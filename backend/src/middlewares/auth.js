const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { errorResponse } = require('../utils/responseHelper');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Akses ditolak, silakan login terlebih dahulu', 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Cek apakah user masih aktif di database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, isActive: true, deletedAt: true },
    });

    if (!user || !user.isActive || user.deletedAt) {
      return errorResponse(res, 'Akun tidak aktif atau telah dihapus', 403);
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Token telah kadaluarsa', 401);
    }
    if (err.name === 'JsonWebTokenError') {
      return errorResponse(res, 'Token tidak valid', 401);
    }
    return errorResponse(res, 'Akses ditolak, silakan login terlebih dahulu', 401);
  }
};

module.exports = { authenticate };
