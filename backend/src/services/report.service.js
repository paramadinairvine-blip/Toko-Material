const prisma = require('../lib/prisma');
const { format, subMonths } = require('date-fns');
const AppError = require('../utils/AppError');
const { TRANSACTION_TYPES } = require('../utils/constants');
const { parseDateParam, buildDateRange } = require('../utils/queryParams');

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Format tanggal dalam WIB (+07:00) untuk grouping — tidak bergantung zona waktu server
const formatWIB = (date, fmt) => {
  const w = new Date(date.getTime() + WIB_OFFSET_MS);
  const local = new Date(
    w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(),
    w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), w.getUTCMilliseconds()
  );
  return format(local, fmt);
};

/**
 * Batas awal & akhir bulan kalender WIB yang memuat `date`,
 * digeser `monthOffset` bulan (negatif = bulan sebelumnya).
 */
const wibMonthRange = (date, monthOffset = 0) => {
  const w = new Date(date.getTime() + WIB_OFFSET_MS);
  const y = w.getUTCFullYear();
  const m = w.getUTCMonth() + monthOffset;
  return {
    start: new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - WIB_OFFSET_MS - 1),
  };
};

// Refund dari transaksi yang dibatalkan tidak boleh mengurangi pendapatan
const NOT_CANCELLED_TX = { transaction: { status: { not: 'CANCELLED' } } };

/**
 * Total pembelian berdasarkan barang yang BENAR-BENAR diterima dalam periode.
 *
 * Setiap penerimaan PO dicatat sebagai StockMovement type IN, referenceType PO,
 * referenceId = id PO, quantity = qty satuan dasar, createdAt = waktu terima.
 * Nilainya = qty dasar diterima × harga per satuan dasar item PO
 * (subtotal / baseQty item PO untuk produk tsb).
 */
const getReceivedPurchaseTotal = async (dateFilter) => {
  const where = { type: 'IN', referenceType: 'PO' };
  if (dateFilter) where.createdAt = dateFilter;

  const received = await prisma.stockMovement.groupBy({
    by: ['referenceId', 'productId'],
    where,
    _sum: { quantity: true },
  });
  if (!received || received.length === 0) return { total: 0, poCount: 0 };

  const poIds = [...new Set(received.map((r) => r.referenceId).filter(Boolean))];
  const poItems = poIds.length > 0
    ? await prisma.purchaseOrderItem.findMany({
        where: { purchaseOrderId: { in: poIds } },
        select: { purchaseOrderId: true, productId: true, quantity: true, baseQty: true, price: true, subtotal: true },
      })
    : [];

  // Harga per satuan dasar per (PO, produk); rata-rata tertimbang bila produk muncul >1 kali
  const priceMap = {};
  poItems.forEach((it) => {
    const key = `${it.purchaseOrderId}_${it.productId}`;
    const subtotal = it.subtotal != null ? Number(it.subtotal) : Number(it.price) * it.quantity;
    const baseQty = it.baseQty > 0 ? it.baseQty : it.quantity; // data lama tanpa baseQty → anggap satuan dasar
    if (!priceMap[key]) priceMap[key] = { subtotal: 0, baseQty: 0 };
    priceMap[key].subtotal += subtotal;
    priceMap[key].baseQty += baseQty;
  });

  let total = 0;
  received.forEach((r) => {
    const p = priceMap[`${r.referenceId}_${r.productId}`];
    if (!p || p.baseQty <= 0) return;
    total += (r._sum.quantity || 0) * (p.subtotal / p.baseQty);
  });

  return { total: Math.round(total * 100) / 100, poCount: poIds.length };
};

/**
 * Stok dianggap menipis bila sudah MENYENTUH batas minimum (stok ≤ minStock),
 * sama dengan aturan notifikasi stok. Produk tanpa batas minimum (0) tidak dihitung.
 */
const isLowStock = (product) => product.minStock > 0 && product.stock <= product.minStock;

/**
 * ID kategori beserta seluruh turunannya (sub-kategori di semua kedalaman).
 */
const getCategoryWithDescendantIds = async (categoryId) => {
  const categories = (await prisma.category.findMany({ select: { id: true, parentId: true } })) || [];
  const childrenOf = new Map();
  categories.forEach((c) => {
    if (!c.parentId) return;
    if (!childrenOf.has(c.parentId)) childrenOf.set(c.parentId, []);
    childrenOf.get(c.parentId).push(c.id);
  });

  const ids = new Set([categoryId]);
  const queue = [categoryId];
  while (queue.length > 0) {
    const current = queue.shift();
    (childrenOf.get(current) || []).forEach((childId) => {
      if (!ids.has(childId)) {
        ids.add(childId);
        queue.push(childId);
      }
    });
  }
  return [...ids];
};

/**
 * Produk terlaris berdasarkan jumlah dalam SATUAN DASAR (baseQty; data lama
 * tanpa baseQty memakai quantity) — menjumlahkan `quantity` lintas satuan
 * (1 dus + 3 pcs = 4) menghasilkan peringkat yang salah.
 */
const getTopProductsByBaseQty = async (transactionWhere, take) => {
  const items = (await prisma.transactionItem.findMany({
    where: { transaction: transactionWhere },
    select: { productId: true, quantity: true, baseQty: true, subtotal: true },
  })) || [];

  const totals = new Map();
  items.forEach((item) => {
    const qty = item.baseQty > 0 ? item.baseQty : item.quantity;
    const row = totals.get(item.productId) || { productId: item.productId, totalQuantity: 0, totalValue: 0 };
    row.totalQuantity += qty || 0;
    row.totalValue += Number(item.subtotal || 0);
    totals.set(item.productId, row);
  });

  const ranked = [...totals.values()].sort((a, b) => b.totalQuantity - a.totalQuantity || b.totalValue - a.totalValue);
  const top = take ? ranked.slice(0, take) : ranked;

  const ids = top.map((t) => t.productId);
  const details = ids.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, sku: true, unit: true },
      })
    : [];
  const productMap = new Map((details || []).map((p) => [p.id, p]));

  return top.map((t, idx) => ({
    rank: idx + 1,
    product: productMap.get(t.productId) || { id: t.productId, name: '-' },
    totalQuantity: t.totalQuantity,
    totalValue: Math.round(t.totalValue * 100) / 100,
  }));
};

// ─── 1. Stock Report ────────────────────────────────────────────────

/**
 * Stock report per product / category.
 *
 * @param {object}  opts
 * @param {string}  [opts.categoryId]
 * @param {boolean} [opts.lowStockOnly=false]
 * @returns {Promise<object>}
 */
const getStockReport = async ({ categoryId, lowStockOnly = false } = {}) => {
  const where = { isActive: true };
  // Memilih kategori induk ikut menampilkan produk di semua sub-kategorinya
  if (categoryId) where.categoryId = { in: await getCategoryWithDescendantIds(categoryId) };

  const products = await prisma.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      brand: { select: { id: true, name: true } },
      unitOfMeasure: { select: { id: true, name: true, abbreviation: true } },
    },
    orderBy: { name: 'asc' },
  });

  let items = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category?.name || '-',
    brand: p.brand?.name || '-',
    unit: p.unitOfMeasure?.abbreviation || p.unit,
    stock: p.stock,
    minStock: p.minStock,
    maxStock: p.maxStock,
    buyPrice: Number(p.buyPrice),
    sellPrice: Number(p.sellPrice),
    stockValue: Math.round(p.stock * Number(p.buyPrice)),
    isLowStock: isLowStock(p),
    isOverStock: p.maxStock ? p.stock > p.maxStock : false,
  }));

  if (lowStockOnly) {
    items = items.filter((i) => i.isLowStock);
  }

  const totalItems = items.length;
  const totalStockValue = Math.round(items.reduce((s, i) => s + i.stockValue, 0));
  const lowStockCount = items.filter((i) => i.isLowStock).length;

  return {
    items,
    summary: {
      totalItems,
      totalStockValue,
      lowStockCount,
    },
  };
};

// ─── 2. Financial Report ────────────────────────────────────────────

/**
 * Financial report: purchases, expenditures by type/unit lembaga, outstanding BON.
 */
const getFinancialReport = async ({ startDate, endDate, type } = {}) => {
  // Accept both ISO strings (from frontend) and plain dates (YYYY-MM-DD = hari WIB)
  const dateFilter = buildDateRange(startDate, endDate) || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  if (type && !Object.values(TRANSACTION_TYPES).includes(type)) {
    throw new AppError(`Parameter type harus salah satu dari: ${Object.values(TRANSACTION_TYPES).join(', ')}`, 400);
  }

  // 2a. Total pembelian = nilai barang PO yang diterima dalam periode
  // (termasuk penerimaan parsial; bukan totalAmount PO yang receivedAt-nya di periode)
  const purchase = await getReceivedPurchaseTotal(hasDateFilter ? dateFilter : null);

  // 2b. All transactions (pendapatan/revenue from POS)
  const txWhere = { status: { not: 'CANCELLED' } };
  if (hasDateFilter) txWhere.createdAt = dateFilter;
  if (type) txWhere.type = type;

  const transactions = await prisma.transaction.findMany({
    where: txWhere,
    select: { type: true, total: true, unitLembagaId: true },
  });

  // 2b-2. Total retur dalam periode yang sama (tanpa retur dari transaksi batal).
  // Dengan filter tipe, hanya retur dari transaksi bertipe sama yang mengurangi.
  const returnWhere = type
    ? { transaction: { ...NOT_CANCELLED_TX.transaction, type } }
    : { ...NOT_CANCELLED_TX };
  if (hasDateFilter) returnWhere.createdAt = dateFilter;

  const returnAgg = await prisma.transactionReturn.aggregate({
    where: returnWhere,
    _sum: { refundAmount: true },
  });
  const totalReturn = Number(returnAgg._sum.refundAmount || 0);

  // Summary totals by type
  const cashTotal = Math.round(transactions
    .filter((t) => t.type === 'CASH')
    .reduce((s, t) => s + Number(t.total), 0));
  const bonTotal = Math.round(transactions
    .filter((t) => t.type === 'BON')
    .reduce((s, t) => s + Number(t.total), 0));

  // 2c. Per-cashier daily breakdown
  const txWithCashier = await prisma.transaction.findMany({
    where: txWhere,
    select: { type: true, total: true, createdAt: true, createdBy: true },
  });

  // Get all returns with creator info for the period
  const returnsWithCashier = await prisma.transactionReturn.findMany({
    where: returnWhere,
    select: { refundAmount: true, createdAt: true, createdBy: true },
  });

  // Collect unique user IDs
  const cashierIds = [...new Set([
    ...txWithCashier.filter((t) => t.createdBy).map((t) => t.createdBy),
    ...returnsWithCashier.filter((r) => r.createdBy).map((r) => r.createdBy),
  ])];
  const cashierList = cashierIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, fullName: true } })
    : [];
  const cashierMap = new Map(cashierList.map((u) => [u.id, u.fullName]));

  // Group by cashier + date
  const byCashierDay = {};
  txWithCashier.forEach((t) => {
    const day = formatWIB(t.createdAt, 'yyyy-MM-dd');
    const key = `${t.createdBy || 'unknown'}_${day}`;
    if (!byCashierDay[key]) {
      byCashierDay[key] = { cashierId: t.createdBy, date: day, cashTotal: 0, bonTotal: 0, returnTotal: 0, count: 0 };
    }
    const amount = Number(t.total);
    if (t.type === 'CASH') byCashierDay[key].cashTotal += amount;
    else if (t.type === 'BON') byCashierDay[key].bonTotal += amount;
    byCashierDay[key].count += 1;
  });
  returnsWithCashier.forEach((r) => {
    const day = formatWIB(r.createdAt, 'yyyy-MM-dd');
    const key = `${r.createdBy || 'unknown'}_${day}`;
    if (!byCashierDay[key]) {
      byCashierDay[key] = { cashierId: r.createdBy, date: day, cashTotal: 0, bonTotal: 0, returnTotal: 0, count: 0 };
    }
    byCashierDay[key].returnTotal += Number(r.refundAmount);
  });

  const perCashier = Object.values(byCashierDay)
    .map((row) => ({
      cashierName: cashierMap.get(row.cashierId) || '-',
      date: row.date,
      cashTotal: row.cashTotal,
      bonTotal: row.bonTotal,
      returnTotal: row.returnTotal,
      netTotal: Math.round(row.cashTotal + row.bonTotal - row.returnTotal),
      transactionCount: row.count,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.cashierName.localeCompare(b.cashierName));

  // Pendapatan per tipe transaksi (untuk pie chart dashboard)
  const expenditureByType = [
    { type: 'CASH', label: 'Tunai', total: cashTotal },
    { type: 'BON', label: 'Overbooking TU', total: bonTotal },
  ];
  const totalExpenditure = Math.round(cashTotal + bonTotal);

  return {
    summary: {
      totalPurchase: purchase.total,
      cashTotal,
      bonTotal,
      totalReturn,
      netRevenue: Math.round(cashTotal + bonTotal - totalReturn),
    },
    expenditureByType,
    totalExpenditure,
    perCashier,
  };
};

// ─── 3. Trend Report ────────────────────────────────────────────────

/**
 * Trend report: monthly expenditure, top products, top unit lembaga.
 */
const getTrendReport = async ({ startDate, endDate, groupBy = 'month' } = {}) => {
  // Tanggal polos (YYYY-MM-DD) = hari kalender WIB: awal hari … akhir hari,
  // sehingga rentang satu hari (start = end) tetap berisi transaksi hari itu.
  const start = parseDateParam(startDate, { name: 'startDate' }) || subMonths(new Date(), 11); // default last 12 months
  const end = parseDateParam(endDate, { endOfDay: true, name: 'endDate' }) || new Date();
  if (start > end) {
    throw new AppError('Parameter startDate tidak boleh setelah endDate', 400);
  }

  // 3a. Monthly expenditure trend
  const transactions = await prisma.transaction.findMany({
    where: {
      status: { not: 'CANCELLED' },
      createdAt: { gte: start, lte: end },
    },
    select: { total: true, createdAt: true, type: true },
  });

  // 3a-2. Retur dalam periode
  const trendReturns = await prisma.transactionReturn.findMany({
    where: { ...NOT_CANCELLED_TX, createdAt: { gte: start, lte: end } },
    select: { refundAmount: true, createdAt: true },
  });

  const monthlyMap = {};
  transactions.forEach((t) => {
    const key = formatWIB(t.createdAt, 'yyyy-MM');
    if (!monthlyMap[key]) monthlyMap[key] = { month: key, total: 0, returnTotal: 0, count: 0 };
    monthlyMap[key].total = Math.round(monthlyMap[key].total + Number(t.total));
    monthlyMap[key].count += 1;
  });
  trendReturns.forEach((r) => {
    const key = formatWIB(r.createdAt, 'yyyy-MM');
    if (!monthlyMap[key]) monthlyMap[key] = { month: key, total: 0, returnTotal: 0, count: 0 };
    monthlyMap[key].returnTotal = Math.round(monthlyMap[key].returnTotal + Number(r.refundAmount));
  });

  const monthlyTrend = Object.values(monthlyMap)
    .map((m) => ({ ...m, netTotal: m.total - m.returnTotal }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // 3b. All issued products sorted by quantity (satuan dasar)
  const topProductsFormatted = await getTopProductsByBaseQty({
    status: { not: 'CANCELLED' },
    createdAt: { gte: start, lte: end },
  });

  // 3c. Top unit lembaga by expenditure
  const unitTx = await prisma.transaction.findMany({
    where: {
      status: { not: 'CANCELLED' },
      createdAt: { gte: start, lte: end },
      unitLembagaId: { not: null },
    },
    select: { unitLembagaId: true, total: true },
  });

  const unitTotals = {};
  unitTx.forEach((t) => {
    unitTotals[t.unitLembagaId] = (unitTotals[t.unitLembagaId] || 0) + Number(t.total);
  });

  const unitIds = Object.keys(unitTotals);
  const unitDetails = unitIds.length > 0
    ? await prisma.unitLembaga.findMany({ where: { id: { in: unitIds } } })
    : [];
  const unitNameMap = new Map(unitDetails.map((u) => [u.id, u.name]));

  const topUnits = Object.entries(unitTotals)
    .map(([id, total]) => ({
      unitLembagaId: id,
      unitLembagaName: unitNameMap.get(id) || '-',
      total,
    }))
    .sort((a, b) => b.total - a.total);

  // 3d. Period comparison (current period vs previous period of same length)
  const periodMs = end.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - periodMs);
  const prevEnd = new Date(start.getTime() - 1);

  const prevTransactions = await prisma.transaction.findMany({
    where: {
      status: { not: 'CANCELLED' },
      createdAt: { gte: prevStart, lte: prevEnd },
    },
    select: { total: true },
  });

  const currentReturnTotal = Math.round(trendReturns.reduce((s, r) => s + Number(r.refundAmount), 0));
  const currentTotal = Math.round(transactions.reduce((s, t) => s + Number(t.total), 0) - currentReturnTotal);

  const prevReturns = await prisma.transactionReturn.aggregate({
    where: { ...NOT_CANCELLED_TX, createdAt: { gte: prevStart, lte: prevEnd } },
    _sum: { refundAmount: true },
  });
  const previousTotal = Math.round(prevTransactions.reduce((s, t) => s + Number(t.total), 0) - Number(prevReturns._sum.refundAmount || 0));
  const changePercent = previousTotal > 0
    ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100)
    : currentTotal > 0 ? 100 : 0;

  return {
    period: { startDate: start, endDate: end },
    monthlyTrend,
    topProducts: topProductsFormatted,
    topUnits,
    periodComparison: {
      current: { total: currentTotal, count: transactions.length },
      previous: { total: previousTotal, count: prevTransactions.length },
      changePercent,
      direction: currentTotal >= previousTotal ? 'up' : 'down',
    },
  };
};

// ─── 4. Profit & Loss (Laba Rugi) Report ─────────────────────────────

/**
 * Laporan Laba Rugi: Pendapatan - HPP = Laba Kotor.
 */
const getLabaRugiReport = async ({ startDate, endDate } = {}) => {
  const dateFilter = buildDateRange(startDate, endDate) || {};
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  // ── A. PENDAPATAN ──────────────────────────────────────
  const txWhere = { status: { not: 'CANCELLED' } };
  if (hasDateFilter) txWhere.createdAt = dateFilter;

  const transactions = await prisma.transaction.findMany({
    where: txWhere,
    select: { type: true, total: true },
  });

  const cashRevenue = Math.round(transactions
    .filter((t) => t.type === 'CASH')
    .reduce((s, t) => s + Number(t.total), 0));
  const bonRevenue = Math.round(transactions
    .filter((t) => t.type === 'BON')
    .reduce((s, t) => s + Number(t.total), 0));

  // Retur (tanpa retur dari transaksi batal)
  const returnWhere = { ...NOT_CANCELLED_TX };
  if (hasDateFilter) returnWhere.createdAt = dateFilter;

  const returnAgg = await prisma.transactionReturn.aggregate({
    where: returnWhere,
    _sum: { refundAmount: true },
  });
  const totalReturn = Number(returnAgg._sum.refundAmount || 0);
  const netRevenue = Math.round(cashRevenue + bonRevenue - totalReturn);

  // ── B. HPP (Harga Pokok Penjualan) ────────────────────
  // Query semua TransactionItem dari transaksi yang tidak cancelled, beserta buyPrice dari Product
  const txItemWhere = { transaction: { status: { not: 'CANCELLED' } } };
  if (hasDateFilter) txItemWhere.transaction.createdAt = dateFilter;

  const productSelect = {
    select: {
      id: true,
      name: true,
      buyPrice: true,
      sellPrice: true,
      category: { select: { id: true, name: true } },
    },
  };

  const txItems = await prisma.transactionItem.findMany({
    where: txItemWhere,
    select: {
      transactionId: true,
      quantity: true,
      baseQty: true,
      subtotal: true,
      product: productSelect,
      transaction: { select: { total: true } },
    },
  });

  // Barang yang diretur (retur dalam periode, transaksi tidak batal) mengurangi HPP,
  // sejalan dengan refund yang mengurangi pendapatan.
  const returnItemWhere = { transactionReturn: { ...NOT_CANCELLED_TX } };
  if (hasDateFilter) returnItemWhere.transactionReturn.createdAt = dateFilter;

  const returnItems = await prisma.transactionReturnItem.findMany({
    where: returnItemWhere,
    select: {
      transactionReturnId: true,
      quantity: true,
      baseQty: true,
      subtotal: true,
      product: productSelect,
      transactionReturn: { select: { refundAmount: true } },
    },
  });

  // Pendapatan per item dialokasikan proporsional dari nilai header:
  //   penjualan → total transaksi (sudah termasuk diskon header & pajak)
  //   retur     → refundAmount retur
  // sehingga jumlah rincian per kategori/produk = netRevenue di ringkasan.
  const buildAllocator = (items, groupKey, headerAmount) => {
    const subtotalByGroup = new Map();
    items.forEach((item) => {
      const key = item[groupKey];
      subtotalByGroup.set(key, (subtotalByGroup.get(key) || 0) + Number(item.subtotal));
    });
    return (item) => {
      const header = headerAmount(item);
      const groupSubtotal = subtotalByGroup.get(item[groupKey]) || 0;
      if (header === null || header === undefined || groupSubtotal <= 0) return Number(item.subtotal);
      return Number(item.subtotal) * (Number(header) / groupSubtotal);
    };
  };
  const saleRevenueOf = buildAllocator(txItems, 'transactionId', (item) => item.transaction?.total);
  const returnRevenueOf = buildAllocator(returnItems || [], 'transactionReturnId', (item) => item.transactionReturn?.refundAmount);

  // Hitung total HPP (qty dalam satuan dasar × buyPrice per satuan dasar)
  let totalHPP = 0;
  const categoryHPPMap = {};
  const productMarginMap = {};

  const accumulate = (item, sign, revenueOf) => {
    const buyPrice = Number(item.product.buyPrice);
    const qty = item.baseQty > 0 ? item.baseQty : item.quantity;
    const hpp = sign * qty * buyPrice;
    const revenue = sign * revenueOf(item);
    totalHPP = Math.round(totalHPP + hpp);

    // HPP per kategori
    const catId = item.product.category?.id || 'uncategorized';
    const catName = item.product.category?.name || 'Tanpa Kategori';
    if (!categoryHPPMap[catId]) {
      categoryHPPMap[catId] = { categoryName: catName, totalHPP: 0, totalRevenue: 0 };
    }
    categoryHPPMap[catId].totalHPP = Math.round(categoryHPPMap[catId].totalHPP + hpp);
    categoryHPPMap[catId].totalRevenue += revenue;

    // Per-product margin aggregation
    const prodId = item.product.id;
    if (!productMarginMap[prodId]) {
      productMarginMap[prodId] = {
        productName: item.product.name,
        buyPrice,
        sellPrice: Number(item.product.sellPrice),
        totalQty: 0,
        totalRevenue: 0,
        totalHPP: 0,
      };
    }
    productMarginMap[prodId].totalQty += sign * qty;
    productMarginMap[prodId].totalRevenue += revenue;
    productMarginMap[prodId].totalHPP = Math.round(productMarginMap[prodId].totalHPP + hpp);
  };

  txItems.forEach((item) => accumulate(item, 1, saleRevenueOf));
  (returnItems || []).forEach((item) => accumulate(item, -1, returnRevenueOf));

  // Bulatkan pendapatan rincian; selisih pembulatan (beberapa rupiah) dibebankan
  // ke baris terbesar supaya jumlah rincian persis sama dengan netRevenue.
  const settleRounding = (rows) => {
    rows.forEach((row) => { row.totalRevenue = Math.round(row.totalRevenue); });
    if (rows.length === 0) return;
    const diff = netRevenue - rows.reduce((sum, row) => sum + row.totalRevenue, 0);
    if (diff !== 0 && Math.abs(diff) <= rows.length) {
      const largest = rows.reduce((a, b) => (Math.abs(b.totalRevenue) > Math.abs(a.totalRevenue) ? b : a));
      largest.totalRevenue += diff;
    }
  };
  settleRounding(Object.values(categoryHPPMap));
  settleRounding(Object.values(productMarginMap));

  const grossProfit = Math.round(netRevenue - totalHPP);
  const grossMarginPercent = netRevenue > 0
    ? Math.round((grossProfit / netRevenue) * 10000) / 100
    : 0;

  // ── C. HPP per Kategori ────────────────────────────────
  const hppByCategory = Object.values(categoryHPPMap)
    .map((cat) => ({
      ...cat,
      percentage: totalHPP > 0 ? Math.round((cat.totalHPP / totalHPP) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.totalHPP - a.totalHPP);

  // ── D. Top Margin & Low Margin Products ────────────────
  const allProducts = Object.values(productMarginMap).map((p) => ({
    ...p,
    grossProfit: p.totalRevenue - p.totalHPP,
    marginPercent: p.totalRevenue > 0
      ? Math.round(((p.totalRevenue - p.totalHPP) / p.totalRevenue) * 10000) / 100
      : 0,
  }));

  const topMarginProducts = [...allProducts]
    .sort((a, b) => b.marginPercent - a.marginPercent)
    .slice(0, 5);

  const lowMarginProducts = [...allProducts]
    .filter((p) => p.totalQty > 0)
    .sort((a, b) => a.marginPercent - b.marginPercent)
    .slice(0, 5);

  return {
    summary: {
      cashRevenue,
      bonRevenue,
      totalReturn,
      netRevenue,
      totalHPP,
      grossProfit,
      grossMarginPercent,
    },
    hppByCategory,
    topMarginProducts,
    lowMarginProducts,
  };
};

// ─── 5. Dashboard Summary ───────────────────────────────────────────

/**
 * Aggregated data for the main dashboard.
 */
const getDashboardSummary = async ({ startDate, endDate } = {}) => {
  // Default: bulan berjalan menurut kalender WIB (bukan zona waktu server)
  const currentMonth = wibMonthRange(new Date());
  const monthStart = parseDateParam(startDate, { name: 'startDate' }) || currentMonth.start;
  // Ensure endDate covers the full day (23:59:59.999 WIB)
  const monthEnd = parseDateParam(endDate, { endOfDay: true, name: 'endDate' }) || currentMonth.end;
  const chartStart = wibMonthRange(monthStart, -5).start;

  // Run all queries in parallel
  const [
    totalProducts,
    stockValueResult,
    monthlyTransactions,
    lowStockProducts,
    activePOs,
    activeProjects,
    sixMonthTransactions,
  ] = await Promise.all([
    // Total active products
    prisma.product.count({ where: { isActive: true } }),

    // Total stock value (stock * buyPrice)
    prisma.product.findMany({
      where: { isActive: true },
      select: { stock: true, buyPrice: true },
    }),

    // Transactions this month
    prisma.transaction.findMany({
      where: {
        status: { not: 'CANCELLED' },
        createdAt: { gte: monthStart, lte: monthEnd },
      },
      select: { total: true, type: true },
    }),

    // Products below minimum stock
    prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, stock: true, minStock: true, unit: true },
    }),

    // Active POs: belum selesai diterima (termasuk yang baru diterima sebagian)
    prisma.purchaseOrder.count({
      where: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] } },
    }),

    // Active projects
    prisma.project.count({
      where: { status: { in: ['PLANNING', 'IN_PROGRESS'] }, isActive: true },
    }),

    // Last 6 months of transactions for chart
    prisma.transaction.findMany({
      where: {
        status: { not: 'CANCELLED' },
        createdAt: { gte: chartStart },
      },
      select: { total: true, createdAt: true, type: true },
    }),
  ]);

  // Calculate stock value
  const totalStockValue = Math.round(stockValueResult.reduce(
    (s, p) => s + p.stock * Number(p.buyPrice),
    0
  ));

  // Low stock
  const lowStock = lowStockProducts.filter(isLowStock);

  // Monthly retur
  const monthlyReturnAgg = await prisma.transactionReturn.aggregate({
    where: { ...NOT_CANCELLED_TX, createdAt: { gte: monthStart, lte: monthEnd } },
    _sum: { refundAmount: true },
    _count: { id: true },
  });
  const monthlyReturnTotal = Number(monthlyReturnAgg._sum.refundAmount || 0);

  // Monthly transaction summary
  const monthlyTotal = Math.round(monthlyTransactions.reduce((s, t) => s + Number(t.total), 0) - monthlyReturnTotal);

  // 6-month chart data (with retur deduction)
  const sixMonthReturns = await prisma.transactionReturn.findMany({
    where: { ...NOT_CANCELLED_TX, createdAt: { gte: chartStart } },
    select: { refundAmount: true, createdAt: true },
  });

  const chartMap = {};
  for (let i = 5; i >= 0; i--) {
    const m = wibMonthRange(monthStart, -i).start;
    const key = formatWIB(m, 'yyyy-MM');
    chartMap[key] = { month: key, label: formatWIB(m, 'MMM yyyy'), total: 0, returnTotal: 0, count: 0 };
  }
  sixMonthTransactions.forEach((t) => {
    const key = formatWIB(t.createdAt, 'yyyy-MM');
    if (chartMap[key]) {
      chartMap[key].total = Math.round(chartMap[key].total + Number(t.total));
      chartMap[key].count += 1;
    }
  });
  sixMonthReturns.forEach((r) => {
    const key = formatWIB(r.createdAt, 'yyyy-MM');
    if (chartMap[key]) {
      chartMap[key].returnTotal = Math.round(chartMap[key].returnTotal + Number(r.refundAmount));
    }
  });
  const transactionChart = Object.values(chartMap).map((m) => ({
    ...m,
    netTotal: m.total - m.returnTotal,
  }));

  // Top 5 products (by transaction quantity this month, satuan dasar)
  const topProducts = await getTopProductsByBaseQty({
    status: { not: 'CANCELLED' },
    createdAt: { gte: monthStart, lte: monthEnd },
  }, 5);

  return {
    totalProducts,
    totalStockValue,
    monthlyTransaction: {
      total: monthlyTotal,
      count: monthlyTransactions.length,
      returnTotal: monthlyReturnTotal,
      returnCount: monthlyReturnAgg._count.id,
    },
    lowStockCount: lowStock.length,
    lowStockItems: lowStock.slice(0, 10), // Top 10 most critical
    activePOs,
    activeProjects,
    charts: {
      transactionTrend: transactionChart,
      topProducts,
    },
  };
};

module.exports = {
  getStockReport,
  getFinancialReport,
  getTrendReport,
  getLabaRugiReport,
  getDashboardSummary,
};
