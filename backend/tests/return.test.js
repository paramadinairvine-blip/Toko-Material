const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleReturn = {
  id: 'ret-1', returnNumber: 'RTN-001', reason: 'Barang rusak',
  totalRefund: 50000, createdAt: new Date().toISOString(),
  transaction: { id: 'tx-1', invoiceNumber: 'INV-001' },
  items: [{ id: 'ri-1', quantity: 1, refundAmount: 50000, product: { name: 'Semen' } }],
};

describe('GET /api/returns', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/returns');
    expect(res.status).toBe(401);
  });

  test('should return returns list', async () => {
    mockPrisma.transactionReturn.findMany.mockResolvedValue([sampleReturn]);
    mockPrisma.transactionReturn.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/returns')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('KASIR should access returns', async () => {
    mockPrisma.transactionReturn.findMany.mockResolvedValue([]);
    mockPrisma.transactionReturn.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/returns')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(200);
  });
});

describe('GET /api/returns/:id', () => {
  test('should return return by id', async () => {
    mockPrisma.transactionReturn.findUnique.mockResolvedValue(sampleReturn);

    const res = await request(app)
      .get('/api/returns/ret-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent return', async () => {
    mockPrisma.transactionReturn.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/returns/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/returns', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/returns')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ transactionId: 'tx-1', items: [] });

    expect(res.status).toBe(403);
  });

  // qty 10 x 10.000 - item discount 10.000 = 90.000; header discount 9.000 → total 81.000
  const discountedTrx = {
    id: 'tx-1', status: 'COMPLETED', subtotal: 90000, discount: 9000, tax: 0, total: 81000, projectId: 'proj-1',
    items: [{ id: 'ti-1', productId: 'p-1', quantity: 10, baseQty: 10, price: 10000, discount: 10000, subtotal: 90000 }],
  };

  const setupReturn = ({ trx = discountedTrx, returned = [], refunded = 0 } = {}) => {
    mockPrisma.transaction.findUnique.mockResolvedValue(trx);
    mockPrisma.transactionReturnItem.groupBy.mockResolvedValue(returned);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: refunded } });
    mockPrisma.transactionReturn.findFirst.mockResolvedValue(null);
    mockPrisma.transactionReturn.create.mockImplementation(({ data }) => Promise.resolve({ id: 'ret-1', ...data }));
    mockPrisma.transactionReturnItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', stock: 20 });
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.project.update.mockResolvedValue({});
    mockPrisma.transactionReturn.findUnique.mockResolvedValue({ id: 'ret-1', returnNumber: 'RTN-1', refundAmount: 0 });
    mockPrisma.auditLog.create.mockResolvedValue({});
  };

  const postReturn = (items) => request(app)
    .post('/api/returns')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ transactionId: 'tx-1', items });

  test('refund is prorated from item subtotal after item and header discount', async () => {
    setupReturn();

    const res = await postReturn([{ transactionItemId: 'ti-1', quantity: 5 }]);

    expect(res.status).toBe(201);
    const created = mockPrisma.transactionReturn.create.mock.calls[0][0].data;
    expect(created.refundAmount).toBe(40500);
    const items = mockPrisma.transactionReturnItem.createMany.mock.calls[0][0].data;
    expect(items[0].subtotal).toBe(40500);
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'proj-1' },
      data: { spent: { decrement: 40500 } },
    });
  });

  test('refund is rounded to 2 decimals and partial returns add up to the total', async () => {
    const trx = {
      id: 'tx-1', status: 'COMPLETED', subtotal: 10000, discount: 0, tax: 0, total: 10000, projectId: null,
      items: [{ id: 'ti-1', productId: 'p-1', quantity: 3, baseQty: 3, price: 3333.33, discount: 0, subtotal: 10000 }],
    };
    // first 1 of 3 returned already (refund 3333.33), now return the remaining 2
    setupReturn({ trx, returned: [{ transactionItemId: 'ti-1', _sum: { quantity: 1, baseQty: 1 } }], refunded: 3333.33 });

    const res = await postReturn([{ transactionItemId: 'ti-1', quantity: 2 }]);

    expect(res.status).toBe(201);
    const created = mockPrisma.transactionReturn.create.mock.calls[0][0].data;
    expect(created.refundAmount).toBe(6666.67);
  });

  test('cumulative refunds are capped at the transaction total', async () => {
    setupReturn({ returned: [{ transactionItemId: 'ti-1', _sum: { quantity: 5, baseQty: 5 } }], refunded: 80000 });

    const res = await postReturn([{ transactionItemId: 'ti-1', quantity: 5 }]);

    expect(res.status).toBe(201);
    const created = mockPrisma.transactionReturn.create.mock.calls[0][0].data;
    expect(created.refundAmount).toBe(1000);
  });

  test('returned base qty never exceeds the remaining base qty (fractional conversion)', async () => {
    // 2 box = 5 pcs (factor 2.5); 1 box already returned as 3 pcs
    const trx = {
      id: 'tx-1', status: 'COMPLETED', subtotal: 50000, discount: 0, tax: 0, total: 50000, projectId: null,
      items: [{ id: 'ti-1', productId: 'p-1', quantity: 2, baseQty: 5, price: 25000, discount: 0, subtotal: 50000 }],
    };
    setupReturn({ trx, returned: [{ transactionItemId: 'ti-1', _sum: { quantity: 1, baseQty: 3 } }], refunded: 25000 });

    const res = await postReturn([{ transactionItemId: 'ti-1', quantity: 1 }]);

    expect(res.status).toBe(201);
    const items = mockPrisma.transactionReturnItem.createMany.mock.calls[0][0].data;
    expect(items[0].baseQty).toBe(2);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 22 } });
  });

  test('rejects returning more than sold when the same item is sent twice', async () => {
    setupReturn();

    const res = await postReturn([
      { transactionItemId: 'ti-1', quantity: 6 },
      { transactionItemId: 'ti-1', quantity: 6 },
    ]);

    expect(res.status).toBe(400);
    expect(mockPrisma.transactionReturn.create).not.toHaveBeenCalled();
  });

  test('locks the transaction row before reading it and returned quantities', async () => {
    setupReturn();

    await postReturn([{ transactionItemId: 'ti-1', quantity: 1 }]);

    const firstRaw = mockPrisma.$queryRaw.mock.calls[0][0].join('?');
    expect(firstRaw).toContain('FROM "transactions"');
    expect(firstRaw).toContain('FOR UPDATE');
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.transaction.findUnique.mock.invocationCallOrder[0]);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.transactionReturnItem.groupBy.mock.invocationCallOrder[0]);
  });
});

describe('GET /api/returns/transaction/:transactionId', () => {
  test('should return returns for transaction', async () => {
    mockPrisma.transactionReturn.findMany.mockResolvedValue([sampleReturn]);

    const res = await request(app)
      .get('/api/returns/transaction/tx-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
