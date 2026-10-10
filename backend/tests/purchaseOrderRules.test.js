const request = require('supertest');
const { adminToken, kasirToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');
const poService = require('../src/services/purchaseOrder.service');

beforeEach(() => resetMocks());

const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join('?') : String(call[0]));

// Produk buatan CMS: product.unitId null
const cmsProduct = { id: 'p-1', name: 'Paku', unitId: null, isActive: true };

const setupCreate = ({ supplier = { id: 's-1', name: 'PT Maju', isActive: true }, products = [cmsProduct], productUnit = null } = {}) => {
  mockPrisma.supplier.findUnique.mockResolvedValue(supplier);
  mockPrisma.product.findMany.mockResolvedValue(products);
  mockPrisma.productUnit.findUnique.mockResolvedValue(productUnit);
  mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
  mockPrisma.purchaseOrder.create.mockResolvedValue({ id: 'po-new' });
  mockPrisma.purchaseOrderItem.create.mockResolvedValue({});
  mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-new', poNumber: 'PO-1', items: [] });
  mockPrisma.auditLog.create.mockResolvedValue({});
};

const post = (body) => request(app)
  .post('/api/purchase-orders')
  .set('Authorization', `Bearer ${kasirToken}`)
  .send(body);

const itemData = () => mockPrisma.purchaseOrderItem.create.mock.calls[0][0].data;

describe('POST /api/purchase-orders', () => {
  test('quantity "2" & price "1500" (string) → tersimpan sebagai number, bukan 500', async () => {
    setupCreate();
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-1', quantity: '2', price: '1500' }] });

    expect(res.status).toBe(201);
    expect(itemData()).toMatchObject({ quantity: 2, baseQty: 2, price: 1500, subtotal: 3000 });
    expect(mockPrisma.purchaseOrder.create.mock.calls[0][0].data.totalAmount).toBe(3000);
  });

  test('Dus ×12 pada produk dengan product.unitId null → baseQty dikali 12', async () => {
    setupCreate({ productUnit: { unitId: 'u-dus', conversionFactor: 12, isBaseUnit: true } });
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-1', unitId: 'u-dus', quantity: 2, price: 24000 }] });

    expect(res.status).toBe(201);
    expect(itemData()).toMatchObject({ unitId: 'u-dus', quantity: 2, baseQty: 24, subtotal: 48000 });
  });

  test('satuan tidak terdaftar untuk produk → 400', async () => {
    setupCreate({ productUnit: null });
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-1', unitId: 'u-asing', quantity: 2, price: 1000 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Satuan tidak terdaftar untuk produk ini');
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  test('supplier nonaktif ditolak', async () => {
    setupCreate({ supplier: { id: 's-1', name: 'PT Tutup', isActive: false } });
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Supplier PT Tutup sudah tidak aktif/);
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  test('supplier tidak dikenal → 400 (bukan error FK 500)', async () => {
    setupCreate({ supplier: null });
    const res = await post({ supplierId: 's-x', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(400);
  });

  test('produk nonaktif ditolak', async () => {
    setupCreate({ products: [{ ...cmsProduct, isActive: false }] });
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Paku sudah tidak aktif/);
    expect(mockPrisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  test('produk tidak dikenal → 400', async () => {
    setupCreate({ products: [] });
    const res = await post({ supplierId: 's-1', items: [{ productId: 'p-x', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(400);
  });

  test('nomor PO dikunci dengan advisory lock sebelum dibaca', async () => {
    setupCreate();
    await post({ supplierId: 's-1', items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });

    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /pg_advisory_xact_lock/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx])
      .toBeLessThan(mockPrisma.purchaseOrder.findFirst.mock.invocationCallOrder[0]);
    expect(mockPrisma.purchaseOrder.create.mock.calls[0][0].data.poNumber).toMatch(/^PO-\d{8}-0001$/);
  });
});

describe('PUT /api/purchase-orders/:id', () => {
  const put = (body) => request(app)
    .put('/api/purchase-orders/po-1')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  beforeEach(() => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status: 'DRAFT', supplierId: 's-1', items: [] });
    mockPrisma.purchaseOrderItem.deleteMany.mockResolvedValue({});
    mockPrisma.purchaseOrderItem.create.mockResolvedValue({});
    mockPrisma.purchaseOrder.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  test('konversi satuan dipakai saat item diganti', async () => {
    mockPrisma.product.findMany.mockResolvedValue([cmsProduct]);
    mockPrisma.productUnit.findUnique.mockResolvedValue({ unitId: 'u-dus', conversionFactor: 12 });

    const res = await put({ items: [{ productId: 'p-1', unitId: 'u-dus', quantity: '3', price: '12000' }] });

    expect(res.status).toBe(200);
    expect(itemData()).toMatchObject({ quantity: 3, baseQty: 36, price: 12000, subtotal: 36000 });
  });

  test('produk nonaktif / satuan asing ditolak tanpa menghapus item lama', async () => {
    mockPrisma.product.findMany.mockResolvedValue([{ ...cmsProduct, isActive: false }]);
    const res = await put({ items: [{ productId: 'p-1', quantity: 1, price: 1000 }] });
    expect(res.status).toBe(400);

    mockPrisma.product.findMany.mockResolvedValue([cmsProduct]);
    mockPrisma.productUnit.findUnique.mockResolvedValue(null);
    const res2 = await put({ items: [{ productId: 'p-1', unitId: 'u-asing', quantity: 1, price: 1000 }] });
    expect(res2.status).toBe(400);

    expect(mockPrisma.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
  });

  test('ganti ke supplier nonaktif ditolak', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-2', name: 'PT Tutup', isActive: false });
    const res = await put({ supplierId: 's-2' });
    expect(res.status).toBe(400);
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/purchase-orders', () => {
  const get = (qs = '') => request(app)
    .get(`/api/purchase-orders${qs}`)
    .set('Authorization', `Bearer ${adminToken}`);

  beforeEach(() => {
    mockPrisma.purchaseOrder.findMany.mockResolvedValue([]);
    mockPrisma.purchaseOrder.count.mockResolvedValue(0);
  });

  test('?search mencari poNumber dan nama supplier (case-insensitive)', async () => {
    const res = await get('?search=maju');

    expect(res.status).toBe(200);
    const { where } = mockPrisma.purchaseOrder.findMany.mock.calls[0][0];
    expect(where.OR).toEqual([
      { poNumber: { contains: 'maju', mode: 'insensitive' } },
      { supplier: { name: { contains: 'maju', mode: 'insensitive' } } },
    ]);
    expect(mockPrisma.purchaseOrder.count).toHaveBeenCalledWith({ where });
  });

  test('search kosong diabaikan', async () => {
    await get('?search=');
    expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  test('daftar & detail menyertakan email supplier', async () => {
    await get();
    expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].include.supplier.select.email).toBe(true);

    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1' });
    await get('/po-1');
    expect(mockPrisma.purchaseOrder.findUnique.mock.calls[0][0].include.supplier.select.email).toBe(true);
  });

  test.each(['?status=NGAWUR', '?page=0', '?limit=abc', '?startDate=xx'])('%s → 400', async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(mockPrisma.purchaseOrder.findMany).not.toHaveBeenCalled();
  });

  test('tanggal polos dihitung sebagai hari WIB', async () => {
    await get('?startDate=2026-10-10&endDate=2026-10-10&status=SENT');
    expect(mockPrisma.purchaseOrder.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'SENT',
      createdAt: { gte: new Date('2026-10-09T17:00:00.000Z'), lte: new Date('2026-10-10T16:59:59.999Z') },
    });
  });
});

describe('PO receive — validasi & konversi', () => {
  const setupPO = ({ items, status = 'SENT', product = {} } = {}) => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
      id: 'po-1', poNumber: 'PO-20261010-0001', status, receivedAt: null,
      items: items || [
        { id: 'poi-1', productId: 'p-1', unitId: null, quantity: 10, baseQty: 10, receivedQty: 0, receivedBaseQty: 0, price: 900 },
        { id: 'poi-2', productId: 'p-1', unitId: null, quantity: 5, baseQty: 5, receivedQty: 5, receivedBaseQty: 5, price: 900 },
      ],
    });
    mockPrisma.product.findUnique.mockResolvedValue({
      id: 'p-1', name: 'Paku', unitId: null, stock: 10, buyPrice: 900, sellPrice: 1500, ...product,
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue(null);
    mockPrisma.purchaseOrderItem.update.mockResolvedValue({});
    mockPrisma.stockMovement.create.mockResolvedValue({});
    mockPrisma.priceHistory.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});
    mockPrisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', status: 'PARTIALLY_RECEIVED' });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.user.findMany.mockResolvedValue([]);
  };

  const expectNoStateChange = () => {
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    expect(mockPrisma.purchaseOrderItem.update).not.toHaveBeenCalled();
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  };

  test.each([
    ['body kosong', undefined],
    ['bukan array', { itemId: 'poi-1', receivedQty: 1 }],
    ['array kosong', []],
    ['itemId hilang', [{ receivedQty: 1 }]],
    ['qty desimal', [{ itemId: 'poi-1', receivedQty: 1.5 }]],
    ['qty string desimal', [{ itemId: 'poi-1', receivedQty: '1.5' }]],
    ['qty negatif', [{ itemId: 'poi-1', receivedQty: -2 }]],
    ['qty bukan angka', [{ itemId: 'poi-1', receivedQty: 'dua' }]],
    ['qty string kosong', [{ itemId: 'poi-1', receivedQty: '' }]],
    ['qty null', [{ itemId: 'poi-1', receivedQty: null }]],
  ])('%s → 400 sebelum menyentuh DB', async (_label, receivedItems) => {
    setupPO();
    await expect(poService.receive('po-1', receivedItems, 'user-1')).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expectNoStateChange();
  });

  test('itemId yang bukan milik PO → 400 tanpa perubahan status', async () => {
    setupPO();
    await expect(poService.receive('po-1', [{ itemId: 'poi-lain', receivedQty: 1 }], 'user-1'))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/bukan bagian/) });
    expectNoStateChange();
  });

  test('semua qty 0 → 400 tanpa perubahan status', async () => {
    setupPO();
    await expect(poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 0 }, { itemId: 'poi-2', receivedQty: 0 }], 'user-1'))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Tidak ada barang yang diterima/) });
    expectNoStateChange();
  });

  test('qty > 0 hanya untuk item yang sudah lengkap → 400', async () => {
    setupPO();
    await expect(poService.receive('po-1', [{ itemId: 'poi-2', receivedQty: 3 }], 'user-1'))
      .rejects.toMatchObject({ status: 400 });
    expectNoStateChange();
  });

  test('qty string "2" lalu "3" dijumlah jadi 5, bukan "23"', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: null, quantity: 10, baseQty: 10, receivedQty: 2, receivedBaseQty: 2, price: 900 }],
      status: 'PARTIALLY_RECEIVED',
    });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: '3' }], 'user-1');

    expect(mockPrisma.purchaseOrderItem.update).toHaveBeenCalledWith({
      where: { id: 'poi-1' },
      data: { receivedQty: 5, receivedBaseQty: 5 },
    });
    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stock: { increment: 3 } }),
    }));
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PARTIALLY_RECEIVED' }),
    }));
  });

  test('qty 0 untuk satu item boleh selama ada item lain yang diterima', async () => {
    setupPO();
    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 10 }, { itemId: 'poi-2', receivedQty: 0 }], 'user-1');

    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'RECEIVED' }),
    }));
  });

  test('Dus ×12 pada produk dengan product.unitId null: stok +24 dan buyPrice per satuan dasar', async () => {
    // Item PO lama tersimpan 1:1 (baseQty = quantity) akibat bug; faktor
    // diambil dari ProductUnit terkini saat penerimaan.
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: 'u-dus', quantity: 2, baseQty: 2, receivedQty: 0, receivedBaseQty: 0, price: 24000 }],
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue({ unitId: 'u-dus', conversionFactor: 12, isBaseUnit: true });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 2 }], 'user-1');

    expect(mockPrisma.purchaseOrderItem.update).toHaveBeenCalledWith({
      where: { id: 'poi-1' },
      data: { receivedQty: 2, receivedBaseQty: 24 },
    });
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ quantity: 24, previousStock: 10, newStock: 34 }),
    }));
    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { stock: { increment: 24 }, buyPrice: 2000 },
    });
  });

  test('satuan PO sudah dihapus dari produk → pakai rasio baseQty/quantity yang tersimpan', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: 'u-dus', quantity: 2, baseQty: 24, receivedQty: 0, receivedBaseQty: 0, price: 24000 }],
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue(null);

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 1 }], 'user-1');

    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stock: { increment: 12 } }),
    }));
  });

  test('PUT /:id/receive dengan body kosong → 400 lewat errorHandler', async () => {
    setupPO();
    const res = await request(app)
      .put('/api/purchase-orders/po-1/receive')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expectNoStateChange();
  });
});

describe('PO cancel — bebas race dengan receive', () => {
  const setupCancel = (status) => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-1', status });
    mockPrisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', status: 'CANCELLED' });
    mockPrisma.auditLog.create.mockResolvedValue({});
  };

  test('mengunci baris PO (FOR UPDATE) di dalam transaksi sebelum membaca status', async () => {
    setupCancel('SENT');

    await poService.cancel('po-1', 'user-1');

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /purchase_orders[\s\S]*FOR UPDATE/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx];
    expect(mockPrisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(lockOrder);
    expect(lockOrder).toBeLessThan(mockPrisma.purchaseOrder.findUnique.mock.invocationCallOrder[0]);
    expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'CANCELLED', updatedBy: 'user-1' },
    }));
  });

  test('PARTIALLY_RECEIVED boleh dibatalkan dan stok yang sudah masuk tidak disentuh', async () => {
    setupCancel('PARTIALLY_RECEIVED');

    const po = await poService.cancel('po-1', 'user-1');

    expect(po.status).toBe('CANCELLED');
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ oldData: { status: 'PARTIALLY_RECEIVED' } }),
    }));
  });

  test.each(['RECEIVED', 'CANCELLED'])('status %s (mis. receive menang lebih dulu) → 400 tanpa update', async (status) => {
    setupCancel(status);
    await expect(poService.cancel('po-1', 'user-1')).rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  test('PO tidak ditemukan → 404', async () => {
    mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);
    await expect(poService.cancel('po-x', 'user-1')).rejects.toMatchObject({ status: 404 });
  });
});
