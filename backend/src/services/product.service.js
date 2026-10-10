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

// ─── input normalisation ────────────────────────────────────────────

const isMissing = (value) => value === undefined || value === null || value === '';

const toNumber = (value, label, { integer = false } = {}) => {
  const num = Number(value);
  if (typeof value === 'boolean' || Array.isArray(value) || !Number.isFinite(num) || num < 0
    || (integer && !Number.isInteger(num))) {
    throw new AppError(`${label} harus berupa ${integer ? 'bilangan bulat' : 'angka'} ≥ 0`, 400);
  }
  return num;
};

const toText = (value, label) => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(`${label} tidak valid`, 400);
  }
  return String(value).trim();
};

/**
 * Ambil HANYA field produk yang boleh ditulis dari body (whitelist) dan
 * rapikan tipenya. Field lain (createdAt, createdBy, isActive, id, field tak
 * dikenal, …) diabaikan — tidak pernah diteruskan ke Prisma.
 *
 * Stok hanya boleh diisi saat membuat produk (`allowStock`); setelah itu stok
 * hanya berubah lewat stock movement (PO, transaksi, retur, opname, penyesuaian).
 */
const pickProductData = (body, { allowStock = false } = {}) => {
  const src = body && typeof body === 'object' ? body : {};
  const data = {};

  if (src.name !== undefined) {
    const name = isMissing(src.name) ? '' : toText(src.name, 'Nama produk');
    if (!name) throw new AppError('Nama produk wajib diisi', 400);
    data.name = name;
  }

  // sku/barcode kosong = tidak dikirim (dibuat otomatis saat create)
  for (const [field, label] of [['sku', 'SKU'], ['barcode', 'Barcode']]) {
    if (!isMissing(src[field])) {
      const text = toText(src[field], label);
      if (text) data[field] = text;
    }
  }

  // teks opsional: kosong → null
  for (const [field, label] of [['description', 'Deskripsi'], ['image', 'Gambar']]) {
    if (src[field] !== undefined) {
      data[field] = isMissing(src[field]) ? null : toText(src[field], label);
    }
  }

  // relasi opsional: kosong → null
  for (const [field, label] of [
    ['categoryId', 'Kategori'], ['supplierId', 'Supplier'], ['brandId', 'Brand'], ['unitId', 'Satuan'],
  ]) {
    if (src[field] !== undefined) {
      if (isMissing(src[field])) data[field] = null;
      else if (typeof src[field] !== 'string') throw new AppError(`${label} tidak valid`, 400);
      else data[field] = src[field];
    }
  }

  if (!isMissing(src.unit)) {
    const unit = toText(src.unit, 'Satuan');
    if (unit) data.unit = unit;
  }

  if (!isMissing(src.buyPrice)) data.buyPrice = toNumber(src.buyPrice, 'Harga beli');
  if (!isMissing(src.sellPrice)) data.sellPrice = toNumber(src.sellPrice, 'Harga jual');
  if (!isMissing(src.minStock)) data.minStock = toNumber(src.minStock, 'Stok minimum', { integer: true });
  if (src.maxStock !== undefined) {
    data.maxStock = isMissing(src.maxStock) ? null : toNumber(src.maxStock, 'Stok maksimum', { integer: true });
  }
  if (allowStock && !isMissing(src.stock)) data.stock = toNumber(src.stock, 'Stok', { integer: true });

  return data;
};

/**
 * Rapikan daftar satuan konversi. conversionFactor wajib > 0; satuan yang
 * ditandai isBaseUnit tetapi faktornya ≠ 1 disimpan sebagai BUKAN satuan dasar
 * (satuan dasar selalu berfaktor 1).
 */
const normalizeUnits = (units) => {
  if (units === undefined || units === null) return undefined;
  if (!Array.isArray(units)) throw new AppError('Satuan konversi harus berupa array', 400);

  return units
    .filter((u) => u && (u.unitId || u.unitName))
    .map((u) => {
      const factor = Number(u.conversionFactor);
      if (isMissing(u.conversionFactor) || !Number.isFinite(factor) || factor <= 0) {
        throw new AppError('Faktor konversi satuan harus berupa angka lebih dari 0', 400);
      }
      return {
        unitId: typeof u.unitId === 'string' && u.unitId ? u.unitId : null,
        unitName: typeof u.unitName === 'string' ? u.unitName.trim() : '',
        conversionFactor: factor,
        isBaseUnit: Boolean(u.isBaseUnit) && factor === 1,
      };
    });
};

const normalizeVariants = (variants) => {
  if (variants === undefined || variants === null) return undefined;
  if (!Array.isArray(variants)) throw new AppError('Varian harus berupa array', 400);

  return variants.map((v) => {
    if (!v || typeof v !== 'object') throw new AppError('Data varian tidak valid', 400);
    const name = isMissing(v.name) ? '' : toText(v.name, 'Nama varian');
    const sku = isMissing(v.sku) ? '' : toText(v.sku, 'SKU varian');
    if (!name || !sku) throw new AppError('Nama dan SKU varian wajib diisi', 400);
    return {
      id: typeof v.id === 'string' && v.id ? v.id : null,
      name,
      sku,
      barcode: isMissing(v.barcode) ? null : toText(v.barcode, 'Barcode varian'),
      buyPrice: isMissing(v.buyPrice) ? 0 : toNumber(v.buyPrice, 'Harga beli varian'),
      sellPrice: isMissing(v.sellPrice) ? 0 : toNumber(v.sellPrice, 'Harga jual varian'),
      stock: isMissing(v.stock) ? 0 : toNumber(v.stock, 'Stok varian', { integer: true }),
    };
  });
};

// ─── reference helpers ──────────────────────────────────────────────

/**
 * Pastikan relasi yang dikirim memang ada (→ 404 yang jelas, bukan error FK).
 */
const assertReferencesExist = async (data) => {
  const checks = [
    ['categoryId', prisma.category, 'Kategori tidak ditemukan'],
    ['supplierId', prisma.supplier, 'Supplier tidak ditemukan'],
    ['brandId', prisma.brand, 'Brand tidak ditemukan'],
    ['unitId', prisma.unitOfMeasure, 'Satuan tidak ditemukan'],
  ];
  const found = {};
  for (const [field, model, message] of checks) {
    if (!data[field]) continue;
    const row = await model.findUnique({ where: { id: data[field] } });
    if (!row) throw new AppError(message, 404);
    found[field] = row;
  }
  return found;
};

/**
 * SKU / barcode harus unik antar produk (→ 409 yang jelas).
 */
const assertUniqueCodes = async (data, excludeId) => {
  for (const [field, label] of [['sku', 'SKU'], ['barcode', 'Barcode']]) {
    if (!data[field]) continue;
    const other = await prisma.product.findFirst({
      where: { [field]: data[field], ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (other) throw new AppError(`${label} tersebut sudah digunakan produk lain`, 409);
  }
};

/**
 * Cari UnitOfMeasure berdasarkan nama (atau singkatan), tanpa beda huruf
 * besar/kecil; buat baru bila belum ada. Mengembalikan baris satuan.
 */
const resolveUnitByName = async (tx, rawName) => {
  const name = String(rawName).trim();
  const found = await tx.unitOfMeasure.findFirst({
    where: {
      OR: [
        { name: { equals: name, mode: 'insensitive' } },
        { abbreviation: { equals: name, mode: 'insensitive' } },
      ],
    },
    orderBy: { isActive: 'desc' },
  });
  if (found) {
    // Satuan nonaktif yang dipakai lagi → aktifkan kembali supaya muncul di daftar
    if (found.isActive === false) {
      return tx.unitOfMeasure.update({ where: { id: found.id }, data: { isActive: true } });
    }
    return found;
  }

  // Singkatan unik: nama huruf kecil (maks 10 karakter), tambah angka bila bentrok
  const base = name.toLowerCase().replace(/\s+/g, '').slice(0, 10) || 'unit';
  let abbreviation = base;
  for (let i = 2; i < 50; i++) {
    const taken = await tx.unitOfMeasure.findUnique({ where: { abbreviation } });
    if (!taken) break;
    abbreviation = `${base.slice(0, 8)}${i}`;
  }

  return tx.unitOfMeasure.create({ data: { name, abbreviation } });
};

/**
 * Tulis ulang satuan konversi produk dari daftar yang sudah dinormalkan.
 */
const createProductUnits = async (tx, productId, units) => {
  const seen = new Set();
  for (const u of units) {
    let unitId = u.unitId;
    if (!unitId && u.unitName) {
      unitId = (await resolveUnitByName(tx, u.unitName)).id;
    }
    if (!unitId) continue;
    if (seen.has(unitId)) {
      throw new AppError('Satuan yang sama tidak boleh muncul lebih dari sekali pada satu produk', 400);
    }
    seen.add(unitId);

    await tx.productUnit.create({
      data: {
        productId,
        unitId,
        conversionFactor: u.conversionFactor,
        isBaseUnit: u.isBaseUnit,
      },
    });
  }
};

/**
 * Create a new product with optional variants and unit conversions.
 * Auto-generates barcode if not provided.
 */
const create = async (data, userId) => {
  const productData = pickProductData(data, { allowStock: true });
  const variants = normalizeVariants(data?.variants) || [];
  const units = normalizeUnits(data?.units) || [];

  if (!productData.name) throw new AppError('Nama produk wajib diisi', 400);

  const refs = await assertReferencesExist(productData);
  await assertUniqueCodes(productData);

  // Look up category code for SKU/barcode generation
  const categoryCode = refs.categoryId ? refs.categoryId.name.substring(0, 3) : 'GEN';

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
    // Satuan dasar: unitId selalu terisi. Tanpa unitId → cari/buat dari nama satuan.
    if (productData.unitId) {
      if (!productData.unit) productData.unit = refs.unitId.name;
    } else {
      const unitRow = await resolveUnitByName(tx, productData.unit || 'pcs');
      productData.unitId = unitRow.id;
      if (!productData.unit) productData.unit = unitRow.name;
    }

    // Create the product
    const created = await tx.product.create({
      data: {
        ...productData,
        createdBy: userId,
      },
    });

    // Stok awal tercatat di buku pergerakan stok (IN: stok bertambah dari 0)
    if (created.stock > 0) {
      await tx.stockMovement.create({
        data: {
          productId: created.id,
          type: 'IN',
          quantity: created.stock,
          previousStock: 0,
          newStock: created.stock,
          referenceType: 'MANUAL',
          referenceId: null,
          notes: 'Stok awal',
          createdBy: userId,
        },
      });
    }

    // Create variants if provided
    for (const v of variants) {
      await tx.productVariant.create({
        data: {
          productId: created.id,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode,
          buyPrice: v.buyPrice,
          sellPrice: v.sellPrice,
          stock: v.stock,
        },
      });
    }

    // Create unit conversions if provided
    await createProductUnits(tx, created.id, units);

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
 *
 * Field yang dikendalikan server (id, isActive, stock, createdBy, timestamps, …)
 * tidak pernah ditulis dari body — lihat pickProductData.
 */
const update = async (id, data, userId) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Produk tidak ditemukan', 404);
  }

  const productData = pickProductData(data, { allowStock: false });
  const variants = normalizeVariants(data?.variants);
  const units = normalizeUnits(data?.units);

  const refs = await assertReferencesExist(productData);
  await assertUniqueCodes(productData, id);

  const product = await prisma.$transaction(async (tx) => {
    // Jaga unitId tetap sinkron dengan nama satuan
    if (productData.unitId) {
      if (!productData.unit) productData.unit = refs.unitId.name;
    } else if (productData.unit && (productData.unit !== existing.unit || !existing.unitId)) {
      productData.unitId = (await resolveUnitByName(tx, productData.unit)).id;
    } else {
      // unitId kosong/null dari body tidak boleh mengosongkan satuan yang sudah ada
      delete productData.unitId;
    }

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

      // Delete variants that are no longer in the list.
      // Varian yang masih punya stok TIDAK boleh dihapus: stok varian adalah bagian
      // dari total stok produk, jadi menghapusnya diam-diam membuat total tidak
      // cocok. Stok varian harus dinolkan dulu lewat penyesuaian stok (tercatat).
      const toDelete = existingVariants.filter((v) => !incomingIds.includes(v.id));
      const stocked = toDelete.find((v) => v.stock > 0);
      if (stocked) {
        throw new AppError(
          `Varian "${stocked.name}" masih memiliki stok ${stocked.stock}. Nolkan stok varian lewat penyesuaian stok sebelum menghapusnya`,
          400
        );
      }
      if (toDelete.length > 0) {
        await tx.productVariant.deleteMany({ where: { id: { in: toDelete.map((v) => v.id) } } });
      }

      // Upsert each variant
      for (const v of variants) {
        if (v.id && existingIds.includes(v.id)) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              name: v.name,
              sku: v.sku,
              barcode: v.barcode,
              buyPrice: v.buyPrice,
              sellPrice: v.sellPrice,
              // stok varian hanya berubah lewat stock movement
            },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId: id,
              name: v.name,
              sku: v.sku,
              barcode: v.barcode,
              buyPrice: v.buyPrice,
              sellPrice: v.sellPrice,
              stock: v.stock,
            },
          });
        }
      }
    }

    // Replace unit conversions if provided
    if (units !== undefined) {
      await tx.productUnit.deleteMany({ where: { productId: id } });
      await createProductUnits(tx, id, units);
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
