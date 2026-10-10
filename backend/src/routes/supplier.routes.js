const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplier.controller');
const { authenticate } = require('../middlewares/auth');
const { authorize } = require('../middlewares/roleGuard');
const { validateSupplier, validateSupplierUpdate } = require('../middlewares/validator');
const { ROLES } = require('../utils/constants');

// All routes require authentication
router.use(authenticate);

// All roles can read
router.get('/', supplierController.getAll);
router.get('/:id', supplierController.getById);

// ADMIN & KASIR can create/update
router.post('/', authorize(ROLES.ADMIN, ROLES.KASIR), validateSupplier, supplierController.create);
router.put('/:id', authorize(ROLES.ADMIN, ROLES.KASIR), validateSupplierUpdate, supplierController.update);

// ADMIN only can delete
router.delete('/:id', authorize(ROLES.ADMIN), supplierController.remove);

module.exports = router;
