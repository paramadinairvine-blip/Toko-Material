const prisma = require('../lib/prisma');
const { DEFAULT_PAGE_SIZE, ROLES } = require('../utils/constants');
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

/**
 * Proyek yang sudah dihapus (soft delete, isActive=false) diperlakukan
 * seperti tidak ada untuk semua operasi tulis.
 */
const assertProjectExists = (project) => {
  if (!project || project.isActive === false) {
    throw new AppError('Proyek tidak ditemukan', 404);
  }
};

// ─── input guards ───────────────────────────────────────────────────

// Batas kewajaran jumlah material (mencegah salah ketik ekstrem / overflow Int)
const MAX_MATERIAL_QTY = 1000000;

const isMissing = (value) => value === undefined || value === null || value === '';

const assertDateOrder = (startDate, endDate) => {
  if (!startDate || !endDate) return;
  if (new Date(endDate) < new Date(startDate)) {
    throw new AppError('Tanggal selesai tidak boleh sebelum tanggal mulai', 400);
  }
};

const toDateOrNull = (value, label) => {
  if (isMissing(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(`${label} tidak valid`, 400);
  return date;
};

/**
 * Bilangan bulat 0..MAX_MATERIAL_QTY. Kosong → `fallback`.
 */
const toQty = (value, label, fallback = 0) => {
  if (isMissing(value)) return fallback;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new AppError(`${label} harus berupa bilangan bulat ≥ 0`, 400);
  }
  if (num > MAX_MATERIAL_QTY) {
    throw new AppError(`${label} terlalu besar (maksimal ${MAX_MATERIAL_QTY.toLocaleString('id-ID')}), periksa kembali angkanya`, 400);
  }
  return num;
};

/**
 * Harga satuan ≥ 0, atau undefined bila tidak dikirim.
 * Nilai 0 yang dikirim eksplisit tetap 0 (tidak diganti harga jual).
 */
const toUnitPrice = (value) => {
  if (isMissing(value)) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new AppError('Harga satuan harus berupa angka ≥ 0', 400);
  }
  return num;
};

/**
 * Validasi daftar material: productId wajib, tidak boleh ganda, produk harus ada.
 * Mengembalikan Map productId → sellPrice.
 */
const loadMaterialProducts = async (db, materials) => {
  const productIds = [];
  for (const m of materials) {
    if (!m || typeof m.productId !== 'string' || !m.productId) {
      throw new AppError('Product ID wajib diisi pada setiap material', 400);
    }
    productIds.push(m.productId);
  }
  if (new Set(productIds).size !== productIds.length) {
    throw new AppError('Produk yang sama tidak boleh muncul lebih dari sekali dalam daftar material', 400);
  }
  if (productIds.length === 0) return new Map();

  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sellPrice: true },
  });
  const priceMap = new Map((products || []).map((p) => [p.id, Number(p.sellPrice)]));
  if (productIds.some((pid) => !priceMap.has(pid))) {
    throw new AppError('Produk pada daftar material tidak ditemukan', 404);
  }
  return priceMap;
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

  const startDate = toDateOrNull(header.startDate, 'Tanggal mulai');
  const endDate = toDateOrNull(header.endDate, 'Tanggal selesai');
  assertDateOrder(startDate, endDate);

  const materialList = Array.isArray(materials) ? materials : [];
  const materialRows = materialList.map((m) => ({
    productId: m?.productId,
    estimatedQty: toQty(m?.estimatedQty, 'Estimasi jumlah'),
    unitPrice: toUnitPrice(m?.unitPrice),
    notes: m?.notes || null,
  }));

  const project = await prisma.$transaction(async (tx) => {
    // Produk material harus ada & tidak ganda — dicek sebelum menulis apa pun
    const priceMap = await loadMaterialProducts(tx, materialRows);

    const created = await tx.project.create({
      data: {
        name: header.name,
        description: header.description || null,
        status: header.status || 'PLANNING',
        budget: header.budget || 0,
        startDate,
        endDate,
        createdBy: userId,
      },
    });

    // Add materials if provided
    if (materialRows.length > 0) {
      await tx.projectMaterial.createMany({
        data: materialRows.map((m) => ({
          projectId: created.id,
          productId: m.productId,
          estimatedQty: m.estimatedQty,
          // Tanpa harga → harga jual produk; 0 eksplisit tetap 0
          unitPrice: m.unitPrice ?? priceMap.get(m.productId) ?? 0,
          notes: m.notes,
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
const update = async (id, data, userId, userRole) => {
  const existing = await prisma.project.findUnique({
    where: { id },
    include: { materials: true },
  });
  assertProjectExists(existing);

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

  // Tanggal: bandingkan dengan nilai tersimpan bila hanya salah satu yang dikirim
  const startDate = header.startDate !== undefined ? toDateOrNull(header.startDate, 'Tanggal mulai') : undefined;
  const endDate = header.endDate !== undefined ? toDateOrNull(header.endDate, 'Tanggal selesai') : undefined;
  if (startDate !== undefined || endDate !== undefined) {
    assertDateOrder(
      startDate !== undefined ? startDate : existing.startDate,
      endDate !== undefined ? endDate : existing.endDate
    );
  }

  // Validasi sinkronisasi material sebelum menulis apa pun
  let materialRows = null;
  if (materials && Array.isArray(materials)) {
    const existingById = new Map(existing.materials.map((m) => [m.id, m]));
    const incomingIds = new Set(materials.filter((m) => m && m.id).map((m) => m.id));

    for (const m of existing.materials) {
      if (!incomingIds.has(m.id) && m.usedQty > 0) {
        throw new AppError('Material yang sudah terpakai tidak dapat dihapus dari proyek', 400);
      }
    }

    materialRows = materials.map((m) => {
      const current = m && m.id ? existingById.get(m.id) || null : null;
      const usedQty = toQty(m?.usedQty, 'Jumlah terpakai', undefined);
      // Koreksi turun (salah ketik) hanya boleh dilakukan ADMIN
      if (current && usedQty !== undefined && usedQty < current.usedQty && userRole !== ROLES.ADMIN) {
        throw new AppError(`Penggunaan material hanya dapat dikurangi oleh ADMIN (saat ini ${current.usedQty})`, 403);
      }
      return {
        current,
        productId: m?.productId,
        estimatedQty: toQty(m?.estimatedQty, 'Estimasi jumlah'),
        usedQty,
        unitPrice: toUnitPrice(m?.unitPrice),
        notes: m?.notes || null,
      };
    });
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
        startDate,
        endDate,
        updatedBy: userId,
      },
    });

    // Sync materials if provided
    if (materialRows) {
      // Produk material harus ada & tidak ganda
      const priceMap = await loadMaterialProducts(tx, materialRows);

      const existingIds = existing.materials.map((m) => m.id);
      const incomingIds = materialRows.filter((m) => m.current).map((m) => m.current.id);

      // Delete removed materials
      const toDelete = existingIds.filter((mid) => !incomingIds.includes(mid));
      if (toDelete.length > 0) {
        await tx.projectMaterial.deleteMany({ where: { id: { in: toDelete } } });
      }

      // Upsert materials
      for (const m of materialRows) {
        if (m.current) {
          // Update existing material. Harga yang tidak dikirim → tetap harga tersimpan
          // (kecuali produknya diganti); 0 eksplisit tetap 0.
          const productChanged = m.productId !== m.current.productId;
          await tx.projectMaterial.update({
            where: { id: m.current.id },
            data: {
              productId: m.productId,
              estimatedQty: m.estimatedQty,
              usedQty: m.usedQty,
              unitPrice: m.unitPrice ?? (productChanged ? (priceMap.get(m.productId) ?? 0) : undefined),
              notes: m.notes,
            },
          });
        } else {
          // Create new material. Tanpa harga → harga jual produk; 0 eksplisit tetap 0
          await tx.projectMaterial.create({
            data: {
              projectId: id,
              productId: m.productId,
              estimatedQty: m.estimatedQty,
              usedQty: m.usedQty ?? 0,
              unitPrice: m.unitPrice ?? priceMap.get(m.productId) ?? 0,
              notes: m.notes,
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
  assertProjectExists(existing);

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
  assertProjectExists(project);
  assertProjectEditable(project);

  const input = materialData || {};
  if (typeof input.productId !== 'string' || !input.productId) {
    throw new AppError('Product ID wajib diisi', 400);
  }
  const estimatedQty = toQty(input.estimatedQty, 'Estimasi jumlah');
  let unitPrice = toUnitPrice(input.unitPrice);

  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { id: true, sellPrice: true },
  });
  if (!product) throw new AppError('Produk tidak ditemukan', 404);
  if (unitPrice === undefined) unitPrice = product.sellPrice;

  const duplicate = await prisma.projectMaterial.findFirst({
    where: { projectId, productId: input.productId },
    select: { id: true },
  });
  if (duplicate) {
    throw new AppError('Produk tersebut sudah ada di daftar material proyek ini', 409);
  }

  const material = await prisma.projectMaterial.create({
    data: {
      projectId,
      productId: input.productId,
      estimatedQty,
      unitPrice,
      notes: input.notes || null,
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
const updateMaterialUsage = async (projectId, materialId, usedQty, userId, userRole) => {
  // usedQty hanyalah catatan realisasi pemakaian: tidak mengubah stok produk
  // maupun `spent` proyek (keduanya digerakkan oleh transaksi/retur), jadi
  // koreksi naik/turun cukup menulis ulang angkanya + audit log.
  const newUsedQty = toQty(usedQty, 'Jumlah penggunaan', undefined);
  if (newUsedQty === undefined) {
    throw new AppError('Jumlah penggunaan (usedQty) wajib diisi', 400);
  }

  const material = await prisma.projectMaterial.findUnique({ where: { id: materialId } });
  if (!material || material.projectId !== projectId) {
    throw new AppError('Material proyek tidak ditemukan', 404);
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true, isActive: true },
  });
  assertProjectExists(project);
  assertProjectEditable(project);

  const oldUsedQty = material.usedQty;

  // Koreksi turun (mis. salah ketik 999 padahal 9) hanya boleh dilakukan ADMIN
  if (newUsedQty < oldUsedQty && userRole !== ROLES.ADMIN) {
    throw new AppError(`Penggunaan material hanya dapat dikurangi oleh ADMIN (saat ini ${oldUsedQty})`, 403);
  }

  const updated = await prisma.projectMaterial.update({
    where: { id: materialId },
    data: { usedQty: newUsedQty },
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
    newData: { usedQty: newUsedQty },
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
