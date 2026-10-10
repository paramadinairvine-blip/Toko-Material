const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const samplePO = {
  id: 'po-1', poNumber: 'PO-2026-001', status: 'DRAFT',
  supplierId: 's-1', totalAmount: 1000000, notes: 'Test PO',
  supplier: { id: 's-1', name: 'PT Supplier' },
  items: [{ id: 'poi-1', productId: 'p-1', quantity: 50, unitPrice: 20000, receivedQty: 0 }],
  creator: { id: 'user-1', fullName: 'Admin' },
};

describe('GET /api/purchase-orders', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/purchase-orders');
    expect(res.status).toBe(401);
  });

  test('should return purchase orders', async () => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([samplePO]);
    mockPrisma.purchaseOrder.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/purchase-orders')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('should support status filter', async () => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/purchase-orders?status=DRAFT')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should support supplierId filter', async () => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/purchase-orders?supplierId=s-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/purchase-orders/:id', () => {
  test('should return PO by id', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(samplePO);

    const res = await request(app)
      .get('/api/purchase-orders/po-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent PO', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/purchase-orders/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/purchase-orders', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ supplierId: 's-1', items: [] });

    expect(res.status).toBe(403);
  });

  test('KASIR should create PO', async () => {
    mockPrisma.purchaseOrder.create.mockResolvedValue(samplePO);
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(samplePO);
    mockPrisma.purchaseOrderItem.create.mockResolvedValue({});
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1', name: 'PT Test', isActive: true });
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', name: 'Semen', unitId: null, isActive: true }]);
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({
        supplierId: 's-1',
        items: [{ productId: 'p-1', quantity: 50, unitPrice: 20000 }],
      });

    expect(res.status).toBe(201);
    expect(mockPrisma.purchaseOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: 'p-1', quantity: 50, baseQty: 50, price: 20000, subtotal: 1000000 }),
    }));
  });
});

describe('PUT /api/purchase-orders/:id (validasi)', () => {
  const draftPO = { id: 'po-1', status: 'DRAFT', items: [] };

  const put = (body) => request(app)
    .put('/api/purchase-orders/po-1')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  test('menolak items kosong', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(draftPO);
    const res = await put({ items: [] });
    expect(res.status).toBe(422);
    expect(mockPrisma.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
  });

  test('menolak quantity bukan bilangan bulat >= 1', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(draftPO);
    const res = await put({ items: [{ productId: 'p-1', quantity: 0, price: 1000 }] });
    expect(res.status).toBe(422);
    const res2 = await put({ items: [{ productId: 'p-1', quantity: 1.5, price: 1000 }] });
    expect(res2.status).toBe(422);
  });

  test('menolak harga negatif dan productId kosong/bukan string', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(draftPO);
    const res = await put({ items: [{ productId: 'p-1', quantity: 1, price: -5 }] });
    expect(res.status).toBe(422);
    const res2 = await put({ items: [{ productId: '', quantity: 1, price: 5 }] });
    expect(res2.status).toBe(422);
    const res3 = await put({ items: [{ productId: { id: 'x' }, quantity: 1, price: 5 }] });
    expect(res3.status).toBe(422);
  });

  test('memetakan unitPrice → price lalu menyimpan item', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(draftPO);
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', name: 'Semen', unitId: null, isActive: true }]);
    mockPrisma.purchaseOrderItem.deleteMany.mockResolvedValue({});
    mockPrisma.purchaseOrderItem.create.mockResolvedValue({});
    mockPrisma.purchaseOrder.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await put({ items: [{ productId: 'p-1', quantity: 2, unitPrice: 1500 }] });

    expect(res.status).toBe(200);
    expect(mockPrisma.purchaseOrderItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: 'p-1', quantity: 2, price: 1500, subtotal: 3000 }),
    }));
  });
});

describe('PUT /api/purchase-orders/:id/cancel', () => {
  test('should reject non-ADMIN', async () => {
    const res = await request(app)
      .put('/api/purchase-orders/po-1/cancel')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(403);
  });

  test('should reject VIEWER', async () => {
    const res = await request(app)
      .put('/api/purchase-orders/po-1/cancel')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(res.status).toBe(403);
  });
});
