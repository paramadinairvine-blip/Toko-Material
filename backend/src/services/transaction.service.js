const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { format } = require('date-fns');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const { sendTransactionNotification } = require('./telegram.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

// Format tanggal dalam WIB (+07:00)
const formatWIB = (date, fmt) => {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return format(wib, fmt);
};

// ─── helpers ────────────────────────────────────────────────────────

const transactionIncludes = {
  items: {
    include: {
      product: {
        select: { id: true, name: true, sku: true, barcode: true, unit: true, unitOfMeasure: { select: { id: true, name: true, abbreviation: true } } },
      },
      unit: { select: { id: true, name: true, abbreviation: true } },
    },
  },
  creator: { select: { id: true, fullName: true, email: true } },
  updater: { select: { id: true, fullName: true } },
  project: { select: { id: true, name: true } },
  unitLembaga: { select: { id: true, name: true } },
};

/**
 * Generate the next transaction number for today.
 * Format: TRX-YYYYMMDD-XXXX (auto-increment per day).
 */
const generateTransactionNumber = async (tx) => {
  const today = formatWIB(new Date(), 'yyyyMMdd');
  const prefix = `TRX-${today}-`;

  const last = await tx.transaction.findFirst({
    where: { transactionNumber: { startsWith: prefix } },
    orderBy: { transactionNumber: 'desc' },
    select: { transactionNumber: true },
  });

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(last.transactionNumber.replace(prefix, ''), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(4, '0')}`;
};

/**
 * Convert quantity to base-unit quantity using ProductUnit conversion factor.
 * Returns the original quantity if no conversion is needed / found.
 */
const convertToBaseQty = async (tx, productId, unitId, quantity) => {
  if (!unitId) return quantity;

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { unitId: true },
  });

  if (!product || !product.unitId || product.unitId === unitId) return quantity;

  const pu = await tx.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId } },
  });

  if (pu) return Math.round(quantity * Number(pu.conversionFactor));
  return quantity;
};

/**
 * Deduct stock for a single product inside an existing prisma transaction.
 * Creates a StockMovement OUT record.
 */
const deductStock = async (tx, { productId, quantity, referenceId, userId, unitId }) => {
  const qty = await convertToBaseQty(tx, productId, unitId, quantity);
  const product = await tx.product.findUnique({ where: { id: productId } });

  if (!product) throw new AppError('Produk tidak ditemukan', 404);

  const newStock = product.stock - qty;
  if (newStock < 0) {
    throw new AppError(`Stok ${product.name} tidak mencukupi (tersisa ${product.stock})`, 400);
  }

  await tx.stockMovement.create({
    data: {
      productId,
      type: 'OUT',
      quantity: qty,
      previousStock: product.stock,
      newStock,
      referenceType: 'TRANSACTION',
      referenceId,
      notes: `Penjualan transaksi`,
      createdBy: userId,
    },
  });

  await tx.product.update({ where: { id: productId }, data: { stock: newStock } });
};

/**
 * Restore stock for a single product inside an existing prisma transaction.
 * Creates a StockMovement IN record (used by cancel).
 */
const restoreStock = async (tx, { productId, quantity, referenceId, userId, unitId }) => {
  const qty = await convertToBaseQty(tx, productId, unitId, quantity);
  const product = await tx.product.findUnique({ where: { id: productId } });

  if (!product) throw new AppError('Produk tidak ditemukan', 404);

  const newStock = product.stock + qty;

  await tx.stockMovement.create({
    data: {
      productId,
      type: 'IN',
      quantity: qty,
      previousStock: product.stock,
      newStock,
      referenceType: 'TRANSACTION',
      referenceId,
      notes: `Pembatalan transaksi`,
      createdBy: userId,
    },
  });

  await tx.product.update({ where: { id: productId }, data: { stock: newStock } });
};

// ─── public API ─────────────────────────────────────────────────────

/**
 * List transactions with filters and pagination.
 */
const getAll = async ({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  type,
  status,
  unitLembagaId,
  startDate,
  endDate,
  search,
  customerName,
} = {}) => {
  const where = {};

  if (type) where.type = type;
  if (status) where.status = status;
  if (unitLembagaId) where.unitLembagaId = unitLembagaId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      if (!String(endDate).includes('T')) end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  if (search) {
    where.transactionNumber = { contains: search, mode: 'insensitive' };
  }
  if (customerName) {
    where.customerName = { contains: customerName, mode: 'insensitive' };
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: transactionIncludes,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Get a single transaction by ID with full relations.
 */
const getById = async (id) => {
  const trx = await prisma.transaction.findUnique({
    where: { id },
    include: transactionIncludes,
  });

  if (!trx) throw new AppError('Transaksi tidak ditemukan', 404);
  return trx;
};

/**
 * Create a new transaction.
 *
 * data shape:
 * {
 *   type: 'CASH' | 'BON',
 *   customerName?, customerPhone?, notes?,
 *   discount?, tax?, paidAmount?,
 *   projectId?, unitLembagaId?, kepanitiaan?,
 *   items: [{ productId, quantity, price, discount?, unitId? }]
 * }
 */
const create = async (data, userId) => {
  const { items, ...header } = data;
  const productIds = [...new Set(items.map((i) => i.productId))];

  // Everything runs inside a single transaction with row-level locking
  // to prevent race conditions on stock checks & deductions.
  const transaction = await prisma.$transaction(async (tx) => {
    // ── 1. Lock & fetch products using SELECT ... FOR UPDATE ──

    // Step 1a: Lock product rows (FOR UPDATE not allowed with GROUP BY)
    await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;

    // Step 1b: Fetch products with units (rows are now locked)
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      include: { productUnits: true },
    });

    const productMap = {};
    for (const p of products) {
      productMap[p.id] = p;
    }

    // ── 2. Validate stock & calculate totals ──
    let subtotal = 0;
    const processedItems = [];
    // Track remaining stock per product for duplicate product validation
    const remainingStock = {};
    for (const p of products) {
      remainingStock[p.id] = p.stock;
    }

    const priceChanges = [];
    for (const item of items) {
      const product = productMap[item.productId];
      if (!product) {
        throw new AppError(`Produk tidak ditemukan: ${item.productId}`, 404);
      }

      // Validate price against current database price
      let currentPrice = Number(product.sellPrice);
      if (item.unitId) {
        const pu = product.productUnits.find(
          (u) => u.unitId === item.unitId && !u.isBaseUnit
        );
        if (pu) {
          currentPrice = Number(pu.unitPrice || product.sellPrice) * Number(pu.conversionFactor);
        }
      }
      const sentPrice = Number(item.price);
      if (Math.abs(sentPrice - currentPrice) >= 1) {
        priceChanges.push({
          productId: item.productId,
          productName: product.name,
          oldPrice: sentPrice,
          newPrice: currentPrice,
        });
      }

      // Convert quantity to base unit if a non-base unit is selected
      let qty = item.quantity;
      if (item.unitId) {
        const pu = product.productUnits.find(
          (u) => u.unitId === item.unitId && !u.isBaseUnit
        );
        if (pu) qty = Math.round(item.quantity * Number(pu.conversionFactor));
      }

      if (remainingStock[item.productId] - qty < 0) {
        throw new AppError(`Stok ${product.name} tidak mencukupi (tersisa ${remainingStock[item.productId]})`, 400);
      }
      remainingStock[item.productId] -= qty;

      const itemDiscount = Number(item.discount) || 0;
      const grossSubtotal = Number(item.quantity) * sentPrice;
      if (itemDiscount < 0 || itemDiscount > grossSubtotal) {
        throw new AppError(`Diskon item ${product.name} tidak valid`, 400);
      }
      const itemSubtotal = grossSubtotal - itemDiscount;
      subtotal += itemSubtotal;
      processedItems.push({ ...item, price: sentPrice, discount: itemDiscount, subtotal: itemSubtotal, baseQty: qty });
    }

    if (priceChanges.length > 0) {
      const names = priceChanges.map((p) => p.productName).join(', ');
      const err = new AppError(
        `Harga ${names} sudah berubah. Silakan refresh data produk.`,
        409
      );
      err.code = 'PRICE_CHANGED';
      err.priceChanges = priceChanges;
      throw err;
    }

    const headerDiscount = Number(header.discount) || 0;
    const tax = Number(header.tax) || 0;
    const paidAmount = Number(header.paidAmount) || 0;
    if (headerDiscount < 0) throw new AppError('Diskon tidak boleh negatif', 400);
    if (tax < 0) throw new AppError('Pajak tidak boleh negatif', 400);
    if (paidAmount < 0) throw new AppError('Jumlah bayar tidak boleh negatif', 400);

    const discount = Math.min(headerDiscount, subtotal);
    const total = subtotal - discount + tax;

    // CASH must be paid in full (compare in cents to avoid float noise)
    if (header.type === 'CASH' && Math.round(paidAmount * 100) < Math.round(total * 100)) {
      throw new AppError('Jumlah pembayaran kurang dari total transaksi', 400);
    }
    const changeAmount = paidAmount > total ? paidAmount - total : 0;

    // ── 3. Write transaction data ──
    const transactionNumber = await generateTransactionNumber(tx);

    const created = await tx.transaction.create({
      data: {
        transactionNumber,
        type: header.type,
        status: 'COMPLETED',
        customerName: header.customerName || null,
        customerPhone: header.customerPhone || null,
        notes: header.notes || null,
        subtotal,
        discount,
        tax,
        total,
        paidAmount,
        changeAmount,
        dueDate: header.dueDate ? new Date(header.dueDate) : null,
        paidAt: new Date(),
        projectId: header.projectId || null,
        unitLembagaId: header.unitLembagaId || null,
        kepanitiaan: header.kepanitiaan || null,
        createdBy: userId,
      },
    });

    await tx.transactionItem.createMany({
      data: processedItems.map((item) => ({
        transactionId: created.id,
        productId: item.productId,
        unitId: item.unitId || null,
        quantity: item.quantity,
        baseQty: item.baseQty,
        price: item.price,
        discount: item.discount,
        subtotal: item.subtotal,
      })),
    });

    // ── 4. Deduct stock (data already locked, safe from race condition) ──
    for (const item of processedItems) {
      const product = productMap[item.productId];
      const newStock = product.stock - item.baseQty;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'OUT',
          quantity: item.baseQty,
          previousStock: product.stock,
          newStock,
          referenceType: 'TRANSACTION',
          referenceId: created.id,
          notes: 'Penjualan transaksi',
          createdBy: userId,
        },
      });

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: newStock },
      });

      // Update local map for duplicate products in same transaction
      product.stock = newStock;
    }

    // Update project spent if linked
    if (header.projectId) {
      await tx.project.update({
        where: { id: header.projectId },
        data: { spent: { increment: total } },
      });
    }

    return tx.transaction.findUnique({
      where: { id: created.id },
      include: transactionIncludes,
    });
  }, { timeout: 30000 });

  // Audit log
  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'transactions',
    recordId: transaction.id,
    newData: {
      transactionNumber: transaction.transactionNumber,
      type: transaction.type,
      total: transaction.total,
      itemCount: items.length,
    },
  });

  // If BON, create in-app notification for admins (fire-and-forget)
  if (data.type === 'BON') {
    sendBonNotification(transaction).catch((err) => logger.error('BON notification failed:', err.message));
  }

  // Send Telegram notification (fire-and-forget)
  sendTransactionNotification(transaction).catch((err) => logger.error('Telegram notification failed:', err.message));

  // Check low stock & out of stock after transaction (fire-and-forget)
  checkStockAfterTransaction(productIds).catch((err) => logger.error('Stock notification failed:', err.message));

  return transaction;
};

/**
 * Cancel a transaction: set status=CANCELLED, restore stock that has not
 * been returned yet, and revert project.spent by the non-refunded amount.
 *
 * Everything (status check, returned quantities, stock writes) happens inside
 * one DB transaction with the transaction row locked, so a concurrent cancel
 * or return on the same transaction is serialized.
 */
const cancel = async (id, userId) => {
  let previousStatus;

  const transaction = await prisma.$transaction(async (tx) => {
    // Lock the transaction row first (serializes with returns / other cancels)
    await tx.$queryRaw`SELECT id FROM "transactions" WHERE id = ${id} FOR UPDATE`;

    const existing = await tx.transaction.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) throw new AppError('Transaksi tidak ditemukan', 404);
    if (existing.status === 'CANCELLED') {
      throw new AppError('Transaksi sudah dibatalkan sebelumnya', 400);
    }
    previousStatus = existing.status;

    // Base qty already returned per transaction item (re-read under lock)
    const returned = await tx.transactionReturnItem.groupBy({
      by: ['transactionItemId'],
      where: { transactionReturn: { transactionId: id } },
      _sum: { baseQty: true },
    });
    const returnedBaseMap = {};
    for (const r of returned || []) {
      returnedBaseMap[r.transactionItemId] = Number(r._sum?.baseQty) || 0;
    }

    const refundAgg = await tx.transactionReturn.aggregate({
      where: { transactionId: id },
      _sum: { refundAmount: true },
    });
    const totalRefunded = Number(refundAgg?._sum?.refundAmount) || 0;

    // Compute how much to restore per item (only what has not been returned)
    const restores = [];
    for (const item of existing.items) {
      // Use baseQty if available (new transactions), fallback to quantity (old data)
      const itemBaseQty = item.baseQty || item.quantity;
      const restoreQty = itemBaseQty - (returnedBaseMap[item.id] || 0);
      if (restoreQty > 0) restores.push({ productId: item.productId, quantity: restoreQty });
    }

    // Lock product rows to prevent lost updates with concurrent stock writes
    const productIds = [...new Set(restores.map((r) => r.productId))];
    if (productIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE`;
    }

    for (const { productId, quantity } of restores) {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) continue;

      const newStock = product.stock + quantity;

      await tx.stockMovement.create({
        data: {
          productId,
          type: 'IN',
          quantity,
          previousStock: product.stock,
          newStock,
          referenceType: 'TRANSACTION',
          referenceId: id,
          notes: 'Pembatalan transaksi',
          createdBy: userId,
        },
      });

      await tx.product.update({
        where: { id: productId },
        data: { stock: newStock },
      });
    }

    // Revert project spent if linked (refunds were already decremented by returns)
    if (existing.projectId) {
      const revertAmount = Math.round((Number(existing.total) - totalRefunded) * 100) / 100;
      if (revertAmount > 0) {
        await tx.project.update({
          where: { id: existing.projectId },
          data: { spent: { decrement: revertAmount } },
        });
      }
    }

    return tx.transaction.update({
      where: { id },
      data: { status: 'CANCELLED', updatedBy: userId },
      include: transactionIncludes,
    });
  }, { timeout: 30000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'transactions',
    recordId: id,
    oldData: { status: previousStatus },
    newData: { status: 'CANCELLED' },
  });

  return transaction;
};

/**
 * Get transactions for a specific unit lembaga, optionally within a date range.
 */
const getByUnitLembaga = async (unitLembagaId, { startDate, endDate, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) => {
  const where = { unitLembagaId };

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      if (!String(endDate).includes('T')) end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: transactionIncludes,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return { data, total, page, limit };
};

// ─── In-app notification ─────────────────────────────────────────────

/**
 * Create in-app notification about a BON transaction for admins.
 */
/**
 * Check stock levels after transaction and notify admins if low/out of stock.
 */
const checkStockAfterTransaction = async (productIds) => {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, stock: true, minStock: true, sku: true },
  });

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true, deletedAt: null },
    select: { id: true },
  });

  if (admins.length === 0) return;

  const notifications = [];

  for (const product of products) {
    if (product.stock <= 0) {
      notifications.push(...admins.map((admin) => ({
        userId: admin.id,
        title: 'Stok Habis!',
        message: `Stok ${product.name} (${product.sku}) sudah habis! Segera lakukan restok.`,
        type: 'LOW_STOCK',
        status: 'PENDING',
      })));
    } else if (product.minStock > 0 && product.stock <= product.minStock) {
      notifications.push(...admins.map((admin) => ({
        userId: admin.id,
        title: 'Stok Menipis',
        message: `Stok ${product.name} (${product.sku}) tinggal ${product.stock} (minimum: ${product.minStock}).`,
        type: 'LOW_STOCK',
        status: 'PENDING',
      })));
    }
  }

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }
};

const sendBonNotification = async (transaction) => {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        title: 'Transaksi Overbooking TU Baru',
        message: `Transaksi Overbooking TU ${transaction.transactionNumber} sebesar Rp ${Number(transaction.total).toLocaleString('id-ID')} oleh ${transaction.customerName || 'pelanggan'}.`,
        type: 'TRANSACTION_BON',
        status: 'PENDING',
      })),
    });
  }
};

module.exports = {
  getAll,
  getById,
  create,
  cancel,
  getByUnitLembaga,
};
