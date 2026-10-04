const request = require('supertest');
const { adminToken, mockPrisma, resetMocks } = require('./helpers/setup');

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

  test('usedQty tidak boleh diturunkan', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(withMaterial);

    const res = await put({ materials: [{ id: 'm-1', productId: 'p-1', estimatedQty: 10, usedQty: 1, unitPrice: 100 }] });

    expect(res.status).toBe(400);
    expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
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
