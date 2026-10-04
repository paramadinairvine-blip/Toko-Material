const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrder.controller');
const { authenticate } = require('../middlewares/auth');
const { authorize } = require('../middlewares/roleGuard');
const { validatePurchaseOrder, validatePurchaseOrderUpdate } = require('../middlewares/validator');
const { ROLES } = require('../utils/constants');

// All routes require authentication
router.use(authenticate);

// All roles can read
router.get('/', poController.getAll);
router.get('/:id', poController.getById);

// ADMIN & KASIR can create/update/send/receive
router.post('/', authorize(ROLES.ADMIN, ROLES.KASIR), validatePurchaseOrder, poController.create);
router.put('/:id', authorize(ROLES.ADMIN, ROLES.KASIR), validatePurchaseOrderUpdate, poController.update);
router.put('/:id/send', authorize(ROLES.ADMIN, ROLES.KASIR), poController.send);
router.put('/:id/receive', authorize(ROLES.ADMIN, ROLES.KASIR), poController.receive);

// ADMIN only can cancel
router.put('/:id/cancel', authorize(ROLES.ADMIN), poController.cancel);

module.exports = router;
