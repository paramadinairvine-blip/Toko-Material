const request = require('supertest');
const { adminToken, mockPrisma, resetMocks, mockUserFindUnique } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => {
  resetMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.user.update.mockResolvedValue({ id: 'x' });
});

const admin2 = { id: 'admin-2', username: 'admin2', email: 'a2@material.dn2', fullName: 'Admin Dua', role: 'ADMIN', isActive: true, deletedAt: null };
const kasir = { id: 'kasir-9', username: 'k9', email: 'k9@material.dn2', fullName: 'Kasir', role: 'KASIR', isActive: true, deletedAt: null, password: 'hash' };

const putUser = (id, body, token = adminToken) => request(app)
  .put(`/api/users/${id}`)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

describe('PUT /api/users/:id — proteksi akun admin', () => {
  test('admin tidak dapat menonaktifkan akun sendiri', async () => {
    mockPrisma.user.count.mockResolvedValue(5);
    const res = await putUser('user-test-1', { isActive: false });
    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('admin tidak dapat menurunkan role akun sendiri', async () => {
    mockPrisma.user.count.mockResolvedValue(5);
    const res = await putUser('user-test-1', { role: 'KASIR' });
    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('tidak boleh menyisakan nol ADMIN aktif (demote admin terakhir)', async () => {
    mockUserFindUnique(admin2);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await putUser('admin-2', { role: 'VIEWER' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ADMIN aktif/);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('tidak boleh menonaktifkan ADMIN aktif terakhir', async () => {
    mockUserFindUnique(admin2);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await putUser('admin-2', { isActive: false });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('menonaktifkan user mencabut semua refresh token', async () => {
    mockUserFindUnique(kasir);

    const res = await putUser('kasir-9', { isActive: false });

    expect(res.status).toBe(200);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'kasir-9', revoked: false },
      data: { revoked: true },
    });
  });
});

describe('DELETE /api/users/:id', () => {
  test('tidak boleh menghapus ADMIN aktif terakhir', async () => {
    mockUserFindUnique(admin2);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/users/admin-2')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('menghapus user mencabut semua refresh token', async () => {
    mockUserFindUnique(kasir);

    const res = await request(app)
      .delete('/api/users/kasir-9')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'kasir-9', revoked: false },
    }));
  });
});

describe('PUT /api/users/:id/change-password', () => {
  test('ganti password mencabut semua refresh token user', async () => {
    mockUserFindUnique(kasir);

    const res = await request(app)
      .put('/api/users/kasir-9/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'rahasia123' });

    expect(res.status).toBe(200);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'kasir-9', revoked: false },
      data: { revoked: true },
    });
  });
});

describe('User yang sudah dihapus (soft delete)', () => {
  const deleted = { ...kasir, isActive: false, deletedAt: new Date('2026-10-01T00:00:00Z') };

  test.each([
    [{ isActive: true }],
    [{ fullName: 'Nama Baru' }],
    [{ role: 'ADMIN' }],
  ])('PUT %j → 404, tidak bisa dihidupkan/diubah', async (body) => {
    mockUserFindUnique(deleted);

    const res = await putUser('kasir-9', body);

    expect(res.status).toBe(404);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('ganti password → 404', async () => {
    mockUserFindUnique(deleted);

    const res = await request(app)
      .put('/api/users/kasir-9/change-password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'rahasia-baru' });

    expect(res.status).toBe(404);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  test('token milik user yang sudah dihapus ditolak middleware auth', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-test-1', role: 'ADMIN', isActive: true, deletedAt: new Date() });

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
  });

  test('login user yang sudah dihapus → 401 walau isActive terlanjur true', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...deleted, isActive: true, email: 'k9@material.dn2' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'k9@material.dn2', password: 'rahasia1' });

    expect(res.status).toBe(401);
    expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/users/:id — email duplikat', () => {
  test('email milik user lain → 409', async () => {
    mockUserFindUnique(kasir);
    mockPrisma.user.findFirst.mockResolvedValue({ email: 'a2@material.dn2', username: 'admin2' });

    const res = await putUser('kasir-9', { email: 'a2@material.dn2' });

    expect(res.status).toBe(409);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
