import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  HiCube, HiCurrencyDollar, HiExclamation,
  HiPrinter, HiDocumentDownload, HiTable,
} from 'react-icons/hi';
import { reportAPI, categoryAPI } from '../../api/endpoints';
import { Card, Badge, Button, Select, Loading, Table, Skeleton } from '../../components/common';
import { formatRupiah, formatNumber } from '../../utils/formatCurrency';
import { exportTableToPDF } from '../../utils/exportPDF';
import { exportToExcel } from '../../utils/exportExcel';
import { STORE_INFO } from '../../utils/constants';

// eslint-disable-next-line no-unused-vars
function StatCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    green: { bg: 'bg-green-50', icon: 'text-green-600' },
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`flex items-center justify-center w-11 h-11 rounded-xl ${c.bg}`}>
          <Icon className={`w-5 h-5 ${c.icon}`} />
        </div>
      </div>
    </div>
  );
}

export default function StockReport() {
  const printRef = useRef();
  const [categoryId, setCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => { const { data } = await categoryAPI.getAll(); return data.data; },
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-stock', { categoryId, lowStockOnly }],
    queryFn: async () => {
      const params = {};
      if (categoryId) params.categoryId = categoryId;
      if (lowStockOnly) params.lowStockOnly = true;
      const { data: res } = await reportAPI.getStock(params);
      return res.data;
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Laporan-Stok',
  });

  // Flatten categories for select
  const flatCats = [];
  const flatten = (cats, level = 0) => {
    for (const c of cats || []) {
      flatCats.push({ value: c.id, label: `${'— '.repeat(level)}${c.name}` });
      if (c.children?.length) flatten(c.children, level + 1);
    }
  };
  flatten(categories);

  const items = data?.items || [];
  const summary = data?.summary || {};

  const getStatusBadge = (item) => {
    if (item.stock <= 0) return <Badge variant="danger" size="sm">Habis</Badge>;
    if (item.stock < item.minStock) return <Badge variant="warning" size="sm">Rendah</Badge>;
    return <Badge variant="success" size="sm">Aman</Badge>;
  };

  const getStatusText = (item) => {
    if (item.stock <= 0) return 'Habis';
    if (item.stock < item.minStock) return 'Rendah';
    return 'Aman';
  };

  const columns = [
    {
      key: 'name', header: 'Produk', sortable: true,
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.name}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Kategori', render: (_, row) => row.category?.name || '-' },
    {
      key: 'stock', header: 'Stok', sortable: true,
      render: (_, row) => (
        <span className={`font-semibold ${row.stock <= 0 ? 'text-red-600' : row.stock < row.minStock ? 'text-yellow-600' : 'text-gray-900'}`}>
          {row.stock}
        </span>
      ),
    },
    { key: 'unit', header: 'Satuan', render: (_, row) => row.unitOfMeasure?.abbreviation || row.unit || '-' },
    { key: 'minStock', header: 'Stok Min.' },
    { key: 'status', header: 'Status', render: (_, row) => getStatusBadge(row) },
    {
      key: 'stockValue', header: 'Nilai Stok',
      render: (_, row) => formatRupiah(row.stockValue || (row.stock * (row.buyPrice || 0))),
    },
  ];

  // ─── Export helpers ─────────────────────────────────
  // forExcel: keep numbers as numbers so Excel can sum them
  const getExportData = (forExcel = false) => {
    const headers = ['Produk', 'SKU', 'Kategori', 'Stok', 'Satuan', 'Stok Min.', 'Status', 'Nilai Stok (Rp)'];
    const rows = items.map((r) => [
      r.name,
      r.sku,
      r.category?.name || '-',
      r.stock,
      r.unitOfMeasure?.abbreviation || r.unit || '-',
      r.minStock,
      getStatusText(r),
      forExcel
        ? Number(r.stockValue || (r.stock * (r.buyPrice || 0))) || 0
        : formatNumber(r.stockValue || (r.stock * (r.buyPrice || 0))),
    ]);
    return { headers, rows };
  };

  const handleExportPDF = () => {
    const { headers, rows } = getExportData();
    const subtitle = lowStockOnly ? 'Filter: Stok Rendah Saja' : categoryId ? `Kategori: ${flatCats.find((c) => c.value === categoryId)?.label || ''}` : '';
    exportTableToPDF('Laporan Stok Barang', headers, rows, 'laporan-stok.pdf', {
      subtitle,
      columnStyles: ['left', 'left', 'left', 'right', 'center', 'right', 'center', 'right'],
    });
  };

  const handleExportExcel = () => {
    const { headers, rows } = getExportData(true);
    exportToExcel('Laporan Stok', headers, rows, 'laporan-stok.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Laporan Stok</h1>
          <p className="text-sm text-gray-500 mt-1">Laporan posisi stok barang</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>Cetak</Button>
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>PDF</Button>
          <Button variant="outline" size="sm" icon={HiTable} onClick={handleExportExcel}>Excel</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-64">
          <Select
            label="Kategori"
            value={categoryId}
            onChange={setCategoryId}
            options={flatCats}
            placeholder="Semua Kategori"
            searchable
          />
        </div>
        <label className="flex items-center gap-2 cursor-pointer pb-1">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Tampilkan stok rendah saja</span>
        </label>
      </div>

      {/* Summary & Table */}
      {isError ? (
        <Card><p className="text-center text-red-500 py-8">Gagal memuat data laporan. Silakan coba lagi.</p></Card>
      ) : isLoading ? (
        <>
          <Skeleton.Card count={3} />
          <Skeleton.Table rows={8} cols={5} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard title="Total Produk" value={summary.totalProducts || items.length} icon={HiCube} color="blue" />
            <StatCard title="Total Nilai Stok" value={formatRupiah(summary.totalStockValue)} icon={HiCurrencyDollar} color="green" />
            <StatCard title="Stok Rendah" value={summary.lowStockCount || 0} icon={HiExclamation} color="red" />
          </div>

          <Table columns={columns} data={items} sortable emptyMessage="Tidak ada data stok" />
        </>
      )}

      {/* Hidden print content */}
      <div className="hidden">
        <div ref={printRef} className="p-8" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{STORE_INFO.NAME}</h2>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Laporan Stok Barang</h3>
            <p style={{ margin: 0, fontSize: '10px', color: '#666' }}>
              Dicetak: {new Date().toLocaleDateString('id-ID')}
              {lowStockOnly ? ' | Filter: Stok Rendah' : ''}
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                {['No', 'Produk', 'SKU', 'Kategori', 'Stok', 'Satuan', 'Min.', 'Status', 'Nilai Stok'].map((h) => (
                  <th key={h} style={{ border: '1px solid #d1d5db', padding: '4px 6px', textAlign: 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={r.id || i}>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{i + 1}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.name}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.sku}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.category?.name || '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.stock}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.unitOfMeasure?.abbreviation || r.unit || '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.minStock}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{getStatusText(r)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{formatRupiah(r.stockValue || (r.stock * (r.buyPrice || 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
