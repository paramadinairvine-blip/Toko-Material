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
