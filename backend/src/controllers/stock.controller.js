const stockService = require('../services/stock.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { parsePagination, parseStringParam } = require('../utils/listQuery');

// Semua error diteruskan ke errorHandler pusat (next) agar AppError dan
// error Prisma dipetakan secara konsisten (bukan 500 mentah).

// ==================== Stock ====================

const getAllStock = async (req, res, next) => {
  try {
    const { categoryId, search, barcode, dateFrom, dateTo, lowStock } = req.query;
    const { page, limit } = parsePagination(req.query);

    const result = await stockService.getAllStock({
      page,
      limit,
      categoryId: parseStringParam(categoryId, 'categoryId'),
      search: parseStringParam(search, 'search'),
      barcode: parseStringParam(barcode, 'barcode'),
      dateFrom: parseStringParam(dateFrom, 'dateFrom'),
      dateTo: parseStringParam(dateTo, 'dateTo'),
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
    return next(err);
  }
};

const getStockByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { startDate, endDate } = req.query;
    const { page, limit } = parsePagination(req.query);

    const stock = await stockService.getCurrentStock(productId);
    const history = await stockService.getStockHistory(productId, {
      startDate: parseStringParam(startDate, 'startDate'),
      endDate: parseStringParam(endDate, 'endDate'),
      page,
      limit,
    });

    return successResponse(res, { stock, history }, 'Detail stok produk berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const adjustStock = async (req, res, next) => {
  try {
    const { productId, variantId, unitId, quantity, notes } = req.body;

    if (!productId || typeof productId !== 'string') return errorResponse(res, 'Product ID wajib diisi', 400);
    if (variantId != null && typeof variantId !== 'string') return errorResponse(res, 'Variant ID tidak valid', 400);
    if (unitId != null && typeof unitId !== 'string') return errorResponse(res, 'Unit ID tidak valid', 400);
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
    return next(err);
  }
};

// ==================== Stock Opname ====================

const getAllOpname = async (req, res, next) => {
  try {
    const { search, dateFrom, dateTo } = req.query;
    const { page, limit } = parsePagination(req.query);

    const result = await stockService.getAllOpname({
      page,
      limit,
      search: parseStringParam(search, 'search'),
      dateFrom: parseStringParam(dateFrom, 'dateFrom'),
      dateTo: parseStringParam(dateTo, 'dateTo'),
    });

    return paginatedResponse(res, result.data, result.total, result.page, result.limit, 'Daftar stock opname berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const createOpname = async (req, res, next) => {
  try {
    const opname = await stockService.createOpname(req.user.id);
    return successResponse(res, opname, 'Sesi stock opname berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const getOpnameById = async (req, res, next) => {
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
    return next(err);
  }
};

const updateOpnameItem = async (req, res, next) => {
  try {
    const { id, itemId } = req.params;
    const { actualStock } = req.body;

    if (actualStock === undefined || actualStock === null) {
      return errorResponse(res, 'Stok aktual wajib diisi', 400);
    }

    const parsedStock = Number(actualStock);
    if (actualStock === '' || !Number.isInteger(parsedStock) || parsedStock < 0) {
      return errorResponse(res, 'Stok aktual harus berupa bilangan bulat minimal 0', 400);
    }

    const item = await stockService.updateOpnameItem(id, itemId, parsedStock);
    return successResponse(res, item, 'Item opname berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const completeOpname = async (req, res, next) => {
  try {
    const result = await stockService.completeOpname(req.params.id, req.user.id);
    return successResponse(res, result, 'Stock opname berhasil diselesaikan');
  } catch (err) {
    return next(err);
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
