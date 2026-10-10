const transactionService = require('../services/transaction.service');
const { successResponse, paginatedResponse } = require('../utils/responseHelper');
const { TRANSACTION_TYPES, TRANSACTION_STATUS } = require('../utils/constants');
const { parsePagination, parseEnumParam, parseStringParam } = require('../utils/listQuery');

// Semua error diteruskan ke errorHandler pusat (next) agar AppError
// (termasuk code/priceChanges) dan error Prisma dipetakan secara konsisten.

const getAll = async (req, res, next) => {
  try {
    const { type, status, unitLembagaId, startDate, endDate, search, customerName } = req.query;
    const { page, limit } = parsePagination(req.query);

    const result = await transactionService.getAll({
      page,
      limit,
      type: parseEnumParam(type, TRANSACTION_TYPES, 'type'),
      status: parseEnumParam(status, TRANSACTION_STATUS, 'status'),
      unitLembagaId: parseStringParam(unitLembagaId, 'unitLembagaId'),
      startDate: parseStringParam(startDate, 'startDate'),
      endDate: parseStringParam(endDate, 'endDate'),
      search: parseStringParam(search, 'search'),
      customerName: parseStringParam(customerName, 'customerName'),
    });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Daftar transaksi berhasil diambil'
    );
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const transaction = await transactionService.getById(req.params.id);
    return successResponse(res, transaction, 'Detail transaksi berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const transaction = await transactionService.create(req.body, req.user.id);
    return successResponse(res, transaction, 'Transaksi berhasil dibuat', 201);
  } catch (err) {
    // 409 PRICE_CHANGED: errorHandler menyertakan code & priceChanges di body
    return next(err);
  }
};

const cancel = async (req, res, next) => {
  try {
    const transaction = await transactionService.cancel(req.params.id, req.user.id);
    return successResponse(res, transaction, 'Transaksi berhasil dibatalkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, cancel };
