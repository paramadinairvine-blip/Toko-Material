import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  HiCurrencyDollar, HiCash, HiTrendingUp, HiChartPie,
  HiPrinter, HiDocumentDownload, HiTable,
} from 'react-icons/hi';
import { reportAPI } from '../../api/endpoints';
import { Card, Button, Skeleton, CalendarPicker } from '../../components/common';
import { formatRupiah, formatNumber } from '../../utils/formatCurrency';
import { formatTanggal, startOfDayWIB, endOfDayWIB, todayWIB } from '../../utils/formatDate';
import { STORE_INFO } from '../../utils/constants';
import { exportTableToPDF } from '../../utils/exportPDF';
import { exportToExcel } from '../../utils/exportExcel';

function StatCard({ title, value, subtitle, icon: Icon, color }) {
  const colorMap = {
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${c.bg}`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}

function PLRow({ label, value, bold, indent, negative, border }) {
  return (
    <div className={`flex items-center justify-between px-5 py-2.5 ${border ? 'border-t border-gray-200' : ''} ${bold ? 'bg-gray-50' : ''}`}>
      <span className={`text-sm ${indent ? 'pl-6' : ''} ${bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>
        {label}
      </span>
      <span className={`text-sm font-medium ${negative ? 'text-red-600' : bold ? 'font-bold text-gray-900' : 'text-gray-900'}`}>
        {negative && value !== 'Rp 0' ? `(${value})` : value}
      </span>
    </div>
  );
}

export default function ProfitLossReport() {
  const printRef = useRef();
  const today = todayWIB();

  const [selectedDate, setSelectedDate] = useState(today);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-laba-rugi', { date: selectedDate }],
    queryFn: async () => {
      const params = {};
      if (selectedDate) {
        params.startDate = startOfDayWIB(selectedDate);
        params.endDate = endOfDayWIB(selectedDate);
      }
      const { data: res } = await reportAPI.getLabaRugi(params);
      const raw = res.data;
      if (raw.summary) return raw;
      return { summary: {}, hppByCategory: [], topMarginProducts: [], lowMarginProducts: [] };
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Laporan-Laba-Rugi',
  });

  const summary = data?.summary || {};
  const hppByCategory = data?.hppByCategory || [];
  const topMarginProducts = data?.topMarginProducts || [];
  const lowMarginProducts = data?.lowMarginProducts || [];

  const periodLabel = formatTanggal(selectedDate);

  // ─── Export: HPP per Kategori ──────────────────────
  const handleExportPDF = () => {
    const headers = ['Kategori', 'HPP (Rp)', '% dari Total HPP'];
    const rows = hppByCategory.map((c) => [
      c.categoryName, formatNumber(c.totalHPP), `${c.percentage}%`,
    ]);
    rows.push(['TOTAL', formatNumber(summary.totalHPP || 0), '100%']);
    exportTableToPDF('Laporan Laba Rugi', headers, rows, 'laba-rugi.pdf', {
      subtitle: `Periode: ${periodLabel}`,
      columnStyles: ['left', 'right', 'right'],
    });
  };

  const handleExportExcel = () => {
    const headers = ['Komponen', 'Nilai (Rp)'];
    const rows = [
      ['Penjualan Tunai', Number(summary.cashRevenue) || 0],
      ['Penjualan Bon', Number(summary.bonRevenue) || 0],
      ['Retur Penjualan', -(Number(summary.totalReturn) || 0)],
      ['Pendapatan Bersih', Number(summary.netRevenue) || 0],
      [''],
      ['Harga Pokok Penjualan (HPP)', -(Number(summary.totalHPP) || 0)],
      [''],
      ['LABA KOTOR', Number(summary.grossProfit) || 0],
      ['Margin Laba Kotor (%)', `${summary.grossMarginPercent || 0}%`],
      [''],
      ['--- HPP per Kategori ---'],
      ...hppByCategory.map((c) => [c.categoryName, Number(c.totalHPP) || 0]),
    ];
    exportToExcel('Laba Rugi', headers, rows, 'laba-rugi.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Laba Rugi</h1>
          <p className="text-sm text-gray-500 mt-1">Pendapatan vs Harga Pokok Penjualan</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>Cetak</Button>
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>PDF</Button>
          <Button variant="outline" size="sm" icon={HiTable} onClick={handleExportExcel}>Excel</Button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tanggal</label>
          <CalendarPicker
            mode="single"
            value={selectedDate}
            onChange={setSelectedDate}
          />
        </div>
      </div>

      {isError ? (
        <Card><p className="text-center text-red-500 py-8">Gagal memuat data laporan. Silakan coba lagi.</p></Card>
      ) : isLoading ? (
        <>
          <Skeleton.Card count={4} />
          <Skeleton.Table rows={6} cols={2} />
        </>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Pendapatan Bersih" value={formatRupiah(summary.netRevenue)} icon={HiCash} color="green" />
            <StatCard title="HPP" value={formatRupiah(summary.totalHPP)} subtitle="Harga Pokok Penjualan" icon={HiCurrencyDollar} color="red" />
            <StatCard
              title="Laba Kotor"
              value={formatRupiah(summary.grossProfit)}
              icon={HiTrendingUp}
              color={summary.grossProfit >= 0 ? 'blue' : 'red'}
            />
            <StatCard title="Margin Laba Kotor" value={`${summary.grossMarginPercent || 0}%`} icon={HiChartPie} color="purple" />
          </div>

          {/* Tabel Laba Rugi */}
          <Card title="Laporan Laba Rugi" padding="none">
            <div className="divide-y divide-gray-100">
              {/* Pendapatan */}
              <div className="px-5 py-2.5 bg-gray-50">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Pendapatan</span>
              </div>
              <PLRow label="Penjualan Tunai" value={formatRupiah(summary.cashRevenue)} indent />
              <PLRow label="Penjualan Bon (Overbooking TU)" value={formatRupiah(summary.bonRevenue)} indent />
              <PLRow label="Retur Penjualan" value={formatRupiah(summary.totalReturn)} indent negative />
              <PLRow label="Total Pendapatan Bersih" value={formatRupiah(summary.netRevenue)} bold border />

              {/* HPP */}
              <div className="px-5 py-2.5 bg-gray-50 mt-1">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Harga Pokok Penjualan</span>
              </div>
              <PLRow label="Modal Barang Terjual" value={formatRupiah(summary.totalHPP)} indent negative />
              <PLRow label="Total HPP" value={formatRupiah(summary.totalHPP)} bold border negative />

              {/* Laba Kotor */}
              <div className="px-5 py-3 bg-blue-50 border-t-2 border-blue-200">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-blue-900">LABA KOTOR</span>
                  <span className={`text-base font-bold ${summary.grossProfit >= 0 ? 'text-blue-900' : 'text-red-600'}`}>
                    {formatRupiah(summary.grossProfit)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-blue-600">Margin Laba Kotor</span>
                  <span className="text-xs font-medium text-blue-600">{summary.grossMarginPercent || 0}%</span>
                </div>
              </div>
            </div>
          </Card>

          {/* HPP per Kategori */}
          {hppByCategory.length > 0 && (
            <Card title="HPP per Kategori" padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-5 py-3 font-medium text-gray-500">Kategori</th>
                      <th className="px-5 py-3 font-medium text-gray-500 text-right">HPP</th>
                      <th className="px-5 py-3 font-medium text-gray-500 text-right">Pendapatan</th>
                      <th className="px-5 py-3 font-medium text-gray-500 text-right">% HPP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {hppByCategory.map((cat, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-5 py-2.5 font-medium text-gray-900">{cat.categoryName}</td>
                        <td className="px-5 py-2.5 text-right text-red-600">{formatRupiah(cat.totalHPP)}</td>
                        <td className="px-5 py-2.5 text-right text-green-600">{formatRupiah(cat.totalRevenue)}</td>
                        <td className="px-5 py-2.5 text-right text-gray-600">{cat.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-bold">
                      <td className="px-5 py-2.5 text-gray-900">TOTAL</td>
                      <td className="px-5 py-2.5 text-right text-red-600">{formatRupiah(summary.totalHPP)}</td>
                      <td className="px-5 py-2.5 text-right text-green-600">{formatRupiah(summary.cashRevenue + summary.bonRevenue)}</td>
                      <td className="px-5 py-2.5 text-right text-gray-600">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}

          {/* Top Margin & Low Margin */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Margin */}
            {topMarginProducts.length > 0 && (
              <Card title="Top 5 Margin Tertinggi" padding="none">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-2.5 font-medium text-gray-500">Produk</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Beli</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Jual</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Margin</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {topMarginProducts.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-900 max-w-[180px] truncate">{p.productName}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{formatRupiah(p.buyPrice)}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{formatRupiah(p.sellPrice)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              {p.marginPercent}%
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600">{p.totalQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Low Margin */}
            {lowMarginProducts.length > 0 && (
              <Card title="Top 5 Margin Terendah" padding="none">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-2.5 font-medium text-gray-500">Produk</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Beli</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Jual</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Margin</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-right">Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lowMarginProducts.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-900 max-w-[180px] truncate">{p.productName}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{formatRupiah(p.buyPrice)}</td>
                          <td className="px-4 py-2 text-right text-gray-600">{formatRupiah(p.sellPrice)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.marginPercent < 10 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                            }`}>
                              {p.marginPercent}%
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600">{p.totalQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </>
      )}

      {/* Hidden print content */}
      <div className="hidden">
        <div ref={printRef} className="p-8" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{STORE_INFO.NAME}</h2>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Laporan Laba Rugi</h3>
            <p style={{ margin: 0, fontSize: '10px', color: '#666' }}>Tanggal: {periodLabel}</p>
          </div>

          {/* P&L Statement */}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '20px' }}>
            <tbody>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                <td colSpan={2} style={{ padding: '6px 8px', fontWeight: 'bold', fontSize: '11px' }}>PENDAPATAN</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px 4px 24px' }}>Penjualan Tunai</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{formatRupiah(summary.cashRevenue)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px 4px 24px' }}>Penjualan Bon (Overbooking TU)</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>{formatRupiah(summary.bonRevenue)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px 4px 24px', color: '#dc2626' }}>Retur Penjualan</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#dc2626' }}>({formatRupiah(summary.totalReturn)})</td>
              </tr>
              <tr style={{ borderTop: '1px solid #d1d5db', fontWeight: 'bold' }}>
                <td style={{ padding: '6px 8px' }}>Total Pendapatan Bersih</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatRupiah(summary.netRevenue)}</td>
              </tr>

              <tr><td colSpan={2} style={{ padding: '4px' }}></td></tr>

              <tr style={{ backgroundColor: '#f3f4f6' }}>
                <td colSpan={2} style={{ padding: '6px 8px', fontWeight: 'bold', fontSize: '11px' }}>HARGA POKOK PENJUALAN</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 8px 4px 24px', color: '#dc2626' }}>Modal Barang Terjual</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#dc2626' }}>({formatRupiah(summary.totalHPP)})</td>
              </tr>

              <tr><td colSpan={2} style={{ padding: '4px' }}></td></tr>

              <tr style={{ borderTop: '2px solid #2563eb', backgroundColor: '#eff6ff' }}>
                <td style={{ padding: '8px', fontWeight: 'bold', fontSize: '13px' }}>LABA KOTOR</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', fontSize: '13px' }}>{formatRupiah(summary.grossProfit)}</td>
              </tr>
              <tr style={{ backgroundColor: '#eff6ff' }}>
                <td style={{ padding: '4px 8px', fontSize: '10px', color: '#2563eb' }}>Margin Laba Kotor</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontSize: '10px', color: '#2563eb' }}>{summary.grossMarginPercent || 0}%</td>
              </tr>
            </tbody>
          </table>

          {/* HPP per Kategori */}
          {hppByCategory.length > 0 && (
            <>
              <h4 style={{ marginBottom: '8px' }}>HPP per Kategori</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', marginBottom: '20px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6' }}>
                    {['Kategori', 'HPP', 'Pendapatan', '% HPP'].map((h, i) => (
                      <th key={h} style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hppByCategory.map((cat, i) => (
                    <tr key={i}>
                      <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{cat.categoryName}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(cat.totalHPP)}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(cat.totalRevenue)}</td>
                      <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{cat.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
