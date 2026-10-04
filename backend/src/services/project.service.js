const prisma = require('../lib/prisma');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const { createLog, ACTION_TYPES } = require('./auditLog.service');
const AppError = require('../utils/AppError');

// ─── shared includes ────────────────────────────────────────────────

const projectIncludes = {
  creator: { select: { id: true, fullName: true } },
  updater: { select: { id: true, fullName: true } },
  materials: {
    include: {
      product: {
        select: { id: true, name: true, sku: true, unit: true, sellPrice: true, stock: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  transactions: {
    select: { id: true, transactionNumber: true, total: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  },
};

// ─── status guards ──────────────────────────────────────────────────

/**
 * Tolak perubahan material pada proyek yang sudah selesai / dibatalkan.
 */
const assertProjectEditable = (project) => {
  if (project.status === 'CANCELLED') {
    throw new AppError('Proyek yang dibatalkan tidak dapat diubah', 400);
  }
  if (project.status === 'COMPLETED') {
    throw new AppError('Proyek yang sudah selesai tidak dapat diubah. Buka kembali proyek (status Sedang Berjalan) terlebih dahulu', 400);
  }
};

// ─── public API ─────────────────────────────────────────────────────

/**
 * List projects with pagination and optional status filter.
 */
const getAll = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, status, search } = {}) => {
  const where = { isActive: true };
  if (status) where.status = status;
  if (search) {
    where.name = { contains: search, mode: 'insensitive' };
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.project.findMany({
      where,
      include: {
        creator: { select: { id: true, fullName: true } },
        materials: {
          include: {
            product: { select: { id: true, name: true, unit: true } },
          },
        },
        _count: { select: { transactions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.project.count({ where }),
  ]);

  // Enrich with progress summary (rata-rata progress per material)
  const enriched = data.map((p) => {
    const materialsWithProgress = p.materials.filter((m) => m.estimatedQty > 0);
    const progressPercent = materialsWithProgress.length > 0
      ? Math.round(materialsWithProgress.reduce((s, m) => s + (m.usedQty / m.estimatedQty) * 100, 0) / materialsWithProgress.length)
      : 0;

    return {
      ...p,
      progressPercent,
      budgetRemaining: Number(p.budget) - Number(p.spent),
    };
  });

  return { data: enriched, total, page, limit };
};

/**
 * Get a single project with full detail: materials, transactions, budget summary.
 */
const getById = async (id) => {
  const project = await prisma.project.findUnique({
    where: { id },
    include: projectIncludes,
  });

  if (!project) throw new AppError('Proyek tidak ditemukan', 404);

  // Build budget summary
  const totalEstimatedCost = project.materials.reduce(
    (sum, m) => sum + m.estimatedQty * Number(m.unitPrice),
    0
  );
  const totalUsedCost = project.materials.reduce(
    (sum, m) => sum + m.usedQty * Number(m.unitPrice),
    0
  );
  const totalEstimatedQty = project.materials.reduce((s, m) => s + m.estimatedQty, 0);
  const totalUsedQty = project.materials.reduce((s, m) => s + m.usedQty, 0);
  const materialsWithEst = project.materials.filter((m) => m.estimatedQty > 0);
  const progressPercent = materialsWithEst.length > 0
    ? Math.round(materialsWithEst.reduce((s, m) => s + (m.usedQty / m.estimatedQty) * 100, 0) / materialsWithEst.length)
    : 0;

  return {
    ...project,
    summary: {
      budget: Number(project.budget),
      spent: Number(project.spent),
      budgetRemaining: Number(project.budget) - Number(project.spent),
      totalEstimatedCost,
      totalUsedCost,
      totalEstimatedQty,
      totalUsedQty,
      progressPercent,
      materialCount: project.materials.length,
      transactionCount: project.transactions.length,
    },
  };
};

/**
 * Create a new project with optional materials list.
 *
 * data shape:
 * {
 *   name, description?, budget?, startDate?, endDate?,
 *   materials?: [{ productId, estimatedQty, unitPrice?, notes? }]
 * }
 */
const create = async (data, userId) => {
  const { materials, ...header } = data;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name: header.name,
        description: header.description || null,
        status: header.status || 'PLANNING',
        budget: header.budget || 0,
        startDate: header.startDate ? new Date(header.startDate) : null,
        endDate: header.endDate ? new Date(header.endDate) : null,
        createdBy: userId,
      },
    });

    // Add materials if provided
    if (materials && materials.length > 0) {
      // Batch fetch product prices to avoid N+1 queries
      const missingPriceIds = materials
        .filter((m) => m.unitPrice === undefined || m.unitPrice === null)
        .map((m) => m.productId);

      const priceMap = {};
      if (missingPriceIds.length > 0) {
        const products = await tx.product.findMany({
          where: { id: { in: [...new Set(missingPriceIds)] } },
          select: { id: true, sellPrice: true },
        });
        for (const p of products) priceMap[p.id] = p.sellPrice;
      }

      await tx.projectMaterial.createMany({
        data: materials.map((m) => ({
          projectId: created.id,
          productId: m.productId,
          estimatedQty: m.estimatedQty,
          unitPrice: (m.unitPrice !== undefined && m.unitPrice !== null)
            ? m.unitPrice
            : (priceMap[m.productId] || 0),
          notes: m.notes || null,
        })),
      });
    }

    return tx.project.findUnique({
      where: { id: created.id },
      include: projectIncludes,
    });
  }, { timeout: 15000 });

  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'projects',
    recordId: project.id,
    newData: { name: project.name, budget: project.budget, materialCount: materials?.length || 0 },
  });

  return project;
};

/**
 * Update project header fields.
 */
const update = async (id, data, userId) => {
  const existing = await prisma.project.findUnique({
    where: { id },
    include: { materials: true },
  });
  if (!existing) throw new AppError('Proyek tidak ditemukan', 404);

  const { materials, ...header } = data;

  if (existing.status === 'CANCELLED') {
    throw new AppError('Proyek yang dibatalkan tidak dapat diubah', 400);
  }

  // Proyek selesai hanya boleh dibuka kembali (COMPLETED → IN_PROGRESS);
  // field lain & material diabaikan, edit dilakukan setelah dibuka kembali.
  if (existing.status === 'COMPLETED') {
    if (header.status !== 'IN_PROGRESS') {
      throw new AppError('Proyek yang sudah selesai hanya dapat dibuka kembali ke status Sedang Berjalan', 400);
    }

    const reopened = await prisma.project.update({
      where: { id },
      data: { status: 'IN_PROGRESS', updatedBy: userId },
      include: projectIncludes,
    });

    await createLog({
      userId,
      action: ACTION_TYPES.UPDATE,
      tableName: 'projects',
      recordId: id,
      oldData: { status: existing.status },
      newData: { status: 'IN_PROGRESS' },
    });

    return reopened;
  }

  // Validasi sinkronisasi material sebelum menulis apa pun
  if (materials && Array.isArray(materials)) {
    const existingById = new Map(existing.materials.map((m) => [m.id, m]));
    const incomingIds = new Set(materials.filter((m) => m.id).map((m) => m.id));

    for (const m of existing.materials) {
      if (!incomingIds.has(m.id) && m.usedQty > 0) {
        throw new AppError('Material yang sudah terpakai tidak dapat dihapus dari proyek', 400);
      }
    }

    for (const m of materials) {
      const current = m.id ? existingById.get(m.id) : null;
      if (current && m.usedQty !== undefined && m.usedQty !== null && Number(m.usedQty) < current.usedQty) {
        throw new AppError(`Penggunaan material tidak boleh dikurangi (minimal ${current.usedQty})`, 400);
      }
    }
  }

  const project = await prisma.$transaction(async (tx) => {
    // Update project header
    await tx.project.update({
      where: { id },
      data: {
        name: header.name !== undefined ? header.name : undefined,
        description: header.description !== undefined ? header.description : undefined,
        status: header.status !== undefined ? header.status : undefined,
        budget: header.budget !== undefined ? header.budget : undefined,
        startDate: header.startDate !== undefined ? (header.startDate ? new Date(header.startDate) : null) : undefined,
        endDate: header.endDate !== undefined ? (header.endDate ? new Date(header.endDate) : null) : undefined,
        updatedBy: userId,
      },
    });

    // Sync materials if provided
    if (materials && Array.isArray(materials)) {
      const existingIds = existing.materials.map((m) => m.id);
      const incomingIds = materials.filter((m) => m.id).map((m) => m.id);

      // Delete removed materials
      const toDelete = existingIds.filter((mid) => !incomingIds.includes(mid));
      if (toDelete.length > 0) {
        await tx.projectMaterial.deleteMany({ where: { id: { in: toDelete } } });
      }

      // Batch fetch product prices for materials without unitPrice
      const missingPriceIds = materials
        .filter((m) => !m.unitPrice && m.productId)
        .map((m) => m.productId);

      const priceMap = {};
      if (missingPriceIds.length > 0) {
        const products = await tx.product.findMany({
          where: { id: { in: [...new Set(missingPriceIds)] } },
          select: { id: true, sellPrice: true },
        });
        for (const p of products) priceMap[p.id] = Number(p.sellPrice);
      }

      // Upsert materials
      for (const m of materials) {
        const unitPrice = m.unitPrice || priceMap[m.productId] || 0;

        if (m.id && existingIds.includes(m.id)) {
          // Update existing material
          await tx.projectMaterial.update({
            where: { id: m.id },
            data: {
              productId: m.productId,
              estimatedQty: m.estimatedQty || 0,
              usedQty: m.usedQty !== undefined ? m.usedQty : undefined,
              unitPrice,
              notes: m.notes || null,
            },
          });
        } else {
          // Create new material
          await tx.projectMaterial.create({
            data: {
              projectId: id,
              productId: m.productId,
              estimatedQty: m.estimatedQty || 0,
              usedQty: m.usedQty || 0,
              unitPrice,
              notes: m.notes || null,
            },
          });
        }
      }
    }

    return tx.project.findUnique({ where: { id }, include: projectIncludes });
  }, { timeout: 30000 });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'projects',
    recordId: id,
    oldData: existing,
    newData: project,
  });

  return project;
};

/**
 * Soft-delete a project.
 */
const remove = async (id, userId) => {
  const existing = await prisma.project.findUnique({ where: { id } });
  if (!existing) throw new AppError('Proyek tidak ditemukan', 404);

  const project = await prisma.project.update({
    where: { id },
    data: { isActive: false, updatedBy: userId },
  });

  await createLog({
    userId,
    action: ACTION_TYPES.DELETE,
    tableName: 'projects',
    recordId: id,
    oldData: existing,
  });

  return project;
};

/**
 * Add a material to a project.
 *
 * materialData: { productId, estimatedQty, unitPrice?, notes? }
 */
const addMaterial = async (projectId, materialData, userId) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError('Proyek tidak ditemukan', 404);
  assertProjectEditable(project);

  let unitPrice = materialData.unitPrice;
  if (unitPrice === undefined || unitPrice === null) {
    const product = await prisma.product.findUnique({
      where: { id: materialData.productId },
      select: { sellPrice: true },
    });
    unitPrice = product ? product.sellPrice : 0;
  }

  const material = await prisma.projectMaterial.create({
    data: {
      projectId,
      productId: materialData.productId,
      estimatedQty: materialData.estimatedQty,
      unitPrice,
      notes: materialData.notes || null,
    },
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
    },
  });

  await createLog({
    userId,
    action: ACTION_TYPES.CREATE,
    tableName: 'project_materials',
    recordId: material.id,
    newData: material,
  });

  return material;
};

/**
 * Update the used quantity of a material in a project.
 */
const updateMaterialUsage = async (projectId, materialId, usedQty, userId) => {
  const material = await prisma.projectMaterial.findUnique({ where: { id: materialId } });
  if (!material || material.projectId !== projectId) {
    throw new AppError('Material proyek tidak ditemukan', 404);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true },
  });
  if (!project) throw new AppError('Proyek tidak ditemukan', 404);
  assertProjectEditable(project);

  const oldUsedQty = material.usedQty;

  if (usedQty < oldUsedQty) {
    throw new AppError(`Penggunaan tidak boleh dikurangi (minimal ${oldUsedQty})`, 400);
  }

  const updated = await prisma.projectMaterial.update({
    where: { id: materialId },
    data: { usedQty },
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
    },
  });

  await createLog({
    userId,
    action: ACTION_TYPES.UPDATE,
    tableName: 'project_materials',
    recordId: materialId,
    oldData: { usedQty: oldUsedQty },
    newData: { usedQty },
  });

  return updated;
};

/**
 * Get a progress summary for a project.
 */
const getProgressSummary = async (projectId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      materials: {
        include: {
          product: { select: { id: true, name: true, unit: true } },
        },
      },
    },
  });

  if (!project) throw new AppError('Proyek tidak ditemukan', 404);

  const materials = project.materials.map((m) => {
    const estimatedCost = m.estimatedQty * Number(m.unitPrice);
    const usedCost = m.usedQty * Number(m.unitPrice);
    const percentUsed = m.estimatedQty > 0 ? Math.round((m.usedQty / m.estimatedQty) * 100) : 0;
    const remaining = m.estimatedQty - m.usedQty;

    return {
      id: m.id,
      product: m.product,
      estimatedQty: m.estimatedQty,
      usedQty: m.usedQty,
      remaining,
      unitPrice: Number(m.unitPrice),
      estimatedCost,
      usedCost,
      percentUsed,
    };
  });

  const totalEstimatedCost = materials.reduce((s, m) => s + m.estimatedCost, 0);
  const totalUsedCost = materials.reduce((s, m) => s + m.usedCost, 0);
  const materialsWithEst = materials.filter((m) => m.estimatedQty > 0);
  const overallPercent = materialsWithEst.length > 0
    ? Math.round(materialsWithEst.reduce((s, m) => s + m.percentUsed, 0) / materialsWithEst.length)
    : 0;

  return {
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    budget: Number(project.budget),
    spent: Number(project.spent),
    budgetRemaining: Number(project.budget) - Number(project.spent),
    budgetUsedPercent: Number(project.budget) > 0
      ? Math.round((Number(project.spent) / Number(project.budget)) * 100)
      : 0,
    totalEstimatedCost,
    totalUsedCost,
    overallMaterialPercent: overallPercent,
    materials,
  };
};

/**
 * Get a detailed material report for a project: estimated vs actual, remaining needs.
 */
const getMaterialReport = async (projectId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      materials: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, unit: true, stock: true, sellPrice: true },
          },
        },
      },
    },
  });

  if (!project) throw new AppError('Proyek tidak ditemukan', 404);

  const report = project.materials.map((m) => {
    const remaining = m.estimatedQty - m.usedQty;
    const estimatedCost = m.estimatedQty * Number(m.unitPrice);
    const usedCost = m.usedQty * Number(m.unitPrice);
    const remainingCost = remaining * Number(m.unitPrice);
    const percentUsed = m.estimatedQty > 0 ? Math.round((m.usedQty / m.estimatedQty) * 100) : 0;
    const stockSufficient = m.product.stock >= remaining;

    return {
      materialId: m.id,
      product: m.product,
      estimatedQty: m.estimatedQty,
      usedQty: m.usedQty,
      remaining,
      unitPrice: Number(m.unitPrice),
      estimatedCost,
      usedCost,
      remainingCost,
      percentUsed,
      currentStock: m.product.stock,
      stockSufficient,
      shortfall: stockSufficient ? 0 : remaining - m.product.stock,
      notes: m.notes,
    };
  });

  const totalEstimated = report.reduce((s, r) => s + r.estimatedCost, 0);
  const totalUsed = report.reduce((s, r) => s + r.usedCost, 0);
  const totalRemaining = report.reduce((s, r) => s + r.remainingCost, 0);
  const insufficientItems = report.filter((r) => !r.stockSufficient);

  return {
    projectId: project.id,
    projectName: project.name,
    status: project.status,
    materials: report,
    summary: {
      totalItems: report.length,
      totalEstimatedCost: totalEstimated,
      totalUsedCost: totalUsed,
      totalRemainingCost: totalRemaining,
      insufficientStockCount: insufficientItems.length,
      insufficientItems: insufficientItems.map((i) => ({
        product: i.product.name,
        needed: i.remaining,
        available: i.currentStock,
        shortfall: i.shortfall,
      })),
    },
  };
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: remove,
  addMaterial,
  updateMaterialUsage,
  getProgressSummary,
  getMaterialReport,
};
