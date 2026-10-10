const prisma = require('../lib/prisma');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { createLog, ACTION_TYPES } = require('../services/auditLog.service');
const { parsePagination } = require('../utils/queryParams');

const getAll = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search : '';

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: {
          _count: { select: { purchaseOrders: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      prisma.supplier.count({ where }),
    ]);

    return paginatedResponse(res, data, total, page, limit, 'Daftar supplier berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            poNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        },
        _count: { select: { products: true, purchaseOrders: true } },
      },
    });

    if (!supplier) return errorResponse(res, 'Supplier tidak ditemukan', 404);

    return successResponse(res, supplier, 'Detail supplier berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const { name, contactName, phone, email, address } = req.body;

    const supplier = await prisma.supplier.create({
      data: {
        name,
        contactName,
        phone,
        email,
        address,
        createdBy: req.user.id,
      },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'suppliers',
      recordId: supplier.id,
      newData: { name, contactName, phone, email, address },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, supplier, 'Supplier berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Supplier tidak ditemukan', 404);

    const { name, contactName, phone, email, address } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (contactName !== undefined) updateData.contactName = contactName;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address;
    updateData.updatedBy = req.user.id;

    const supplier = await prisma.supplier.update({
      where: { id },
      data: updateData,
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'suppliers',
      recordId: id,
      oldData: { name: existing.name, contactName: existing.contactName, phone: existing.phone, email: existing.email, address: existing.address },
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, supplier, 'Supplier berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Supplier tidak ditemukan', 404);

    // Supplier yang masih punya PO yang belum selesai tidak boleh dihapus
    const activePO = await prisma.purchaseOrder.findFirst({
      where: { supplierId: id, status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      select: { poNumber: true },
    });
    if (activePO) {
      return errorResponse(res, `Supplier tidak bisa dihapus karena masih memiliki PO aktif (${activePO.poNumber})`, 400);
    }

    await prisma.supplier.update({
      where: { id },
      data: { isActive: false, updatedBy: req.user.id },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'suppliers',
      recordId: id,
      oldData: { name: existing.name, isActive: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Supplier berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove };
