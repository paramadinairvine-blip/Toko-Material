const express = require('express');
const router = express.Router();
const projectController = require('../controllers/project.controller');
const { authenticate } = require('../middlewares/auth');
const { authorize } = require('../middlewares/roleGuard');
const {
  validateProject,
  validateProjectUpdate,
  validateProjectMaterial,
  validateProjectMaterialUsage,
} = require('../middlewares/validator');
const { ROLES } = require('../utils/constants');

// All routes require authentication
router.use(authenticate);

// All roles can read
router.get('/', projectController.getAll);
router.get('/:id', projectController.getById);
router.get('/:id/report', projectController.getMaterialReport);

// ADMIN & KASIR can create/update/manage materials
router.post('/', authorize(ROLES.ADMIN, ROLES.KASIR), validateProject, projectController.create);
router.put('/:id', authorize(ROLES.ADMIN, ROLES.KASIR), validateProjectUpdate, projectController.update);
router.post('/:id/materials', authorize(ROLES.ADMIN, ROLES.KASIR), validateProjectMaterial, projectController.addMaterial);
router.put('/:id/materials/:materialId', authorize(ROLES.ADMIN, ROLES.KASIR), validateProjectMaterialUsage, projectController.updateMaterial);

// ADMIN only can delete
router.delete('/:id', authorize(ROLES.ADMIN), projectController.remove);

module.exports = router;
