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

describe('GET /api/stock-opname filters', () => {
  test('applies search and WIB date range filters', async () => {
    mockPrisma.stockOpname.findMany.mockResolvedValue([]);
    mockPrisma.stockOpname.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/stock-opname?search=OPN-2026&dateFrom=2026-03-01&dateTo=2026-03-31&page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const expectedWhere = {
      opnameNumber: { contains: 'OPN-2026', mode: 'insensitive' },
      createdAt: {
        gte: new Date('2026-03-01T00:00:00+07:00'),
        lte: new Date('2026-03-31T23:59:59.999+07:00'),
      },
    };
    expect(mockPrisma.stockOpname.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expectedWhere, skip: 0, take: 10,
    }));
    expect(mockPrisma.stockOpname.count).toHaveBeenCalledWith({ where: expectedWhere });
  });
});

describe('PUT /api/stock-opname/:id/items/:itemId', () => {
  const put = (body) => request(app)
    .put('/api/stock-opname/opname-1/items/item-1')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  test.each([
    ['NaN string', 'abc'],
    ['negative', -1],
    ['decimal', 2.5],
    ['empty string', ''],
  ])('rejects %s actualStock', async (_label, actualStock) => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue({ id: 'opname-1', status: 'DRAFT' });
    mockPrisma.stockOpnameItem.findUnique.mockResolvedValue({ id: 'item-1', stockOpnameId: 'opname-1', systemStock: 10 });

    const res = await put({ actualStock });

    expect(res.status).toBe(400);
    expect(mockPrisma.stockOpnameItem.update).not.toHaveBeenCalled();
  });

  test('rejects updates on a COMPLETED opname', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue({ id: 'opname-1', status: 'COMPLETED' });
    mockPrisma.stockOpnameItem.findUnique.mockResolvedValue({ id: 'item-1', stockOpnameId: 'opname-1', systemStock: 10 });

    const res = await put({ actualStock: 5 });

    expect(res.status).toBe(400);
    expect(mockPrisma.stockOpnameItem.update).not.toHaveBeenCalled();
  });

  test('updates actual stock and difference', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue({ id: 'opname-1', status: 'DRAFT' });
    mockPrisma.stockOpnameItem.findUnique.mockResolvedValue({ id: 'item-1', stockOpnameId: 'opname-1', systemStock: 10 });
    mockPrisma.stockOpnameItem.update.mockResolvedValue({ id: 'item-1', actualStock: 7, difference: -3 });

    const res = await put({ actualStock: '7' });

    expect(res.status).toBe(200);
    expect(mockPrisma.stockOpnameItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { actualStock: 7, difference: -3 },
    });
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
    mockPrisma.stockOpname.updateMany.mockResolvedValue({ count: 1 });
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

  test('status claim happens inside the DB transaction so a failure rolls it back', async () => {
    let inTx = false;
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      inTx = true;
      try { return await fn(mockPrisma); } finally { inTx = false; }
    });
    const claimedInTx = [];
    mockPrisma.stockOpname.updateMany.mockImplementation(() => {
      claimedInTx.push(inTx);
      return Promise.resolve({ count: 1 });
    });
    mockPrisma.stockOpname.findUnique.mockResolvedValue(opnameWithDifference(-10));
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', name: 'Semen Tiga Roda', stock: 4 }]);

    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(claimedInTx).toEqual([true]);
    expect(mockPrisma.stockOpname.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'opname-1', status: { not: 'COMPLETED' } },
    }));
  });

  test('should reject a concurrent second completion (conditional status update count 0)', async () => {
    // Pre-read (stale) still shows IN_PROGRESS, but the conditional update loses the race
    mockPrisma.stockOpname.findUnique.mockResolvedValue(opnameWithDifference(-10));
    mockPrisma.stockOpname.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'prod-1', name: 'Semen Tiga Roda', stock: 50 }]);

    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('sudah selesai');
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  test('should return 404 when the opname does not exist', async () => {
    mockPrisma.stockOpname.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.stockOpname.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/stock-opname/opname-x/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  test('reads items after claiming the status', async () => {
    mockPrisma.stockOpname.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.stockOpname.findUnique.mockResolvedValue(opnameWithDifference(0));
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/stock-opname/opname-1/complete')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const claimOrder = mockPrisma.stockOpname.updateMany.mock.invocationCallOrder[0];
    const readCalls = mockPrisma.stockOpname.findUnique.mock.calls
      .map((c, i) => ({ args: c[0], order: mockPrisma.stockOpname.findUnique.mock.invocationCallOrder[i] }))
      .filter((c) => c.args.include && c.args.include.items === true);
    expect(readCalls.length).toBeGreaterThan(0);
    expect(readCalls.every((c) => c.order > claimOrder)).toBe(true);
  });

  test('should apply the difference when stock stays at zero or above', async () => {
    mockPrisma.stockOpname.updateMany.mockResolvedValue({ count: 1 });
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
