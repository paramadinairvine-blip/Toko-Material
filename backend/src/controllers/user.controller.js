const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const { successResponse, errorResponse, paginatedResponse } = require('../utils/responseHelper');
const { createLog, ACTION_TYPES } = require('../services/auditLog.service');
const { hashPassword } = require('../services/auth.service');
const { ROLES } = require('../utils/constants');
const { parsePagination, parseEnumParam } = require('../utils/queryParams');

const userSelect = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  avatar: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Cabut semua refresh token aktif milik user (paksa login ulang).
 */
const revokeAllRefreshTokens = (userId) => prisma.refreshToken.updateMany({
  where: { userId, revoked: false },
  data: { revoked: true },
});

const isActiveAdmin = (user) => user.role === ROLES.ADMIN && user.isActive && !user.deletedAt;

/**
 * Apakah masih ada ADMIN aktif lain selain user ini.
 */
const hasOtherActiveAdmin = async (userId) => {
  const count = await prisma.user.count({
    where: { role: ROLES.ADMIN, isActive: true, deletedAt: null, id: { not: userId } },
  });
  return count > 0;
};

/**
 * Pesan bentrok bila email / username sudah dipakai user lain, atau null.
 */
const findDuplicateUser = async ({ email, username, excludeId }) => {
  const or = [];
  if (email) or.push({ email });
  if (username) or.push({ username });
  if (or.length === 0) return null;

  const where = { OR: or };
  if (excludeId) where.id = { not: excludeId };
  const found = await prisma.user.findFirst({ where, select: { email: true, username: true } });
  if (!found) return null;
  return email && found.email === email
    ? 'Email tersebut sudah digunakan user lain'
    : 'Username tersebut sudah digunakan user lain';
};

const getAll = async (req, res, next) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const role = parseEnumParam(req.query.role, Object.values(ROLES), 'role');

    const where = { deletedAt: null };
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({ where, select: userSelect, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.user.count({ where }),
    ]);

    return paginatedResponse(res, data, total, page, limit, 'Daftar user berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const getById = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: userSelect,
    });

    if (!user) return errorResponse(res, 'User tidak ditemukan', 404);

    return successResponse(res, user, 'Detail user berhasil diambil');
  } catch (err) {
    return next(err);
  }
};

const create = async (req, res, next) => {
  try {
    const { username, email, password, fullName, phone, role } = req.body;
    // Auto-generate username from email if not provided
    const finalUsername = username || email.split('@')[0];

    // Email/username unik (termasuk milik user yang sudah dihapus) → 409 yang jelas
    const duplicate = await findDuplicateUser({ email, username: finalUsername });
    if (duplicate) return errorResponse(res, duplicate, 409);

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: { username: finalUsername, email, password: hashedPassword, fullName, phone, role },
      select: userSelect,
    });

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.CREATE,
      tableName: 'users',
      recordId: user.id,
      newData: { username: finalUsername, email, fullName, role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, user, 'User berhasil dibuat', 201);
  } catch (err) {
    return next(err);
  }
};

const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    // User yang sudah dihapus (soft delete) tidak boleh diubah / dihidupkan kembali
    if (!existing || existing.deletedAt) return errorResponse(res, 'User tidak ditemukan', 404);

    const { username, email, fullName, phone, role, isActive } = req.body;

    const updateData = {};
    if (username !== undefined) updateData.username = username;
    if (email !== undefined) updateData.email = email;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (phone !== undefined) updateData.phone = phone;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const deactivating = updateData.isActive === false && existing.isActive;
    const demoting = updateData.role !== undefined && updateData.role !== existing.role && existing.role === ROLES.ADMIN;

    if (existing.id === req.user.id) {
      if (deactivating) {
        return errorResponse(res, 'Tidak dapat menonaktifkan akun sendiri', 400);
      }
      if (demoting) {
        return errorResponse(res, 'Tidak dapat mengubah role akun sendiri', 400);
      }
    }

    if (isActiveAdmin(existing) && (deactivating || demoting) && !(await hasOtherActiveAdmin(id))) {
      return errorResponse(res, 'Minimal harus ada satu ADMIN aktif', 400);
    }

    const duplicate = await findDuplicateUser({
      email: updateData.email !== existing.email ? updateData.email : undefined,
      username: updateData.username !== existing.username ? updateData.username : undefined,
      excludeId: id,
    });
    if (duplicate) return errorResponse(res, duplicate, 409);

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: userSelect,
    });

    if (deactivating) {
      await revokeAllRefreshTokens(id);
    }

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'users',
      recordId: id,
      oldData: { username: existing.username, email: existing.email, fullName: existing.fullName, role: existing.role },
      newData: updateData,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, user, 'User berhasil diperbarui');
  } catch (err) {
    return next(err);
  }
};

const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return errorResponse(res, 'User tidak ditemukan', 404);

    if (existing.id === req.user.id) {
      return errorResponse(res, 'Tidak dapat menghapus akun sendiri', 400);
    }

    if (existing.deletedAt) {
      return errorResponse(res, 'User sudah dihapus sebelumnya', 400);
    }

    if (isActiveAdmin(existing) && !(await hasOtherActiveAdmin(id))) {
      return errorResponse(res, 'Minimal harus ada satu ADMIN aktif', 400);
    }

    // Soft delete: tandai sebagai dihapus, nonaktifkan akun
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await revokeAllRefreshTokens(id);

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.DELETE,
      tableName: 'users',
      recordId: id,
      oldData: { username: existing.username, email: existing.email, fullName: existing.fullName, role: existing.role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'User berhasil dihapus');
  } catch (err) {
    return next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;

    // Allow: ADMIN can change anyone's password, non-admin can only change own
    if (req.user.role !== ROLES.ADMIN && req.user.id !== id) {
      return errorResponse(res, 'Anda tidak memiliki izin untuk mengubah password user lain', 403);
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt) return errorResponse(res, 'User tidak ditemukan', 404);

    // Non-admin must provide old password
    if (req.user.role !== ROLES.ADMIN) {
      if (!oldPassword) {
        return errorResponse(res, 'Password lama wajib diisi', 400);
      }
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        return errorResponse(res, 'Password lama tidak sesuai', 400);
      }
    }

    if (!newPassword || newPassword.length < 6) {
      return errorResponse(res, 'Password baru minimal 6 karakter', 400);
    }

    const hashedPassword = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
    // Sesi lain (refresh token) tidak berlaku lagi setelah password diganti
    await revokeAllRefreshTokens(id);

    await createLog({
      userId: req.user.id,
      action: ACTION_TYPES.UPDATE,
      tableName: 'users',
      recordId: id,
      newData: { passwordChanged: true },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return successResponse(res, null, 'Password berhasil diubah');
  } catch (err) {
    return next(err);
  }
};

module.exports = { getAll, getById, create, update, remove, changePassword };
