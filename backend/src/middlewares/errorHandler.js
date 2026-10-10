const { Prisma } = require('@prisma/client');
const { errorResponse } = require('../utils/responseHelper');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const GENERIC_MESSAGE = 'Terjadi kesalahan pada server';

// Nama kolom → label yang dimengerti pengguna (pesan duplikat / referensi)
const FIELD_LABELS = {
  email: 'email',
  username: 'username',
  name: 'nama',
  abbreviation: 'singkatan',
  sku: 'SKU',
  barcode: 'barcode',
  token: 'token',
  transactionNumber: 'nomor transaksi',
  poNumber: 'nomor PO',
  opnameNumber: 'nomor opname',
  returnNumber: 'nomor retur',
  categoryId: 'kategori',
  parentId: 'kategori induk',
  supplierId: 'supplier',
  brandId: 'brand',
  unitId: 'satuan',
  productId: 'produk',
  projectId: 'proyek',
  unitLembagaId: 'unit lembaga',
  transactionId: 'transaksi',
  transactionItemId: 'item transaksi',
  purchaseOrderId: 'purchase order',
  userId: 'pengguna',
  createdBy: 'pengguna',
  updatedBy: 'pengguna',
  changedBy: 'pengguna',
};

const labelOf = (field) => FIELD_LABELS[field] || null;

/**
 * Kolom unik yang bentrok (P2002). meta.target bisa berupa array nama kolom
 * atau nama constraint ("users_email_key") tergantung driver.
 */
const uniqueTargetLabels = (target) => {
  const raw = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  const labels = [];
  for (const entry of raw) {
    if (labelOf(entry)) {
      labels.push(labelOf(entry));
      continue;
    }
    // nama constraint: <tabel>_<kolom>[_<kolom>]_key
    const known = Object.keys(FIELD_LABELS).filter((f) => new RegExp(`_${f}(_|$)`).test(String(entry)));
    known.forEach((f) => labels.push(labelOf(f)));
  }
  return [...new Set(labels)];
};

/**
 * Kolom foreign key yang gagal (P2003). meta.field_name berisi nama constraint
 * ("products_categoryId_fkey (index)") — tidak boleh bocor ke klien.
 */
const foreignKeyLabel = (fieldName) => {
  if (typeof fieldName !== 'string') return null;
  const match = Object.keys(FIELD_LABELS)
    .filter((f) => new RegExp(`(^|_)${f}(_|$| )`).test(fieldName))
    .sort((a, b) => b.length - a.length)[0];
  return match ? labelOf(match) : null;
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  // Detail lengkap hanya masuk log server, tidak pernah ke respons
  logger.error({ err, method: req.method, url: req.originalUrl }, err.message);

  // --- AppError (custom) ---
  if (err instanceof AppError) {
    const body = { success: false, message: err.message };
    if (err.code) body.code = err.code;
    if (err.priceChanges) body.priceChanges = err.priceChanges;
    return res.status(err.status).json(body);
  }

  // --- Prisma errors ---
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const labels = uniqueTargetLabels(err.meta?.target);
        const message = labels.length > 0
          ? `Data dengan ${labels.join(' dan ')} tersebut sudah ada`
          : 'Data yang sama sudah ada';
        return errorResponse(res, message, 409);
      }
      case 'P2025':
        return errorResponse(res, 'Data tidak ditemukan', 404);
      case 'P2003': {
        const label = foreignKeyLabel(err.meta?.field_name);
        const message = label
          ? `Data ${label} yang dipilih tidak ditemukan atau masih digunakan data lain`
          : 'Gagal memproses, terdapat referensi data yang tidak valid';
        return errorResponse(res, message, 400);
      }
      case 'P2014':
        return errorResponse(
          res,
          'Perubahan ini akan melanggar relasi data yang ada',
          400
        );
      case 'P2000':
        return errorResponse(res, 'Nilai yang dikirim terlalu panjang', 400);
      case 'P2020':
        return errorResponse(res, 'Nilai yang dikirim di luar batas yang diizinkan', 400);
      default:
        return errorResponse(res, GENERIC_MESSAGE, 500);
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return errorResponse(res, 'Data yang dikirim tidak valid', 400);
  }

  // --- JWT errors ---
  if (err.name === 'JsonWebTokenError') {
    return errorResponse(res, 'Token tidak valid', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return errorResponse(res, 'Token telah kadaluarsa', 401);
  }

  // --- Multer errors ---
  if (err.name === 'MulterError') {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return errorResponse(res, 'Ukuran file terlalu besar', 400);
      case 'LIMIT_FILE_COUNT':
        return errorResponse(res, 'Jumlah file melebihi batas', 400);
      case 'LIMIT_UNEXPECTED_FILE':
        return errorResponse(res, 'Tipe file tidak diizinkan', 400);
      default:
        return errorResponse(res, 'Upload file gagal', 400);
    }
  }

  // --- Body parser errors ---
  if (err.type === 'entity.parse.failed') {
    return errorResponse(res, 'Format data (JSON) tidak valid', 400);
  }
  if (err.type === 'entity.too.large') {
    return errorResponse(res, 'Ukuran data yang dikirim terlalu besar', 413);
  }

  // --- Validation errors (express-validator style thrown manually) ---
  if (err.name === 'ValidationError' || err.type === 'validation') {
    return errorResponse(res, err.message || 'Validasi gagal', 422, err.errors || null);
  }

  // --- Generic / unknown errors ---
  // Error dengan status 4xx yang sengaja diset boleh menampilkan pesannya;
  // selain itu (500 / tak dikenal) selalu pesan umum, di semua NODE_ENV.
  const statusCode = Number(err.status || err.statusCode) || 500;
  if (statusCode >= 400 && statusCode < 500) {
    return errorResponse(res, err.message || 'Permintaan tidak valid', statusCode);
  }

  return errorResponse(res, GENERIC_MESSAGE, statusCode >= 500 && statusCode < 600 ? statusCode : 500);
};

module.exports = { errorHandler, GENERIC_MESSAGE };
