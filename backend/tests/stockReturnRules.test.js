const request = require('supertest');
const { adminToken, kasirToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');
const stockService = require('../src/services/stock.service');
const { resolveFactor, resolveFactorFromDb } = require('../src/utils/unitResolver');

beforeEach(() => resetMocks());

const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join('?') : String(call[0]));
const as = (token) => (req) => req.set('Authorization', `Bearer ${token}`);

describe('unitResolver', () => {
  const units = [
    { unitId: 'u-dus', conversionFactor: '12.0000', isBaseUnit: true },
    { unitId: 'u-pcs', conversionFactor: 1, isBaseUnit: false },
  ];

  test('unitId kosong = satuan dasar', () => {
    expect(resolveFactor({ unitId: null }, units, null)).toBe(1);
    expect(resolveFactor({ unitId: null }, units, undefined)).toBe(1);
  });

  test('baris ProductUnit dipakai apa pun flag isBaseUnit & product.unitId', () => {
    expect(resolveFactor({ unitId: null }, units, 'u-dus')).toBe(12);
    expect(resolveFactor({ unitId: 'u-dus' }, units, 'u-dus')).toBe(12);
    expect(resolveFactor({ unitId: 'u-lain' }, units, 'u-pcs')).toBe(1);
  });

  test('satuan milik produk sendiri tanpa ProductUnit = dasar; satuan asing → 400', () => {
    expect(resolveFactor({ unitId: 'u-own' }, [], 'u-own')).toBe(1);
    expect(() => resolveFactor({ unitId: 'u-own' }, units, 'u-asing'))
      .toThrow(expect.objectContaining({ status: 400, message: 'Satuan tidak terdaftar untuk produk ini' }));
    expect(() => resolveFactor({ unitId: null }, [], 'u-asing')).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('faktor konversi 0/negatif → 400', () => {
    expect(() => resolveFactor({ unitId: null }, [{ unitId: 'u-x', conversionFactor: 0 }], 'u-x'))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  test('versi DB: cari ProductUnit dulu, lalu product.unitId, lalu 400', async () => {
    mockPrisma.productUnit.findUnique.mockResolvedValue({ conversionFactor: 12 });
    expect(await resolveFactorFromDb(mockPrisma, 'p-1', 'u-dus', { unitId: null })).toBe(12);
    expect(mockPrisma.productUnit.findUnique).toHaveBeenCalledWith({
      where: { productId_unitId: { productId: 'p-1', unitId: 'u-dus' } },
    });

    mockPrisma.productUnit.findUnique.mockResolvedValue(null);
    mockPrisma.product.findUnique.mockResolvedValue({ unitId: 'u-own' });
    expect(await resolveFactorFromDb(mockPrisma, 'p-1', 'u-own')).toBe(1);
    await expect(resolveFactorFromDb(mockPrisma, 'p-1', 'u-asing')).rejects.toMatchObject({ status: 400 });
  });
});

describe('POST /api/stock/adjustment — konversi satuan', () => {
  const adjust = (body) => as(adminToken)(request(app).post('/api/stock/adjustment')).send(body);

  const setupAdjust = (productUnit) => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Paku', unitId: null, stock: 10, minStock: 0 });
    mockPrisma.productUnit.findUnique.mockResolvedValue(productUnit);
    mockPrisma.stockMovement.create.mockResolvedValue({ id: 'sm-1' });
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.user.findMany.mockResolvedValue([]);
  };

  test('3 Dus (×12) pada produk dengan product.unitId null → stok 36', async () => {
    setupAdjust({ unitId: 'u-dus', conversionFactor: 12, isBaseUnit: true });
    const res = await adjust({ productId: 'p-1', unitId: 'u-dus', quantity: 3 });

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 36 } });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 26, previousStock: 10, newStock: 36 }),
    }));
  });

  test('satuan tidak terdaftar → 400 dan stok tidak berubah', async () => {
    setupAdjust(null);
    const res = await adjust({ productId: 'p-1', unitId: 'u-asing', quantity: 3 });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Satuan tidak terdaftar untuk produk ini');
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  test('tanpa unitId = satuan dasar', async () => {
    setupAdjust(null);
    const res = await adjust({ productId: 'p-1', quantity: 7 });
    expect(res.status).toBe(200);
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 7 } });
  });
});

describe('stok menipis = stock <= minStock', () => {
  const products = [
    { id: 'a', name: 'Di bawah', stock: 4, minStock: 5 },
    { id: 'b', name: 'Tepat minimum', stock: 5, minStock: 5 },
    { id: 'c', name: 'Aman', stock: 6, minStock: 5 },
    { id: 'd', name: 'Tanpa batas minimum', stock: 0, minStock: 0 },
  ];

  test('GET /api/stock?lowStock=true menyertakan stok yang tepat di minimum', async () => {
    mockPrisma.product.findMany.mockResolvedValue(products);
    const res = await as(adminToken)(request(app).get('/api/stock?lowStock=true'));

    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.id)).toEqual(['a', 'b']);
    expect(res.body.pagination.total).toBe(2);
  });

  test('checkLowStock memakai aturan yang sama', async () => {
    mockPrisma.product.findMany.mockResolvedValue(products);
    expect((await stockService.checkLowStock()).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('GET /api/stock/:productId — riwayat', () => {
  beforeEach(() => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Paku', stock: 10 });
    mockPrisma.stockMovement.findMany.mockResolvedValue([]);
    mockPrisma.stockMovement.count.mockResolvedValue(0);
  });

  test('tanggal polos dihitung sebagai hari WIB', async () => {
    const res = await as(adminToken)(request(app).get('/api/stock/p-1?startDate=2026-10-10&endDate=2026-10-10'));

    expect(res.status).toBe(200);
    expect(mockPrisma.stockMovement.findMany.mock.calls[0][0].where).toEqual({
      productId: 'p-1',
      createdAt: { gte: new Date('2026-10-09T17:00:00.000Z'), lte: new Date('2026-10-10T16:59:59.999Z') },
    });
  });

  test.each(['?page=0', '?limit=-5', '?endDate=ngawur'])('%s → 400', async (qs) => {
    const res = await as(adminToken)(request(app).get(`/api/stock/p-1${qs}`));
    expect(res.status).toBe(400);
  });

  test('produk tidak ditemukan → 404 lewat errorHandler', async () => {
    mockPrisma.product.findUnique.mockResolvedValue(null);
    const res = await as(adminToken)(request(app).get('/api/stock/p-x'));
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/stock-opname — nomor opname', () => {
  test('nomor dibuat di dalam transaksi dengan advisory lock, format OPN-YYYYMMDD-HHmmss', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', stock: 3 }]);
    mockPrisma.stockOpname.findUnique
      .mockResolvedValueOnce({ id: 'sudah-ada' }) // detik ini sudah terpakai
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'op-1', opnameNumber: 'OPN-X', items: [] });
    mockPrisma.stockOpname.create.mockResolvedValue({ id: 'op-1' });
    mockPrisma.stockOpnameItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await as(kasirToken)(request(app).post('/api/stock-opname'));

    expect(res.status).toBe(201);
    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /pg_advisory_xact_lock/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$transaction.mock.invocationCallOrder[0])
      .toBeLessThan(mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx]);

    const tried = mockPrisma.stockOpname.findUnique.mock.calls.slice(0, 2).map((c) => c[0].where.opnameNumber);
    const used = mockPrisma.stockOpname.create.mock.calls[0][0].data.opnameNumber;
    expect(used).toMatch(/^OPN-\d{8}-\d{6}$/);
    expect(used).toBe(tried[1]);
    expect(used).not.toBe(tried[0]);
  });
});

describe('GET /api/returns', () => {
  beforeEach(() => {
    mockPrisma.transactionReturn.findMany.mockResolvedValue([]);
    mockPrisma.transactionReturn.count.mockResolvedValue(0);
  });

  test('tanggal polos dihitung sebagai hari WIB', async () => {
    const res = await as(adminToken)(request(app).get('/api/returns?startDate=2026-10-10&endDate=2026-10-10'));

    expect(res.status).toBe(200);
    expect(mockPrisma.transactionReturn.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-10-09T17:00:00.000Z'),
      lte: new Date('2026-10-10T16:59:59.999Z'),
    });
  });

  test.each(['?page=0', '?limit=abc', '?startDate=ngawur'])('%s → 400', async (qs) => {
    const res = await as(adminToken)(request(app).get(`/api/returns${qs}`));
    expect(res.status).toBe(400);
    expect(mockPrisma.transactionReturn.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/returns — nomor retur', () => {
  test('advisory lock diambil sebelum membaca nomor retur terakhir', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1', status: 'COMPLETED', total: 10000, tax: 0, projectId: null,
      items: [{ id: 'ti-1', productId: 'p-1', quantity: 10, baseQty: 10, price: 1000, subtotal: 10000 }],
    });
    mockPrisma.transactionReturnItem.groupBy.mockResolvedValue([]);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: 0 } });
    mockPrisma.transactionReturn.findFirst.mockResolvedValue(null);
    mockPrisma.transactionReturn.create.mockResolvedValue({ id: 'rt-1' });
    mockPrisma.transactionReturnItem.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', stock: 5 });
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.transactionReturn.findUnique.mockResolvedValue({ id: 'rt-1', returnNumber: 'RTN-1', refundAmount: 2000 });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await as(kasirToken)(request(app).post('/api/returns'))
      .send({ transactionId: 'tx-1', items: [{ transactionItemId: 'ti-1', quantity: '2' }] });

    expect(res.status).toBe(201);
    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /pg_advisory_xact_lock/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$queryRaw.mock.calls[lockIdx][1]).toBe('docnum:RTN');
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx])
      .toBeLessThan(mockPrisma.transactionReturn.findFirst.mock.invocationCallOrder[0]);
    expect(mockPrisma.transactionReturn.create.mock.calls[0][0].data.returnNumber).toMatch(/^RTN-\d{8}-0001$/);
    expect(mockPrisma.transactionReturnItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ quantity: 2, baseQty: 2 });
  });
});
