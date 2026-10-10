const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brand.controller');
const { authenticate } = require('../middlewares/auth');
const { authorize } = require('../middlewares/roleGuard');
const { ROLES } = require('../utils/constants');
const { body } = require('express-validator');
const { handleValidationErrors } = require('../middlewares/validator');

const validateBrand = [
  body('name')
    .notEmpty().withMessage('Nama brand wajib diisi')
    .isString().withMessage('Nama brand tidak valid')
    .bail()
    .trim()
    .isLength({ min: 2 }).withMessage('Nama brand minimal 2 karakter'),
  body('isActive')
    .optional()
    .isBoolean().withMessage('Status aktif harus berupa boolean')
    .toBoolean(),
  handleValidationErrors,
];

// All routes require authentication
router.use(authenticate);

// All roles can read
router.get('/', brandController.getAll);
router.get('/:id', brandController.getById);

// ADMIN & KASIR can create/update
router.post('/', authorize(ROLES.ADMIN, ROLES.KASIR), validateBrand, brandController.create);
router.put('/:id', authorize(ROLES.ADMIN, ROLES.KASIR), validateBrand, brandController.update);

// ADMIN only can delete
router.delete('/:id', authorize(ROLES.ADMIN), brandController.remove);

module.exports = router;
