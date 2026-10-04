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
