const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

const SALT_ROUNDS = 12;
const ACCESS_TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_DAYS = 30;

/**
 * Generate a JWT access token.
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
};

/**
 * Generate a random refresh token string.
 */
const generateRefreshTokenString = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Hash a plain-text password with bcrypt (salt 12).
 * @param {string} password
 * @returns {Promise<string>} hashed password
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Login with email + password.
 * Returns user data (without password) + access & refresh tokens.
 */
const login = async (email, password) => {
  const user = await prisma.user.findUnique({ where: { email } });

  // User yang sudah dihapus (soft delete) diperlakukan seperti tidak ada
  if (!user || user.deletedAt) {
    throw new AppError('Email atau password salah', 401);
  }

  if (!user.isActive) {
    throw new AppError('Akun tidak aktif, silakan hubungi administrator', 403);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AppError('Email atau password salah', 401);
  }

  // Generate tokens
  const accessToken = generateAccessToken(user);
  const refreshTokenStr = generateRefreshTokenString();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  // Cleanup: hapus token expired/revoked milik user ini
  await prisma.refreshToken.deleteMany({
    where: {
      userId: user.id,
      OR: [
        { expiresAt: { lt: new Date() } },
        { revoked: true },
      ],
    },
  });

  // Save refresh token to database
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenStr,
      userId: user.id,
      expiresAt,
    },
  });

  // Return user without password
  const { password: _, ...userData } = user;

  return {
    user: userData,
    accessToken,
    refreshToken: refreshTokenStr,
  };
};

/**
 * Refresh access token using a valid refresh token.
 * Returns a new access token (refresh token stays the same).
 */
const refreshToken = async (token) => {
  if (!token) {
    throw new AppError('Refresh token wajib diisi', 400);
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!stored) {
    throw new AppError('Refresh token tidak valid', 401);
  }

  if (stored.revoked) {
    throw new AppError('Refresh token telah dicabut', 401);
  }

  if (new Date() > stored.expiresAt) {
    // Auto-revoke expired token
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
    throw new AppError('Refresh token telah kadaluarsa, silakan login kembali', 401);
  }

  if (!stored.user.isActive || stored.user.deletedAt) {
    throw new AppError('Akun tidak aktif, silakan hubungi administrator', 403);
  }

  const accessToken = generateAccessToken(stored.user);

  return { accessToken };
};

/**
 * Logout: revoke the given refresh token.
 */
const logout = async (token) => {
  if (!token) {
    return;
  }

  const stored = await prisma.refreshToken.findUnique({ where: { token } });

  if (stored && !stored.revoked) {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revoked: true },
    });
  }
};

module.exports = {
  login,
  refreshToken,
  logout,
  hashPassword,
};
