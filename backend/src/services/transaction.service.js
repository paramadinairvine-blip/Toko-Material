const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const { sendTransactionNotification } = require('./telegram.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { wibDateRange } = require('../utils/wib');
const { nextDailyNumber } = require('../utils/documentNumber');
const { resolveFactor, toBaseQty } = require('../utils/unitResolver');

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
 * Generate the next transaction number for today (WIB).
 * Format: TRX-YYYYMMDD-XXXX (auto-increment per day, serialized by an
 * advisory lock so concurrent creates never get the same number).
 */
const generateTransactionNumber = (tx) => nextDailyNumber(tx, {
  prefix: 'TRX',
  model: 'transaction',
  field: 'transactionNumber',
});

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
  // Tanggal polos (yyyy-MM-dd) dihitung sebagai hari WIB
  const createdAt = wibDateRange(startDate, endDate);
  if (createdAt) where.createdAt = createdAt;
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
  const { items: rawItems, ...header } = data;

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new AppError('Item transaksi wajib diisi', 400);
  }

  // Angka yang lolos validator bisa saja masih berupa string ("2") → paksa
  // jadi number di sini supaya tidak ada "2" + 3 = "23" atau error Prisma.
  const items = rawItems.map((raw) => {
    const quantity = Number(raw?.quantity);
    const price = Number(raw?.price);
    if (!raw?.productId || typeof raw.productId !== 'string') {
      throw new AppError('Product ID wajib diisi pada setiap item', 400);
    }
    if (raw.quantity === '' || raw.quantity === null || !Number.isInteger(quantity) || quantity < 1) {
      throw new AppError('Jumlah item harus berupa bilangan bulat minimal 1', 400);
    }
    if (raw.price === '' || raw.price === null || !Number.isFinite(price) || price < 0) {
      throw new AppError('Harga item harus berupa angka positif', 400);
    }
    return { ...raw, quantity, price, unitId: raw.unitId || null };
  });

  // Sorted so concurrent transactions lock product rows in the same order
  const productIds = [...new Set(items.map((i) => i.productId))].sort();

  // Everything runs inside a single transaction with row-level locking
  // to prevent race conditions on stock checks & deductions.
  const transaction = await prisma.$transaction(async (tx) => {
    // Unit lembaga yang sudah dinonaktifkan tidak boleh dipakai lagi
    if (header.unitLembagaId) {
      const unitLembaga = await tx.unitLembaga.findUnique({ where: { id: header.unitLembagaId } });
      if (!unitLembaga) throw new AppError('Unit lembaga tidak ditemukan', 400);
      if (unitLembaga.isActive === false) {
        throw new AppError(`Unit lembaga ${unitLembaga.name} sudah tidak aktif`, 400);
      }
    }

    // Pengeluaran hanya boleh dibebankan ke proyek yang masih aktif
    if (header.projectId) {
      const project = await tx.project.findUnique({ where: { id: header.projectId } });
      if (!project || project.isActive === false) {
        throw new AppError('Proyek tidak ditemukan', 404);
      }
      if (['COMPLETED', 'CANCELLED'].includes(project.status)) {
        throw new AppError('Proyek sudah selesai atau dibatalkan, transaksi tidak bisa dibebankan ke proyek ini', 400);
      }
    }

    // ── 1. Lock & fetch products using SELECT ... FOR UPDATE ──

    // Step 1a: Lock product rows (FOR UPDATE not allowed with GROUP BY)
    await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`;

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

      if (product.isActive === false) {
        throw new AppError(`Produk ${product.name} sudah tidak aktif dan tidak bisa dijual`, 400);
      }

      // Satuan yang dipilih → faktor konversi ke satuan dasar. Baris
      // ProductUnit dipakai apa pun flag isBaseUnit-nya; satuan yang tidak
      // terdaftar untuk produk ini ditolak (400).
      const factor = resolveFactor(product, product.productUnits, item.unitId);

      // Validate price against current database price
      const currentPrice = Number(product.sellPrice) * factor;
      const sentPrice = item.price;
      if (Math.abs(sentPrice - currentPrice) >= 1) {
        priceChanges.push({
          productId: item.productId,
          unitId: item.unitId,
          productName: product.name,
          oldPrice: sentPrice,
          newPrice: currentPrice,
        });
      }

      // Convert quantity to base unit
      const qty = toBaseQty(item.quantity, factor);

      if (remainingStock[item.productId] - qty < 0) {
        throw new AppError(`Stok ${product.name} tidak mencukupi (tersisa ${remainingStock[item.productId]})`, 400);
      }
      remainingStock[item.productId] -= qty;

      const itemDiscount = Number(item.discount) || 0;
      const grossSubtotal = item.quantity * sentPrice;
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

    // Diskon yang melebihi subtotal tidak lagi dipangkas diam-diam (dulu
    // menghasilkan penjualan Rp 0) — bandingkan dalam sen agar aman dari float.
    if (Math.round(headerDiscount * 100) > Math.round(subtotal * 100)) {
      throw new AppError('Diskon tidak boleh melebihi subtotal transaksi', 400);
    }
    const discount = Math.min(headerDiscount, subtotal);
    const total = subtotal - discount + tax;

    // CASH must be paid in full (compare in cents to avoid float noise)
    if (header.type === 'CASH' && Math.round(paidAmount * 100) < Math.round(total * 100)) {
      throw new AppError('Jumlah pembayaran kurang dari total transaksi', 400);
    }
    const changeAmount = paidAmount > total ? paidAmount - total : 0;

    // paidAt hanya diisi bila benar-benar lunas: CASH selalu lunas (dicek di
    // atas); BON baru dianggap lunas bila paidAmount menutup total.
    const isPaid = header.type === 'CASH'
      || Math.round(paidAmount * 100) >= Math.round(total * 100);

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
        paidAt: isPaid ? new Date() : null,
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
        unitId: item.unitId,
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
      await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`;
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

  const createdAt = wibDateRange(startDate, endDate);
  if (createdAt) where.createdAt = createdAt;

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
