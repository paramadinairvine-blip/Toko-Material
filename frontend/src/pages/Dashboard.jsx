import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HiCube,
  HiCurrencyDollar,
  HiShoppingCart,
  HiExclamation,
  HiCalendar,
} from 'react-icons/hi';
import {
  PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer as PieContainer, Legend,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar,
} from 'recharts';
import { reportAPI } from '../api/endpoints';
import { Card } from '../components/common';
import { formatRupiah } from '../utils/formatCurrency';
import useAuth from '../hooks/useAuth';
import { ROLES } from '../utils/constants';
import { startOfMonthWIB, endOfMonthWIB } from '../utils/formatDate';

// ─── Helpers ──────────────────────────────────────────
const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#6366f1'];

function getYears() {
  const current = new Date().getFullYear();
  return [current, current - 1, current - 2];
}

// ─── Skeleton ─────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

function StatCardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-12 w-12 rounded-xl" />
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
function StatCard({ title, value, subtitle, icon: Icon, color }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
  };
  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
        </div>
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${c.bg}`}>
          <Icon className={`w-6 h-6 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}

// ─── Custom Tooltips ──────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
      <p className="text-sm font-medium text-gray-900 mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-sm" style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{formatRupiah(p.value)}</span>
        </p>
      ))}
    </div>
  );
};

const PieChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
      <p className="text-sm font-medium text-gray-900">{d.name}</p>
      <p className="text-sm text-gray-600">{formatRupiah(d.value)}</p>
    </div>
  );
};

// ─── Dashboard ────────────────────────────────────────
export default function Dashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [year, setYear] = useState(now.getFullYear());
  const { role } = useAuth();
  const canViewFinancial = role === ROLES.ADMIN || role === ROLES.VIEWER;

  // The month selector (ADMIN/VIEWER) also drives the dashboard summary. For the
  // current month no params are sent, so the server uses its own month range.
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();
  const useSelectedMonth = canViewFinancial && !isCurrentMonth;

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard', useSelectedMonth ? `${year}-${month}` : 'current'],
    queryFn: async () => {
      const { data } = await reportAPI.getDashboard(
        useSelectedMonth
          ? { startDate: startOfMonthWIB(year, month), endDate: endOfMonthWIB(year, month) }
          : undefined
      );
      return data.data;
    },
    refetchInterval: 30000,
    // Keep showing the previous month while the newly selected one loads
    placeholderData: (prev) => prev,
  });

  // Trend report for selected period (only for ADMIN/VIEWER)
  const { data: trendData } = useQuery({
    queryKey: ['trend-dashboard', year, month],
    queryFn: async () => {
      const { data } = await reportAPI.getTrend({
        startDate: startOfMonthWIB(year, month),
        endDate: endOfMonthWIB(year, month),
      });
      return data.data;
    },
    enabled: canViewFinancial,
  });

  // Financial report for selected month (only for ADMIN/VIEWER)
  const { data: financialData } = useQuery({
    queryKey: ['financial-dashboard', year, month],
    queryFn: async () => {
      const { data } = await reportAPI.getFinancial({
        startDate: startOfMonthWIB(year, month),
        endDate: endOfMonthWIB(year, month),
      });
      return data.data;
    },
    enabled: canViewFinancial,
  });

  const d = dashboard || {};

  // ─── Prepare Pie Chart Data (Pendapatan per Tipe) ───
  const pieData = (financialData?.expenditureByType || [])
    .filter((e) => e.total > 0)
    .map((e) => ({ name: e.label, value: e.total }));

  // ─── Prepare Line Chart Data (Grafik Penjualan 3 bulan) ───
  const transactionTrend = d.charts?.transactionTrend || [];
  const salesChartData = transactionTrend.map((t) => ({
    label: t.label,
    total: t.netTotal ?? t.total,
    count: t.count,
  }));

  // ─── Top Products Bar Chart ─────────────────────────
  const topProducts = (d.charts?.topProducts || []).map((tp) => ({
    name: tp.product?.name?.substring(0, 15) || '-',
    qty: tp.totalQuantity || 0,
    value: tp.totalValue || 0,
  }));

  // ─── Prepare Daily Revenue Chart Data ────────────────
  const dailyRevenueData = (() => {
    const perCashier = financialData?.perCashier || [];
    // Group by date, sum all cashiers
    const dailyMap = {};
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      dailyMap[dateStr] = { date: dateStr, day: i, total: 0 };
    }
    perCashier.forEach((row) => {
      if (dailyMap[row.date]) {
        dailyMap[row.date].total += row.netTotal || 0;
      }
    });
    return Object.values(dailyMap).sort((a, b) => a.day - b.day);
  })();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <StatCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border rounded-xl p-6"><Skeleton className="h-72 w-full" /></div>
          <div className="bg-white border rounded-xl p-6"><Skeleton className="h-72 w-full" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Date Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Ringkasan sistem inventori</p>
        </div>
        {canViewFinancial && (
          <div className="flex items-center gap-2">
            <HiCalendar className="w-5 h-5 text-gray-400" />
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="rounded-lg border-gray-300 text-sm py-2 px-3 focus:border-blue-500 focus:ring-blue-500"
            >
              {MONTHS.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="rounded-lg border-gray-300 text-sm py-2 px-3 focus:border-blue-500 focus:ring-blue-500"
            >
              {getYears().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Row 1: Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Produk Aktif"
          value={d.totalProducts?.toLocaleString('id-ID') || '0'}
          icon={HiCube}
          color="blue"
        />
        <StatCard
          title="Nilai Total Stok"
          value={formatRupiah(d.totalStockValue)}
          icon={HiCurrencyDollar}
          color="green"
        />
        <StatCard
          title={useSelectedMonth ? `Transaksi ${MONTHS[month]} ${year}` : 'Transaksi Bulan Ini'}
          value={d.monthlyTransaction?.count?.toLocaleString('id-ID') || '0'}
          subtitle={formatRupiah(d.monthlyTransaction?.total)}
          icon={HiShoppingCart}
          color="purple"
        />
        <StatCard
          title="Produk Stok Minimum"
          value={d.lowStockCount || 0}
          subtitle={d.lowStockCount > 0 ? 'Perlu restock segera' : 'Semua aman'}
          icon={HiExclamation}
          color="red"
        />
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pendapatan per Tipe Transaksi — only ADMIN/VIEWER */}
        {canViewFinancial ? (
          <Card>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                Pendapatan {MONTHS[month]} {year}
              </h3>
              <p className="text-sm text-gray-500">Per Tipe Transaksi</p>
            </div>
            {pieData.length > 0 ? (
              <PieContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={0}
                    dataKey="value"
                    label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
                    labelLine={true}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <PieTooltip content={<PieChartTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={10}
                    formatter={(value) => <span className="text-sm text-gray-600">{value}</span>}
                  />
                </PieChart>
              </PieContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                Belum ada data pendapatan di bulan ini
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">Top 5 Produk</h3>
              <p className="text-sm text-gray-500">Paling banyak dikeluarkan bulan ini</p>
            </div>
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{d.name}</p>
                          <p className="text-sm text-blue-600">Qty: {d.qty}</p>
                          <p className="text-sm text-green-600">Nilai: {formatRupiah(d.value)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="qty" fill="#3b82f6" radius={[0, 6, 6, 0]} maxBarSize={30}>
                    {topProducts.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                Belum ada data produk bulan ini
              </div>
            )}
          </Card>
        )}

        {/* Grafik Penjualan (Tren 6 Bulan) */}
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-gray-900">Grafik Penjualan</h3>
            <p className="text-sm text-gray-500">Per 6 bulan terakhir</p>
          </div>
          {salesChartData.some((d) => d.total > 0) ? (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={salesChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(0)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}rb` : v}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Total Penjualan"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
              Belum ada data penjualan
            </div>
          )}
        </Card>
      </div>

      {/* Row 3: Pendapatan + Top Produk (role-based) */}
      {canViewFinancial && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pendapatan summary — only ADMIN/VIEWER */}
          <Card>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                Ringkasan Pendapatan
              </h3>
              <p className="text-sm text-gray-500">{MONTHS[month]} {year}</p>
            </div>
            <div className="space-y-4">
              {(financialData?.expenditureByType || []).map((item, idx) => {
                const totalAll = financialData?.totalExpenditure || 1;
                const pct = totalAll > 0 ? ((item.total / totalAll) * 100).toFixed(1) : 0;
                return (
                  <div key={idx}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <span className="text-gray-700 font-medium">{item.label}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">{pct}%</span>
                        <span className="font-semibold text-gray-900">{formatRupiah(item.total)}</span>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: COLORS[idx % COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 mt-3 border-t border-gray-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Total Pendapatan</span>
                <span className="text-lg font-bold text-gray-900">
                  {formatRupiah(financialData?.totalExpenditure || 0)}
                </span>
              </div>
              {trendData?.periodComparison && (
                <div className="flex items-center gap-2 text-sm">
                  <span className={`font-medium ${trendData.periodComparison.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                    {trendData.periodComparison.direction === 'up' ? '▲' : '▼'}{' '}
                    {Math.abs(trendData.periodComparison.changePercent)}%
                  </span>
                  <span className="text-gray-500">dibanding periode sebelumnya</span>
                </div>
              )}
            </div>
          </Card>

          {/* Top Produk */}
          <Card>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-900">Top 5 Produk</h3>
              <p className="text-sm text-gray-500">Paling banyak dikeluarkan bulan ini</p>
            </div>
            {topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProducts} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                    width={120}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{d.name}</p>
                          <p className="text-sm text-blue-600">Qty: {d.qty}</p>
                          <p className="text-sm text-green-600">Nilai: {formatRupiah(d.value)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="qty" fill="#3b82f6" radius={[0, 6, 6, 0]} maxBarSize={30}>
                    {topProducts.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-gray-400 text-sm">
                Belum ada data produk bulan ini
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Row 4: Pendapatan Harian */}
      {canViewFinancial && (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-gray-900">
              Pendapatan Harian {MONTHS[month]} {year}
            </h3>
            <p className="text-sm text-gray-500">Nominal pendapatan per tanggal</p>
          </div>
          {dailyRevenueData.some((d) => d.total > 0) ? (
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={dailyRevenueData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  label={{ value: 'Tanggal', position: 'insideBottom', offset: -2, fontSize: 12, fill: '#9ca3af' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(0)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}rb` : v}
                  label={{ value: 'Nominal Pendapatan', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12, fill: '#9ca3af' }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3">
                        <p className="text-sm font-bold text-gray-900 mb-1">Tanggal {label}</p>
                        <p className="text-sm text-blue-600">
                          Pendapatan: <span className="font-semibold">{formatRupiah(data.total)}</span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Pendapatan"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                  activeDot={{ r: 6, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[350px] text-gray-400 text-sm">
              Belum ada data pendapatan di bulan ini
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
