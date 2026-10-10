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

describe('Laporan keuangan — filter tipe', () => {
  test('type=BON hanya dikurangi retur dari transaksi BON', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { type: 'BON', total: 111000, createdAt: new Date('2026-10-01T03:00:00Z'), createdBy: 'u-1' },
    ]);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: 11100 } });

    const result = await reportService.getFinancialReport({ type: 'BON' });

    const expected = { status: { not: 'CANCELLED' }, type: 'BON' };
    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(expected);
    expect(mockPrisma.transactionReturn.findMany.mock.calls[0][0].where.transaction).toEqual(expected);
    expect(result.summary.netRevenue).toBe(99900);
  });

  test('tanpa type, retur semua tipe dihitung', async () => {
    await reportService.getFinancialReport({});

    expect(mockPrisma.transactionReturn.aggregate.mock.calls[0][0].where.transaction).toEqual(notCancelled);
  });

  test('type tidak dikenal → 400', async () => {
    await expect(reportService.getFinancialReport({ type: 'SALAH' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Laporan tren — tanggal polos = hari WIB', () => {
  test('rentang satu hari (start = end) mencakup hari WIB penuh', async () => {
    const result = await reportService.getTrendReport({ startDate: '2026-03-10', endDate: '2026-03-10' });

    const range = mockPrisma.transaction.findMany.mock.calls[0][0].where.createdAt;
    expect(range.gte).toEqual(new Date('2026-03-09T17:00:00.000Z'));
    expect(range.lte).toEqual(new Date('2026-03-10T16:59:59.999Z'));
    expect(result.period.startDate).toEqual(new Date('2026-03-09T17:00:00.000Z'));
  });

  test('string ISO dipakai apa adanya', async () => {
    await reportService.getTrendReport({ startDate: '2026-03-10T01:00:00.000Z', endDate: '2026-03-10T02:00:00.000Z' });

    const range = mockPrisma.transaction.findMany.mock.calls[0][0].where.createdAt;
    expect(range).toEqual({ gte: new Date('2026-03-10T01:00:00.000Z'), lte: new Date('2026-03-10T02:00:00.000Z') });
  });

  test('tanggal tidak valid → 400', async () => {
    await expect(reportService.getTrendReport({ startDate: 'bukan-tanggal' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('Produk terlaris — jumlah dalam satuan dasar', () => {
  const items = [
    // p-dus: 2 dus = 48 pcs
    { productId: 'p-dus', quantity: 2, baseQty: 48, subtotal: 120000 },
    // p-pcs: 10 + 5 pcs (baris kedua data lama tanpa baseQty)
    { productId: 'p-pcs', quantity: 10, baseQty: 10, subtotal: 20000 },
    { productId: 'p-pcs', quantity: 5, baseQty: 0, subtotal: 10000 },
  ];
  const details = [{ id: 'p-dus', name: 'Paku Dus' }, { id: 'p-pcs', name: 'Paku Eceran' }];

  test('trend: peringkat & total memakai baseQty (fallback quantity)', async () => {
    mockPrisma.transactionItem.findMany.mockResolvedValue(items);
    mockPrisma.product.findMany.mockResolvedValue(details);

    const result = await reportService.getTrendReport({});

    expect(result.topProducts.map((t) => [t.rank, t.product.name, t.totalQuantity, t.totalValue])).toEqual([
      [1, 'Paku Dus', 48, 120000],
      [2, 'Paku Eceran', 15, 30000],
    ]);
  });

  test('dashboard: top 5 memakai baseQty', async () => {
    mockPrisma.transactionItem.findMany.mockResolvedValue(items);
    mockPrisma.product.findMany.mockResolvedValue(details);

    const result = await reportService.getDashboardSummary({});

    expect(result.charts.topProducts[0]).toMatchObject({ rank: 1, totalQuantity: 48 });
    expect(result.charts.topProducts[1]).toMatchObject({ rank: 2, totalQuantity: 15 });
  });
});

describe('Laba rugi — rincian dialokasikan dari total transaksi', () => {
  const semen = { id: 'p-1', name: 'Semen', buyPrice: 100, sellPrice: 150, category: { id: 'c-1', name: 'Semen' } };
  const paku = { id: 'p-2', name: 'Paku', buyPrice: 10, sellPrice: 20, category: { id: 'c-2', name: 'Paku' } };

  test('diskon header, pajak, dan retur terbagi proporsional; jumlah rincian = netRevenue', async () => {
    // tx-1: subtotal 200000, diskon header 20000 → total 180000
    // tx-2: subtotal 100000, pajak 11000 → total 111000
    mockPrisma.transaction.findMany.mockResolvedValue([
      { type: 'CASH', total: 180000 },
      { type: 'BON', total: 111000 },
    ]);
    mockPrisma.transactionItem.findMany.mockResolvedValue([
      { transactionId: 'tx-1', quantity: 2, baseQty: 2, subtotal: 120000, product: semen, transaction: { total: 180000 } },
      { transactionId: 'tx-1', quantity: 5, baseQty: 5, subtotal: 80000, product: paku, transaction: { total: 180000 } },
      { transactionId: 'tx-2', quantity: 10, baseQty: 10, subtotal: 100000, product: paku, transaction: { total: 111000 } },
    ]);
    mockPrisma.transactionReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: 11100 } });
    mockPrisma.transactionReturnItem.findMany.mockResolvedValue([
      { transactionReturnId: 'r-1', quantity: 1, baseQty: 1, subtotal: 10000, product: paku, transactionReturn: { refundAmount: 11100 } },
    ]);

    const result = await reportService.getLabaRugiReport({});

    expect(result.summary.netRevenue).toBe(279900);
    const byCategory = Object.fromEntries(result.hppByCategory.map((c) => [c.categoryName, c.totalRevenue]));
    // Semen: 120000 × 0.9 = 108000; Paku: 80000 × 0.9 + 100000 × 1.11 − 11100 = 171900
    expect(byCategory).toEqual({ Semen: 108000, Paku: 171900 });
    const sum = result.hppByCategory.reduce((s, c) => s + c.totalRevenue, 0);
    expect(sum).toBe(result.summary.netRevenue);
  });

  test('selisih pembulatan dibebankan ke baris terbesar sehingga jumlah tetap persis', async () => {
    // total 100 dibagi tiga item sama besar → 33,33 masing-masing
    const mk = (id, name) => ({ id, name, buyPrice: 1, sellPrice: 2, category: { id: `c-${id}`, name } });
    mockPrisma.transaction.findMany.mockResolvedValue([{ type: 'CASH', total: 100 }]);
    mockPrisma.transactionItem.findMany.mockResolvedValue(['a', 'b', 'c'].map((id) => ({
      transactionId: 'tx-1', quantity: 1, baseQty: 1, subtotal: 50, product: mk(id, id.toUpperCase()), transaction: { total: 100 },
    })));

    const result = await reportService.getLabaRugiReport({});

    const sum = result.hppByCategory.reduce((s, c) => s + c.totalRevenue, 0);
    expect(sum).toBe(100);
    expect(result.summary.netRevenue).toBe(100);
  });
});

describe('Dashboard & laporan stok', () => {
  test('activePOs menghitung PARTIALLY_RECEIVED', async () => {
    await reportService.getDashboardSummary({});

    expect(mockPrisma.purchaseOrder.count).toHaveBeenCalledWith({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
    });
  });

  test('stok menipis: stok ≤ minimum (minimum 0 tidak dihitung)', async () => {
    const products = [
      { id: 'p-1', name: 'Di bawah', sku: 'A', stock: 3, minStock: 5, buyPrice: 1, sellPrice: 2 },
      { id: 'p-2', name: 'Tepat', sku: 'B', stock: 5, minStock: 5, buyPrice: 1, sellPrice: 2 },
      { id: 'p-3', name: 'Aman', sku: 'C', stock: 6, minStock: 5, buyPrice: 1, sellPrice: 2 },
      { id: 'p-4', name: 'Tanpa minimum', sku: 'D', stock: 0, minStock: 0, buyPrice: 1, sellPrice: 2 },
    ];
    mockPrisma.product.findMany.mockResolvedValue(products);

    const dashboard = await reportService.getDashboardSummary({});
    expect(dashboard.lowStockCount).toBe(2);
    expect(dashboard.lowStockItems.map((p) => p.id)).toEqual(['p-1', 'p-2']);

    const stock = await reportService.getStockReport({});
    expect(stock.summary.lowStockCount).toBe(2);
    expect(stock.items.map((i) => i.isLowStock)).toEqual([true, true, false, false]);

    const lowOnly = await reportService.getStockReport({ lowStockOnly: true });
    expect(lowOnly.items.map((i) => i.id)).toEqual(['p-1', 'p-2']);
  });

  test('laporan stok: filter kategori induk mencakup semua turunannya', async () => {
    mockPrisma.category.findMany.mockResolvedValue([
      { id: 'induk', parentId: null },
      { id: 'anak', parentId: 'induk' },
      { id: 'cucu', parentId: 'anak' },
      { id: 'lain', parentId: null },
      { id: 'anak-lain', parentId: 'lain' },
    ]);

    await reportService.getStockReport({ categoryId: 'induk' });

    const { where } = mockPrisma.product.findMany.mock.calls[0][0];
    expect(where.categoryId.in.sort()).toEqual(['anak', 'cucu', 'induk']);
  });
});
