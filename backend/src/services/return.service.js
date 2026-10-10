const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');
const { wibDateRange } = require('../utils/wib');
const { nextDailyNumber } = require('../utils/documentNumber');

// ─── helpers ────────────────────────────────────────────────────────

const returnIncludes = {
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
      transactionItem: { select: { id: true, quantity: true, baseQty: true } },
    },
  },
  transaction: {
    select: { id: true, transactionNumber: true, type: true, status: true, total: true, customerName: true, projectId: true },
  },
  creator: { select: { id: true, fullName: true } },
};

// RTN-YYYYMMDD-XXXX (tanggal WIB), diserialkan dengan advisory lock agar
// retur yang dibuat bersamaan tidak mendapat nomor yang sama.
const generateReturnNumber = (tx) => nextDailyNumber(tx, {
  prefix: 'RTN',
  model: 'transactionReturn',
  field: 'returnNumber',
});

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Item subtotal after item discount (qty * price - discount)
const itemNetSubtotal = (item) => {
  if (item.subtotal !== undefined && item.subtotal !== null) return Number(item.subtotal);
  return item.quantity * Number(item.price) - (Number(item.discount) || 0);
};

// ─── public API ─────────────────────────────────────────────────────

const getAll = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, search, startDate, endDate } = {}) => {
  const where = {};

  if (search) {
    where.OR = [
      { returnNumber: { contains: search, mode: 'insensitive' } },
      { transaction: { transactionNumber: { contains: search, mode: 'insensitive' } } },
    ];
  }
  // Tanggal polos (yyyy-MM-dd) dihitung sebagai hari WIB
  const createdAt = wibDateRange(startDate, endDate);
  if (createdAt) where.createdAt = createdAt;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.transactionReturn.findMany({
      where,
      include: returnIncludes,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transactionReturn.count({ where }),
  ]);

  return { data, total, page, limit };
};

const getById = async (id) => {
  const ret = await prisma.transactionReturn.findUnique({
    where: { id },
    include: returnIncludes,
  });

  if (!ret) throw new AppError('Data retur tidak ditemukan', 404);
  return ret;
};

const getByTransactionId = async (transactionId) => {
  return prisma.transactionReturn.findMany({
    where: { transactionId },
    include: {
      items: {
        include: {
          product: { select: { id: true, name: true } },
        },
      },
      creator: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Create a return for a transaction.
 *
 * data shape:
 * {
 *   transactionId: string,
 *   reason?: string,
 *   items: [{ transactionItemId: string, quantity: number }]
 * }
 */
const create = async (data, userId) => {
  const { transactionId, reason, items } = data;

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock the transaction row so concurrent returns / cancel on the same
    //    transaction are serialized, then fetch it with items (under lock).
    await tx.$queryRaw`SELECT id FROM "transactions" WHERE id = ${transactionId} FOR UPDATE`;

    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { items: true },
    });

    if (!transaction) throw new AppError('Transaksi tidak ditemukan', 404);
    if (transaction.status !== 'COMPLETED') {
      throw new AppError('Hanya transaksi COMPLETED yang bisa diretur', 400);
    }

    // 2. Get already-returned quantities (and base qty) per transaction item
    const existingReturns = await tx.transactionReturnItem.groupBy({
      by: ['transactionItemId'],
      where: { transactionReturn: { transactionId } },
      _sum: { quantity: true, baseQty: true },
    });

    const returnedMap = {};
    const returnedBaseMap = {};
    for (const r of existingReturns || []) {
      returnedMap[r.transactionItemId] = Number(r._sum?.quantity) || 0;
      returnedBaseMap[r.transactionItemId] = Number(r._sum?.baseQty) || 0;
    }

    const refundAgg = await tx.transactionReturn.aggregate({
      where: { transactionId },
      _sum: { refundAmount: true },
    });
    const alreadyRefunded = Number(refundAgg?._sum?.refundAmount) || 0;

    // 3. Build item map + header discount ratio
    //    total = subtotal(items) - header discount + tax, so the ratio that
    //    spreads the header discount over the items is (total - tax) / subtotal.
    const itemMap = {};
    let itemsSubtotal = 0;
    for (const item of transaction.items) {
      itemMap[item.id] = item;
      itemsSubtotal += itemNetSubtotal(item);
    }
    const transactionTotal = Number(transaction.total) || 0;
    const discountRatio = itemsSubtotal > 0
      ? Math.max(transactionTotal - (Number(transaction.tax) || 0), 0) / itemsSubtotal
      : 0;

    // 4. Validate and process return items
    let refundAmount = 0;
    const processedItems = [];

    for (const ri of items) {
      const originalItem = itemMap[ri.transactionItemId];
      if (!originalItem) {
        throw new AppError(`Item transaksi ${ri.transactionItemId} tidak ditemukan`, 400);
      }

      const qty = Number(ri.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        throw new AppError('Jumlah retur harus berupa bilangan bulat minimal 1', 400);
      }
      const alreadyReturned = returnedMap[ri.transactionItemId] || 0;
      const maxReturnable = originalItem.quantity - alreadyReturned;

      if (qty > maxReturnable) {
        throw new AppError(
          `Jumlah retur melebihi sisa yang bisa diretur (maks: ${maxReturnable})`,
          400
        );
      }

      // Base qty: never exceed what is left; the last return gets the exact remainder
      const itemBaseQty = originalItem.baseQty > 0 ? originalItem.baseQty : originalItem.quantity;
      const alreadyReturnedBase = returnedBaseMap[ri.transactionItemId] || 0;
      const remainingBase = Math.max(itemBaseQty - alreadyReturnedBase, 0);
      let baseQty;
      if (qty === maxReturnable) {
        baseQty = remainingBase;
      } else {
        const proportional = originalItem.quantity > 0
          ? Math.round(qty * (itemBaseQty / originalItem.quantity))
          : qty;
        baseQty = Math.min(proportional, remainingBase);
      }

      // Refund = share of the item's net subtotal (after item & header discount).
      // Computed cumulatively so the sum over partial returns equals the whole.
      const itemNet = itemNetSubtotal(originalItem) * discountRatio;
      const refundedBefore = round2(itemNet * (alreadyReturned / originalItem.quantity));
      const refundedAfter = round2(itemNet * ((alreadyReturned + qty) / originalItem.quantity));
      const subtotal = round2(refundedAfter - refundedBefore);
      refundAmount = round2(refundAmount + subtotal);

      // Account for the same item appearing more than once in this request
      returnedMap[ri.transactionItemId] = alreadyReturned + qty;
      returnedBaseMap[ri.transactionItemId] = alreadyReturnedBase + baseQty;

      processedItems.push({
        transactionItemId: ri.transactionItemId,
        productId: originalItem.productId,
        quantity: qty,
        baseQty,
        price: originalItem.price,
        subtotal,
      });
    }

    // Cumulative refunds may never exceed the transaction total
    refundAmount = round2(Math.min(refundAmount, Math.max(transactionTotal - alreadyRefunded, 0)));

    // 5. Generate return number
    const returnNumber = await generateReturnNumber(tx);

    // 6. Create TransactionReturn
    const created = await tx.transactionReturn.create({
      data: {
        returnNumber,
        transactionId,
        reason: reason || null,
        refundAmount,
        createdBy: userId,
      },
    });

    // 7. Create return items
    await tx.transactionReturnItem.createMany({
      data: processedItems.map((item) => ({
        transactionReturnId: created.id,
        transactionItemId: item.transactionItemId,
        productId: item.productId,
        quantity: item.quantity,
        baseQty: item.baseQty,
        price: item.price,
        subtotal: item.subtotal,
      })),
    });

    // 8. Restore stock for each item
    // Lock product rows to prevent lost-update race with concurrent
    // returns / transactions / adjustments on the same products.
    const stockProductIds = [...new Set(processedItems.map((p) => p.productId))];
    if (stockProductIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM "products" WHERE id IN (${Prisma.join(stockProductIds)}) ORDER BY id FOR UPDATE`;
    }
    for (const item of processedItems) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) continue;

      const newStock = product.stock + item.baseQty;

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          type: 'IN',
          quantity: item.baseQty,
          previousStock: product.stock,
          newStock,
          referenceType: 'RETURN',
          referenceId: created.id,
          notes: `Retur transaksi ${returnNumber}`,
          createdBy: userId,
        },
      });

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: newStock },
      });
    }

    // 9. Update project.spent if linked
    if (transaction.projectId) {
      await tx.project.update({
        where: { id: transaction.projectId },
        data: { spent: { decrement: refundAmount } },
      });
    }

    return tx.transactionReturn.findUnique({
      where: { id: created.id },
      include: returnIncludes,
    });
  }, { timeout: 30000 });

  // 10. Audit log
  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'transaction_returns',
    recordId: result.id,
    newData: {
      returnNumber: result.returnNumber,
      transactionId,
      refundAmount: result.refundAmount,
      itemCount: items.length,
    },
  });

  return result;
};

module.exports = {
  getAll,
  getById,
  getByTransactionId,
  create,
};
