const auditLogService = require('../services/auditLog.service');
const { successResponse, paginatedResponse } = require('../utils/responseHelper');
const { parsePagination, parseEnumParam } = require('../utils/queryParams');

const getAll = async (req, res, next) => {
  try {
    const { userId, tableName, startDate, endDate } = req.query;
    const { page, limit } = parsePagination(req.query, 20);
    const action = parseEnumParam(req.query.action, Object.values(auditLogService.ACTION_TYPES), 'action');

    const result = await auditLogService.getLogs({
      page,
      limit,
      userId,
      tableName,
      action,
      startDate,
      endDate,
    });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Daftar audit log berhasil diambil'
    );
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const log = await auditLogService.getLogById(req.params.id);
    return successResponse(res, log, 'Detail audit log berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const rollback = async (req, res, next) => {
  try {
    const restored = await auditLogService.rollback(req.params.id, req.user.id);
    return successResponse(res, restored, 'Rollback berhasil dilakukan');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, rollback };
