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
