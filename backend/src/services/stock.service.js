const prisma = require('../lib/prisma');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
// Day boundaries in WIB (+07:00) for 'yyyy-MM-dd'; full ISO strings are used as-is
const { wibDateRange } = require('../utils/wib');
const { nextOpnameNumber } = require('../utils/documentNumber');
const { resolveFactorFromDb, toBaseQty } = require('../utils/unitResolver');

// Stok menipis = stok sudah di titik minimum atau di bawahnya (stock <= minStock).
// Dipakai sama oleh daftar stok menipis dan notifikasi.
const isLowStock = (p) => p.stock <= p.minStock;

/**
 * Get the current stock of a product (or a specific variant).
 * Stock is read directly from the Product / ProductVariant record
 * which is kept in sync by addMovement.
 */
const getCurrentStock = async (productId, variantId = null) => {
  if (variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, name: true, stock: true, sku: true },
    });
    if (!variant) {
      throw new AppError('Varian produk tidak ditemukan', 404);
    }
    return variant;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      minStock: true,
      maxStock: true,
      unit: true,
      variants: { select: { id: true, name: true, sku: true, stock: true } },
    },
  });

  if (!product) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  return product;
};

/**
 * List all product stock with pagination.
 * Optionally filter to only low-stock items (stock <= minStock).
 */
const getAllStock = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, categoryId, search, barcode, dateFrom, dateTo, lowStock = false } = {}) => {
  const where = { isActive: true };

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (barcode) {
    where.barcode = { contains: barcode, mode: 'insensitive' };
  }

  const movementWhere = wibDateRange(dateFrom, dateTo);
  if (movementWhere) {
    where.stockMovements = {
      some: { createdAt: movementWhere },
    };
  }

  const skip = (page - 1) * limit;

  const include = {
    category: { select: { id: true, name: true } },
    brand: { select: { id: true, name: true } },
    unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
    variants: { select: { id: true, name: true, sku: true, stock: true } },
  };

  if (lowStock) {
    const products = await prisma.product.findMany({
      where,
      include,
      orderBy: { stock: 'asc' },
    });

    const filtered = products.filter(isLowStock);
    const total = filtered.length;
    const data = filtered.slice(skip, skip + limit);

    return { data, total, page, limit };
  }

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Add a stock movement and update the product's stock accordingly.
 *
 * MovementType behaviour:
 *   IN         → stock += quantity
 *   OUT        → stock -= quantity
 *   ADJUSTMENT → stock is SET to quantity (delta recorded)
 *   OPNAME     → stock is SET to quantity (delta recorded)
 *
 * With variantId, ADJUSTMENT/OPNAME set the VARIANT stock to quantity and the
 * product total stock changes by the same delta (new - old variant stock).
 */
const addMovement = async ({ productId, variantId, unitId, quantity, movementType, referenceType, referenceId, notes, userId }) => {
  return prisma.$transaction(async (tx) => {
    // Lock product row to prevent lost-update race on concurrent stock writes
    await tx.$queryRaw`SELECT id FROM "products" WHERE id = ${productId} FOR UPDATE`;
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new AppError('Produk tidak ditemukan', 404);
    }


    // Convert quantity to base unit. ProductUnit (productId, unitId) dipakai
    // apa pun nilai product.unitId / flag isBaseUnit; satuan yang tidak
    // terdaftar untuk produk ini ditolak (400), tidak dianggap 1:1.
    const factor = await resolveFactorFromDb(tx, productId, unitId, product);
    const convertedQty = toBaseQty(quantity, factor);

    if (!Number.isFinite(convertedQty) || convertedQty < 0) {
      throw new AppError('Jumlah stok tidak boleh negatif', 400);
    }

    const isAbsolute = movementType === 'ADJUSTMENT' || movementType === 'OPNAME';

    // Lock & read the variant first (when given) so absolute adjustments can
    // be applied to the product total as a delta of the variant stock.
    let variant = null;
    if (variantId) {
      await tx.$queryRaw`SELECT id FROM "product_variants" WHERE id = ${variantId} FOR UPDATE`;
      variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      if (isAbsolute && (!variant || (variant.productId && variant.productId !== productId))) {
        throw new AppError('Varian produk tidak ditemukan', 404);
      }
    }

    const previousStock = product.stock;
    let delta;

    switch (movementType) {
      case 'IN':
        delta = convertedQty;
        break;
      case 'OUT':
        delta = -convertedQty;
        break;
      case 'ADJUSTMENT':
      case 'OPNAME':
        // quantity = the new absolute stock value (of the variant if given,
        // otherwise of the product); we record the delta
        delta = variant ? convertedQty - variant.stock : convertedQty - previousStock;
        break;
      default:
        throw new AppError('Tipe pergerakan stok tidak valid', 400);
    }

    const newStock = previousStock + delta;
    if (newStock < 0) {
      throw new AppError('Stok tidak mencukupi', 400);
    }

    // Record the movement
    const movement = await tx.stockMovement.create({
      data: {
        productId,
        type: movementType,
        quantity: isAbsolute ? delta : convertedQty,
        previousStock,
        newStock,
        referenceType: referenceType || null,
        referenceId: referenceId || null,
        notes: notes || null,
        createdBy: userId,
      },
    });

    // Update product stock
    await tx.product.update({
      where: { id: productId },
      data: { stock: newStock },
    });

    // Also update variant stock if specified
    if (variant) {
      const variantNewStock = isAbsolute ? convertedQty : variant.stock + delta;
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: variantNewStock },
      });
    }

    return movement;
  }, { timeout: 15000 });
};

/**
 * Manually adjust stock (shortcut for addMovement with ADJUSTMENT type).
 */
const adjustStock = async ({ productId, variantId, unitId, quantity, notes, userId }) => {
  const movement = await addMovement({
    productId,
    variantId,
    unitId,
    quantity,
    movementType: 'ADJUSTMENT',
    referenceType: 'MANUAL',
    notes: notes || 'Penyesuaian stok manual',
    userId,
  });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'stock_movements',
    recordId: movement.id,
    newData: movement,
  });

  // Check low stock after adjustment (fire-and-forget)
  notifyLowStock(productId).catch((err) => logger.error('Stock notification failed:', err.message));

  return movement;
};

/**
 * Check all products whose stock is at or below their minStock threshold.
 */
const checkLowStock = async () => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      minStock: true,
      unit: true,
      category: { select: { id: true, name: true } },
    },
    orderBy: { stock: 'asc' },
  });

  return products.filter(isLowStock);
};

/**
 * Get stock movement history for a product within an optional date range.
 */
const getStockHistory = async (productId, { startDate, endDate, page = 1, limit = DEFAULT_PAGE_SIZE } = {}) => {
  const where = { productId };

  // Tanggal polos (yyyy-MM-dd) dihitung sebagai hari WIB
  const createdAt = wibDateRange(startDate, endDate);
  if (createdAt) where.createdAt = createdAt;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: {
        creator: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.stockMovement.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * List stock opname sessions with optional search (opname number) and
 * created-date range (yyyy-MM-dd, interpreted in WIB).
 */
const getAllOpname = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, search, dateFrom, dateTo } = {}) => {
  const where = {};

  if (search) {
    where.opnameNumber = { contains: search, mode: 'insensitive' };
  }
  const createdAt = wibDateRange(dateFrom, dateTo);
  if (createdAt) where.createdAt = createdAt;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.stockOpname.findMany({
      where,
      include: {
        creator: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.stockOpname.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Create a new stock opname session.
 * Snapshots every active product's current system stock.
 */
const createOpname = async (userId) => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, stock: true },
  });

  const opname = await prisma.$transaction(async (tx) => {
    // Nomor OPN-YYYYMMDD-HHmmss (WIB) dibuat di dalam transaksi dengan
    // advisory lock, jadi dua sesi pada detik yang sama tidak bentrok.
    const opnameNumber = await nextOpnameNumber(tx);

    const created = await tx.stockOpname.create({
      data: {
        opnameNumber,
        status: 'DRAFT',
        createdBy: userId,
      },
    });

    // Batch create all items at once (prevents transaction timeout)
    if (products.length > 0) {
      await tx.stockOpnameItem.createMany({
        data: products.map((p) => ({
          stockOpnameId: created.id,
          productId: p.id,
          systemStock: p.stock,
          actualStock: p.stock,
          difference: 0,
        })),
      });
    }

    return tx.stockOpname.findUnique({
      where: { id: created.id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
      },
    });
  }, { timeout: 30000 });

  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'stock_opnames',
    recordId: opname.id,
    newData: { opnameNumber: opname.opnameNumber, productCount: products.length },
  });

  return opname;
};

/**
 * Update the actual quantity for a single opname item.
 */
const updateOpnameItem = async (opnameId, itemId, actualQty) => {
  if (!Number.isInteger(actualQty) || actualQty < 0) {
    throw new AppError('Stok aktual harus berupa bilangan bulat minimal 0', 400);
  }

  return prisma.$transaction(async (tx) => {
    // Lock the opname row so this cannot interleave with completeOpname
    await tx.$queryRaw`SELECT id FROM "stock_opnames" WHERE id = ${opnameId} FOR UPDATE`;

    const opname = await tx.stockOpname.findUnique({ where: { id: opnameId } });
    if (!opname) {
      throw new AppError('Sesi opname tidak ditemukan', 404);
    }
    if (opname.status === 'COMPLETED') {
      throw new AppError('Sesi opname sudah selesai, tidak bisa diubah', 400);
    }

    const item = await tx.stockOpnameItem.findUnique({ where: { id: itemId } });
    if (!item || item.stockOpnameId !== opnameId) {
      throw new AppError('Item opname tidak ditemukan', 404);
    }

    const difference = actualQty - item.systemStock;

    return tx.stockOpnameItem.update({
      where: { id: itemId },
      data: { actualStock: actualQty, difference },
    });
  });
};

/**
 * Complete an opname session.
 * For every item with a difference, creates an OPNAME stock movement
 * and updates the product stock.
 */
const completeOpname = async (opnameId, userId) => {
  const result = await prisma.$transaction(async (tx) => {
    // Claim the opname atomically: only one concurrent request can flip the
    // status. Any error below (e.g. negative stock) rolls this back too.
    const claimed = await tx.stockOpname.updateMany({
      where: { id: opnameId, status: { not: 'COMPLETED' } },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        updatedBy: userId,
      },
    });

    if (!claimed || claimed.count === 0) {
      const exists = await tx.stockOpname.findUnique({ where: { id: opnameId }, select: { id: true } });
      if (!exists) throw new AppError('Sesi opname tidak ditemukan', 404);
      throw new AppError('Sesi opname sudah selesai', 400);
    }

    // Read items inside the transaction (after the claim)
    const opname = await tx.stockOpname.findUnique({
      where: { id: opnameId },
      include: { items: true },
    });

    // Process each item that has a difference
    const adjustments = [];
    for (const item of opname.items) {
      if (item.difference !== 0) {
        // Lock the product row to prevent race conditions
        const [product] = await tx.$queryRaw`SELECT * FROM "products" WHERE id = ${item.productId} FOR UPDATE`;

        if (!product) continue;

        // Apply the opname difference to CURRENT stock instead of overwriting.
        // This preserves transactions/POs that happened during opname.
        // Example: systemStock=100, actualStock=95, difference=-5
        //          currentStock=110 (changed during opname)
        //          newStock = 110 + (-5) = 105 ✓ (not overwritten to 95)
        const currentStock = product.stock;
        const newStock = currentStock + item.difference;

        if (newStock < 0) {
          throw new AppError(`Stok produk ${product.name} akan menjadi negatif (${newStock}): stok saat ini ${currentStock}, selisih opname ${item.difference}. Periksa kembali data stock opname.`, 400);
        }

        const movement = await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OPNAME',
            quantity: item.difference,
            previousStock: currentStock,
            newStock,
            referenceType: 'OPNAME',
            referenceId: opnameId,
            notes: `Stock opname ${opname.opnameNumber}: selisih ${item.difference > 0 ? '+' : ''}${item.difference}`,
            createdBy: userId,
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: newStock },
        });

        adjustments.push(movement);
      }
    }

    // Opname was already marked COMPLETED above; return it with items
    const completed = await tx.stockOpname.findUnique({
      where: { id: opnameId },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    return { opname: completed, adjustments };
  }, { timeout: 30000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'stock_opnames',
    recordId: opnameId,
    newData: {
      status: 'COMPLETED',
      adjustmentsCount: result.adjustments.length,
    },
  });

  // Check low stock for all adjusted products after opname (fire-and-forget)
  const adjustedProductIds = result.adjustments.map((a) => a.productId);
  for (const pid of adjustedProductIds) {
    notifyLowStock(pid).catch((err) => logger.error('Opname stock notification failed:', err.message));
  }

  return result;
};

/**
 * Notify admins if a product's stock is low or out of stock.
 */
const notifyLowStock = async (productId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sku: true, stock: true, minStock: true },
  });

  if (!product) return;

  const isOutOfStock = product.stock <= 0;

  if (!isOutOfStock && !isLowStock(product)) return;

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true, deletedAt: null },
    select: { id: true },
  });

  if (admins.length === 0) return;

  const title = isOutOfStock ? 'Stok Habis!' : 'Stok Menipis';
  const message = isOutOfStock
    ? `Stok ${product.name} (${product.sku}) sudah habis! Segera lakukan restok.`
    : `Stok ${product.name} (${product.sku}) tinggal ${product.stock} (minimum: ${product.minStock}).`;

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      title,
      message,
      type: 'LOW_STOCK',
      status: 'PENDING',
    })),
  });
};

module.exports = {
  getCurrentStock,
  getAllStock,
  addMovement,
  adjustStock,
  checkLowStock,
  getStockHistory,
  getAllOpname,
  createOpname,
  updateOpnameItem,
  completeOpname,
};
