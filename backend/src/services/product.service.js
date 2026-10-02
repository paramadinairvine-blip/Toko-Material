const prisma = require('../lib/prisma');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { generateBarcode } = require('../utils/generateBarcode');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');

// Shared include for product queries
const productIncludes = {
  category: { select: { id: true, name: true, parentId: true } },
  brand: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
  variants: true,
  productUnits: {
    include: { unit: { select: { id: true, name: true, abbreviation: true } } },
  },
  priceHistories: {
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { user: { select: { id: true, fullName: true } } },
  },
};

/**
 * List products with pagination, search and filters.
 */
const getAll = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, search, categoryId, brandId, isActive } = {}) => {
  const where = {};

  // Default: hanya tampilkan produk aktif, kecuali diminta semua
  where.isActive = typeof isActive === 'boolean' ? isActive : true;
  if (categoryId) {
    where.categoryId = categoryId;
  }
  if (brandId) {
    where.brandId = brandId;
  }
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { barcode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
        variants: { where: { isActive: true } },
        productUnits: {
          include: { unit: { select: { id: true, name: true, abbreviation: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return { data, total, page, limit };
};

/**
 * Get a single product with all relations, current stock, and price history.
 */
const getById = async (id) => {
  const product = await prisma.product.findUnique({
    where: { id },
    include: productIncludes,
  });

  if (!product) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  return product;
};

/**
 * Create a new product with optional variants and unit conversions.
 * Auto-generates barcode if not provided.
 */
const create = async (data, userId) => {
  const { variants, units, ...productData } = data;

  // Look up category code for SKU/barcode generation
  let categoryCode = 'GEN';
  if (productData.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: productData.categoryId },
    });
    if (category) {
      categoryCode = category.name.substring(0, 3);
    }
  }

  // Auto-generate SKU if not provided (with duplicate check)
  if (!productData.sku) {
    const nameCode = productData.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3) || 'PRD';
    for (let i = 0; i < 10; i++) {
      const random = String(Math.floor(10000 + Math.random() * 90000));
      const sku = `SKU-${nameCode}-${random}`;
      const exists = await prisma.product.findFirst({ where: { sku } });
      if (!exists) { productData.sku = sku; break; }
    }
    if (!productData.sku) {
      productData.sku = `SKU-${nameCode}-${Date.now().toString().slice(-6)}`;
    }
  }

  // Auto-generate barcode if not provided
  if (!productData.barcode) {
    productData.barcode = await generateBarcode(categoryCode);
  }

  const product = await prisma.$transaction(async (tx) => {
    // Create the product
    const created = await tx.product.create({
      data: {
        ...productData,
        createdBy: userId,
      },
    });

    // Create variants if provided
    if (variants && variants.length > 0) {
      for (const v of variants) {
        await tx.productVariant.create({
          data: {
            productId: created.id,
            name: v.name,
            sku: v.sku,
            barcode: v.barcode || null,
            buyPrice: v.buyPrice || 0,
            sellPrice: v.sellPrice || 0,
            stock: v.stock || 0,
          },
        });
      }
    }

    // Create unit conversions if provided
    if (units && units.length > 0) {
      for (const u of units) {
        let unitId = u.unitId;
        if (!unitId && u.unitName) {
          const found = await tx.unitOfMeasure.findFirst({
            where: { name: { equals: u.unitName, mode: 'insensitive' } },
          });
          if (found) {
            unitId = found.id;
          } else {
            const newUnit = await tx.unitOfMeasure.create({
              data: { name: u.unitName, abbreviation: u.unitName.toLowerCase().slice(0, 5) },
            });
            unitId = newUnit.id;
          }
        }
        if (!unitId) continue;
        await tx.productUnit.create({
          data: {
            productId: created.id,
            unitId,
            conversionFactor: u.conversionFactor,
            isBaseUnit: u.isBaseUnit || false,
          },
        });
      }
    }

    // Return complete product
    return tx.product.findUnique({
      where: { id: created.id },
      include: productIncludes,
    });
  }, { timeout: 15000 });

  // Audit log (outside transaction for non-critical logging)
  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'products',
    recordId: product.id,
    newData: product,
  });

  return product;
};

/**
 * Update a product. Records price history if prices changed.
 */
const update = async (id, data, userId) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  const { variants, units, ...productData } = data;

  const product = await prisma.$transaction(async (tx) => {
    // Check if prices changed → record history
    const buyChanged = productData.buyPrice !== undefined && Number(productData.buyPrice) !== Number(existing.buyPrice);
    const sellChanged = productData.sellPrice !== undefined && Number(productData.sellPrice) !== Number(existing.sellPrice);

    if (buyChanged || sellChanged) {
      await tx.priceHistory.create({
        data: {
          productId: id,
          oldBuy: existing.buyPrice,
          newBuy: productData.buyPrice !== undefined ? productData.buyPrice : existing.buyPrice,
          oldSell: existing.sellPrice,
          newSell: productData.sellPrice !== undefined ? productData.sellPrice : existing.sellPrice,
          changedBy: userId,
        },
      });
    }

    // Update the product
    await tx.product.update({
      where: { id },
      data: {
        ...productData,
        updatedBy: userId,
      },
    });

    // Upsert variants if provided (preserve existing IDs & stock)
    if (variants !== undefined) {
      const existingVariants = await tx.productVariant.findMany({ where: { productId: id } });
      const existingIds = existingVariants.map((v) => v.id);
      const incomingIds = variants.filter((v) => v.id).map((v) => v.id);

      // Delete variants that are no longer in the list
      const toDelete = existingIds.filter((vid) => !incomingIds.includes(vid));
      if (toDelete.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: toDelete } } });
      }

      // Upsert each variant
      for (const v of variants) {
        if (v.id && existingIds.includes(v.id)) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              name: v.name,
              sku: v.sku,
              barcode: v.barcode || null,
              buyPrice: v.buyPrice || 0,
              sellPrice: v.sellPrice || 0,
              ...(v.stock !== undefined ? { stock: v.stock } : {}),
            },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId: id,
              name: v.name,
              sku: v.sku,
              barcode: v.barcode || null,
              buyPrice: v.buyPrice || 0,
              sellPrice: v.sellPrice || 0,
              stock: v.stock || 0,
            },
          });
        }
      }
    }

    // Replace unit conversions if provided
    if (units !== undefined) {
      await tx.productUnit.deleteMany({ where: { productId: id } });
      if (units.length > 0) {
        for (const u of units) {
          let unitId = u.unitId;
          if (!unitId && u.unitName) {
            const found = await tx.unitOfMeasure.findFirst({
              where: { name: { equals: u.unitName, mode: 'insensitive' } },
            });
            if (found) {
              unitId = found.id;
            } else {
              const newUnit = await tx.unitOfMeasure.create({
                data: { name: u.unitName, abbreviation: u.unitName.toLowerCase().slice(0, 5) },
              });
              unitId = newUnit.id;
            }
          }
          if (!unitId) continue;
          await tx.productUnit.create({
            data: {
              productId: id,
              unitId,
              conversionFactor: u.conversionFactor,
              isBaseUnit: u.isBaseUnit || false,
            },
          });
        }
      }
    }

    return tx.product.findUnique({
      where: { id },
      include: productIncludes,
    });
  }, { timeout: 15000 });

  // Audit log
  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'products',
    recordId: id,
    oldData: existing,
    newData: product,
  });

  return product;
};

/**
 * Soft-delete a product (set isActive = false).
 */
const remove = async (id, userId) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  // Produk yang masih ada di PO yang belum selesai tidak boleh dihapus
  const activePOItem = await prisma.purchaseOrderItem.findFirst({
    where: {
      productId: id,
      purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
    },
    include: { purchaseOrder: { select: { poNumber: true } } },
  });
  if (activePOItem) {
    throw new AppError(`Produk tidak bisa dihapus karena masih digunakan di PO aktif (${activePOItem.purchaseOrder.poNumber})`, 400);
  }

  const product = await prisma.product.update({
    where: { id },
    data: { isActive: false, updatedBy: userId },
  });

  await createLog({
    userId,
    action: ACTION_TYPES.DELETE,
    tableName: 'products',
    recordId: id,
    oldData: existing,
  });

  return product;
};

/**
 * Find a product by barcode (exact match on product or variant barcode).
 */
const getByBarcode = async (barcode) => {
  // Try product barcode first
  let product = await prisma.product.findUnique({
    where: { barcode },
    include: productIncludes,
  });

  if (product) return product;

  // Try variant barcode
  const variant = await prisma.productVariant.findUnique({
    where: { barcode },
    include: {
      product: { include: productIncludes },
    },
  });

  if (variant) return { ...variant.product, matchedVariant: variant };

  throw new AppError('Produk dengan barcode tersebut tidak ditemukan', 404);
};

/**
 * Generate and assign a new barcode to a product.
 */
const generateProductBarcode = async (productId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true },
  });

  if (!product) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  const categoryCode = product.category ? product.category.name.substring(0, 3) : 'GEN';
  const barcode = await generateBarcode(categoryCode);

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { barcode },
  });

  return updated;
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  getByBarcode,
  generateProductBarcode,
};
