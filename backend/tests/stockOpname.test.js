const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleOpname = {
  id: 'opname-1',
  status: 'IN_PROGRESS',
  createdAt: new Date().toISOString(),
  creator: { id: 'user-1', fullName: 'Admin' },
  _count: { items: 5 },
};

describe('GET /api/stock-opname', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/stock-opname');
    expect(res.status).toBe(401);
  });

  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .get('/api/stock-opname')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  test('should return opname list for ADMIN', async () => {
    mockPrisma.stockOpname.findMany.mockResolvedValue([sampleOpname]);
    mockPrisma.stockOpname.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/stock-opname')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('should return opname list for KASIR', async () => {
    mockPrisma.stockOpname.findMany.mockResolvedValue([]);
    mockPrisma.stockOpname.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock-opname')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/stock-opname', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/stock-opname')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/stock-opname/:id', () => {
  test('should return opname by id', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue({
      ...sampleOpname,
      updater: null,
      items: [
        {
          id: 'item-1',
          systemStock: 100,
          actualStock: 98,
          product: { id: 'prod-1', name: 'Semen', sku: 'SMN-001', unit: 'sak', barcode: '123', category: { id: 'cat-1', name: 'Bangunan' } },
        },
      ],
    });

    const res = await request(app)
      .get('/api/stock-opname/opname-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent opname', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/stock-opname/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/stock-opname/:id/complete', () => {
  test('should reject KASIR role', async () => {
    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${kasirToken}`);
    expect(res.status).toBe(403);
  });

  const opnameWithDifference = (difference) => ({
    id: 'opname-1', opnameNumber: 'SO-2026-001', status: 'IN_PROGRESS',
    items: [{ productId: 'prod-1', difference }],
  });

  test('should reject completion when stock would become negative', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue(opnameWithDifference(-10));
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', name: 'Semen Tiga Roda', stock: 4 }]);

    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Semen Tiga Roda');
    expect(res.body.message).toContain('negatif (-6)');
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.stockOpname.update).not.toHaveBeenCalled();
  });

  test('should apply the difference when stock stays at zero or above', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue(opnameWithDifference(-10));
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', name: 'Semen Tiga Roda', stock: 10 }]);
    mockPrisma.stockMovement.create.mockResolvedValue({ id: 'mov-1', productId: 'prod-1' });
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.stockOpname.update.mockResolvedValue({ id: 'opname-1', status: 'COMPLETED', items: [] });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { stock: 0 },
    });
  });
});
