const request = require('supertest');
const { adminToken, kasirToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => {
  resetMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
});

const project = (overrides = {}) => ({
  id: 'proj-1', name: 'Gedung', status: 'IN_PROGRESS', budget: 1000, spent: 0,
  materials: [], ...overrides,
});

const put = (body) => request(app)
  .put('/api/projects/proj-1')
  .set('Authorization', `Bearer ${adminToken}`)
  .send(body);

describe('PUT /api/projects/:id — status terkunci', () => {
  test('proyek CANCELLED tidak dapat diubah', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project({ status: 'CANCELLED' }));

    const res = await put({ name: 'Baru' });

    expect(res.status).toBe(400);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  test('proyek COMPLETED tidak dapat diedit selain dibuka kembali', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project({ status: 'COMPLETED' }));

    const res = await put({ name: 'Baru', status: 'COMPLETED' });

    expect(res.status).toBe(400);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  test('proyek COMPLETED boleh dibuka kembali ke IN_PROGRESS (hanya status)', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project({ status: 'COMPLETED' }));
    mockPrisma.project.update.mockResolvedValue(project());

    const res = await put({ name: 'Baru', status: 'IN_PROGRESS', budget: 5 });

    expect(res.status).toBe(200);
    expect(mockPrisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'IN_PROGRESS', updatedBy: 'user-test-1' },
    }));
  });
});

describe('PUT /api/projects/:id — validasi', () => {
  test.each([
    [{ budget: -1 }],
    [{ budget: 'abc' }],
    [{ status: 'SELESAI' }],
    [{ startDate: 'bukan-tanggal' }],
    [{ startDate: '2026-10-10', endDate: '2026-10-01' }],
    [{ materials: [{ productId: 'p-1', estimatedQty: -2 }] }],
  ])('menolak payload %j', async (body) => {
    mockPrisma.project.findUnique.mockResolvedValue(project());
    const res = await put(body);
    expect(res.status).toBe(422);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/projects/:id — sinkronisasi material', () => {
  const withMaterial = project({
    materials: [{ id: 'm-1', projectId: 'proj-1', productId: 'p-1', estimatedQty: 10, usedQty: 4, unitPrice: 100 }],
  });

  const lowered = { materials: [{ id: 'm-1', productId: 'p-1', estimatedQty: 10, usedQty: 1, unitPrice: 100 }] };

  test('KASIR tidak boleh menurunkan usedQty', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(withMaterial);

    const res = await request(app)
      .put('/api/projects/proj-1')
      .set('Authorization', `Bearer ${kasirToken}`)
      .send(lowered);

    expect(res.status).toBe(403);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
  });

  test('ADMIN boleh menurunkan usedQty (koreksi salah ketik)', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(withMaterial);
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', sellPrice: 500 }]);
    mockPrisma.project.update.mockResolvedValue(withMaterial);

    const res = await put(lowered);

    expect(res.status).toBe(200);
    expect(mockPrisma.projectMaterial.update).toHaveBeenCalledWith({
      where: { id: 'm-1' },
      data: expect.objectContaining({ usedQty: 1, unitPrice: 100 }),
    });
  });

  test('unitPrice 0 yang dikirim eksplisit tetap 0 (tidak diganti harga jual)', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(withMaterial);
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-1', sellPrice: 500 }, { id: 'p-2', sellPrice: 700 }]);
    mockPrisma.project.update.mockResolvedValue(withMaterial);

    const res = await put({
      materials: [
        { id: 'm-1', productId: 'p-1', estimatedQty: 10, usedQty: 4, unitPrice: 0 },
        { productId: 'p-2', estimatedQty: 3, unitPrice: 0 },
      ],
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.projectMaterial.update.mock.calls[0][0].data.unitPrice).toBe(0);
    expect(mockPrisma.projectMaterial.create.mock.calls[0][0].data.unitPrice).toBe(0);
  });

  test('material baru tanpa unitPrice memakai harga jual produk', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project());
    mockPrisma.product.findMany.mockResolvedValue([{ id: 'p-2', sellPrice: 700 }]);
    mockPrisma.project.update.mockResolvedValue(project());

    const res = await put({ materials: [{ productId: 'p-2', estimatedQty: 3 }] });

    expect(res.status).toBe(200);
    expect(mockPrisma.projectMaterial.create.mock.calls[0][0].data.unitPrice).toBe(700);
  });

  test('produk material yang tidak ada → 404, tidak ada yang ditulis', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project());
    mockPrisma.product.findMany.mockResolvedValue([]);
    mockPrisma.project.update.mockResolvedValue(project());

    const res = await put({ materials: [{ productId: 'tidak-ada', estimatedQty: 3 }] });

    expect(res.status).toBe(404);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test('material yang sudah terpakai tidak boleh dihapus', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(withMaterial);

    const res = await put({ materials: [{ productId: 'p-2', estimatedQty: 5, unitPrice: 100 }] });

    expect(res.status).toBe(400);
    expect(mockPrisma.projectMaterial.deleteMany).not.toHaveBeenCalled();
  });
});

describe('Material proyek pada proyek terkunci', () => {
  test('tambah material ditolak untuk proyek COMPLETED', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project({ status: 'COMPLETED' }));

    const res = await request(app)
      .post('/api/projects/proj-1/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'p-1', estimatedQty: 1 });

    expect(res.status).toBe(400);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test('update penggunaan material ditolak untuk proyek CANCELLED', async () => {
    mockPrisma.projectMaterial.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'proj-1', usedQty: 1 });
    mockPrisma.project.findUnique.mockResolvedValue(project({ status: 'CANCELLED' }));

    const res = await request(app)
      .put('/api/projects/proj-1/materials/m-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ usedQty: 3 });

    expect(res.status).toBe(400);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
  });
});

describe('Proyek — validasi tanggal & material', () => {
  const post = (body) => request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  test('POST: tanggal selesai sebelum tanggal mulai → 422', async () => {
    const res = await post({ name: 'Gedung', startDate: '2026-10-10', endDate: '2026-10-01' });

    expect(res.status).toBe(422);
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  test('POST: startDate bukan tanggal → 422', async () => {
    const res = await post({ name: 'Gedung', startDate: 'besok' });

    expect(res.status).toBe(422);
  });

  test('PUT: hanya endDate dikirim, dibandingkan dengan startDate tersimpan → 400', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project({ startDate: new Date('2026-10-10T00:00:00Z'), endDate: null }));

    const res = await put({ endDate: '2026-10-01' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Tanggal selesai/);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  test('tambah material: estimatedQty negatif → 422', async () => {
    const res = await request(app)
      .post('/api/projects/proj-1/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'p-1', estimatedQty: -5 });

    expect(res.status).toBe(422);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test('tambah material: produk tidak ada → 404', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project());
    mockPrisma.product.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/projects/proj-1/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'tidak-ada', estimatedQty: 1 });

    expect(res.status).toBe(404);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test('tambah material: produk sudah ada di proyek → 409', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(project());
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', sellPrice: 500 });
    mockPrisma.projectMaterial.findFirst.mockResolvedValue({ id: 'm-1' });

    const res = await request(app)
      .post('/api/projects/proj-1/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'p-1', estimatedQty: 1 });

    expect(res.status).toBe(409);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });
});

describe('Proyek yang sudah dihapus (soft delete)', () => {
  const deleted = project({ isActive: false });

  test('PUT → 404', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(deleted);

    const res = await put({ name: 'Baru' });

    expect(res.status).toBe(404);
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  test('tambah material → 404', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(deleted);

    const res = await request(app)
      .post('/api/projects/proj-1/materials')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId: 'p-1', estimatedQty: 1 });

    expect(res.status).toBe(404);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test('update penggunaan material → 404', async () => {
    mockPrisma.projectMaterial.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'proj-1', usedQty: 1 });
    mockPrisma.project.findUnique.mockResolvedValue(deleted);

    const res = await request(app)
      .put('/api/projects/proj-1/materials/m-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ usedQty: 3 });

    expect(res.status).toBe(404);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
  });
});

describe('PUT /api/projects/:id/materials/:materialId — koreksi penggunaan', () => {
  const usage = (token, usedQty) => request(app)
    .put('/api/projects/proj-1/materials/m-1')
    .set('Authorization', `Bearer ${token}`)
    .send({ usedQty });

  beforeEach(() => {
    mockPrisma.projectMaterial.findUnique.mockResolvedValue({ id: 'm-1', projectId: 'proj-1', usedQty: 999 });
    mockPrisma.project.findUnique.mockResolvedValue(project());
    mockPrisma.projectMaterial.update.mockImplementation(({ data }) => Promise.resolve({ id: 'm-1', ...data }));
  });

  test('KASIR tidak boleh menurunkan usedQty', async () => {
    const res = await usage(kasirToken, 9);

    expect(res.status).toBe(403);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
  });

  test('KASIR tetap boleh menaikkan usedQty', async () => {
    const res = await usage(kasirToken, 1000);

    expect(res.status).toBe(200);
  });

  test('ADMIN boleh menurunkan usedQty; stok & spent proyek tidak disentuh, perubahan diaudit', async () => {
    const res = await usage(adminToken, 9);

    expect(res.status).toBe(200);
    expect(mockPrisma.projectMaterial.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'm-1' }, data: { usedQty: 9 },
    }));
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'UPDATE', entity: 'project_materials', oldData: { usedQty: 999 }, newData: { usedQty: 9 },
    });
  });

  test('angka yang tidak masuk akal ditolak', async () => {
    const res = await usage(adminToken, 99999999);

    expect(res.status).toBe(400);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
  });
});
