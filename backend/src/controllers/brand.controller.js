const prisma = require('../lib/prisma');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { createLog, ACTION_TYPES } = require('../services/auditLog.service');
const { parsePagination, parseBooleanParam } = require('../utils/queryParams');

const cleanName = (value) => (typeof value === 'string' ? value.trim() : value);

/**
 * Brand lain dengan nama sama (tanpa beda huruf besar/kecil).
 */
const findByName = (name, excludeId) => prisma.brand.findFirst({
  where: {
    name: { equals: name, mode: 'insensitive' },
    ...(excludeId ? { id: { not: excludeId } } : {}),
  },
});

const countActiveProducts = (brandId) => prisma.product.count({ where: { brandId, isActive: true } });

const inUseMessage = (count) => `Brand masih digunakan oleh ${count} produk aktif, pindahkan atau nonaktifkan produk terlebih dahulu`;

const getAll = async (req, res, next) => {
  try {
    const { search } = req.query;
    const { page: pageNum, limit: limitNum, skip } = parsePagination(req.query);
    const isActive = parseBooleanParam(req.query.isActive, 'isActive');

    const where = {};
    if (search) {
      where.name = { contains: String(search), mode: 'insensitive' };
    }
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      prisma.brand.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: { name: 'asc' },
        skip,
        take: limitNum,
      }),
      prisma.brand.count({ where }),
    ]);

    return paginatedResponse(res, data, total, pageNum, limitNum, 'Daftar brand berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const brand = await prisma.brand.findUnique({
      where: { id: req.params.id },
      include: {
        products: {
          select: { id: true, name: true, sku: true, stock: true, isActive: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!brand) {
      return errorResponse(res, 'Brand tidak ditemukan', 404);
    }

    return successResponse(res, brand, 'Detail brand berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const name = cleanName(req.body.name);

    const sameName = await findByName(name);
    if (sameName && sameName.isActive) {
      return errorResponse(res, 'Brand dengan nama tersebut sudah ada', 409);
    }

    // Nama milik brand yang sudah dinonaktifkan → aktifkan kembali, jangan gagal
    if (sameName) {
      const reactivated = await prisma.brand.update({
        where: { id: sameName.id },
        data: { name, isActive: true },
      });

      await createLog({
        userId: req.user.id,
        action: ACTION_TYPES.UPDATE,
        tableName: 'brands',
        recordId: reactivated.id,
        oldData: sameName,
        newData: reactivated,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return successResponse(res, reactivated, 'Brand diaktifkan kembali', 201);
    }

    const brand = await prisma.brand.create({
      data: { name },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'brands',
      recordId: brand.id,
      newData: brand,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, brand, 'Brand berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const name = cleanName(req.body.name);

    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) {
      return errorResponse(res, 'Brand tidak ditemukan', 404);
    }

    if (name !== undefined && name !== existing.name && await findByName(name, id)) {
      return errorResponse(res, 'Brand dengan nama tersebut sudah ada', 409);
    }

    // Menonaktifkan lewat PUT mengikuti aturan yang sama dengan DELETE
    if (isActive === false && existing.isActive) {
      const activeProducts = await countActiveProducts(id);
      if (activeProducts > 0) return errorResponse(res, inUseMessage(activeProducts), 400);
    }

    const data = {};
    if (name !== undefined) data.name = name;
    if (isActive !== undefined) data.isActive = isActive;

    const brand = await prisma.brand.update({
      where: { id },
      data,
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'brands',
      recordId: brand.id,
      oldData: existing,
      newData: brand,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, brand, 'Brand berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.brand.findUnique({ where: { id } });

    if (!existing) {
      return errorResponse(res, 'Brand tidak ditemukan', 404);
    }

    const activeProducts = await countActiveProducts(id);
    if (activeProducts > 0) {
      return errorResponse(res, inUseMessage(activeProducts), 400);
    }

    await prisma.brand.update({
      where: { id },
      data: { isActive: false },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'brands',
      recordId: id,
      oldData: { name: existing.name, isActive: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Brand berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove };
