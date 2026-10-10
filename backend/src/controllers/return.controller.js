const returnService = require('../services/return.service');
const { successResponse, paginatedResponse } = require('../utils/responseHelper');
const { parsePagination, parseStringParam } = require('../utils/queryParams');

const getAll = async (req, res, next) => {
  try {
    const { search, startDate, endDate } = req.query;
    const { page, limit } = parsePagination(req.query);
    const { data, total } = await returnService.getAll({
      page,
      limit,
      search: parseStringParam(search, 'search'),
      startDate: parseStringParam(startDate, 'startDate'),
      endDate: parseStringParam(endDate, 'endDate'),
    });
    return paginatedResponse(res, data, total, page, limit);
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const data = await returnService.getById(req.params.id);
    return successResponse(res, data);
  } catch (err) {
    return next(err);
  }
};

const getByTransaction = async (req, res, next) => {
  try {
    const data = await returnService.getByTransactionId(req.params.transactionId);
    return successResponse(res, data);
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const data = await returnService.create(req.body, req.user.id);
    return successResponse(res, data, 'Retur berhasil diproses', 201);
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getAll,
  getById,
  getByTransaction,
  create,
};
