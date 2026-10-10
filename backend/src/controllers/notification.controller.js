const prisma = require('../lib/prisma');
const stockService = require('../services/stock.service');
const notificationService = require('../services/notification.service');
const { successResponse, paginatedResponse } = require('../utils/responseHelper');
const { parsePagination } = require('../utils/queryParams');

const getAll = async (req, res, next) => {
  try {
    const { type } = req.query;
    const { page: pageNum, limit: limitNum, skip } = parsePagination(req.query);

    const where = {};
    // Admin bisa lihat semua, user lain hanya miliknya sendiri
    if (req.user.role !== 'ADMIN') {
      where.userId = req.user.id;
    }
    if (type) where.type = String(type);

    const [data, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.notification.count({ where }),
    ]);

    return paginatedResponse(res, data, total, pageNum, limitNum, 'Daftar notifikasi berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const checkLowStock = async (req, res, next) => {
  try {
    const lowStockProducts = await stockService.checkLowStock();

    if (lowStockProducts.length === 0) {
      return successResponse(res, { count: 0, products: [] }, 'Tidak ada produk dengan stok di bawah minimum');
    }

    // Create in-app notifications for all admins
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true },
    });

    for (const admin of admins) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          title: 'Peringatan Stok Minimum',
          message: `${lowStockProducts.length} produk memiliki stok di bawah batas minimum.`,
          type: 'LOW_STOCK',
          status: 'PENDING',
        },
      });
    }

    return successResponse(
      res,
      {
        count: lowStockProducts.length,
        products: lowStockProducts,
      },
      `Ditemukan ${lowStockProducts.length} produk dengan stok di bawah minimum`
    );
  } catch (err) {
    return next(err);
  }
};

const getMyNotifications = async (req, res, next) => {
  try {
    const { page: pageNum, limit: limitNum } = parsePagination(req.query);

    const result = await notificationService.getMyNotifications(req.user.id, {
      page: pageNum,
      limit: limitNum,
    });

    return res.status(200).json({
      success: true,
      message: 'Notifikasi berhasil diambil',
      data: result.data,
      unreadCount: result.unreadCount,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  } catch (err) {
    return next(err);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user.id);
    return successResponse(res, null, 'Notifikasi ditandai telah dibaca');
  } catch (err) {
    return next(err);
  }
};

const markAllAsRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllAsRead(req.user.id);
    return successResponse(res, { count: result.count }, 'Semua notifikasi ditandai telah dibaca');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, checkLowStock, getMyNotifications, markAsRead, markAllAsRead };
