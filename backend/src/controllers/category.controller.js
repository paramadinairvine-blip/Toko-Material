const prisma = require('../lib/prisma');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { createLog, ACTION_TYPES } = require('../services/auditLog.service');

/**
 * Kategori aktif lain dengan nama sama (tanpa beda huruf besar/kecil) di bawah induk yang sama.
 */
const findDuplicateName = (name, parentId, excludeId) => prisma.category.findFirst({
  where: {
    name: { equals: name, mode: 'insensitive' },
    parentId: parentId || null,
    isActive: true,
    ...(excludeId ? { id: { not: excludeId } } : {}),
  },
  select: { id: true },
});

/**
 * Apakah `candidateParentId` adalah `categoryId` sendiri atau salah satu
 * turunannya (menjadikannya induk akan membentuk lingkaran).
 */
const wouldCreateCycle = async (categoryId, candidateParentId) => {
  const visited = new Set();
  let currentId = candidateParentId;
  while (currentId) {
    if (currentId === categoryId) return true;
    if (visited.has(currentId)) return true; // data lama sudah melingkar
    visited.add(currentId);
    const node = await prisma.category.findUnique({
      where: { id: currentId },
      select: { id: true, parentId: true },
    });
    currentId = node?.parentId || null;
  }
  return false;
};

const getAll = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: {
        children: {
          where: { isActive: true },
          include: {
            children: { where: { isActive: true } },
            _count: { select: { products: true } },
          },
        },
        _count: { select: { products: true } },
      },
      orderBy: { name: 'asc' },
    });

    return successResponse(res, categories, 'Daftar kategori berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: {
        parent: { select: { id: true, name: true } },
        children: {
          where: { isActive: true },
          include: { _count: { select: { products: true } } },
        },
        products: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            buyPrice: true,
            sellPrice: true,
            stock: true,
            image: true,
          },
          orderBy: { name: 'asc' },
        },
        _count: { select: { products: true, children: true } },
      },
    });

    if (!category) return errorResponse(res, 'Kategori tidak ditemukan', 404);

    return successResponse(res, category, 'Detail kategori berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const { description, parentId } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : req.body.name;

    if (!name) return errorResponse(res, 'Nama kategori wajib diisi', 400);

    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) return errorResponse(res, 'Kategori induk tidak ditemukan', 404);
    }

    if (await findDuplicateName(name, parentId)) {
      return errorResponse(res, 'Kategori dengan nama tersebut sudah ada', 409);
    }

    const category = await prisma.category.create({
      data: {
        name,
        description,
        parentId: parentId || null,
        createdBy: req.user.id,
      },
      include: {
        parent: { select: { id: true, name: true } },
      },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'categories',
      recordId: category.id,
      newData: { name, description, parentId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, category, 'Kategori berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Kategori tidak ditemukan', 404);

    const { description, parentId } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : req.body.name;

    if (parentId) {
      if (parentId === id) return errorResponse(res, 'Kategori tidak boleh menjadi induk diri sendiri', 400);
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) return errorResponse(res, 'Kategori induk tidak ditemukan', 404);
      if (parentId !== existing.parentId && await wouldCreateCycle(id, parent.parentId)) {
        return errorResponse(res, 'Kategori tidak boleh dipindahkan ke bawah sub-kategorinya sendiri', 400);
      }
    }

    // Nama unik di antara kategori aktif pada induk yang sama
    const finalName = name !== undefined ? name : existing.name;
    const finalParentId = parentId !== undefined ? (parentId || null) : existing.parentId;
    const nameOrParentChanged = finalName !== existing.name || finalParentId !== existing.parentId;
    if (nameOrParentChanged && await findDuplicateName(finalName, finalParentId, id)) {
      return errorResponse(res, 'Kategori dengan nama tersebut sudah ada', 409);
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (parentId !== undefined) updateData.parentId = parentId || null;
    updateData.updatedBy = req.user.id;

    const category = await prisma.category.update({
      where: { id },
      data: updateData,
      include: {
        parent: { select: { id: true, name: true } },
      },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'categories',
      recordId: id,
      oldData: { name: existing.name, description: existing.description, parentId: existing.parentId },
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, category, 'Kategori berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Kategori tidak ditemukan', 404);

    // Hanya sub-kategori & produk yang masih AKTIF yang menghalangi penghapusan
    const [activeChildren, activeProducts] = await Promise.all([
      prisma.category.count({ where: { parentId: id, isActive: true } }),
      prisma.product.count({ where: { categoryId: id, isActive: true } }),
    ]);

    if (activeChildren > 0) {
      return errorResponse(res, `Kategori masih memiliki ${activeChildren} sub-kategori aktif, hapus sub-kategori terlebih dahulu`, 400);
    }
    if (activeProducts > 0) {
      return errorResponse(res, `Kategori masih digunakan oleh ${activeProducts} produk aktif, pindahkan atau nonaktifkan produk terlebih dahulu`, 400);
    }

    await prisma.category.update({
      where: { id },
      data: { isActive: false, updatedBy: req.user.id },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'categories',
      recordId: id,
      oldData: { name: existing.name, isActive: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Kategori berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove };
