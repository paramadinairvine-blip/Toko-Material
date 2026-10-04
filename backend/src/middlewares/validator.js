const { body, validationResult } = require('express-validator');
const { TRANSACTION_TYPES, ROLES, PROJECT_STATUS } = require('../utils/constants');

// ==================== Handle validation result ====================

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
    }));
    console.log('[VALIDATION] Failed:', JSON.stringify(errorDetails), '| Body:', JSON.stringify(req.body));
    return res.status(422).json({
      success: false,
      message: 'Validasi gagal',
      errors: errorDetails,
    });
  }
  next();
};

// ==================== Auth ====================

const validateLogin = [
  body('email')
    .notEmpty().withMessage('Email wajib diisi')
    .matches(/@material\.dn2$/).withMessage('Email harus menggunakan domain @material.dn2'),
  body('password')
    .notEmpty().withMessage('Password wajib diisi')
    .isLength({ min: 6 }).withMessage('Password minimal 6 karakter'),
  handleValidationErrors,
];

const validateRefreshToken = [
  body('refreshToken')
    .notEmpty().withMessage('Refresh token wajib diisi'),
  handleValidationErrors,
];

// ==================== User ====================

const validateUser = [
  body('fullName')
    .notEmpty().withMessage('Nama lengkap wajib diisi')
    .isLength({ min: 2 }).withMessage('Nama lengkap minimal 2 karakter'),
  body('email')
    .notEmpty().withMessage('Email wajib diisi')
    .matches(/@material\.dn2$/).withMessage('Email harus menggunakan domain @material.dn2'),
  body('password')
    .notEmpty().withMessage('Password wajib diisi')
    .isLength({ min: 6 }).withMessage('Password minimal 6 karakter'),
  body('role')
    .notEmpty().withMessage('Role wajib diisi')
    .isIn(Object.values(ROLES)).withMessage(`Role harus salah satu dari: ${Object.values(ROLES).join(', ')}`),
  handleValidationErrors,
];

const validateUserUpdate = [
  body('fullName')
    .optional()
    .isLength({ min: 2 }).withMessage('Nama lengkap minimal 2 karakter'),
  body('email')
    .optional()
    .matches(/@material\.dn2$/).withMessage('Email harus menggunakan domain @material.dn2'),
  body('role')
    .optional()
    .isIn(Object.values(ROLES)).withMessage(`Role harus salah satu dari: ${Object.values(ROLES).join(', ')}`),
  body('isActive')
    .optional()
    .isBoolean().withMessage('Status aktif harus berupa boolean')
    .toBoolean(),
  handleValidationErrors,
];

const validateChangePassword = [
  body('newPassword')
    .notEmpty().withMessage('Password baru wajib diisi')
    .isLength({ min: 6 }).withMessage('Password baru minimal 6 karakter'),
  handleValidationErrors,
];

// ==================== Category ====================

const validateCategory = [
  body('name')
    .notEmpty().withMessage('Nama kategori wajib diisi')
    .isLength({ min: 2 }).withMessage('Nama kategori minimal 2 karakter'),
  handleValidationErrors,
];

// ==================== Product ====================

const validateProduct = [
  body('name')
    .notEmpty().withMessage('Nama produk wajib diisi'),
  body('categoryId')
    .notEmpty().withMessage('Kategori wajib diisi'),
  body('buyPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Harga beli harus berupa angka positif'),
  body('sellPrice')
    .optional()
    .isFloat({ min: 0 }).withMessage('Harga jual harus berupa angka positif'),
  body('stock')
    .optional()
    .isInt({ min: 0 }).withMessage('Stok harus berupa angka positif'),
  body('minStock')
    .optional()
    .isInt({ min: 0 }).withMessage('Stok minimum harus berupa angka positif'),
  body('maxStock')
    .optional()
    .isInt({ min: 0 }).withMessage('Stok maksimum harus berupa angka positif'),
  handleValidationErrors,
];

// ==================== Transaction ====================

const validateTransaction = [
  body('type')
    .notEmpty().withMessage('Tipe transaksi wajib diisi')
    .isIn(Object.values(TRANSACTION_TYPES))
    .withMessage(`Tipe transaksi harus salah satu dari: ${Object.values(TRANSACTION_TYPES).join(', ')}`),
  body('items')
    .notEmpty().withMessage('Item transaksi wajib diisi')
    .isArray({ min: 1 }).withMessage('Item transaksi harus berupa array minimal 1 item'),
  body('items.*.productId')
    .notEmpty().withMessage('Product ID wajib diisi pada setiap item'),
  body('items.*.quantity')
    .notEmpty().withMessage('Jumlah wajib diisi pada setiap item')
    .isInt({ min: 1 }).withMessage('Jumlah harus minimal 1'),
  body('items.*.price')
    .notEmpty().withMessage('Harga wajib diisi pada setiap item')
    .isFloat({ min: 0 }).withMessage('Harga harus berupa angka positif'),
  handleValidationErrors,
];

// ==================== Purchase Order ====================

// Accept both 'price' and 'unitPrice' from frontend
const remapPOItemPrice = (req, _res, next) => {
  if (Array.isArray(req.body?.items)) {
    req.body.items = req.body.items.map((item) => {
      if (item && item.unitPrice !== undefined && item.price === undefined) {
        item.price = item.unitPrice;
        delete item.unitPrice;
      }
      return item;
    });
  }
  next();
};

const poItemRules = [
  body('items.*.productId')
    .isString().withMessage('Product ID tidak valid')
    .bail()
    .trim()
    .notEmpty().withMessage('Product ID wajib diisi pada setiap item'),
  body('items.*.unitId')
    .optional({ values: 'falsy' })
    .isString().withMessage('Unit ID tidak valid'),
  body('items.*.quantity')
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        throw new Error('Jumlah wajib diisi pada setiap item');
      }
      const num = Number(value);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        throw new Error('Jumlah harus bilangan bulat minimal 1');
      }
      return true;
    }),
  remapPOItemPrice,
  body('items.*.price')
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        throw new Error('Harga wajib diisi pada setiap item');
      }
      const num = Number(value);
      if (isNaN(num) || num < 0) {
        throw new Error('Harga harus berupa angka positif');
      }
      return true;
    }),
];

const validatePurchaseOrderUpdate = [
  body('supplierId')
    .optional()
    .isString().withMessage('Supplier tidak valid')
    .bail()
    .trim()
    .notEmpty().withMessage('Supplier tidak boleh kosong'),
  body('orderDate')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Tanggal order tidak valid'),
  body('items')
    .optional()
    .isArray({ min: 1 }).withMessage('Item purchase order harus berupa array minimal 1 item'),
  ...poItemRules,
  handleValidationErrors,
];

const validatePurchaseOrder = [
  body('supplierId')
    .notEmpty().withMessage('Supplier wajib diisi'),
  body('items')
    .isArray({ min: 1 }).withMessage('Item purchase order harus berupa array minimal 1 item'),
  body('items.*.productId')
    .notEmpty().withMessage('Product ID wajib diisi pada setiap item'),
  body('items.*.quantity')
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        throw new Error('Jumlah wajib diisi pada setiap item');
      }
      const num = Number(value);
      if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
        throw new Error('Jumlah harus bilangan bulat minimal 1');
      }
      return true;
    }),
  remapPOItemPrice,
  body('items.*.price')
    .custom((value) => {
      if (value === undefined || value === null || value === '') {
        throw new Error('Harga wajib diisi pada setiap item');
      }
      const num = Number(value);
      if (isNaN(num) || num < 0) {
        throw new Error('Harga harus berupa angka positif');
      }
      return true;
    }),
  handleValidationErrors,
];

// ==================== Supplier ====================

const validateSupplier = [
  body('name')
    .notEmpty().withMessage('Nama supplier wajib diisi'),
  body('phone')
    .notEmpty().withMessage('Nomor telepon wajib diisi'),
  handleValidationErrors,
];

// ==================== Project ====================

const validateProject = [
  body('name')
    .notEmpty().withMessage('Nama proyek wajib diisi'),
  body('status')
    .optional()
    .isIn(Object.values(PROJECT_STATUS))
    .withMessage(`Status proyek harus salah satu dari: ${Object.values(PROJECT_STATUS).join(', ')}`),
  body('budget')
    .optional()
    .isFloat({ min: 0 }).withMessage('Anggaran harus berupa angka positif'),
  handleValidationErrors,
];

const validateProjectUpdate = [
  body('name')
    .optional()
    .isString().withMessage('Nama proyek tidak valid')
    .bail()
    .trim()
    .notEmpty().withMessage('Nama proyek tidak boleh kosong'),
  body('status')
    .optional()
    .isIn(Object.values(PROJECT_STATUS))
    .withMessage(`Status proyek harus salah satu dari: ${Object.values(PROJECT_STATUS).join(', ')}`),
  body('budget')
    .optional()
    .isFloat({ min: 0 }).withMessage('Anggaran harus berupa angka positif'),
  body('startDate')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Tanggal mulai tidak valid'),
  body('endDate')
    .optional({ values: 'falsy' })
    .isISO8601().withMessage('Tanggal selesai tidak valid')
    .bail()
    .custom((value, { req }) => {
      if (req.body.startDate && new Date(value) < new Date(req.body.startDate)) {
        throw new Error('Tanggal selesai tidak boleh sebelum tanggal mulai');
      }
      return true;
    }),
  body('materials')
    .optional()
    .isArray().withMessage('Material harus berupa array'),
  body('materials.*.productId')
    .isString().withMessage('Product ID tidak valid')
    .bail()
    .notEmpty().withMessage('Product ID wajib diisi pada setiap material'),
  body('materials.*.estimatedQty')
    .optional({ values: 'null' })
    .isInt({ min: 0 }).withMessage('Estimasi jumlah harus bilangan bulat ≥ 0'),
  body('materials.*.usedQty')
    .optional({ values: 'null' })
    .isInt({ min: 0 }).withMessage('Jumlah terpakai harus bilangan bulat ≥ 0'),
  body('materials.*.unitPrice')
    .optional({ values: 'null' })
    .isFloat({ min: 0 }).withMessage('Harga satuan harus berupa angka positif'),
  handleValidationErrors,
];

// ==================== Stock Opname ====================

const validateStockOpname = [
  body('items')
    .notEmpty().withMessage('Item opname wajib diisi')
    .isArray({ min: 1 }).withMessage('Item opname harus berupa array minimal 1 item'),
  body('items.*.productId')
    .notEmpty().withMessage('Product ID wajib diisi pada setiap item'),
  body('items.*.actualStock')
    .notEmpty().withMessage('Stok aktual wajib diisi pada setiap item')
    .isInt({ min: 0 }).withMessage('Stok aktual harus berupa angka positif'),
  handleValidationErrors,
];

// ==================== Return ====================

const validateReturn = [
  body('transactionId')
    .notEmpty().withMessage('ID transaksi wajib diisi'),
  body('items')
    .isArray({ min: 1 }).withMessage('Item retur harus berupa array minimal 1 item'),
  body('items.*.transactionItemId')
    .notEmpty().withMessage('ID item transaksi wajib diisi'),
  body('items.*.quantity')
    .notEmpty().withMessage('Jumlah retur wajib diisi')
    .isInt({ min: 1 }).withMessage('Jumlah retur harus minimal 1'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  validateLogin,
  validateRefreshToken,
  validateUser,
  validateUserUpdate,
  validateChangePassword,
  validateCategory,
  validateProduct,
  validateTransaction,
  validatePurchaseOrder,
  validatePurchaseOrderUpdate,
  validateSupplier,
  validateProject,
  validateProjectUpdate,
  validateStockOpname,
  validateReturn,
};
