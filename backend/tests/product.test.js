const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleProduct = {
  id: 'prod-1', name: 'Semen Tiga Roda', sku: 'SMN-001', barcode: '123456',
  stock: 100, minStock: 10, maxStock: 500, buyPrice: 50000, sellPrice: 65000,
  unit: 'sak', isActive: true, categoryId: 'cat-1', brandId: 'brand-1',
  category: { id: 'cat-1', name: 'Semen' },
  brand: { id: 'brand-1', name: 'Tiga Roda' },
  unitOfMeasure: { id: 'unit-1', name: 'Sak', abbreviation: 'sak' },
};

describe('GET /api/products', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });

  test('should return paginated products', async () => {
    mockPrisma.product.findMany.mockResolvedValue([sampleProduct]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('should filter by search query', async () => {
    mockPrisma.product.findMany.mockResolvedValue([sampleProduct]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/products?search=semen')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/products/:id', () => {
  test('should return product by id', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleProduct);

    const res = await request(app)
      .get('/api/products/prod-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent product', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/products/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/products', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(403);
  });

  test('should reject invalid data (missing name)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryId: 'cat-1' });

    expect(res.status).toBe(422);
  });
});

describe('PUT /api/products/:id — field yang dikendalikan server', () => {
  test('tidak menulis stock/isActive/id/createdBy/timestamps dari body', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleProduct);
    mockPrisma.product.update.mockResolvedValue(sampleProduct);
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Semen' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/products/prod-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Semen Baru', categoryId: 'cat-1', stock: 5, isActive: false,
        id: 'hack', createdBy: 'u-x', updatedBy: 'u-y',
        createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z',
      });

    expect(res.status).toBe(200);
    const { data } = mockPrisma.product.update.mock.calls[0][0];
    expect(data).toMatchObject({ name: 'Semen Baru', categoryId: 'cat-1', updatedBy: 'user-test-1' });
    ['stock', 'isActive', 'id', 'createdBy', 'createdAt', 'updatedAt'].forEach((f) => {
      expect(data).not.toHaveProperty(f);
    });
  });
});

describe('DELETE /api/products/:id', () => {
  test('should reject KASIR role', async () => {
    const res = await request(app)
      .delete('/api/products/prod-1')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(403);
  });

  test('should deactivate product that is not on any active PO', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleProduct);
    mockPrisma.purchaseOrderItem.findFirst.mockResolvedValue(null);
    mockPrisma.product.update.mockResolvedValue({ ...sampleProduct, isActive: false });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/products/prod-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'prod-1' },
      data: expect.objectContaining({ isActive: false }),
    }));
  });

  test('should reject product that is still on an active PO', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleProduct);
    mockPrisma.purchaseOrderItem.findFirst.mockResolvedValue({ purchaseOrder: { poNumber: 'PO-2026-002' } });

    const res = await request(app)
      .delete('/api/products/prod-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('PO-2026-002');
    expect(mockPrisma.purchaseOrderItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        productId: 'prod-1',
        purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
      },
    }));
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});
