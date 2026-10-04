const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleStock = {
  id: 'prod-1', name: 'Semen', sku: 'SMN-001', barcode: '123', stock: 100,
  minStock: 10, maxStock: 500, isActive: true,
  category: { id: 'cat-1', name: 'Semen' },
  brand: { id: 'b-1', name: 'Tiga Roda' },
  unitOfMeasure: { id: 'u-1', name: 'Sak', abbreviation: 'sak' },
  variants: [],
};

describe('GET /api/stock', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/stock');
    expect(res.status).toBe(401);
  });

  test('should return stock list', async () => {
    mockPrisma.product.findMany.mockResolvedValue([sampleStock]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/stock')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('should support search filter', async () => {
    mockPrisma.product.findMany.mockResolvedValue([sampleStock]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/stock?search=semen')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should support barcode filter', async () => {
    mockPrisma.product.findMany.mockResolvedValue([sampleStock]);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/stock?barcode=123')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should support date filter', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock?dateFrom=2026-03-01&dateTo=2026-03-22')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const { where } = mockPrisma.product.findMany.mock.calls[0][0];
    // Day boundaries must be in WIB (+07:00), independent of server timezone
    expect(where.stockMovements.some.createdAt).toEqual({
      gte: new Date('2026-03-01T00:00:00+07:00'),
      lte: new Date('2026-03-22T23:59:59.999+07:00'),
    });
  });

  test('should support category filter', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock?categoryId=cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should support lowStock filter', async () => {
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.product.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock?lowStock=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/stock/:productId', () => {
  test('should return stock detail with history', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleStock);
    mockPrisma.stockMovement.findMany.mockResolvedValue([]);
    mockPrisma.stockMovement.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock/prod-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/stock/adjustment', () => {
  test('should reject non-ADMIN', async () => {
    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ productId: 'prod-1', quantity: 10 });

    expect(res.status).toBe(403);
  });

  test('should reject VIEWER', async () => {
    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ productId: 'prod-1', quantity: 10 });

    expect(res.status).toBe(403);
  });

  test('should reject missing productId', async () => {
    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ quantity: 10 });

    expect(res.status).toBe(400);
  });

  test('should reject missing quantity', async () => {
    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'prod-1' });

    expect(res.status).toBe(400);
  });

  test('should adjust stock successfully', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleStock);
    mockPrisma.product.update.mockResolvedValue({ ...sampleStock, stock: 110 });
    mockPrisma.stockMovement.create.mockResolvedValue({ id: 'sm-1', type: 'ADJUSTMENT', quantity: 10 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'prod-1', quantity: 10, notes: 'Koreksi stok' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should reject negative quantity', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(sampleStock);
    mockPrisma.stockMovement.create.mockResolvedValue({ id: 'sm-1' });

    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'prod-1', quantity: -5 });

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  test('variant adjustment changes product total by the variant delta', async () => {
    // product total 100 = variant A 30 + others 70; set variant A to 40
    mockPrisma.product.findUnique.mockResolvedValue({ ...sampleStock, stock: 100, unitId: null });
    mockPrisma.productVariant.findUnique.mockResolvedValue({ id: 'var-1', productId: 'prod-1', stock: 30 });
    mockPrisma.productVariant.update.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.stockMovement.create.mockResolvedValue({ id: 'sm-1', productId: 'prod-1' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'prod-1', variantId: 'var-1', quantity: 40 });

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'prod-1' }, data: { stock: 110 } });
    expect(mockPrisma.productVariant.update).toHaveBeenCalledWith({ where: { id: 'var-1' }, data: { stock: 40 } });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 10, previousStock: 100, newStock: 110 }) })
    );
  });

  test('variant adjustment rejects a variant of another product', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ ...sampleStock, stock: 100, unitId: null });
    mockPrisma.productVariant.findUnique.mockResolvedValue({ id: 'var-9', productId: 'prod-9', stock: 5 });

    const res = await request(app)
      .post('/api/stock/adjustment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'prod-1', variantId: 'var-9', quantity: 40 });

    expect(res.status).toBe(404);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});

describe('stock.service addMovement', () => {
  const stockService = require('../src/services/stock.service');

  test('rejects negative quantity for ADJUSTMENT at service level', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ ...sampleStock, stock: 100, unitId: null });

    await expect(stockService.addMovement({
      productId: 'prod-1', quantity: -1, movementType: 'ADJUSTMENT', userId: 'u-1',
    })).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});
