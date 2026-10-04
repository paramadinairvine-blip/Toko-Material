// Catatan: jest globalSetup memaksa TZ=UTC (seperti server Railway)
const { mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const reportService = require('../src/services/report.service');

const notCancelled = { status: { not: 'CANCELLED' } };

beforeEach(() => {
  resetMocks();
  mockPrisma.transaction.findMany.mockResolvedValue([]);
  mockPrisma.transactionReturn.findMany.mockResolvedValue([]);
  mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: 0 }, _count: { id: 0 } });
  mockPrisma.transactionItem.findMany.mockResolvedValue([]);
  mockPrisma.transactionItem.groupBy.mockResolvedValue([]);
  mockPrisma.transactionReturnItem.findMany.mockResolvedValue([]);
  mockPrisma.stockMovement.groupBy.mockResolvedValue([]);
  mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([]);
  mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalAmount: 0 }, _count: { id: 0 } });
  mockPrisma.purchaseOrder.count.mockResolvedValue(0);
  mockPrisma.product.count.mockResolvedValue(0);
  mockPrisma.product.findMany.mockResolvedValue([]);
  mockPrisma.project.count.mockResolvedValue(0);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.unitLembaga.findMany.mockResolvedValue([]);
});

afterEach(() => jest.useRealTimers());

describe('Laporan keuangan — totalPurchase dari barang yang diterima', () => {
  test('menghitung penerimaan parsial dalam periode × harga per satuan dasar', async () => {
    // PO-1 diterima sebagian: 48 pcs (2 dus) dari item 5 dus @24.000 (factor 24)
    mockPrisma.stockMovement.groupBy.mockResolvedValue([
      { referenceId: 'po-1', productId: 'p-1', _sum: { quantity: 48 } },
      { referenceId: 'po-2', productId: 'p-2', _sum: { quantity: 3 } },
    ]);
    mockPrisma.purchaseOrderItem.findMany.mockResolvedValue([
      { purchaseOrderId: 'po-1', productId: 'p-1', quantity: 5, baseQty: 120, price: 24000, subtotal: 120000 },
      { purchaseOrderId: 'po-2', productId: 'p-2', quantity: 10, baseQty: 10, price: 5000, subtotal: 50000 },
    ]);
    // totalAmount PO (nilai lama) tidak boleh dipakai
    mockPrisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalAmount: 999999 }, _count: { id: 1 } });

    const result = await reportService.getFinancialReport({ startDate: '2026-10-01', endDate: '2026-10-31' });

    expect(result.summary.totalPurchase).toBe(48 * 1000 + 3 * 5000);
    const where = mockPrisma.stockMovement.groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({ type: 'IN', referenceType: 'PO' });
    expect(where.createdAt.gte).toEqual(new Date('2026-10-01T00:00:00+07:00'));
    expect(where.createdAt.lte).toEqual(new Date('2026-10-31T23:59:59.999+07:00'));
  });
});

describe('Refund transaksi batal tidak mengurangi laporan', () => {
  test('financial report memfilter retur dari transaksi CANCELLED', async () => {
    await reportService.getFinancialReport({});
    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(notCancelled);
    expect(mockPrisma.transactionReturn.findMany.mock.calls[0][0].where.transaction).toEqual(notCancelled);
  });

  test('trend report memfilter retur dari transaksi CANCELLED', async () => {
    await reportService.getTrendReport({ startDate: '2026-01-01', endDate: '2026-10-31' });
    expect(mockPrisma.transactionReturn.findMany.mock.calls[0][0].where.transaction).toEqual(notCancelled);
    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(notCancelled);
  });

  test('laba rugi memfilter retur dari transaksi CANCELLED', async () => {
    await reportService.getLabaRugiReport({});
    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(notCancelled);
  });

  test('dashboard memfilter retur dari transaksi CANCELLED', async () => {
    await reportService.getDashboardSummary({});
    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(notCancelled);
    expect(mockPrisma.transactionReturn.findMany.mock.calls[0][0].where.transaction).toEqual(notCancelled);
  });
});

describe('Laba rugi — HPP', () => {
  const product = { id: 'p-1', name: 'Paku', buyPrice: 100, sellPrice: 150, category: { id: 'c-1', name: 'Paku' } };

  test('HPP memakai baseQty (fallback quantity untuk data lama)', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([{ type: 'CASH', total: 3600 }]);
    mockPrisma.transactionItem.findMany.mockResolvedValue([
      // 2 dus (= 20 pcs) × buyPrice 100/pcs = 2000
      { quantity: 2, baseQty: 20, subtotal: 3000, product },
      // data lama tanpa baseQty: 4 pcs × 100 = 400
      { quantity: 4, baseQty: 0, subtotal: 600, product },
    ]);

    const result = await reportService.getLabaRugiReport({});

    expect(result.summary.totalHPP).toBe(2400);
    expect(result.summary.grossProfit).toBe(1200);
  });

  test('HPP dikurangi biaya barang yang diretur', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([{ type: 'CASH', total: 3000 }]);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: 750 } });
    mockPrisma.transactionItem.findMany.mockResolvedValue([
      { quantity: 2, baseQty: 20, subtotal: 3000, product },
    ]);
    mockPrisma.transactionReturnItem.findMany.mockResolvedValue([
      { quantity: 5, baseQty: 5, subtotal: 750, product },
    ]);

    const result = await reportService.getLabaRugiReport({ startDate: '2026-10-01', endDate: '2026-10-31' });

    expect(result.summary.totalHPP).toBe(2000 - 500);
    expect(result.summary.netRevenue).toBe(2250);
    expect(result.summary.grossProfit).toBe(750);
    const where = mockPrisma.transactionReturnItem.findMany.mock.calls[0][0].where;
    expect(where.transactionReturn.transaction).toEqual(notCancelled);
    expect(where.transactionReturn.createdAt.gte).toEqual(new Date('2026-10-01T00:00:00+07:00'));
  });
});

describe('Dashboard — batas bulan WIB', () => {
  test('default bulan berjalan memakai kalender WIB', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    // 30 Sep 2026 18:00 UTC = 1 Okt 2026 01:00 WIB → bulan berjalan = Oktober
    jest.setSystemTime(new Date('2026-09-30T18:00:00Z'));

    const result = await reportService.getDashboardSummary({});

    const monthlyCall = mockPrisma.transaction.findMany.mock.calls.find((c) => c[0].where.createdAt.lte);
    expect(monthlyCall[0].where.createdAt.gte).toEqual(new Date('2026-09-30T17:00:00.000Z'));
    expect(monthlyCall[0].where.createdAt.lte).toEqual(new Date('2026-10-31T16:59:59.999Z'));

    const months = result.charts.transactionTrend.map((m) => m.month);
    expect(months).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  });
});
