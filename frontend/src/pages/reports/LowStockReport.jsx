import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import {
  HiExclamation, HiCube,
  HiPrinter, HiDocumentDownload, HiTable,
} from 'react-icons/hi';
import { reportAPI } from '../../api/endpoints';
import { Badge, Button, Loading, Table, Skeleton } from '../../components/common';
import { exportTableToPDF } from '../../utils/exportPDF';
import { exportToExcel } from '../../utils/exportExcel';
import { STORE_INFO } from '../../utils/constants';

// eslint-disable-next-line no-unused-vars
function StatCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    red: { bg: 'bg-red-50', icon: 'text-red-600' },
    yellow: { bg: 'bg-yellow-50', icon: 'text-yellow-600' },
    blue: { bg: 'bg-blue-50', icon: 'text-blue-600' },
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

// API mengirim kategori sebagai teks; data lama bisa berupa objek
const getCategoryName = (item) =>
  (typeof item.category === 'string' ? item.category : item.category?.name) || '-';

export default function LowStockReport() {
  const printRef = useRef();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['report-low-stock'],
    queryFn: async () => {
      const { data: res } = await reportAPI.getStock({ lowStockOnly: true });
      return res.data;
    },
  });

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: 'Laporan-Stok-Rendah',
  });

  const items = data?.items || [];

  const outOfStock = items.filter((i) => i.stock <= 0).length;
  const lowStock = items.filter((i) => i.stock > 0 && i.stock <= i.minStock).length;

  const getStatusBadge = (item) => {
    if (item.stock <= 0) return <Badge variant="danger" size="sm">Habis</Badge>;
    return <Badge variant="warning" size="sm">Rendah</Badge>;
  };

  const getStatusText = (item) => {
    if (item.stock <= 0) return 'Habis';
    return 'Rendah';
  };

  const columns = [
    {
      key: 'name', header: 'Produk', sortable: true,
      render: (_, row) => <p className="font-medium text-gray-900">{row.name}</p>,
    },
    { key: 'category', header: 'Kategori', render: (_, row) => getCategoryName(row) },
    {
      key: 'stock', header: 'Stok', sortable: true,
      render: (_, row) => (
        <span className={`font-semibold ${row.stock <= 0 ? 'text-red-600' : 'text-yellow-600'}`}>
          {row.stock}
        </span>
      ),
    },
    { key: 'unit', header: 'Satuan', render: (_, row) => row.unitOfMeasure?.abbreviation || row.unit || '-' },
    { key: 'minStock', header: 'Stok Min.' },
    { key: 'status', header: 'Status', render: (_, row) => getStatusBadge(row) },
  ];

  // ─── Export helpers ─────────────────────────────────
  const getExportData = () => {
    const headers = ['Produk', 'SKU', 'Kategori', 'Stok', 'Satuan', 'Stok Min.', 'Status'];
    const rows = items.map((r) => [
      r.name,
      r.sku,
      getCategoryName(r),
      r.stock,
      r.unitOfMeasure?.abbreviation || r.unit || '-',
      r.minStock,
      getStatusText(r),
    ]);
    return { headers, rows };
  };

  const handleExportPDF = () => {
    const { headers, rows } = getExportData();
    exportTableToPDF('Laporan Stok Rendah', headers, rows, 'laporan-stok-rendah.pdf', {
      subtitle: 'Produk dengan stok di bawah minimum',
      columnStyles: ['left', 'left', 'left', 'right', 'center', 'right', 'center'],
    });
  };

  const handleExportExcel = () => {
    const { headers, rows } = getExportData();
    exportToExcel('Stok Rendah', headers, rows, 'laporan-stok-rendah.xlsx');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stok Rendah</h1>
          <p className="text-sm text-gray-500 mt-1">Produk dengan stok di bawah batas minimum</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={handlePrint}>Cetak</Button>
          <Button variant="outline" size="sm" icon={HiDocumentDownload} onClick={handleExportPDF}>PDF</Button>
          <Button variant="outline" size="sm" icon={HiTable} onClick={handleExportExcel}>Excel</Button>
        </div>
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
            <StatCard title="Total Stok Rendah" value={items.length} icon={HiExclamation} color="red" />
            <StatCard title="Stok Habis" value={outOfStock} icon={HiExclamation} color="red" />
            <StatCard title="Stok Menipis" value={lowStock} icon={HiCube} color="yellow" />
          </div>

          {items.length === 0 ? (
            <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
              <p className="text-green-700 font-medium">Semua produk memiliki stok yang cukup</p>
            </div>
          ) : (
            <Table columns={columns} data={items} sortable emptyMessage="Tidak ada produk stok rendah" />
          )}
        </>
      )}

      {/* Hidden print content */}
      <div className="hidden">
        <div ref={printRef} className="p-8" style={{ fontFamily: 'Arial, sans-serif', fontSize: '11px' }}>
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '16px' }}>{STORE_INFO.NAME}</h2>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '14px' }}>Laporan Stok Rendah</h3>
            <p style={{ margin: 0, fontSize: '10px', color: '#666' }}>
              Dicetak: {new Date().toLocaleDateString('id-ID')}
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f3f4f6' }}>
                {['No', 'Produk', 'SKU', 'Kategori', 'Stok', 'Satuan', 'Min.', 'Status'].map((h) => (
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
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{getCategoryName(r)}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.stock}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{r.unitOfMeasure?.abbreviation || r.unit || '-'}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px', textAlign: 'right' }}>{r.minStock}</td>
                  <td style={{ border: '1px solid #d1d5db', padding: '3px 6px' }}>{getStatusText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
