const request = require('supertest');
const { adminToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => {
  resetMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
});

const send = (method, path, body) => request(app)[method](path)
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body);

describe('Brand — pengaman pemakaian & aktivasi ulang', () => {
  const brand = { id: 'b-1', name: 'Tiga Roda', isActive: true };

  test('DELETE ditolak bila masih dipakai produk aktif', async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(brand);
    mockPrisma.product.count.mockResolvedValue(4);

    const res = await send('delete', '/api/brands/b-1');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/4 produk aktif/);
    expect(mockPrisma.product.count).toHaveBeenCalledWith({ where: { brandId: 'b-1', isActive: true } });
    expect(mockPrisma.brand.update).not.toHaveBeenCalled();
  });

  test('DELETE boleh bila tidak ada produk aktif', async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(brand);
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.brand.update.mockResolvedValue({ ...brand, isActive: false });

    const res = await send('delete', '/api/brands/b-1');

    expect(res.status).toBe(200);
    expect(mockPrisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b-1' }, data: { isActive: false } });
  });

  test('PUT isActive:false mengikuti aturan yang sama', async () => {
    mockPrisma.brand.findUnique.mockResolvedValue(brand);
    mockPrisma.product.count.mockResolvedValue(1);

    const res = await send('put', '/api/brands/b-1', { name: 'Tiga Roda', isActive: false });

    expect(res.status).toBe(400);
    expect(mockPrisma.brand.update).not.toHaveBeenCalled();
  });

  test('POST nama milik brand nonaktif → diaktifkan kembali', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue({ ...brand, isActive: false });
    mockPrisma.brand.update.mockResolvedValue({ ...brand, isActive: true });

    const res = await send('post', '/api/brands', { name: 'Tiga Roda' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 'b-1', isActive: true });
    expect(mockPrisma.brand.update).toHaveBeenCalledWith({ where: { id: 'b-1' }, data: { name: 'Tiga Roda', isActive: true } });
    expect(mockPrisma.brand.create).not.toHaveBeenCalled();
  });

  test('POST nama milik brand aktif → 409', async () => {
    mockPrisma.brand.findFirst.mockResolvedValue(brand);

    const res = await send('post', '/api/brands', { name: 'tiga roda' });

    expect(res.status).toBe(409);
    expect(mockPrisma.brand.create).not.toHaveBeenCalled();
    expect(mockPrisma.brand.update).not.toHaveBeenCalled();
  });
});

describe('Satuan — pengaman pemakaian & aktivasi ulang', () => {
  const unit = { id: 'u-1', name: 'Kilogram', abbreviation: 'kg', isActive: true };

  test('DELETE ditolak bila dipakai produk aktif', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(unit);
    mockPrisma.product.count.mockResolvedValue(2);
    mockPrisma.productUnit.count.mockResolvedValue(0);

    const res = await send('delete', '/api/units/measures/u-1');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 produk aktif/);
    expect(mockPrisma.unitOfMeasure.update).not.toHaveBeenCalled();
  });

  test('DELETE ditolak bila dipakai konversi satuan produk aktif', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(unit);
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.productUnit.count.mockResolvedValue(3);

    const res = await send('delete', '/api/units/measures/u-1');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3 konversi satuan/);
    expect(mockPrisma.productUnit.count).toHaveBeenCalledWith({ where: { unitId: 'u-1', product: { isActive: true } } });
  });

  test('DELETE boleh bila tidak dipakai', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(unit);
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.productUnit.count.mockResolvedValue(0);
    mockPrisma.unitOfMeasure.update.mockResolvedValue({});

    const res = await send('delete', '/api/units/measures/u-1');

    expect(res.status).toBe(200);
  });

  test('PUT isActive:false mengikuti aturan yang sama', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(unit);
    mockPrisma.product.count.mockResolvedValue(1);
    mockPrisma.productUnit.count.mockResolvedValue(0);

    const res = await send('put', '/api/units/measures/u-1', { isActive: false });

    expect(res.status).toBe(400);
    expect(mockPrisma.unitOfMeasure.update).not.toHaveBeenCalled();
  });

  test('POST singkatan milik satuan nonaktif → diaktifkan kembali', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue({ ...unit, isActive: false });
    mockPrisma.unitOfMeasure.update.mockResolvedValue(unit);

    const res = await send('post', '/api/units/measures', { name: 'Kilogram', abbreviation: 'kg' });

    expect(res.status).toBe(201);
    expect(mockPrisma.unitOfMeasure.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { name: 'Kilogram', isActive: true } });
    expect(mockPrisma.unitOfMeasure.create).not.toHaveBeenCalled();
  });

  test('POST singkatan milik satuan aktif → 409', async () => {
    mockPrisma.unitOfMeasure.findUnique.mockResolvedValue(unit);

    const res = await send('post', '/api/units/measures', { name: 'Kilo', abbreviation: 'kg' });

    expect(res.status).toBe(409);
    expect(mockPrisma.unitOfMeasure.create).not.toHaveBeenCalled();
  });
});

describe('Supplier — validasi update', () => {
  test.each([
    [{ name: '' }],
    [{ name: '   ' }],
    [{ phone: 'bukan telepon' }],
    [{ phone: '12' }],
    [{ email: 'bukan-email' }],
  ])('PUT menolak %j', async (body) => {
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1', name: 'PT Lama', phone: '0812345678' });

    const res = await send('put', '/api/suppliers/s-1', body);

    expect(res.status).toBe(422);
    expect(mockPrisma.supplier.update).not.toHaveBeenCalled();
  });

  test('PUT dengan data valid tetap berhasil', async () => {
    mockPrisma.supplier.findUnique.mockResolvedValue({ id: 's-1', name: 'PT Lama', phone: '0812345678' });
    mockPrisma.supplier.update.mockResolvedValue({ id: 's-1' });

    const res = await send('put', '/api/suppliers/s-1', { name: ' PT Baru ', phone: '+62 812-3456-7890' });

    expect(res.status).toBe(200);
    expect(mockPrisma.supplier.update.mock.calls[0][0].data).toMatchObject({ name: 'PT Baru', phone: '+62 812-3456-7890' });
  });

  test('POST menolak nomor telepon yang bukan nomor', async () => {
    const res = await send('post', '/api/suppliers', { name: 'PT Baru', phone: 'hubungi saya' });

    expect(res.status).toBe(422);
    expect(mockPrisma.supplier.create).not.toHaveBeenCalled();
  });
});
