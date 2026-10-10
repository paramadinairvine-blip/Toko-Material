const request = require('supertest');
const { adminToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const rollback = (id) => request(app)
  .post(`/api/audit-logs/${id}/rollback`)
  .set('Authorization', `Bearer ${adminToken}`);

describe('POST /api/audit-logs/:id/rollback', () => {
  test.each([
    'transactions', 'transaction_returns', 'purchase_orders',
    'stock_movements', 'stock_opnames', 'projects',
  ])('menolak rollback untuk tabel %s', async (entity) => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity, entityId: 'rec-1',
      oldData: { status: 'PENDING', notes: 'lama' },
    });

    const res = await rollback('log-1');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Rollback tidak diizinkan/);
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  test('produk: stock, status, id, timestamp, dan relasi tidak dipulihkan', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'products', entityId: 'p-1',
      oldData: {
        id: 'p-1', name: 'Semen Lama', sellPrice: '65000', stock: 999, isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        createdBy: 'u-9', category: { id: 'c-1', name: 'Semen' }, productUnits: [{ id: 'pu-1' }],
      },
    });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Semen Baru', stock: 10 });
    mockPrisma.product.update.mockResolvedValue({ id: 'p-1', name: 'Semen Lama' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await rollback('log-1');

    expect(res.status).toBe(200);
    const { data } = mockPrisma.product.update.mock.calls[0][0];
    expect(data).toEqual({ name: 'Semen Lama', sellPrice: '65000', isActive: true });
  });

  test('users: role dan isActive tidak dipulihkan', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'users', entityId: 'u-5',
      oldData: { username: 'budi', fullName: 'Budi', role: 'ADMIN', isActive: true, password: 'hash' },
    });
    mockPrisma.user.update.mockResolvedValue({ id: 'u-5' });
    mockPrisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 'user-test-1'
        ? { id: 'user-test-1', role: 'ADMIN', isActive: true }
        : { id: 'u-5', username: 'budi2', role: 'KASIR' }
    ));
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await rollback('log-1');

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({ username: 'budi', fullName: 'Budi' });
  });

  test('400 bila tidak ada data yang bisa dipulihkan', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'products', entityId: 'p-1',
      oldData: { stock: 5, status: 'X', id: 'p-1' },
    });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1' });

    const res = await rollback('log-1');

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit-logs — canRollback', () => {
  test('menandai log yang bisa di-rollback', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      { id: 'l1', action: 'UPDATE', entity: 'products', entityId: 'p-1', oldData: { name: 'A' }, newData: { name: 'B' } },
      { id: 'l2', action: 'UPDATE', entity: 'transactions', entityId: 't-1', oldData: { status: 'PENDING' }, newData: {} },
      { id: 'l3', action: 'CREATE', entity: 'products', entityId: 'p-2', oldData: null, newData: { name: 'C' } },
      { id: 'l4', action: 'UPDATE', entity: 'products', entityId: 'p-3', oldData: { stock: 3 }, newData: { stock: 4 } },
    ]);
    mockPrisma.auditLog.count.mockResolvedValue(4);

    const res = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((l) => l.canRollback)).toEqual([true, false, false, false]);
  });
});

describe('Audit log — hash password tidak pernah disimpan / dikembalikan', () => {
  const auditLogService = require('../src/services/auditLog.service');

  test('createLog membuang password dari oldData/newData (termasuk yang bersarang)', async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});

    await auditLogService.createLog({
      userId: 'u-1', action: 'UPDATE', tableName: 'users', recordId: 'u-5',
      oldData: { id: 'u-5', fullName: 'Budi', password: '$2a$12$hashlama' },
      newData: { id: 'u-5', fullName: 'Budi B', password: '$2a$12$hashbaru', creator: { id: 'u-1', password: 'x' } },
    });

    const { data } = mockPrisma.auditLog.create.mock.calls[0][0];
    expect(data.oldData).toEqual({ id: 'u-5', fullName: 'Budi' });
    expect(data.newData).toEqual({ id: 'u-5', fullName: 'Budi B', creator: { id: 'u-1' } });
  });

  test('rollback users: respons & baris ROLLBACK tanpa password', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'users', entityId: 'u-5',
      oldData: { username: 'budi', fullName: 'Budi' }, newData: { fullName: 'Budi Baru' },
    });
    mockPrisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 'user-test-1'
        ? { id: 'user-test-1', role: 'ADMIN', isActive: true }
        : { id: 'u-5', username: 'budi', fullName: 'Budi Baru', password: '$2a$12$hash', deletedAt: null }
    ));
    mockPrisma.user.update.mockResolvedValue({ id: 'u-5', username: 'budi', fullName: 'Budi', password: '$2a$12$hash' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await rollback('log-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'u-5', username: 'budi', fullName: 'Budi' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2a\$/);
    expect(JSON.stringify(mockPrisma.auditLog.create.mock.calls[0][0])).not.toMatch(/password|\$2a\$/);
  });

  test('GET detail & daftar menyaring password dari baris lama', async () => {
    const legacy = {
      id: 'log-9', action: 'ROLLBACK', entity: 'users', entityId: 'u-5',
      oldData: { fullName: 'A', password: '$2a$12$hash' }, newData: { fullName: 'B', password: '$2a$12$hash' },
    };
    mockPrisma.auditLog.findUnique.mockResolvedValue(legacy);
    mockPrisma.auditLog.findMany.mockResolvedValue([legacy]);
    mockPrisma.auditLog.count.mockResolvedValue(1);

    const detail = await request(app).get('/api/audit-logs/log-9').set('Authorization', `Bearer ${adminToken}`);
    const list = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${adminToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.oldData).toEqual({ fullName: 'A' });
    expect(JSON.stringify(detail.body)).not.toMatch(/password|\$2a\$/);
    expect(JSON.stringify(list.body)).not.toMatch(/password|\$2a\$/);
  });
});

describe('Rollback yang tidak memulihkan apa pun ditolak', () => {
  const userDeleteLog = {
    id: 'log-d', action: 'DELETE', entity: 'users', entityId: 'u-5',
    oldData: { username: 'budi', email: 'budi@material.dn2', fullName: 'Budi', role: 'KASIR' },
  };

  test('log DELETE users: canRollback false', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([
      userDeleteLog,
      // soft delete brand bisa dibalik karena isActive:true ikut dipulihkan
      { id: 'log-b', action: 'DELETE', entity: 'brands', entityId: 'b-1', oldData: { name: 'Tiga Roda', isActive: true } },
      // update yang hanya mengubah kolom yang tidak dipulihkan (isActive user)
      { id: 'log-u', action: 'UPDATE', entity: 'users', entityId: 'u-6', oldData: { username: 'a', fullName: 'A', role: 'KASIR' }, newData: { isActive: false } },
    ]);
    mockPrisma.auditLog.count.mockResolvedValue(3);

    const res = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.data.map((l) => l.canRollback)).toEqual([false, true, false]);
  });

  test('POST rollback log DELETE users → 400, tidak menulis apa pun', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue(userDeleteLog);

    const res = await rollback('log-d');

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  test('data saat ini sudah sama dengan data lama → 400', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'products', entityId: 'p-1',
      oldData: { name: 'Semen', sellPrice: '65000' }, newData: { name: 'Semen Baru', sellPrice: '70000' },
    });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Semen', sellPrice: 65000 });

    const res = await rollback('log-1');

    expect(res.status).toBe(400);
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });

  test('rollback pada user yang sudah dihapus → 404', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'users', entityId: 'u-5',
      oldData: { fullName: 'Budi' }, newData: { fullName: 'Budi Baru' },
    });
    mockPrisma.user.findUnique.mockImplementation(({ where }) => Promise.resolve(
      where.id === 'user-test-1'
        ? { id: 'user-test-1', role: 'ADMIN', isActive: true }
        : { id: 'u-5', fullName: 'Budi Baru', deletedAt: new Date() }
    ));

    const res = await rollback('log-1');

    expect(res.status).toBe(404);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('GET /api/audit-logs — filter tanggal polos = hari WIB', () => {
  test('YYYY-MM-DD dibaca 00:00:00+07:00 … 23:59:59.999+07:00 (server UTC)', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/audit-logs?startDate=2026-03-10&endDate=2026-03-10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-03-09T17:00:00.000Z'),
      lte: new Date('2026-03-10T16:59:59.999Z'),
    });
  });

  test('string ISO lengkap dipakai apa adanya', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/audit-logs')
      .query({ startDate: '2026-03-10T02:00:00.000Z', endDate: '2026-03-10T05:00:00.000Z' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-03-10T02:00:00.000Z'),
      lte: new Date('2026-03-10T05:00:00.000Z'),
    });
  });
});
