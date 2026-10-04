const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { format } = require('date-fns');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const formatWIB = (date, fmt) => {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return format(wib, fmt);
};

// ─── helpers ────────────────────────────────────────────────────────

const poIncludes = {
  items: {
    include: {
      product: {
        select: {
          id: true, name: true, sku: true, barcode: true,
          unit: true, buyPrice: true, unitId: true,
          unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
          productUnits: {
            include: { unit: { select: { id: true, name: true, abbreviation: true } } },
          },
        },
      },
      unit: { select: { id: true, name: true, abbreviation: true } },
    },
  },
  supplier: { select: { id: true, name: true, contactName: true, phone: true } },
  creator: { select: { id: true, fullName: true, email: true } },
  updater: { select: { id: true, fullName: true } },
};

/**
 * Convert quantity to base-unit quantity using ProductUnit conversion factor.
 * Returns { baseQty, conversionFactor }.
 */
const convertToBaseQty = async (tx, productId, unitId, quantity) => {
  if (!unitId) return { baseQty: quantity, conversionFactor: 1 };

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { unitId: true },
  });

  // Jika tidak ada product atau unitId sama = sudah base unit
  if (!product || !product.unitId || product.unitId === unitId) {
    return { baseQty: quantity, conversionFactor: 1 };
  }

  const pu = await tx.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId } },
  });

  if (pu) {
    const factor = Number(pu.conversionFactor);
    if (!factor || factor <= 0) {
      throw new AppError(`Conversion factor untuk produk tidak valid (${factor}). Periksa konfigurasi satuan.`, 400);
    }
    return { baseQty: Math.round(quantity * factor), conversionFactor: factor };
  }

  // Tidak ditemukan ProductUnit, anggap 1:1 — log warning agar admin tahu
  logger.warn(
    { productId, unitId, quantity },
    'ProductUnit conversion not found, falling back to 1:1. Periksa konfigurasi satuan produk ini.'
  );
  return { baseQty: quantity, conversionFactor: 1 };
};

/**
 * Harga per satuan PO → harga per satuan dasar (dibulatkan 2 desimal).
 */
const toBasePrice = (price, conversionFactor = 1) => {
  const factor = Number(conversionFactor) || 1;
  return Math.round((Number(price) / factor) * 100) / 100;
};

/**
 * Generate the next PO number for today.
 * Format: PO-YYYYMMDD-XXXX
 */
const generatePONumber = async (tx) => {
  const today = formatWIB(new Date(), 'yyyyMMdd');
  const prefix = `PO-${today}-`;

  const last = await tx.purchaseOrder.findFirst({
    where: { poNumber: { startsWith: prefix } },
    orderBy: { poNumber: 'desc' },
    select: { poNumber: true },
  });

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.poNumber.replace(prefix, ''), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
};

// ─── public API ─────────────────────────────────────────────────────

/**
 * List purchase orders with filters and pagination.
 */
const getAll = async ({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  status,
  supplierId,
  startDate,
  endDate,
} = {}) => {
  const where = {};

  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: poIncludes,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Get a single purchase order by ID with full relations.
 */
const getById = async (id) => {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: poIncludes,
  });

  if (!po) throw new AppError('Purchase order tidak ditemukan', 404);
  return po;
};

/**
 * Create a new purchase order.
 *
 * data shape:
 * {
 *   supplierId, notes?,
 *   items: [{ productId, unitId?, quantity, price }]
 * }
 */
const create = async (data, userId) => {
  const { items, ...header } = data;

  const po = await prisma.$transaction(async (tx) => {
    const poNumber = await generatePONumber(tx);

    // Calculate totals & convert to base qty
    let totalAmount = 0;
    const processedItems = [];

    for (const item of items) {
      const subtotal = item.quantity * item.price;
      totalAmount += subtotal;

      const { baseQty } = await convertToBaseQty(tx, item.productId, item.unitId, item.quantity);

      processedItems.push({
        ...item,
        subtotal,
        baseQty,
        unitId: item.unitId || null,
      });
    }

    const created = await tx.purchaseOrder.create({
      data: {
        poNumber,
        supplierId: header.supplierId,
        status: 'DRAFT',
        notes: header.notes || null,
        totalAmount,
        orderDate: header.orderDate ? new Date(header.orderDate) : new Date(),
        createdBy: userId,
      },
    });

    for (const item of processedItems) {
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: created.id,
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          baseQty: item.baseQty,
          price: item.price,
          subtotal: item.subtotal,
        },
      });
    }

    return tx.purchaseOrder.findUnique({
      where: { id: created.id },
      include: poIncludes,
    });
  }, { timeout: 15000 });

  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'purchase_orders',
    recordId: po.id,
    newData: { poNumber: po.poNumber, supplierId: po.supplierId, totalAmount: po.totalAmount, itemCount: items.length },
  });

  return po;
};

/**
 * Update a purchase order (only allowed when status is DRAFT).
 */
const update = async (id, data, userId) => {
  const existing = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!existing) throw new AppError('Purchase order tidak ditemukan', 404);
  if (existing.status !== 'DRAFT') {
    throw new AppError('Hanya PO berstatus DRAFT yang dapat diubah', 400);
  }

  const { items, ...header } = data;

  const po = await prisma.$transaction(async (tx) => {
    // Update header fields
    const updateData = {};
    if (header.supplierId) updateData.supplierId = header.supplierId;
    if (header.notes !== undefined) updateData.notes = header.notes;
    if (header.orderDate) updateData.orderDate = new Date(header.orderDate);
    updateData.updatedBy = userId;

    // Replace items if provided
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        throw new AppError('Item purchase order minimal 1 item', 400);
      }

      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

      let totalAmount = 0;
      for (const rawItem of items) {
        const item = { ...rawItem, quantity: Number(rawItem.quantity), price: Number(rawItem.price) };
        const subtotal = item.quantity * item.price;
        totalAmount += subtotal;

        const { baseQty } = await convertToBaseQty(tx, item.productId, item.unitId, item.quantity);

        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: id,
            productId: item.productId,
            unitId: item.unitId || null,
            quantity: item.quantity,
            baseQty,
            price: item.price,
            subtotal,
          },
        });
      }
      updateData.totalAmount = totalAmount;
    }

    await tx.purchaseOrder.update({ where: { id }, data: updateData });

    return tx.purchaseOrder.findUnique({
      where: { id },
      include: poIncludes,
    });
  }, { timeout: 15000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'purchase_orders',
    recordId: id,
    oldData: existing,
    newData: po,
  });

  return po;
};

/**
 * Send a purchase order (change status DRAFT → SENT).
 */
const send = async (id, userId) => {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });

  if (!existing) throw new AppError('Purchase order tidak ditemukan', 404);
  if (existing.status !== 'DRAFT') {
    throw new AppError('Hanya PO berstatus DRAFT yang dapat dikirim', 400);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'SENT', updatedBy: userId },
    include: poIncludes,
  });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'purchase_orders',
    recordId: id,
    oldData: { status: 'DRAFT' },
    newData: { status: 'SENT' },
  });

  return po;
};

/**
 * Receive a purchase order.
 *
 * receivedItems shape:
 * [{ itemId, receivedQty }]
 *
 * Steps:
 *   1. Update receivedQty & receivedBaseQty per item
 *   2. Add stock in BASE UNIT (converted) via StockMovement IN
 *   3. Update buy price if PO price differs → record PriceHistory
 *   4. Change status to PARTIALLY_RECEIVED or RECEIVED
 *   5. Create in-app notification
 */
const receive = async (id, receivedItems, userId) => {
  // Build a map of itemId → receivedQty for this batch
  const receivedMap = new Map();
  if (receivedItems && receivedItems.length > 0) {
    for (const ri of receivedItems) {
      receivedMap.set(ri.itemId, ri.receivedQty);
    }
  }

  const { po, previousStatus, itemCount } = await prisma.$transaction(async (tx) => {
    // Kunci baris PO dulu agar dua penerimaan bersamaan untuk PO yang sama
    // diproses berurutan (yang kedua membaca receivedQty & status terbaru).
    await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${id} FOR UPDATE`;

    const existing = await tx.purchaseOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) throw new AppError('Purchase order tidak ditemukan', 404);
    if (existing.status === 'RECEIVED') {
      throw new AppError('Purchase order sudah diterima sepenuhnya', 400);
    }
    if (existing.status === 'CANCELLED') {
      throw new AppError('Purchase order yang dibatalkan tidak dapat diterima', 400);
    }
    if (existing.status === 'DRAFT') {
      throw new AppError('PO berstatus DRAFT belum bisa diterima, kirim dulu ke supplier', 400);
    }
    if (!existing.items || existing.items.length === 0) {
      throw new AppError('Purchase order tidak memiliki item untuk diterima', 400);
    }

    // Kunci baris produk yang stoknya akan bertambah
    const productIds = [...new Set(
      existing.items
        .filter((item) => (receivedMap.get(item.id) ?? 0) > 0)
        .map((item) => item.productId)
    )].sort();
    if (productIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
    }

    let allFullyReceived = true;

    for (const item of existing.items) {
      // For this batch: how many are being received now (in PO unit)
      const batchQty = receivedMap.get(item.id) ?? 0;

      // Skip items with 0 qty in this batch
      if (batchQty <= 0) {
        // Check if this item is already fully received
        if (item.receivedQty < item.quantity) allFullyReceived = false;
        continue;
      }

      // Calculate new total receivedQty (accumulated, in PO unit)
      const newReceivedQty = item.receivedQty + batchQty;
      const cappedReceivedQty = Math.min(newReceivedQty, item.quantity);

      // Actual qty to add (in PO unit)
      const actualAddQty = cappedReceivedQty - item.receivedQty;
      if (actualAddQty <= 0) {
        // Already fully received for this item
        continue;
      }

      // *** KONVERSI KE BASE UNIT ***
      const { baseQty: addBaseQty, conversionFactor } = await convertToBaseQty(
        tx, item.productId, item.unitId, actualAddQty
      );

      // Hitung receivedBaseQty baru
      const newReceivedBaseQty = (item.receivedBaseQty || 0) + addBaseQty;

      // Update PO item receivedQty & receivedBaseQty
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          receivedQty: cappedReceivedQty,
          receivedBaseQty: newReceivedBaseQty,
        },
      });

      if (cappedReceivedQty < item.quantity) {
        allFullyReceived = false;
      }

      // Add stock in BASE UNIT (StockMovement IN) — baris produk sudah dikunci
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new AppError(`Produk ${item.productId} tidak ditemukan`, 400);
      }
      const previousStock = product.stock;
      const newStock = previousStock + addBaseQty; // ← Pakai base qty!

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'IN',
          quantity: addBaseQty, // ← Simpan dalam base unit
          previousStock,
          newStock,
          referenceType: 'PO',
          referenceId: id,
          notes: `Penerimaan PO ${existing.poNumber} — ${actualAddQty} ${item.unitId ? 'unit' : 'pcs'} (=${addBaseQty} base)`,
          createdBy: userId,
        },
      });

      // Harga PO adalah harga per satuan PO (mis. per dus), sedangkan buyPrice
      // produk disimpan per satuan dasar → bagi dengan conversion factor.
      const poBuyPrice = toBasePrice(item.price, conversionFactor);
      const currentBuyPrice = Number(product.buyPrice);
      const productUpdate = { stock: { increment: addBaseQty } };

      if (poBuyPrice !== currentBuyPrice) {
        await tx.priceHistory.create({
          data: {
            productId: item.productId,
            oldBuy: product.buyPrice,
            newBuy: poBuyPrice,
            oldSell: product.sellPrice,
            newSell: product.sellPrice, // sell price unchanged
            changedBy: userId,
          },
        });
        productUpdate.buyPrice = poBuyPrice;
      }

      await tx.product.update({
        where: { id: item.productId },
        data: productUpdate,
      });
    }

    const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        receivedAt: allFullyReceived ? new Date() : existing.receivedAt,
        updatedBy: userId,
      },
      include: poIncludes,
    });

    return { po: updated, previousStatus: existing.status, itemCount: existing.items.length };
  }, { timeout: 30000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'purchase_orders',
    recordId: id,
    oldData: { status: previousStatus },
    newData: { status: po.status, receivedItemCount: itemCount },
  });

  // In-app notification for admins (fire-and-forget)
  sendReceiveNotification(po).catch(() => {});

  return po;
};

/**
 * Cancel a purchase order (only DRAFT or SENT).
 */
const cancel = async (id, userId) => {
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });

  if (!existing) throw new AppError('Purchase order tidak ditemukan', 404);
  if (!['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(existing.status)) {
    throw new AppError('PO yang sudah diterima sepenuhnya tidak dapat dibatalkan', 400);
  }

  const po = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'CANCELLED', updatedBy: userId },
    include: poIncludes,
  });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'purchase_orders',
    recordId: id,
    oldData: { status: existing.status },
    newData: { status: 'CANCELLED' },
  });

  return po;
};

// ─── In-app notification ─────────────────────────────────────────────

const sendReceiveNotification = async (po) => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title: 'Barang PO Diterima',
        message: `PO ${po.poNumber} dari ${po.supplier?.name || 'supplier'} telah diterima. Total: Rp ${Number(po.totalAmount).toLocaleString('id-ID')}.`,
        type: 'PO_RECEIVED',
        status: 'PENDING',
      })),
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  send,
  receive,
  cancel,
};
