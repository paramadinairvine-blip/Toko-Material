const productService = require('../services/product.service');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const AppError = require('../utils/AppError');
const { parsePagination, parseBooleanParam } = require('../utils/queryParams');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ==================== Multer config for product images ====================

const uploadDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads', 'products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'product-' + uniqueSuffix + ext);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|webp/;
  const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = allowed.test(String(file.mimetype || '').split('/')[1] || '');
  if (extOk && mimeOk) {
    cb(null, true);
  } else {
    cb(new AppError('Format file harus jpg, png, atau webp', 400));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

// ==================== Controllers ====================

const getAll = async (req, res, next) => {
  try {
    const { search, categoryId, brandId } = req.query;
    const { page, limit } = parsePagination(req.query);

    const result = await productService.getAll({
      page,
      limit,
      search: typeof search === 'string' ? search : undefined,
      categoryId: typeof categoryId === 'string' ? categoryId : undefined,
      brandId: typeof brandId === 'string' ? brandId : undefined,
      isActive: parseBooleanParam(req.query.isActive, 'isActive'),
    });

    return paginatedResponse(
      res,
      result.data,
      result.total,
      result.page,
      result.limit,
      'Daftar produk berhasil diambil'
    );
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const product = await productService.getById(req.params.id);
    return successResponse(res, product, 'Detail produk berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const product = await productService.create(req.body, req.user.id);
    return successResponse(res, product, 'Produk berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const product = await productService.update(req.params.id, req.body, req.user.id);
    return successResponse(res, product, 'Produk berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    await productService.delete(req.params.id, req.user.id);
    return successResponse(res, null, 'Produk berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

const getByBarcode = async (req, res, next) => {
  try {
    const product = await productService.getByBarcode(req.params.barcode);
    return successResponse(res, product, 'Produk berhasil ditemukan');
  } catch (err) {
    return next(err);
  }
};

const generateBarcode = async (req, res, next) => {
  try {
    const product = await productService.generateProductBarcode(req.params.id);
    return successResponse(res, product, 'Barcode berhasil di-generate');
  } catch (err) {
    return next(err);
  }
};

const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'File gambar wajib diupload', 400);
    }

    const relativePath = '/uploads/products/' + req.file.filename;
    return successResponse(res, { url: relativePath }, 'Gambar berhasil diupload');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove, getByBarcode, generateBarcode, uploadImage, upload };
