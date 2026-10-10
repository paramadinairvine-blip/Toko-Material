const projectService = require('../services/project.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { PROJECT_STATUS } = require('../utils/constants');
const { parsePagination, parseEnumParam } = require('../utils/queryParams');

const getAll = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const status = parseEnumParam(req.query.status, Object.values(PROJECT_STATUS), 'status');
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const result = await projectService.getAll({ page, limit, status, search });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Daftar proyek berhasil diambil'
    );
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const project = await projectService.getById(req.params.id);
    return successResponse(res, project, 'Detail proyek berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const project = await projectService.create(req.body, req.user.id);
    return successResponse(res, project, 'Proyek berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const project = await projectService.update(req.params.id, req.body, req.user.id, req.user.role);
    return successResponse(res, project, 'Proyek berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await projectService.delete(req.params.id, req.user.id);
    return successResponse(res, null, 'Proyek berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

const addMaterial = async (req, res, next) => {
  try {
    const material = await projectService.addMaterial(req.params.id, req.body, req.user.id);
    return successResponse(res, material, 'Material berhasil ditambahkan ke proyek', 201);
  } catch (err) {
    return next(err);
  }
};

const updateMaterial = async (req, res, next) => {
  try {
    const { usedQty } = req.body;
    if (usedQty === undefined || usedQty === null || usedQty === '') {
      return errorResponse(res, 'Jumlah penggunaan (usedQty) wajib diisi', 400);
    }

    const material = await projectService.updateMaterialUsage(
      req.params.id,
      req.params.materialId,
      Number(usedQty),
      req.user.id,
      req.user.role
    );
    return successResponse(res, material, 'Penggunaan material berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const getMaterialReport = async (req, res, next) => {
  try {
    const report = await projectService.getMaterialReport(req.params.id);
    return successResponse(res, report, 'Laporan material proyek berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove, addMaterial, updateMaterial, getMaterialReport };
