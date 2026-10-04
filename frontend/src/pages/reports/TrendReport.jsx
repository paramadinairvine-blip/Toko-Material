import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { HiPrinter, HiDocumentDownload, HiTable, HiChevronLeft, HiChevronRight } from 'react-icons/hi';
import { reportAPI } from '../../api/endpoints';
import { Card, Button, Skeleton } from '../../components/common';
import { formatNumber } from '../../utils/formatCurrency';
import { exportTableToPDF } from '../../utils/exportPDF';
import { exportToExcel } from '../../utils/exportExcel';
import { STORE_INFO } from '../../utils/constants';
import { startOfMonthWIB, endOfMonthWIB } from '../../utils/formatDate';

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function getYears() {
  const current = new Date().getFullYear();
  return [current, current - 1, current - 2];
}

export default function TrendReport() {
  const printRef = useRef();
  const now = new Date();

  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const startDate = startOfMonthWIB(year, month);
  const endDate = endOfMonthWIB(year, month);
  const periodLabel = `${MONTHS[month]} ${year}`;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-trend', { year, month }],
    queryFn: async () => {
      const { data: res } = await reportAPI.getTrend({ startDate, endDate });
      return res.data;
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Laporan-Tren',
  });

  const allProducts = data?.topProducts || [];

  // Pagination
  const totalItems = allProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
  const startIdx = (page - 1) * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, totalItems);
  const paginated = allProducts.slice(startIdx, endIdx);

  // ─── Exports ────────────────────────────────────────
  const handleExportPDF = () => {
    const headers = ['No', 'Produk', 'Jumlah'];
    const rows = allProducts.map((r, i) => [i + 1, r.product?.name || '-', r.totalQuantity || 0]);
    exportTableToPDF('Laporan Tren Produk', headers, rows, 'laporan-tren.pdf', {
      subtitle: `Periode: ${periodLabel}`,
      columnStyles: ['center', 'left', 'right'],
    });
  };

  const handleExportExcel = () => {
    const headers = ['No', 'Produk', 'Jumlah'];
    const rows = allProducts.map((r, i) => [i + 1, r.product?.name || '-', Number(r.totalQuantity) || 0]);
    exportToExcel('Laporan Tren', headers, rows, 'laporan-tren.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Tren</h1>
          <p className="text-sm text-gray-500 mt-1">Produk paling banyak dikeluarkan per bulan</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>Cetak</Button>
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>PDF</Button>
          <Button variant="outline" size="sm" icon={HiTable} onClick={handleExportExcel}>Excel</Button>
        </div>
      </div>

      {/* Filter Bulan + Pagination Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Left: Filter Bulan */}
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => { setMonth(parseInt(e.target.value)); setPage(1); }}
            className="rounded-lg border border-gray-300 text-sm py-2 px-4 focus:border-blue-500 focus:ring-blue-500 bg-white"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => { setYear(parseInt(e.target.value)); setPage(1); }}
            className="rounded-lg border border-gray-300 text-sm py-2 px-4 focus:border-blue-500 focus:ring-blue-500 bg-white"
          >
            {getYears().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* Right: Pagination */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500 border border-gray-300 rounded-lg px-3 py-2 bg-white">Baris</span>
          <select
            value={rowsPerPage}
            onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}
            className="rounded-lg border border-gray-300 text-sm py-2 px-3 focus:border-blue-500 focus:ring-blue-500 bg-white"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span className="text-gray-600 border border-gray-300 rounded-lg px-3 py-2 bg-white">
            {totalItems === 0 ? '0' : `${startIdx + 1}-${endIdx}`} of {totalItems}
          </span>
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <HiChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white text-sm font-semibold">
            {page}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <HiChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {isError ? (
        <Card><p className="text-center text-red-500 py-8">Gagal memuat data laporan. Silakan coba lagi.</p></Card>
      ) : isLoading ? (
        <Skeleton.Table rows={10} cols={3} />
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-600 uppercase w-12">No</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Produk</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 uppercase w-32">Jumlah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginated.length > 0 ? (
                  paginated.map((item, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="text-center px-4 py-3 text-gray-500">{startIdx + idx + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.product?.name || '-'}</p>
                      </td>
                      <td className="text-right px-4 py-3 font-medium text-gray-900">
                        {item.totalQuantity || 0} <span className="text-xs text-gray-500">{item.product?.unit || 'pcs'}</span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="text-center py-12 text-gray-400">Belum ada data produk di bulan ini</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Hidden print content */}
      <div className="hidden">
        <div ref={printRef} className="p-8" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{STORE_INFO.NAME}</h2>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Laporan Tren Produk</h3>
            <p style={{ margin: 0, fontSize: '10px', color: '#666' }}>Periode: {periodLabel}</p>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                {['No', 'Produk', 'Jumlah'].map((h) => (
                  <th key={h} style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allProducts.map((r, i) => (
                <tr key={i}>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'center' }}>{i + 1}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.product?.name || '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.totalQuantity || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
