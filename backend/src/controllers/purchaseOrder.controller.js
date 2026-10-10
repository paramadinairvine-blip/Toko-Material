const poService = require('../services/purchaseOrder.service');
const { successResponse, paginatedResponse } = require('../utils/responseHelper');
const { PO_STATUS } = require('../utils/constants');
const { parsePagination, parseEnumParam, parseStringParam } = require('../utils/listQuery');
const logger = require('../utils/logger');

// Semua error diteruskan ke errorHandler pusat (next) agar AppError dan
// error Prisma (P2002/P2003/P2025/validasi) tidak lagi jadi 500 mentah.

const getAll = async (req, res, next) => {
  try {
    const { status, supplierId, startDate, endDate, search } = req.query;
    const { page, limit } = parsePagination(req.query);

    const result = await poService.getAll({
      page,
      limit,
      status: parseEnumParam(status, PO_STATUS, 'status'),
      supplierId: parseStringParam(supplierId, 'supplierId'),
      startDate: parseStringParam(startDate, 'startDate'),
      endDate: parseStringParam(endDate, 'endDate'),
      search: parseStringParam(search, 'search'),
    });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Daftar purchase order berhasil diambil'
    );
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const po = await poService.getById(req.params.id);
    return successResponse(res, po, 'Detail purchase order berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const po = await poService.create(req.body, req.user.id);
    return successResponse(res, po, 'Purchase order berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const po = await poService.update(req.params.id, req.body, req.user.id);
    return successResponse(res, po, 'Purchase order berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const send = async (req, res, next) => {
  try {
    const po = await poService.send(req.params.id, req.user.id);
    return successResponse(res, po, 'Purchase order berhasil dikirim ke supplier');
  } catch (err) {
    return next(err);
  }
};

const receive = async (req, res, next) => {
  try {
    const receivedItems = req.body?.receivedItems;
    logger.debug({ poId: req.params.id, receivedItems, userId: req.user.id }, 'PO receive request');
    const po = await poService.receive(req.params.id, receivedItems, req.user.id);
    return successResponse(res, po, 'Barang dari purchase order berhasil diterima');
  } catch (err) {
    return next(err);
  }
};

const cancel = async (req, res, next) => {
  try {
    const po = await poService.cancel(req.params.id, req.user.id);
    return successResponse(res, po, 'Purchase order berhasil dibatalkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, send, receive, cancel };
