const reportService = require('../services/report.service');
const { successResponse } = require('../utils/responseHelper');
const { TRANSACTION_TYPES } = require('../utils/constants');
const { parseEnumParam, parseBooleanParam } = require('../utils/queryParams');

// Query string boleh kosong; nilai ganda (?a=1&a=2 → array) ditolak
const stringParam = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

const getDashboard = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const summary = await reportService.getDashboardSummary({
      startDate: stringParam(startDate),
      endDate: stringParam(endDate),
    });
    return successResponse(res, summary, 'Data dashboard berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getStockReport = async (req, res, next) => {
  try {
    const { categoryId, lowStockOnly } = req.query;

    const report = await reportService.getStockReport({
      categoryId: stringParam(categoryId),
      lowStockOnly: parseBooleanParam(lowStockOnly, 'lowStockOnly') === true,
    });

    return successResponse(res, report, 'Laporan stok berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getFinancialReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const type = parseEnumParam(req.query.type, Object.values(TRANSACTION_TYPES), 'type');

    const report = await reportService.getFinancialReport({
      startDate: stringParam(startDate),
      endDate: stringParam(endDate),
      type,
    });

    return successResponse(res, report, 'Laporan keuangan berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getTrendReport = async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy } = req.query;

    const report = await reportService.getTrendReport({
      startDate: stringParam(startDate),
      endDate: stringParam(endDate),
      groupBy,
    });

    return successResponse(res, report, 'Laporan tren berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getLabaRugi = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const report = await reportService.getLabaRugiReport({
      startDate: stringParam(startDate),
      endDate: stringParam(endDate),
    });

    return successResponse(res, report, 'Laporan laba rugi berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getDashboard, getStockReport, getFinancialReport, getTrendReport, getLabaRugi };
