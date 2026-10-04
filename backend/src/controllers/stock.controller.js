const stockService = require('../services/stock.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');

// ==================== Stock ====================

const getAllStock = async (req, res) => {
  try {
    const { page, limit, categoryId, search, barcode, dateFrom, dateTo, lowStock } = req.query;

    const result = await stockService.getAllStock({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || DEFAULT_PAGE_SIZE,
      categoryId,
      search,
      barcode,
      dateFrom,
      dateTo,
      lowStock: lowStock === 'true',
    });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Data stok berhasil diambil'
    );
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const getStockByProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const { startDate, endDate, page, limit } = req.query;

    const stock = await stockService.getCurrentStock(productId);
    const history = await stockService.getStockHistory(productId, {
      startDate,
      endDate,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || DEFAULT_PAGE_SIZE,
    });

    return successResponse(res, { stock, history }, 'Detail stok produk berhasil diambil');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const adjustStock = async (req, res) => {
  try {
    const { productId, variantId, unitId, quantity, notes } = req.body;

    if (!productId) return errorResponse(res, 'Product ID wajib diisi', 400);
    if (quantity === undefined || quantity === null) return errorResponse(res, 'Jumlah stok wajib diisi', 400);

    const parsedQty = Number(quantity);
    if (quantity === '' || isNaN(parsedQty)) return errorResponse(res, 'Jumlah stok harus berupa angka', 400);
    if (!Number.isInteger(parsedQty)) return errorResponse(res, 'Jumlah stok harus berupa bilangan bulat', 400);
    if (parsedQty < 0) return errorResponse(res, 'Jumlah stok tidak boleh negatif', 400);

    const movement = await stockService.adjustStock({
      productId,
      variantId,
      unitId,
      quantity: parsedQty,
      notes,
      userId: req.user.id,
    });

    return successResponse(res, movement, 'Penyesuaian stok berhasil dilakukan');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

// ==================== Stock Opname ====================

const getAllOpname = async (req, res) => {
  try {
    const prisma = require('../lib/prisma');

    const { page, limit } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || DEFAULT_PAGE_SIZE;
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      prisma.stockOpname.findMany({
        include: {
          creator: { select: { id: true, fullName: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.stockOpname.count(),
    ]);

    return paginatedResponse(res, data, total, pageNum, limitNum, 'Daftar stock opname berhasil diambil');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const createOpname = async (req, res) => {
  try {
    const opname = await stockService.createOpname(req.user.id);
    return successResponse(res, opname, 'Sesi stock opname berhasil dibuat', 201);
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const getOpnameById = async (req, res) => {
  try {
    const prisma = require('../lib/prisma');

    const opname = await prisma.stockOpname.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, fullName: true } },
        updater: { select: { id: true, fullName: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, unit: true, barcode: true, category: { select: { id: true, name: true } } } },
          },
          orderBy: { product: { name: 'asc' } },
        },
      },
    });

    if (!opname) return errorResponse(res, 'Sesi opname tidak ditemukan', 404);

    return successResponse(res, opname, 'Detail stock opname berhasil diambil');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const updateOpnameItem = async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { actualStock } = req.body;

    if (actualStock === undefined || actualStock === null) {
      return errorResponse(res, 'Stok aktual wajib diisi', 400);
    }

    const item = await stockService.updateOpnameItem(id, itemId, parseInt(actualStock));
    return successResponse(res, item, 'Item opname berhasil diperbarui');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

const completeOpname = async (req, res) => {
  try {
    const result = await stockService.completeOpname(req.params.id, req.user.id);
    return successResponse(res, result, 'Stock opname berhasil diselesaikan');
  } catch (err) {
    return errorResponse(res, err.message, err.status || 500);
  }
};

module.exports = {
  getAllStock,
  getStockByProduct,
  adjustStock,
  getAllOpname,
  createOpname,
  getOpnameById,
  updateOpnameItem,
  completeOpname,
};
