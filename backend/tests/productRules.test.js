const request = require('supertest');
const { adminToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);
jest.mock('../src/utils/generateBarcode', () => ({ generateBarcode: jest.fn().mockResolvedValue('8990000000017') }));

const app = require('../src/index');

const category = { id: 'cat-1', name: 'Semen' };
const pcs = { id: 'u-pcs', name: 'pcs', abbreviation: 'pcs', isActive: true };

beforeEach(() => {
  resetMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.category.findUnique.mockResolvedValue(category);
  mockPrisma.product.findFirst.mockResolvedValue(null);
  mockPrisma.product.create.mockImplementation(({ data }) => Promise.resolve({ id: 'prod-new', stock: 0, ...data }));
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.unitOfMeasure.findFirst.mockResolvedValue(pcs);
  mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(null);
  mockPrisma.unitOfMeasure.create.mockImplementation(({ data }) => Promise.resolve({ id: 'u-new', isActive: true, ...data }));
  mockPrisma.productUnit.create.mockResolvedValue({});
  mockPrisma.productUnit.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.productVariant.findMany.mockResolvedValue([]);
  mockPrisma.stockMovement.create.mockResolvedValue({});
});

const post = (body) => request(app).post('/api/products').set('Authorization', `Bearer ${adminToken}`).send(body);
const put = (body) => request(app).put('/api/products/prod-1').set('Authorization', `Bearer ${adminToken}`).send(body);

const existing = {
  id: 'prod-1', name: 'Semen', sku: 'SMN-1', barcode: '899', categoryId: 'cat-1', unit: 'pcs', unitId: 'u-pcs',
  buyPrice: 50000, sellPrice: 65000, stock: 10, isActive: true,
};

/** product.findUnique: panggilan pertama = produk lama, panggilan akhir = hasil */
const mockExisting = (product = existing) => mockPrisma.product.findUnique.mockResolvedValue(product);

describe('POST /api/products — whitelist field', () => {
  test('field tak dikenal & field milik server diabaikan (bukan 500)', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({
      name: 'Paku', categoryId: 'cat-1', unit: 'pcs', fieldAsing: 'x',
      createdAt: '2001-01-01T00:00:00Z', updatedAt: '2001-01-01T00:00:00Z',
      createdBy: 'orang-lain', updatedBy: 'orang-lain', isActive: false, id: 'paksa',
    });

    expect(res.status).toBe(201);
    const { data } = mockPrisma.product.create.mock.calls[0][0];
    expect(data.createdBy).toBe('user-test-1');
    ['fieldAsing', 'createdAt', 'updatedAt', 'updatedBy', 'isActive', 'id'].forEach((f) => {
      expect(data).not.toHaveProperty(f);
    });
  });

  test('kategori yang tidak ada → 404, tidak menulis apa pun', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await post({ name: 'Paku', categoryId: 'tidak-ada' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Kategori tidak ditemukan');
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  test('SKU yang sudah dipakai → 409', async () => {
    mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-lain' });

    const res = await post({ name: 'Paku', categoryId: 'cat-1', sku: 'SMN-1' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/SKU/);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/products — satuan dasar (unitId)', () => {
  test('nama satuan tanpa unitId → memakai master satuan yang sudah ada', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({ name: 'Paku', categoryId: 'cat-1', unit: 'PCS' });

    expect(res.status).toBe(201);
    expect(mockPrisma.product.create.mock.calls[0][0].data).toMatchObject({ unit: 'PCS', unitId: 'u-pcs' });
    expect(mockPrisma.unitOfMeasure.create).not.toHaveBeenCalled();
  });

  test('nama satuan yang belum ada → master satuan dibuat lalu dipakai', async () => {
    mockPrisma.unitOfMeasure.findFirst.mockResolvedValue(null);
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({ name: 'Besi', categoryId: 'cat-1', unit: 'Lonjor' });

    expect(res.status).toBe(201);
    expect(mockPrisma.unitOfMeasure.create).toHaveBeenCalledWith({ data: { name: 'Lonjor', abbreviation: 'lonjor' } });
    expect(mockPrisma.product.create.mock.calls[0][0].data.unitId).toBe('u-new');
  });

  test('tanpa nama satuan → default pcs tetap terhubung ke master satuan', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({ name: 'Paku', categoryId: 'cat-1' });

    expect(res.status).toBe(201);
    expect(mockPrisma.product.create.mock.calls[0][0].data).toMatchObject({ unit: 'pcs', unitId: 'u-pcs' });
  });
});

describe('POST /api/products — satuan konversi', () => {
  test('isBaseUnit dengan faktor ≠ 1 disimpan sebagai bukan satuan dasar', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({
      name: 'Paku', categoryId: 'cat-1', unit: 'pcs',
      units: [
        { unitId: 'u-dus', conversionFactor: 24, isBaseUnit: true },
        { unitId: 'u-pcs', conversionFactor: 1, isBaseUnit: true },
      ],
    });

    expect(res.status).toBe(201);
    const created = mockPrisma.productUnit.create.mock.calls.map((c) => c[0].data);
    expect(created).toEqual([
      { productId: 'prod-new', unitId: 'u-dus', conversionFactor: 24, isBaseUnit: false },
      { productId: 'prod-new', unitId: 'u-pcs', conversionFactor: 1, isBaseUnit: true },
    ]);
  });

  test.each([0, -2, 'abc', ''])('conversionFactor %j ditolak (422)', async (factor) => {
    const res = await post({ name: 'Paku', categoryId: 'cat-1', units: [{ unitId: 'u-dus', conversionFactor: factor }] });

    expect(res.status).toBe(422);
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/products — stok awal', () => {
  test('stok awal > 0 menulis pergerakan stok "Stok awal"', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({ name: 'Paku', categoryId: 'cat-1', unit: 'pcs', stock: 25 });

    expect(res.status).toBe(201);
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith({
      data: {
        productId: 'prod-new', type: 'IN', quantity: 25, previousStock: 0, newStock: 25,
        referenceType: 'MANUAL', referenceId: null, notes: 'Stok awal', createdBy: 'user-test-1',
      },
    });
  });

  test('stok awal 0 tidak menulis pergerakan stok', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'prod-new' });

    const res = await post({ name: 'Paku', categoryId: 'cat-1', unit: 'pcs', stock: 0 });

    expect(res.status).toBe(201);
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/products/:id', () => {
  test('conversionFactor 0 / negatif ditolak', async () => {
    mockExisting();

    for (const factor of [0, -5]) {
      const res = await put({ name: 'Semen', categoryId: 'cat-1', units: [{ unitId: 'u-dus', conversionFactor: factor }] });
      expect(res.status).toBe(422);
    }
    expect(mockPrisma.productUnit.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  test('mengganti nama satuan ikut memperbarui unitId', async () => {
    mockExisting();
    mockPrisma.unitOfMeasure.findFirst.mockResolvedValue({ id: 'u-sak', name: 'sak', abbreviation: 'sak', isActive: true });

    const res = await put({ name: 'Semen', categoryId: 'cat-1', unit: 'sak' });

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update.mock.calls[0][0].data).toMatchObject({ unit: 'sak', unitId: 'u-sak' });
  });

  test('satuan tidak berubah → unitId tidak disentuh', async () => {
    mockExisting();

    const res = await put({ name: 'Semen', categoryId: 'cat-1', unit: 'pcs', unitId: null });

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update.mock.calls[0][0].data).not.toHaveProperty('unitId');
    expect(mockPrisma.unitOfMeasure.findFirst).not.toHaveBeenCalled();
  });

  test('produk lama tanpa unitId → unitId diisi saat disimpan ulang', async () => {
    mockExisting({ ...existing, unitId: null });

    const res = await put({ name: 'Semen', categoryId: 'cat-1', unit: 'pcs' });

    expect(res.status).toBe(200);
    expect(mockPrisma.product.update.mock.calls[0][0].data.unitId).toBe('u-pcs');
  });

  test('varian yang masih punya stok tidak boleh dihapus', async () => {
    mockExisting();
    mockPrisma.productVariant.findMany.mockResolvedValue([
      { id: 'v-1', productId: 'prod-1', name: 'Merah', stock: 3 },
      { id: 'v-2', productId: 'prod-1', name: 'Biru', stock: 0 },
    ]);

    const res = await put({ name: 'Semen', categoryId: 'cat-1', variants: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Varian "Merah" masih memiliki stok 3/);
    expect(mockPrisma.productVariant.deleteMany).not.toHaveBeenCalled();
  });

  test('varian tanpa stok boleh dihapus', async () => {
    mockExisting();
    mockPrisma.productVariant.findMany.mockResolvedValue([{ id: 'v-2', productId: 'prod-1', name: 'Biru', stock: 0 }]);
    mockPrisma.productVariant.deleteMany.mockResolvedValue({ count: 1 });

    const res = await put({ name: 'Semen', categoryId: 'cat-1', variants: [] });

    expect(res.status).toBe(200);
    expect(mockPrisma.productVariant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['v-2'] } } });
  });
});
