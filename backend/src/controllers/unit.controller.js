const prisma = require('../lib/prisma');
const { successResponse, errorResponse } = require('../utils/responseHelper');
const { createLog, ACTION_TYPES } = require('../services/auditLog.service');

const cleanText = (value) => (typeof value === 'string' ? value.trim() : value);

const isBooleanOrUndefined = (value) => value === undefined || typeof value === 'boolean';

/**
 * Jumlah pemakaian satuan oleh produk aktif: sebagai satuan dasar produk
 * dan sebagai satuan konversi (ProductUnit).
 */
const countUnitUsage = async (unitId) => {
  const [products, conversions] = await Promise.all([
    prisma.product.count({ where: { unitId, isActive: true } }),
    prisma.productUnit.count({ where: { unitId, product: { isActive: true } } }),
  ]);
  return { products, conversions };
};

const unitInUseMessage = ({ products, conversions }) => {
  const parts = [];
  if (products > 0) parts.push(`${products} produk aktif`);
  if (conversions > 0) parts.push(`${conversions} konversi satuan produk`);
  return `Satuan masih digunakan oleh ${parts.join(' dan ')}, ganti satuan pada produk tersebut terlebih dahulu`;
};

// ==================== UnitOfMeasure ====================

const getAllUnits = async (req, res, next) => {
  try {
    const units = await prisma.unitOfMeasure.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return successResponse(res, units, 'Daftar satuan berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const createUnit = async (req, res, next) => {
  try {
    const name = cleanText(req.body.name);
    const abbreviation = cleanText(req.body.abbreviation);
    if (!name || !abbreviation || typeof name !== 'string' || typeof abbreviation !== 'string') {
      return errorResponse(res, 'Nama dan singkatan wajib diisi', 400);
    }

    const sameAbbreviation = await prisma.unitOfMeasure.findUnique({ where: { abbreviation } });
    if (sameAbbreviation && sameAbbreviation.isActive) {
      return errorResponse(res, 'Satuan dengan singkatan tersebut sudah ada', 409);
    }

    // Singkatan milik satuan yang sudah dinonaktifkan → aktifkan kembali
    if (sameAbbreviation) {
      const reactivated = await prisma.unitOfMeasure.update({
        where: { id: sameAbbreviation.id },
        data: { name, isActive: true },
      });

      await createLog({
        userId: req.user.id,
        action: ACTION_TYPES.UPDATE,
        tableName: 'unit_of_measures',
        recordId: reactivated.id,
        oldData: { name: sameAbbreviation.name, abbreviation, isActive: false },
        newData: { name, abbreviation, isActive: true },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return successResponse(res, reactivated, 'Satuan diaktifkan kembali', 201);
    }

    const unit = await prisma.unitOfMeasure.create({
      data: { name, abbreviation },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'unit_of_measures',
      recordId: unit.id,
      newData: { name, abbreviation },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, unit, 'Satuan berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const updateUnit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.unitOfMeasure.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Satuan tidak ditemukan', 404);

    const { isActive } = req.body;
    const name = cleanText(req.body.name);
    const abbreviation = cleanText(req.body.abbreviation);

    if ((name !== undefined && (typeof name !== 'string' || !name))
      || (abbreviation !== undefined && (typeof abbreviation !== 'string' || !abbreviation))) {
      return errorResponse(res, 'Nama dan singkatan tidak boleh kosong', 400);
    }
    if (!isBooleanOrUndefined(isActive)) {
      return errorResponse(res, 'Status aktif harus berupa boolean', 400);
    }

    if (abbreviation !== undefined && abbreviation !== existing.abbreviation) {
      const sameAbbreviation = await prisma.unitOfMeasure.findUnique({ where: { abbreviation } });
      if (sameAbbreviation && sameAbbreviation.id !== id) {
        return errorResponse(res, 'Satuan dengan singkatan tersebut sudah ada', 409);
      }
    }

    // Menonaktifkan lewat PUT mengikuti aturan yang sama dengan DELETE
    if (isActive === false && existing.isActive) {
      const usage = await countUnitUsage(id);
      if (usage.products > 0 || usage.conversions > 0) {
        return errorResponse(res, unitInUseMessage(usage), 400);
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (abbreviation !== undefined) updateData.abbreviation = abbreviation;
    if (isActive !== undefined) updateData.isActive = isActive;

    const unit = await prisma.unitOfMeasure.update({
      where: { id },
      data: updateData,
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'unit_of_measures',
      recordId: id,
      oldData: { name: existing.name, abbreviation: existing.abbreviation },
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, unit, 'Satuan berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const deleteUnit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.unitOfMeasure.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Satuan tidak ditemukan', 404);

    const usage = await countUnitUsage(id);
    if (usage.products > 0 || usage.conversions > 0) {
      return errorResponse(res, unitInUseMessage(usage), 400);
    }

    await prisma.unitOfMeasure.update({
      where: { id },
      data: { isActive: false },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'unit_of_measures',
      recordId: id,
      oldData: { name: existing.name, isActive: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Satuan berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

// ==================== UnitLembaga ====================

const getAllUnitLembaga = async (req, res, next) => {
  try {
    const units = await prisma.unitLembaga.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return successResponse(res, units, 'Daftar unit lembaga berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const createUnitLembaga = async (req, res, next) => {
  try {
    const name = cleanText(req.body.name);
    if (!name || typeof name !== 'string') return errorResponse(res, 'Nama unit lembaga wajib diisi', 400);

    const sameName = await prisma.unitLembaga.findUnique({ where: { name } });
    if (sameName && sameName.isActive) {
      return errorResponse(res, 'Unit lembaga dengan nama tersebut sudah ada', 409);
    }

    // Nama milik unit lembaga yang sudah dinonaktifkan → aktifkan kembali
    if (sameName) {
      const reactivated = await prisma.unitLembaga.update({
        where: { id: sameName.id },
        data: { isActive: true },
      });

      await createLog({
        userId: req.user.id,
        action: ACTION_TYPES.UPDATE,
        tableName: 'unit_lembaga',
        recordId: reactivated.id,
        oldData: { name, isActive: false },
        newData: { name, isActive: true },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return successResponse(res, reactivated, 'Unit lembaga diaktifkan kembali', 201);
    }

    const unit = await prisma.unitLembaga.create({
      data: { name },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'unit_lembaga',
      recordId: unit.id,
      newData: { name },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, unit, 'Unit lembaga berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const updateUnitLembaga = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.unitLembaga.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Unit lembaga tidak ditemukan', 404);

    const { isActive } = req.body;
    const name = cleanText(req.body.name);

    if (name !== undefined && (typeof name !== 'string' || !name)) {
      return errorResponse(res, 'Nama unit lembaga tidak boleh kosong', 400);
    }
    if (!isBooleanOrUndefined(isActive)) {
      return errorResponse(res, 'Status aktif harus berupa boolean', 400);
    }

    if (name !== undefined && name !== existing.name) {
      const sameName = await prisma.unitLembaga.findUnique({ where: { name } });
      if (sameName && sameName.id !== id) {
        return errorResponse(res, 'Unit lembaga dengan nama tersebut sudah ada', 409);
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = isActive;

    const unit = await prisma.unitLembaga.update({
      where: { id },
      data: updateData,
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'unit_lembaga',
      recordId: id,
      oldData: { name: existing.name },
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, unit, 'Unit lembaga berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const deleteUnitLembaga = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.unitLembaga.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'Unit lembaga tidak ditemukan', 404);

    await prisma.unitLembaga.update({
      where: { id },
      data: { isActive: false },
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'unit_lembaga',
      recordId: id,
      oldData: { name: existing.name, isActive: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Unit lembaga berhasil dinonaktifkan');
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getAllUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  getAllUnitLembaga,
  createUnitLembaga,
  updateUnitLembaga,
  deleteUnitLembaga,
};
