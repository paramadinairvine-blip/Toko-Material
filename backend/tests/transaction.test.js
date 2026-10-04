const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

describe('GET /api/transactions', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/transactions');
    expect(res.status).toBe(401);
  });

  test('should return transactions', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('KASIR should access transactions', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/transactions')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/transactions', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ type: 'CASH', items: [] });

    expect(res.status).toBe(403);
  });

  test('should reject invalid data (missing type)', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ items: [{ productId: 'p-1', quantity: 1 }] });

    expect(res.status).toBe(422);
  });

  test('should reject empty items', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({ type: 'CASH', items: [] });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/transactions money validation', () => {
  const product = { id: 'p-1', name: 'Semen', sellPrice: 10000, stock: 100, productUnits: [] };

  const setupCreate = () => {
    mockPrisma.product.findMany.mockResolvedValue([{ ...product }]);
    mockPrisma.transaction.findFirst.mockResolvedValue(null);
    mockPrisma.transaction.create.mockResolvedValue({ id: 'tx-new' });
    mockPrisma.transactionItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.transaction.findUnique.mockResolvedValue({ id: 'tx-new', transactionNumber: 'TRX-1', type: 'CASH', total: 20000, items: [] });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.notification.createMany.mockResolvedValue({});
  };

  // Same shape as pos/src/pages/Checkout.jsx
  const posPayload = (overrides = {}) => ({
    type: 'CASH',
    items: [{ productId: 'p-1', quantity: 2, price: 10000, unitId: null }],
    discount: 0,
    paidAmount: 20000,
    notes: undefined,
    customerName: undefined,
    customerPhone: undefined,
    kepanitiaan: undefined,
    ...overrides,
  });

  const post = (body) => request(app)
    .post('/api/transactions')
    .set('Authorization', `Bearer ${kasirToken}`)
    .send(body);

  test('rejects charging a completed or cancelled project', async () => {
    setupCreate();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'proj-1', status: 'COMPLETED', isActive: true });
    const res = await post(posPayload({ projectId: 'proj-1' }));
    expect(res.status).toBe(400);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('accepts charging an active project', async () => {
    setupCreate();
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'proj-1', status: 'IN_PROGRESS', isActive: true });
    mockPrisma.project.update.mockResolvedValue({});
    const res = await post(posPayload({ projectId: 'proj-1' }));
    expect(res.status).toBe(201);
  });

  test('accepts the POS checkout payload', async () => {
    setupCreate();
    const res = await post(posPayload());
    expect(res.status).toBe(201);
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ total: 20000, paidAmount: 20000, changeAmount: 0 }) })
    );
  });

  test('rejects negative item discount', async () => {
    const res = await post(posPayload({ items: [{ productId: 'p-1', quantity: 2, price: 10000, discount: -5000 }] }));
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'items[0].discount')).toBe(true);
  });

  test('rejects item discount larger than qty * price', async () => {
    const res = await post(posPayload({ items: [{ productId: 'p-1', quantity: 2, price: 10000, discount: 25000 }] }));
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'items[0].discount')).toBe(true);
  });

  test('rejects negative tax and negative header discount', async () => {
    const res = await post(posPayload({ tax: -100, discount: -100 }));
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'tax')).toBe(true);
    expect(res.body.errors.some((e) => e.field === 'discount')).toBe(true);
  });

  test('rejects CASH transaction when paidAmount is less than total', async () => {
    setupCreate();
    const res = await post(posPayload({ paidAmount: 15000 }));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('pembayaran kurang');
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('coerces string money fields to numbers', async () => {
    setupCreate();
    const res = await post(posPayload({ discount: '5000', paidAmount: '15000' }));
    expect(res.status).toBe(201);
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ discount: 5000, total: 15000, paidAmount: 15000 }) })
    );
  });
});

describe('PUT /api/transactions/:id/cancel', () => {
  const baseTrx = {
    id: 'tx-1', status: 'COMPLETED', total: 100000, projectId: 'proj-1',
    items: [{ id: 'ti-1', productId: 'p-1', quantity: 10, baseQty: 10 }],
  };

  const setupCancel = ({ returnedBase = [], refunded = 0, trx = baseTrx } = {}) => {
    mockPrisma.transaction.findUnique.mockResolvedValue(trx);
    mockPrisma.transactionReturnItem.groupBy.mockResolvedValue(returnedBase);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: refunded } });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', stock: 50 });
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.project.update.mockResolvedValue({});
    mockPrisma.transaction.update.mockResolvedValue({ ...trx, status: 'CANCELLED' });
    mockPrisma.auditLog.create.mockResolvedValue({});
  };

  test('restores full stock and project spent when there are no returns', async () => {
    setupCancel();

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 60 } });
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { spent: { decrement: 100000 } },
    });
  });

  test('only restores the not-yet-returned qty and non-refunded amount', async () => {
    setupCancel({ returnedBase: [{ transactionItemId: 'ti-1', _sum: { baseQty: 4 } }], refunded: 40000 });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 56 } });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 6, previousStock: 50, newStock: 56 }) })
    );
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { spent: { decrement: 60000 } },
    });
  });

  test('restores nothing when everything was already returned and refunded', async () => {
    setupCancel({ returnedBase: [{ transactionItemId: 'ti-1', _sum: { baseQty: 10 } }], refunded: 100000 });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.update).toHaveBeenCalled();
  });

  test('locks the transaction row and re-reads status inside the DB transaction', async () => {
    setupCancel();

    await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', `Bearer ${adminToken}`);

    const firstRaw = mockPrisma.$queryRaw.mock.calls[0][0].join('?');
    expect(firstRaw).toContain('FROM "transactions"');
    expect(firstRaw).toContain('FOR UPDATE');
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[0];
    const readOrder = mockPrisma.transaction.findUnique.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(readOrder);
    // product rows are locked too
    const productLock = mockPrisma.$queryRaw.mock.calls.find((c) => c[0].join('?').includes('FROM "products"'));
    expect(productLock).toBeDefined();
  });

  test('rejects cancelling an already cancelled transaction', async () => {
    setupCancel({ trx: { ...baseTrx, status: 'CANCELLED' } });

    const res = await request(app)
      .put('/api/transactions/tx-1/cancel')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});
