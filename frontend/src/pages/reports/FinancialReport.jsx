import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  HiCurrencyDollar, HiCash, HiOfficeBuilding,
  HiPrinter, HiDocumentDownload, HiTable, HiRefresh,
} from 'react-icons/hi';
import { reportAPI } from '../../api/endpoints';
import { Card, Button, Select, Loading, Table, Skeleton, CalendarPicker } from '../../components/common';
import { formatRupiah, formatNumber } from '../../utils/formatCurrency';
import { formatTanggal, startOfDayWIB, endOfDayWIB, todayWIB } from '../../utils/formatDate';
import { TRANSACTION_TYPE_LABELS, STORE_INFO } from '../../utils/constants';
import { exportTableToPDF } from '../../utils/exportPDF';
import { exportToExcel } from '../../utils/exportExcel';

// eslint-disable-next-line no-unused-vars
function StatCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    orange: { bg: 'bg-orange-50', icon: 'text-orange-600' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${c.bg}`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}

export default function FinancialReport() {
  const printRef = useRef();

  // Default: today
  const today = todayWIB();

  const [selectedDate, setSelectedDate] = useState(today);
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-financial', { date: selectedDate, type: typeFilter }],
    queryFn: async () => {
      const params = {};
      if (selectedDate) {
        params.startDate = startOfDayWIB(selectedDate);
        params.endDate = endOfDayWIB(selectedDate);
      }
      if (typeFilter) params.type = typeFilter;
      const { data: res } = await reportAPI.getFinancial(params);
      const raw = res.data;
      if (raw.summary) return raw;
      return { summary: {}, perCashier: [] };
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Laporan-Keuangan',
  });

  const typeOptions = [
    { value: '', label: 'Semua Tipe' },
    ...Object.entries(TRANSACTION_TYPE_LABELS)
      .map(([v, l]) => ({ value: v, label: l })),
  ];

  const summary = data?.summary || {};
  const perCashier = data?.perCashier || [];

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // ─── Per-Cashier table columns ─────────────────────────
  const cashierColumns = [
    {
      key: 'cashierName',
      header: 'Kasir',
      render: (v) => <span className="font-medium text-gray-900">{v}</span>,
    },
    {
      key: 'date',
      header: 'Tanggal',
      render: (v) => <span className="text-sm">{formatDate(v)}</span>,
    },
    {
      key: 'cashTotal',
      header: 'Tunai',
      render: (v) => <span className="text-green-600">{formatRupiah(v)}</span>,
    },
    {
      key: 'bonTotal',
      header: 'Overbooking TU',
      render: (v) => <span className="text-purple-600">{formatRupiah(v)}</span>,
    },
    {
      key: 'returnTotal',
      header: 'Retur',
      render: (v) => v > 0 ? <span className="text-red-600">-{formatRupiah(v)}</span> : <span className="text-gray-400">-</span>,
    },
    {
      key: 'netTotal',
      header: 'Total Bersih',
      render: (v) => <span className="font-bold text-gray-900">{formatRupiah(v)}</span>,
    },
    {
      key: 'transactionCount',
      header: 'Jml Trx',
      render: (v) => <span className="text-sm text-gray-600">{v}</span>,
    },
  ];

  // ─── Exports ────────────────────────────────────────
  const periodLabel = formatTanggal(selectedDate);

  const handleExportPDF = () => {
    const headers = ['Kasir', 'Tanggal', 'Tunai (Rp)', 'Overbooking TU (Rp)', 'Retur (Rp)', 'Total Bersih (Rp)', 'Jml Trx'];
    const rows = perCashier.map((r) => [
      r.cashierName, formatDate(r.date), formatNumber(r.cashTotal), formatNumber(r.bonTotal), formatNumber(r.returnTotal), formatNumber(r.netTotal), r.transactionCount,
    ]);
    exportTableToPDF('Rekap Pendapatan Kasir', headers, rows, 'rekap-kasir.pdf', {
      subtitle: `Periode: ${periodLabel}`,
      columnStyles: ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
    });
  };

  const handleExportExcel = () => {
    const headers = ['Kasir', 'Tanggal', 'Tunai (Rp)', 'Overbooking TU (Rp)', 'Retur (Rp)', 'Total Bersih (Rp)', 'Jml Trx'];
    const rows = perCashier.map((r) => [
      r.cashierName, formatDate(r.date), Number(r.cashTotal) || 0, Number(r.bonTotal) || 0, Number(r.returnTotal) || 0, Number(r.netTotal) || 0, Number(r.transactionCount) || 0,
    ]);
    exportToExcel('Rekap Kasir', headers, rows, 'rekap-kasir.xlsx');
  };

  // Summary totals for table footer
  const totalCash = perCashier.reduce((s, r) => s + r.cashTotal, 0);
  const totalBon = perCashier.reduce((s, r) => s + r.bonTotal, 0);
  const totalRetur = perCashier.reduce((s, r) => s + r.returnTotal, 0);
  const totalNet = perCashier.reduce((s, r) => s + r.netTotal, 0);
  const totalTrx = perCashier.reduce((s, r) => s + r.transactionCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Keuangan</h1>
          <p className="text-sm text-gray-500 mt-1">Rekap pendapatan kasir harian</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>Cetak</Button>
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>PDF</Button>
          <Button variant="outline" size="sm" icon={HiTable} onClick={handleExportExcel}>Excel</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal</label>
          <CalendarPicker
            mode="single"
            value={selectedDate}
            onChange={setSelectedDate}
          />
        </div>
        <div className="w-48">
          <Select
            label="Tipe Transaksi"
            value={typeFilter}
            onChange={setTypeFilter}
            options={typeOptions}
          />
        </div>
      </div>

      {isError ? (
        <Card><p className="text-center text-red-500 py-8">Gagal memuat data laporan. Silakan coba lagi.</p></Card>
      ) : isLoading ? (
        <>
          <Skeleton.Card count={3} />
          <Skeleton.Table rows={8} cols={7} />
        </>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard title="Total Pembelian (PO)" value={formatRupiah(summary.totalPurchase)} icon={HiCurrencyDollar} color="blue" />
            <StatCard title="Pendapatan Tunai" value={formatRupiah(summary.cashTotal)} icon={HiCash} color="green" />
            <StatCard title="Pendapatan Overbooking TU" value={formatRupiah(summary.bonTotal)} icon={HiOfficeBuilding} color="purple" />
            <StatCard title="Total Retur" value={formatRupiah(summary.totalReturn)} icon={HiRefresh} color="red" />
            <StatCard title="Pendapatan Bersih" value={formatRupiah(summary.netRevenue)} icon={HiCurrencyDollar} color="blue" />
          </div>

          {/* Per-Cashier Daily Table */}
          <Card title="Rekap Pendapatan Kasir Harian" padding="none">
            <Table columns={cashierColumns} data={perCashier} emptyMessage="Tidak ada data pendapatan" />
            {perCashier.length > 0 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-gray-700">TOTAL</span>
                  <div className="flex gap-6">
                    <span className="text-green-600 font-medium">{formatRupiah(totalCash)}</span>
                    <span className="text-purple-600 font-medium">{formatRupiah(totalBon)}</span>
                    {totalRetur > 0 && <span className="text-red-600 font-medium">-{formatRupiah(totalRetur)}</span>}
                    <span className="font-bold text-gray-900">{formatRupiah(totalNet)}</span>
                    <span className="text-gray-600">{totalTrx} trx</span>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Hidden print content */}
      <div className="hidden">
        <div ref={printRef} className="p-8" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{STORE_INFO.NAME}</h2>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Rekap Pendapatan Kasir</h3>
            <p style={{ margin: 0, fontSize: '10px', color: '#666' }}>Tanggal: {periodLabel}</p>
          </div>

          {/* Summary */}
          <table style={{ width: '100%', marginBottom: '16px', fontSize: '11px' }}>
            <tbody>
              <tr><td style={{ padding: '2px 0' }}><strong>Total Pembelian (PO):</strong> {formatRupiah(summary.totalPurchase)}</td></tr>
              <tr><td style={{ padding: '2px 0' }}><strong>Tunai:</strong> {formatRupiah(summary.cashTotal)} | <strong>Overbooking TU:</strong> {formatRupiah(summary.bonTotal)} | <strong>Retur:</strong> {formatRupiah(summary.totalReturn)}</td></tr>
              <tr><td style={{ padding: '2px 0' }}><strong>Pendapatan Bersih:</strong> {formatRupiah(summary.netRevenue)}</td></tr>
            </tbody>
          </table>

          <h4 style={{ marginBottom: '8px' }}>Rekap Kasir Harian</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '20px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                {['Kasir', 'Tanggal', 'Tunai', 'Overbooking TU', 'Retur', 'Total Bersih', 'Jml Trx'].map((h, i) => (
                  <th key={h} style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perCashier.map((r, i) => (
                <tr key={i}>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.cashierName}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{formatDate(r.date)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(r.cashTotal)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(r.bonTotal)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right', color: r.returnTotal > 0 ? '#dc2626' : '' }}>{r.returnTotal > 0 ? `-${formatRupiah(r.returnTotal)}` : '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right', fontWeight: 'bold' }}>{formatRupiah(r.netTotal)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.transactionCount}</td>
                </tr>
              ))}
              {perCashier.length > 0 && (
                <tr style={{ backgroundColor: '#f3f4f6', fontWeight: 'bold' }}>
                  <td colSpan={2} style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>TOTAL</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(totalCash)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(totalBon)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right', color: '#dc2626' }}>{totalRetur > 0 ? `-${formatRupiah(totalRetur)}` : '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(totalNet)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{totalTrx}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
