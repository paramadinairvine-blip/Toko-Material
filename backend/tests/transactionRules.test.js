const request = require('supertest');
const { Prisma } = require('@prisma/client');
const { adminToken, kasirToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

// Produk buatan CMS: product.unitId null, satuan kemasan pertama (Dus ×12)
// ditandai isBaseUnit=true walau faktornya 12.
const cmsProduct = {
  id: 'p-1', name: 'Paku', sellPrice: 1000, stock: 100, unitId: null, isActive: true,
  productUnits: [
    { unitId: 'u-dus', conversionFactor: 12, isBaseUnit: true },
    { unitId: 'u-pak', conversionFactor: 6, isBaseUnit: false },
    { unitId: 'u-pcs', conversionFactor: 1, isBaseUnit: false },
  ],
};

const setupCreate = (product = cmsProduct) => {
  mockPrisma.product.findMany.mockResolvedValue([{ ...product }]);
  mockPrisma.transaction.findFirst.mockResolvedValue(null);
  mockPrisma.transaction.create.mockResolvedValue({ id: 'tx-new' });
  mockPrisma.transactionItem.createMany.mockResolvedValue({ count: 1 });
  mockPrisma.stockMovement.create.mockResolvedValue({});
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.transaction.findUnique.mockResolvedValue({ id: 'tx-new', transactionNumber: 'TRX-1', type: 'CASH', total: 0, items: [] });
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.notification.createMany.mockResolvedValue({});
};

const post = (body, token = kasirToken) => request(app)
  .post('/api/transactions')
  .set('Authorization', `Bearer ${token}`)
  .send(body);

const get = (qs = '') => request(app)
  .get(`/api/transactions${qs}`)
  .set('Authorization', `Bearer ${adminToken}`);

const createdData = () => mockPrisma.transaction.create.mock.calls[0][0].data;
const createdItems = () => mockPrisma.transactionItem.createMany.mock.calls[0][0].data;

describe('POST /api/transactions — konversi satuan', () => {
  test('satuan ber-flag isBaseUnit dengan faktor 12 tetap dikonversi ×12', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', paidAmount: 24000,
      items: [{ productId: 'p-1', unitId: 'u-dus', quantity: 2, price: 12000 }],
    });

    expect(res.status).toBe(201);
    expect(createdItems()[0]).toMatchObject({ unitId: 'u-dus', quantity: 2, baseQty: 24, price: 12000, subtotal: 24000 });
    expect(mockPrisma.product.update).toHaveBeenCalledWith({ where: { id: 'p-1' }, data: { stock: 76 } });
  });

  test('harga satuan dasar untuk satuan kemasan → 409 PRICE_CHANGED beserta code, priceChanges & unitId', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', paidAmount: 2000,
      items: [{ productId: 'p-1', unitId: 'u-dus', quantity: 2, price: 1000 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.priceChanges).toEqual([
      { productId: 'p-1', unitId: 'u-dus', productName: 'Paku', oldPrice: 1000, newPrice: 12000 },
    ]);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('priceChanges untuk satuan dasar membawa unitId null', async () => {
    setupCreate();
    const res = await post({ type: 'CASH', paidAmount: 900, items: [{ productId: 'p-1', quantity: 1, price: 900 }] });

    expect(res.status).toBe(409);
    expect(res.body.priceChanges[0]).toMatchObject({ productId: 'p-1', unitId: null, newPrice: 1000 });
  });

  test('satuan yang tidak terdaftar untuk produk → 400, bukan dianggap satuan dasar', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', paidAmount: 1000,
      items: [{ productId: 'p-1', unitId: 'u-asing', quantity: 1, price: 1000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Satuan tidak terdaftar untuk produk ini');
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('unitId = product.unitId tanpa baris ProductUnit → satuan dasar', async () => {
    setupCreate({ ...cmsProduct, unitId: 'u-own', productUnits: [] });
    const res = await post({
      type: 'CASH', paidAmount: 3000,
      items: [{ productId: 'p-1', unitId: 'u-own', quantity: 3, price: 1000 }],
    });

    expect(res.status).toBe(201);
    expect(createdItems()[0]).toMatchObject({ quantity: 3, baseQty: 3 });
  });

  test('stok dicek dalam satuan dasar (9 dus × 12 > 100)', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', paidAmount: 108000,
      items: [{ productId: 'p-1', unitId: 'u-dus', quantity: 9, price: 12000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tidak mencukupi/);
  });
});

describe('POST /api/transactions — angka berupa string', () => {
  test('quantity "2" & price "1000" dipaksa jadi number (bukan 500)', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', paidAmount: '2000',
      items: [{ productId: 'p-1', quantity: '2', price: '1000' }],
    });

    expect(res.status).toBe(201);
    const item = createdItems()[0];
    expect(item.quantity).toBe(2);
    expect(item.baseQty).toBe(2);
    expect(item.price).toBe(1000);
    expect(createdData()).toMatchObject({ subtotal: 2000, total: 2000 });
  });

  test('quantity desimal ditolak', async () => {
    const res = await post({ type: 'CASH', paidAmount: 2500, items: [{ productId: 'p-1', quantity: '2.5', price: 1000 }] });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/transactions — master data nonaktif', () => {
  test('produk nonaktif tidak bisa dijual', async () => {
    setupCreate({ ...cmsProduct, isActive: false });
    const res = await post({ type: 'CASH', paidAmount: 1000, items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tidak aktif/);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('unit lembaga nonaktif ditolak', async () => {
    setupCreate();
    mockPrisma.unitLembaga.findUnique.mockResolvedValue({ id: 'ul-1', name: 'MTs', isActive: false });
    const res = await post({
      type: 'BON', unitLembagaId: 'ul-1',
      items: [{ productId: 'p-1', quantity: 1, price: 1000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tidak aktif/);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('unit lembaga tidak dikenal → 400', async () => {
    setupCreate();
    mockPrisma.unitLembaga.findUnique.mockResolvedValue(null);
    const res = await post({ type: 'BON', unitLembagaId: 'ul-x', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(400);
  });

  test('unit lembaga aktif diterima', async () => {
    setupCreate();
    mockPrisma.unitLembaga.findUnique.mockResolvedValue({ id: 'ul-1', name: 'MTs', isActive: true });
    const res = await post({ type: 'BON', unitLembagaId: 'ul-1', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(201);
    expect(createdData().unitLembagaId).toBe('ul-1');
  });
});

describe('POST /api/transactions — diskon & paidAt', () => {
  test('diskon header melebihi subtotal ditolak (tidak lagi jadi penjualan Rp 0)', async () => {
    setupCreate();
    const res = await post({
      type: 'CASH', discount: 5000, paidAmount: 0,
      items: [{ productId: 'p-1', quantity: 2, price: 1000 }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Diskon tidak boleh melebihi subtotal/);
    expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
  });

  test('diskon sama dengan subtotal masih boleh', async () => {
    setupCreate();
    const res = await post({ type: 'CASH', discount: 2000, paidAmount: 0, items: [{ productId: 'p-1', quantity: 2, price: 1000 }] });
    expect(res.status).toBe(201);
    expect(createdData()).toMatchObject({ discount: 2000, total: 0 });
  });

  test('BON belum dibayar → paidAt null', async () => {
    setupCreate();
    const res = await post({ type: 'BON', items: [{ productId: 'p-1', quantity: 2, price: 1000 }] });

    expect(res.status).toBe(201);
    expect(createdData()).toMatchObject({ paidAmount: 0, paidAt: null });
  });

  test('BON dibayar sebagian → paidAt null; dibayar penuh → paidAt terisi', async () => {
    setupCreate();
    await post({ type: 'BON', paidAmount: 500, items: [{ productId: 'p-1', quantity: 2, price: 1000 }] });
    expect(createdData().paidAt).toBeNull();

    mockPrisma.transaction.create.mockClear();
    await post({ type: 'BON', paidAmount: 2000, items: [{ productId: 'p-1', quantity: 2, price: 1000 }] });
    expect(createdData().paidAt).toBeInstanceOf(Date);
  });

  test('CASH → paidAt terisi', async () => {
    setupCreate();
    await post({ type: 'CASH', paidAmount: 2000, items: [{ productId: 'p-1', quantity: 2, price: 1000 }] });
    expect(createdData().paidAt).toBeInstanceOf(Date);
  });
});

describe('POST /api/transactions — penomoran & error Prisma', () => {
  const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join('?') : String(call[0]));

  test('advisory lock nomor transaksi diambil sebelum membaca nomor terakhir', async () => {
    setupCreate();
    const res = await post({ type: 'CASH', paidAmount: 1000, items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });

    expect(res.status).toBe(201);
    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /pg_advisory_xact_lock/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx])
      .toBeLessThan(mockPrisma.transaction.findFirst.mock.invocationCallOrder[0]);
    expect(createdData().transactionNumber).toMatch(/^TRX-\d{8}-0001$/);
  });

  test('P2002 (nomor kembar) dipetakan errorHandler jadi 409, bukan 500', async () => {
    setupCreate();
    mockPrisma.transaction.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['transactionNumber'] },
    }));
    const res = await post({ type: 'CASH', paidAmount: 1000, items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(409);
  });

  test('P2003 (FK tidak valid) → 400', async () => {
    setupCreate();
    mockPrisma.transaction.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('FK failed', {
      code: 'P2003', clientVersion: 'test', meta: { field_name: 'transactions_projectId_fkey' },
    }));
    const res = await post({ type: 'CASH', paidAmount: 1000, items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/transactions — query params', () => {
  beforeEach(() => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);
  });

  test.each([
    '?status=NGAWUR', '?type=KREDIT', '?page=0', '?page=abc', '?page=-1', '?limit=0', '?limit=1.5',
    '?startDate=bukan-tanggal', '?status=COMPLETED&status=CANCELLED',
  ])('%s → 400', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(mockPrisma.transaction.findMany).not.toHaveBeenCalled();
  });

  test('limit di atas batas dipangkas ke 1000', async () => {
    const res = await get('?limit=999999');
    expect(res.status).toBe(200);
    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1000 }));
  });

  test('tanggal polos dihitung sebagai hari WIB', async () => {
    const res = await get('?startDate=2026-10-10&endDate=2026-10-10&status=COMPLETED&type=CASH&page=2&limit=5');

    expect(res.status).toBe(200);
    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 5,
      take: 5,
      where: expect.objectContaining({
        status: 'COMPLETED',
        type: 'CASH',
        createdAt: {
          gte: new Date('2026-10-09T17:00:00.000Z'),
          lte: new Date('2026-10-10T16:59:59.999Z'),
        },
      }),
    }));
  });

  test('string ISO lengkap dipakai apa adanya', async () => {
    await get(`?startDate=${encodeURIComponent('2026-10-10T01:00:00.000Z')}`);
    expect(mockPrisma.transaction.findMany.mock.calls[0][0].where.createdAt)
      .toEqual({ gte: new Date('2026-10-10T01:00:00.000Z') });
  });

  test('error Prisma yang tidak terduga diteruskan ke errorHandler', async () => {
    mockPrisma.transaction.findMany.mockRejectedValue(new Prisma.PrismaClientValidationError('bad', { clientVersion: 'test' }));
    const res = await get();
    expect(res.status).toBe(400);
  });
});
