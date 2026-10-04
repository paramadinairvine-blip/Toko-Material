const { mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const poService = require('../src/services/purchaseOrder.service');

beforeEach(() => resetMocks());

const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join('?') : String(call[0]));

const setupPO = ({ items, status = 'SENT', product = {} }) => {
  mockPrisma.purchaseOrder.findUnique.mockResolvedValue({
    id: 'po-1', poNumber: 'PO-20261004-0001', status, receivedAt: null, items,
  });
  mockPrisma.product.findUnique.mockResolvedValue({
    id: 'p-1', unitId: 'u-pcs', stock: 10, buyPrice: 900, sellPrice: 1500, ...product,
  });
  mockPrisma.purchaseOrderItem.update.mockResolvedValue({});
  mockPrisma.stockMovement.create.mockResolvedValue({});
  mockPrisma.priceHistory.create.mockResolvedValue({});
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.purchaseOrder.update.mockResolvedValue({ id: 'po-1', status: 'RECEIVED', poNumber: 'PO-20261004-0001' });
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.user.findMany.mockResolvedValue([]);
};

describe('PO receive — buyPrice per satuan dasar', () => {
  test('harga per dus dibagi conversion factor sebelum disimpan ke buyPrice', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: 'u-dus', quantity: 2, receivedQty: 0, receivedBaseQty: 0, price: 24000 }],
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue({ conversionFactor: 24 });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 2 }], 'user-1');

    expect(mockPrisma.priceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ newBuy: 1000 }),
    }));
    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p-1' },
      data: expect.objectContaining({ buyPrice: 1000 }),
    }));
  });

  test('harga per satuan dasar dibulatkan 2 desimal', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: 'u-pak', quantity: 1, receivedQty: 0, receivedBaseQty: 0, price: 10000 }],
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue({ conversionFactor: 3 });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 1 }], 'user-1');

    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buyPrice: 3333.33 }),
    }));
  });

  test('tidak mencatat PriceHistory bila harga per satuan dasar sama', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: 'u-dus', quantity: 1, receivedQty: 0, receivedBaseQty: 0, price: 21600 }],
    });
    mockPrisma.productUnit.findUnique.mockResolvedValue({ conversionFactor: 24 });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 1 }], 'user-1');

    expect(mockPrisma.priceHistory.create).not.toHaveBeenCalled();
    const data = mockPrisma.product.update.mock.calls[0][0].data;
    expect(data.buyPrice).toBeUndefined();
  });
});

describe('PO receive — konkurensi', () => {
  test('mengunci baris PO di dalam transaksi sebelum membaca PO', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: null, quantity: 5, receivedQty: 0, receivedBaseQty: 0, price: 900 }],
    });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 5 }], 'user-1');

    const lockCall = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /purchase_orders[\s\S]*FOR UPDATE/.test(sqlOf(c)));
    expect(lockCall).toBeGreaterThanOrEqual(0);
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[lockCall];
    const readOrder = mockPrisma.purchaseOrder.findUnique.mock.invocationCallOrder[0];
    const txOrder = mockPrisma.$transaction.mock.invocationCallOrder[0];
    expect(txOrder).toBeLessThan(readOrder);
    expect(lockOrder).toBeLessThan(readOrder);
    expect(mockPrisma.$queryRaw.mock.calls.some((c) => /products[\s\S]*FOR UPDATE/.test(sqlOf(c)))).toBe(true);
  });

  test('stok ditambah dengan increment (bukan menimpa nilai lama)', async () => {
    setupPO({
      items: [{ id: 'poi-1', productId: 'p-1', unitId: null, quantity: 5, receivedQty: 0, receivedBaseQty: 0, price: 900 }],
    });

    await poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 5 }], 'user-1');

    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stock: { increment: 5 } }),
    }));
  });

  test('status dicek ulang di dalam transaksi (PO sudah RECEIVED ditolak)', async () => {
    setupPO({ status: 'RECEIVED', items: [{ id: 'poi-1', productId: 'p-1', quantity: 5, receivedQty: 5, price: 900 }] });

    await expect(poService.receive('po-1', [{ itemId: 'poi-1', receivedQty: 1 }], 'user-1'))
      .rejects.toMatchObject({ status: 400 });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
  });

  test('menolak PO tanpa item', async () => {
    setupPO({ items: [] });

    await expect(poService.receive('po-1', [], 'user-1'))
      .rejects.toMatchObject({ status: 400, message: expect.stringMatching(/tidak memiliki item/) });
    expect(mockPrisma.purchaseOrder.update).not.toHaveBeenCalled();
  });
});
