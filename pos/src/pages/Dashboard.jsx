import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HiCash, HiShoppingCart, HiCube, HiExclamation, HiRefresh, HiDatabase, HiClipboardList } from 'react-icons/hi';
import { reportAPI, transactionAPI, returnAPI } from '../api/endpoints';
import { formatRupiah } from '../utils/formatCurrency';
import { formatTanggalPanjang, startOfDayWIB, endOfDayWIB } from '../utils/formatDate';
import { Loading } from '../components/common';
import CalendarPicker from '../components/common/CalendarPicker';

// Helper: format date to YYYY-MM-DD for input[type="date"]
const toDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Default dates: today → today
const getDefaultStartDate = () => toDateString(new Date());
const getDefaultEndDate = () => toDateString(new Date());

export default function Dashboard() {
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());
  const [appliedStart, setAppliedStart] = useState(getDefaultStartDate());
  const [appliedEnd, setAppliedEnd] = useState(getDefaultEndDate());

  const isCustomFilter = useMemo(() => {
    return appliedStart !== getDefaultStartDate() || appliedEnd !== getDefaultEndDate();
  }, [appliedStart, appliedEnd]);

  // Fetch general dashboard data (products, stock, POs)
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportAPI.getDashboard(),
    select: (res) => res.data.data || {},
    refetchInterval: 30000,
  });

  // Fetch transactions filtered by date — this is the source of truth for count & total
  // Gunakan WIB (UTC+7) secara eksplisit
  const startISO = useMemo(() => startOfDayWIB(appliedStart), [appliedStart]);
  const endISO = useMemo(() => endOfDayWIB(appliedEnd), [appliedEnd]);

  const { data: filteredTx, isLoading: txLoading, refetch: refetchTx } = useQuery({
    queryKey: ['dashboard-transactions', appliedStart, appliedEnd],
    // Only COMPLETED transactions (exclude cancelled), summed across all pages
    queryFn: async () => {
      const limit = 500;
      let page = 1;
      let total = 0;
      let count = 0;
      for (;;) {
        const res = await transactionAPI.getAll({
          startDate: startISO, endDate: endISO, status: 'COMPLETED', page, limit,
        });
        const list = res.data.data || [];
        total += list.reduce((sum, trx) => sum + (parseFloat(trx.total) || 0), 0);
        const pagination = res.data.pagination;
        count = pagination?.total ?? count + list.length;
        if (!pagination?.hasNextPage || list.length === 0) break;
        page += 1;
      }
      return { count, total };
    },
    refetchInterval: 30000,
  });

  const { data: returData, isLoading: returLoading, refetch: refetchRetur } = useQuery({
    queryKey: ['dashboard-returns', appliedStart, appliedEnd],
    queryFn: () => returnAPI.getAll({ startDate: startISO, endDate: endISO, limit: 500 }),
    select: (res) => {
      // Retur dari transaksi yang sudah dibatalkan tidak dihitung lagi
      const list = (res.data.data || []).filter((r) => r.transaction?.status !== 'CANCELLED');
      const totalRetur = list.reduce((sum, r) => sum + (parseFloat(r.refundAmount) || 0), 0);
      return { totalRetur, count: list.length };
    },
    refetchInterval: 30000,
  });

  const isLoading = dashLoading || txLoading || returLoading;

  const refetch = () => {
    refetchDash();
    refetchTx();
    refetchRetur();
  };

  const handleApply = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    setAppliedStart(start);
    setAppliedEnd(end);
  };

  const handleReset = () => {
    const defStart = getDefaultStartDate();
    const defEnd = getDefaultEndDate();
    setStartDate(defStart);
    setEndDate(defEnd);
    setAppliedStart(defStart);
    setAppliedEnd(defEnd);
  };

  // Transaction count & total from filtered transactions API
  const txCount = filteredTx?.count || 0;
  const txTotal = filteredTx?.total || 0;
  const totalRetur = returData?.totalRetur || 0;
  const netRevenue = txTotal - totalRetur;

  const transLabel = 'Transaksi';
  const incomeLabel = 'Pendapatan Bersih';
  const topProductLabel = 'Produk Terlaris';

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto bg-gray-50">
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Dashboard Kasir</h2>
            <p className="text-sm text-gray-500">{formatTanggalPanjang(new Date())}</p>
          </div>
          <button
            onClick={refetch}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Refresh"
          >
            <HiRefresh className="w-5 h-5" />
          </button>
        </div>

        {/* Date Filter */}
        <CalendarPicker
          mode="range"
          dateFrom={appliedStart}
          dateTo={appliedEnd}
          onChange={handleApply}
        />

        {isLoading ? (
          <Loading text="Memuat dashboard..." />
        ) : (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiShoppingCart className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{transLabel}</p>
                    <p className="text-lg font-bold text-gray-900">{txCount}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiCash className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{incomeLabel}</p>
                    <p className="text-lg font-bold text-gray-900">{formatRupiah(netRevenue)}</p>
                    {totalRetur > 0 && (
                      <p className="text-xs text-red-500">Retur: -{formatRupiah(totalRetur)}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiCube className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Total Produk</p>
                    <p className="text-lg font-bold text-gray-900">{dashboard?.totalProducts || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiExclamation className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Stok Rendah</p>
                    <p className="text-lg font-bold text-gray-900">{dashboard?.lowStockCount || 0}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Extra info cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiDatabase className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Nilai Stok</p>
                    <p className="text-lg font-bold text-gray-900">{formatRupiah(dashboard?.totalStockValue || 0)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HiClipboardList className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">PO Aktif</p>
                    <p className="text-lg font-bold text-gray-900">{dashboard?.activePOs || 0}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Top Products */}
            {dashboard?.charts?.topProducts && dashboard.charts.topProducts.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="font-semibold text-gray-900 mb-3">{topProductLabel}</h3>
                <div className="space-y-2">
                  {dashboard.charts.topProducts.map((item) => (
                    <div key={item.product?.id || item.rank} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-400 w-5">#{item.rank}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{item.product?.name || '-'}</p>
                          <p className="text-xs text-gray-500">{item.totalQuantity} {item.product?.unit || 'pcs'} terjual</p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{formatRupiah(item.totalValue)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Low Stock Alert */}
            {dashboard?.lowStockItems && dashboard.lowStockItems.length > 0 && (
              <div className="bg-white rounded-xl border border-red-200 p-4">
                <h3 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
                  <HiExclamation className="w-5 h-5" />
                  Produk Stok Rendah
                </h3>
                <div className="space-y-2">
                  {dashboard.lowStockItems.map((product) => (
                    <div key={product.id} className="flex justify-between items-center py-1.5">
                      <div>
                        <span className="text-sm text-gray-700">{product.name}</span>
                        <span className="text-xs text-gray-400 ml-2">(min: {product.minStock})</span>
                      </div>
                      <span className="text-sm font-semibold text-red-600">
                        {product.stock} {product.unit || 'pcs'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <p className="text-center text-xs text-gray-400 py-4">
          Data diperbarui otomatis setiap 60 detik
        </p>
      </div>
    </div>
  );
}
