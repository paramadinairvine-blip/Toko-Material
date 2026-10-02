const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleSupplier = {
  id: 's-1', name: 'PT Test Supplier', contactName: 'Budi',
  phone: '08123456789', email: 'budi@test.com', address: 'Jakarta',
  isActive: true,
};

describe('GET /api/suppliers', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/suppliers');
    expect(res.status).toBe(401);
  });

  test('should return suppliers', async () => {
    mockPrisma.supplier.findMany.mockResolvedValue([sampleSupplier]);
    mockPrisma.supplier.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('should support search', async () => {
    mockPrisma.supplier.findMany.mockResolvedValue([]);
    mockPrisma.supplier.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/suppliers?search=test')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/suppliers/:id', () => {
  test('should return supplier by id', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue({
      ...sampleSupplier,
      purchaseOrders: [],
      _count: { products: 3, purchaseOrders: 1 },
    });

    const res = await request(app)
      .get('/api/suppliers/s-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent supplier', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/suppliers/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/suppliers', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Test', phone: '08123' });

    expect(res.status).toBe(403);
  });

  test('should reject invalid data (missing name)', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ phone: '08123' });

    expect(res.status).toBe(422);
  });

  test('should create supplier successfully', async () => {
    mockPrisma.supplier.create.mockResolvedValue(sampleSupplier);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'PT Test Supplier', phone: '08123456789' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('KASIR should create supplier', async () => {
    mockPrisma.supplier.create.mockResolvedValue(sampleSupplier);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/suppliers')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ name: 'PT Test', phone: '08123' });

    expect(res.status).toBe(201);
  });
});

describe('PUT /api/suppliers/:id', () => {
  test('should update supplier', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(sampleSupplier);
    mockPrisma.supplier.update.mockResolvedValue({ ...sampleSupplier, name: 'Updated' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/suppliers/s-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent supplier', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/suppliers/non-existent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/suppliers/:id', () => {
  test('should deactivate supplier', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(sampleSupplier);
    mockPrisma.supplier.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/suppliers/s-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should reject supplier that still has an active PO', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(sampleSupplier);
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue({ poNumber: 'PO-2026-001' });

    const res = await request(app)
      .delete('/api/suppliers/s-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('PO-2026-001');
    expect(mockPrisma.purchaseOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { supplierId: 's-1', status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
    }));
    expect(mockPrisma.supplier.update).not.toHaveBeenCalled();
  });

  test('should reject non-ADMIN', async () => {
    const res = await request(app)
      .delete('/api/suppliers/s-1')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(403);
  });

  test('should return 404 for non-existent supplier', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/suppliers/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});
