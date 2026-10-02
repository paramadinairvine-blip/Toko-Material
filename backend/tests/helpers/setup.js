const jwt = require('jsonwebtoken');

const JWT_SECRET = 'test-secret-key-for-testing';

// Set test env vars before anything else
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

/**
 * Generate a valid JWT token for testing.
 */
const generateToken = (payload = {}) => {
  const defaults = { id: 'user-test-1', email: 'admin@test.com', role: 'ADMIN' };
  return jwt.sign({ ...defaults, ...payload }, JWT_SECRET, { expiresIn: '1h' });
};

const adminToken = generateToken({ role: 'ADMIN' });
const kasirToken = generateToken({ id: 'user-test-2', email: 'kasir@test.com', role: 'KASIR' });
const viewerToken = generateToken({ id: 'user-test-3', email: 'viewer@test.com', role: 'VIEWER' });

/**
 * Mock Prisma client — call this in jest.mock.
 */
const mockPrisma = {
  product: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn() },
  category: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn() },
  brand: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  supplier: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn() },
  transaction: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
  transactionItem: { findMany: jest.fn(), create: jest.fn(), groupBy: jest.fn() },
  transactionReturn: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
  purchaseOrder: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
  purchaseOrderItem: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  stockMovement: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  stockOpname: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  stockOpnameItem: { findMany: jest.fn(), createMany: jest.fn(), update: jest.fn() },
  project: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn() },
  projectMaterial: { findMany: jest.fn(), create: jest.fn(), createMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
  user: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  auditLog: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  notification: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
  priceHistory: { create: jest.fn(), updateMany: jest.fn() },
  unitOfMeasure: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  unitLembaga: { findMany: jest.fn(), findUnique: jest.fn() },
  productUnit: { findUnique: jest.fn() },
  productVariant: { findUnique: jest.fn(), update: jest.fn() },
  refreshToken: { findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn().mockResolvedValue([]),
  $queryRawUnsafe: jest.fn(),
};

/** Reset all mocks between tests */
const resetMocks = () => {
  Object.values(mockPrisma).forEach((model) => {
    if (typeof model === 'object' && model !== null) {
      Object.values(model).forEach((fn) => {
        if (typeof fn === 'function' && fn.mockReset) fn.mockReset();
      });
    } else if (typeof model === 'function' && model.mockReset) {
      model.mockReset();
    }
  });
  // Restore $transaction default behavior
  mockPrisma.$transaction.mockImplementation((fn) => fn(mockPrisma));

  // Auth middleware cek user.findUnique — return active user for test tokens
  const authUsers = {
    'user-test-1': { id: 'user-test-1', email: 'admin@test.com', role: 'ADMIN', isActive: true },
    'user-test-2': { id: 'user-test-2', email: 'kasir@test.com', role: 'KASIR', isActive: true },
    'user-test-3': { id: 'user-test-3', email: 'viewer@test.com', role: 'VIEWER', isActive: true },
  };
  mockPrisma.user.findUnique.mockImplementation(({ where }) => {
    if (authUsers[where.id]) return Promise.resolve(authUsers[where.id]);
    return Promise.resolve(null);
  });
};

/**
 * Mock user.findUnique while preserving auth middleware users.
 * Use this instead of mockPrisma.user.findUnique.mockResolvedValue()
 */
const mockUserFindUnique = (returnValue) => {
  const authUsers = {
    'user-test-1': { id: 'user-test-1', email: 'admin@test.com', role: 'ADMIN', isActive: true },
    'user-test-2': { id: 'user-test-2', email: 'kasir@test.com', role: 'KASIR', isActive: true },
    'user-test-3': { id: 'user-test-3', email: 'viewer@test.com', role: 'VIEWER', isActive: true },
  };
  mockPrisma.user.findUnique.mockImplementation(({ where }) => {
    if (authUsers[where.id]) return Promise.resolve(authUsers[where.id]);
    return Promise.resolve(typeof returnValue === 'function' ? returnValue(where) : returnValue);
  });
};

module.exports = {
  JWT_SECRET,
  generateToken,
  adminToken,
  kasirToken,
  viewerToken,
  mockPrisma,
  resetMocks,
  mockUserFindUnique,
};
