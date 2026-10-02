const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { mockPrisma, resetMocks, mockUserFindUnique } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

// Keep dotenv from filling this in from a local backend/.env — the default is under test
process.env.JWT_EXPIRES_IN = '';

const app = require('../src/index');

const PASSWORD = 'rahasia123';
const user = {
  id: 'user-login-1', email: 'admin@material.dn2', fullName: 'Admin', role: 'ADMIN',
  isActive: true, password: bcrypt.hashSync(PASSWORD, 4),
};

beforeEach(() => resetMocks());

describe('POST /api/auth/login', () => {
  test('should issue access tokens that expire after 15 minutes by default', async () => {
    mockUserFindUnique(user);
    mockPrisma.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.refreshToken.create.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.body.data.accessToken);
    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });
});

describe('rate limit on /api/auth', () => {
  test('should not count token refresh against the login limit', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'unknown-token' });
      expect(res.status).toBe(401);
    }
  });

  test('should still limit login attempts to 20 per 15 minutes', async () => {
    mockUserFindUnique(null);

    const statuses = [];
    for (let i = 0; i < 22; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.50') // own rate-limit key, independent of other tests
        .send({ email: user.email, password: 'wrong-password' });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});
