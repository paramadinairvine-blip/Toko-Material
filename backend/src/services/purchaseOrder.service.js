const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { wibDateRange } = require('../utils/wib');
const { nextDailyNumber } = require('../utils/documentNumber');
const { UNIT_NOT_REGISTERED, resolveFactorFromDb, toBaseQty } = require('../utils/unitResolver');

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
  supplier: { select: { id: true, name: true, contactName: true, phone: true, email: true } },
  creator: { select: { id: true, fullName: true, email: true } },
  updater: { select: { id: true, fullName: true } },
};

/**
 * Convert quantity to base-unit quantity using ProductUnit conversion factor.
 * Returns { baseQty, conversionFactor }.
 */
const convertToBaseQty = async (tx, productId, unitId, quantity, product = null) => {
  // ProductUnit (productId, unitId) dipakai apa pun nilai product.unitId
  // maupun flag isBaseUnit; satuan yang tidak terdaftar → 400 (bukan 1:1).
  const conversionFactor = await resolveFactorFromDb(tx, productId, unitId, product);
  return { baseQty: toBaseQty(quantity, conversionFactor), conversionFactor };
};

/**
 * Validasi & normalisasi item PO (angka bisa datang sebagai string).
 */
const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Item purchase order minimal 1 item', 400);
  }
  return items.map((raw) => {
    if (!raw || typeof raw !== 'object' || typeof raw.productId !== 'string' || !raw.productId) {
      throw new AppError('Product ID wajib diisi pada setiap item', 400);
    }
    if (raw.unitId != null && raw.unitId !== '' && typeof raw.unitId !== 'string') {
      throw new AppError('Unit ID tidak valid', 400);
    }
    const rawPrice = raw.price !== undefined ? raw.price : raw.unitPrice;
    const quantity = Number(raw.quantity);
    const price = Number(rawPrice);
    if (raw.quantity === '' || raw.quantity === null || !Number.isInteger(quantity) || quantity < 1) {
      throw new AppError('Jumlah harus bilangan bulat minimal 1', 400);
    }
    if (rawPrice === '' || rawPrice === null || rawPrice === undefined || !Number.isFinite(price) || price < 0) {
      throw new AppError('Harga harus berupa angka positif', 400);
    }
    return { productId: raw.productId, unitId: raw.unitId || null, quantity, price };
  });
};

/**
 * Supplier PO harus ada dan masih aktif.
 */
const assertSupplierActive = async (tx, supplierId) => {
  if (typeof supplierId !== 'string' || !supplierId) {
    throw new AppError('Supplier wajib diisi', 400);
  }
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new AppError('Supplier tidak ditemukan', 400);
  if (supplier.isActive === false) {
    throw new AppError(`Supplier ${supplier.name} sudah tidak aktif`, 400);
  }
};

/**
 * Semua produk pada item PO harus ada dan masih aktif.
 * Mengembalikan map productId → produk.
 */
const loadActiveProducts = async (tx, items) => {
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, unitId: true, isActive: true },
  });
  const map = {};
  for (const p of products || []) map[p.id] = p;

  for (const id of ids) {
    const product = map[id];
    if (!product) throw new AppError(`Produk tidak ditemukan: ${id}`, 400);
    if (product.isActive === false) {
      throw new AppError(`Produk ${product.name} sudah tidak aktif dan tidak bisa dipesan`, 400);
    }
  }
  return map;
};

/**
 * Hitung subtotal & qty satuan dasar untuk item PO yang sudah dinormalisasi.
 */
const buildItemRows = async (tx, items, productMap) => {
  let totalAmount = 0;
  const rows = [];
  for (const item of items) {
    const subtotal = Math.round(item.quantity * item.price * 100) / 100;
    totalAmount += subtotal;

    const { baseQty } = await convertToBaseQty(
      tx, item.productId, item.unitId, item.quantity, productMap[item.productId]
    );
    rows.push({ ...item, baseQty, subtotal });
  }
  return { rows, totalAmount: Math.round(totalAmount * 100) / 100 };
};

/**
 * Konversi qty yang diterima (satuan PO) → satuan dasar saat penerimaan.
 *
 * Faktor diambil dari ProductUnit TERKINI, bukan dari baseQty yang tersimpan
 * di item PO, supaya PO lama yang dulu tersimpan 1:1 ikut benar. Hanya bila
 * satuan itu sudah dihapus dari produk sejak PO dibuat, dipakai rasio
 * baseQty/quantity yang tersimpan saat PO dibuat (agar PO tetap bisa diterima).
 */
const convertReceivedQty = async (tx, item, quantity, product) => {
  try {
    return await convertToBaseQty(tx, item.productId, item.unitId, quantity, product);
  } catch (err) {
    const storedFactor = item.quantity > 0 ? Number(item.baseQty) / item.quantity : 0;
    if (err instanceof AppError && err.message === UNIT_NOT_REGISTERED && storedFactor > 0) {
      logger.warn(
        { productId: item.productId, unitId: item.unitId, storedFactor },
        'Satuan PO sudah tidak terdaftar pada produk, memakai rasio konversi yang tersimpan di item PO'
      );
      return { baseQty: toBaseQty(quantity, storedFactor), conversionFactor: storedFactor };
    }
    throw err;
  }
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
 * Format: PO-YYYYMMDD-XXXX (tanggal WIB), diserialkan dengan advisory lock
 * agar PO yang dibuat bersamaan tidak mendapat nomor yang sama.
 */
const generatePONumber = (tx) => nextDailyNumber(tx, {
  prefix: 'PO',
  model: 'purchaseOrder',
  field: 'poNumber',
});

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
  search,
} = {}) => {
  const where = {};

  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  // Tanggal polos (yyyy-MM-dd) dihitung sebagai hari WIB
  const createdAt = wibDateRange(startDate, endDate);
  if (createdAt) where.createdAt = createdAt;

  const keyword = typeof search === 'string' ? search.trim() : '';
  if (keyword) {
    where.OR = [
      { poNumber: { contains: keyword, mode: 'insensitive' } },
      { supplier: { name: { contains: keyword, mode: 'insensitive' } } },
    ];
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
  const { items: rawItems, ...header } = data;
  const items = normalizeItems(rawItems);

  const po = await prisma.$transaction(async (tx) => {
    // Master data yang sudah dinonaktifkan tidak boleh dipakai di PO baru
    await assertSupplierActive(tx, header.supplierId);
    const productMap = await loadActiveProducts(tx, items);

    // Calculate totals & convert to base qty
    const { rows: processedItems, totalAmount } = await buildItemRows(tx, items, productMap);

    const poNumber = await generatePONumber(tx);

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

  const { items: rawItems, ...header } = data;
  const items = rawItems !== undefined ? normalizeItems(rawItems) : undefined;

  const po = await prisma.$transaction(async (tx) => {
    // Update header fields
    const updateData = {};
    if (header.supplierId) {
      if (header.supplierId !== existing.supplierId) {
        await assertSupplierActive(tx, header.supplierId);
      }
      updateData.supplierId = header.supplierId;
    }
    if (header.notes !== undefined) updateData.notes = header.notes;
    if (header.orderDate) updateData.orderDate = new Date(header.orderDate);
    updateData.updatedBy = userId;

    // Replace items if provided
    if (items !== undefined) {
      const productMap = await loadActiveProducts(tx, items);
      const { rows, totalAmount } = await buildItemRows(tx, items, productMap);

      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });

      for (const item of rows) {
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: id,
            productId: item.productId,
            unitId: item.unitId,
            quantity: item.quantity,
            baseQty: item.baseQty,
            price: item.price,
            subtotal: item.subtotal,
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
  // Validasi bentuk request sebelum menyentuh DB: array tidak kosong,
  // itemId string, receivedQty bilangan bulat ≥ 0 ("2" dipaksa jadi 2 agar
  // tidak ter-concat jadi "23"; desimal/negatif/non-angka ditolak).
  if (!Array.isArray(receivedItems) || receivedItems.length === 0) {
    throw new AppError('Daftar barang yang diterima (receivedItems) wajib diisi', 400);
  }

  // Build a map of itemId → receivedQty for this batch
  const receivedMap = new Map();
  for (const ri of receivedItems) {
    if (!ri || typeof ri !== 'object' || typeof ri.itemId !== 'string' || !ri.itemId) {
      throw new AppError('Item ID wajib diisi pada setiap barang yang diterima', 400);
    }
    const raw = ri.receivedQty;
    const qty = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 0) {
      throw new AppError('Jumlah diterima harus berupa bilangan bulat minimal 0', 400);
    }
    // Item yang sama dikirim dua kali → dijumlahkan
    receivedMap.set(ri.itemId, (receivedMap.get(ri.itemId) || 0) + qty);
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

    // Setiap itemId harus milik PO ini, dan minimal satu item yang masih
    // punya sisa benar-benar diterima (> 0). Kalau tidak → 400 tanpa
    // mengubah status PO.
    const poItemMap = new Map(existing.items.map((item) => [item.id, item]));
    let hasEffectiveReceipt = false;
    for (const [itemId, qty] of receivedMap) {
      const poItem = poItemMap.get(itemId);
      if (!poItem) {
        throw new AppError(`Item ${itemId} bukan bagian dari purchase order ini`, 400);
      }
      if (qty > 0 && poItem.receivedQty < poItem.quantity) hasEffectiveReceipt = true;
    }
    if (!hasEffectiveReceipt) {
      throw new AppError('Tidak ada barang yang diterima. Isi jumlah diterima minimal 1 untuk item yang belum lengkap', 400);
    }

    // Kunci baris produk yang stoknya akan bertambah
    const productIds = [...new Set(
      existing.items
        .filter((item) => (receivedMap.get(item.id) ?? 0) > 0)
        .map((item) => item.productId)
    )].sort();
    if (productIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`;
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

      // Baris produk sudah dikunci di atas
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) {
        throw new AppError(`Produk ${item.productId} tidak ditemukan`, 400);
      }

      // *** KONVERSI KE BASE UNIT ***
      const { baseQty: addBaseQty, conversionFactor } = await convertReceivedQty(
        tx, item, actualAddQty, product
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

      // Add stock in BASE UNIT (StockMovement IN)
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
 * Cancel a purchase order (DRAFT, SENT or PARTIALLY_RECEIVED).
 *
 * Membatalkan PO yang sudah diterima sebagian TIDAK menarik kembali stok yang
 * sudah masuk — yang dibatalkan hanya sisa yang belum diterima.
 *
 * Baris PO dikunci (FOR UPDATE) dan status dibaca ulang di dalam transaksi
 * DB, sama seperti receive(), sehingga cancel dan receive yang bersamaan
 * diproses berurutan: yang kedua selalu melihat status hasil yang pertama.
 */
const cancel = async (id, userId) => {
  const { po, previousStatus } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "purchase_orders" WHERE id = ${id} FOR UPDATE`;

    const existing = await tx.purchaseOrder.findUnique({ where: { id } });

    if (!existing) throw new AppError('Purchase order tidak ditemukan', 404);
    if (existing.status === 'CANCELLED') {
      throw new AppError('Purchase order sudah dibatalkan sebelumnya', 400);
    }
    if (!['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(existing.status)) {
      throw new AppError('PO yang sudah diterima sepenuhnya tidak dapat dibatalkan', 400);
    }

    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED', updatedBy: userId },
      include: poIncludes,
    });

    return { po: updated, previousStatus: existing.status };
  }, { timeout: 15000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'purchase_orders',
    recordId: id,
    oldData: { status: previousStatus },
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
