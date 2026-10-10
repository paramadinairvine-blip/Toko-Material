import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiEye, HiFilter, HiAdjustments } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { stockAPI, categoryAPI } from '../../api/endpoints';
import { Table, Badge, Pagination, Modal, Loading, CalendarPicker, Button, Input } from '../../components/common';
import { getErrorMessage } from '../../utils/handleError';
import useAuth from '../../hooks/useAuth';
import { formatTanggalWaktu } from '../../utils/formatDate';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_COLORS } from '../../utils/constants';
import useBarcodeScanner from '../../hooks/useBarcodeScanner';

// ─── Movement History Modal ───────────────────────────
function MovementHistoryModal({ product, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-history', product?.id],
    queryFn: async () => {
      const { data } = await stockAPI.getByProduct(product.id, { limit: 20 });
      return data.data;
    },
    enabled: !!product?.id,
  });

  const movements = data?.history?.data || [];

  const columns = [
    { key: 'createdAt', header: 'Tanggal', render: (v) => formatTanggalWaktu(v) },
    {
      key: 'type', header: 'Tipe',
      render: (v) => (
        <Badge colorClass={MOVEMENT_TYPE_COLORS[v]} size="sm">
          {MOVEMENT_TYPE_LABELS[v] || v}
        </Badge>
      ),
    },
    {
      key: 'quantity', header: 'Jumlah',
      render: (v, row) => (
        <span className={row.type === 'IN' ? 'text-green-600 font-medium' : row.type === 'OUT' ? 'text-red-600 font-medium' : 'font-medium'}>
          {row.type === 'IN' ? '+' : row.type === 'OUT' ? '-' : v > 0 ? '+' : v < 0 ? '-' : ''}{Math.abs(v)}
        </span>
      ),
    },
    { key: 'previousStock', header: 'Sebelum' },
    { key: 'newStock', header: 'Sesudah' },
    {
      key: 'referenceType', header: 'Referensi',
      render: (v) => <span className="text-xs text-gray-500">{v || '-'}</span>,
    },
    {
      key: 'notes', header: 'Catatan',
      render: (v) => <span className="text-xs text-gray-500">{v || '-'}</span>,
    },
  ];

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Riwayat Stok — ${product?.name}`}
      size="lg"
    >
      {isLoading ? (
        <Loading text="Memuat riwayat..." />
      ) : (
        <Table columns={columns} data={movements} emptyMessage="Belum ada pergerakan stok" />
      )}
    </Modal>
  );
}

// ─── Stock Adjustment Modal (ADMIN) ───────────────────
function AdjustStockModal({ product, onClose }) {
  const queryClient = useQueryClient();
  const [newStock, setNewStock] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [confirming, setConfirming] = useState(false);

  const unitLabel = product.unitOfMeasure?.abbreviation || product.unit || '';
  const currentStock = Number(product.stock) || 0;
  const parsedStock = /^\d+$/.test(newStock.trim()) ? parseInt(newStock.trim(), 10) : null;
  const diff = parsedStock === null ? null : parsedStock - currentStock;

  const mutation = useMutation({
    mutationFn: (data) => stockAPI.adjust(data),
    onSuccess: () => {
      toast.success('Penyesuaian stok berhasil disimpan');
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-history', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(getErrorMessage(err, 'Gagal menyesuaikan stok'));
    },
  });

  const validate = () => {
    const errs = {};
    if (newStock.trim() === '') errs.newStock = 'Stok baru wajib diisi';
    else if (parsedStock === null) errs.newStock = 'Stok baru harus bilangan bulat, minimal 0';
    else if (parsedStock === currentStock) errs.newStock = 'Stok baru sama dengan stok saat ini';
    if (!notes.trim()) errs.notes = 'Catatan wajib diisi';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (validate()) setConfirming(true);
  };

  const handleSubmit = () => {
    mutation.mutate({ productId: product.id, quantity: parsedStock, notes: notes.trim() });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Sesuaikan Stok — ${product.name}`}
      size="sm"
      footer={confirming ? (
        <>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={mutation.isPending}>Kembali</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>Ya, Sesuaikan</Button>
        </>
      ) : (
        <>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={handleNext}>Simpan</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Stok Saat Ini</span>
            <span className="font-medium">{currentStock} {unitLabel}</span>
          </div>
          {diff !== null && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-500">Stok Baru</span>
                <span className="font-medium">{parsedStock} {unitLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Selisih</span>
                <span className={`font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : ''}`}>
                  {diff > 0 ? '+' : ''}{diff} {unitLabel}
                </span>
              </div>
            </>
          )}
        </div>

        {confirming ? (
          <div className="text-sm text-gray-700 space-y-2">
            <p>
              Stok <span className="font-semibold">{product.name}</span> akan diubah dari{' '}
              <span className="font-semibold">{currentStock}</span> menjadi{' '}
              <span className="font-semibold">{parsedStock} {unitLabel}</span>. Lanjutkan?
            </p>
            <p className="text-xs text-gray-500">Catatan: {notes.trim()}</p>
          </div>
        ) : (
          <>
            <Input
              label="Stok Baru"
              type="number"
              min="0"
              step="1"
              value={newStock}
              onChange={(e) => {
                setNewStock(e.target.value);
                if (errors.newStock) setErrors((prev) => ({ ...prev, newStock: undefined }));
              }}
              placeholder="Jumlah stok sebenarnya"
              helperText="Isi jumlah stok akhir (bukan selisih)"
              error={errors.newStock}
              autoFocus
            />
            <Input
              label="Catatan"
              type="textarea"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                if (errors.notes) setErrors((prev) => ({ ...prev, notes: undefined }));
              }}
              placeholder="Alasan penyesuaian, mis. barang rusak, salah hitung"
              error={errors.notes}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Component ───────────────────────────────────
export default function StockOverview() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [barcode, setBarcode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ search: '', barcode: '', categoryId: '', dateFrom: '', dateTo: '' });
  const [historyProduct, setHistoryProduct] = useState(null);
  const [adjustProduct, setAdjustProduct] = useState(null);
  const { isAdmin } = useAuth();

  // USB Barcode Scanner support — auto-fill barcode field and apply filter
  const handleBarcodeScan = useCallback((scannedBarcode) => {
    setBarcode(scannedBarcode);
    setAppliedFilters((prev) => ({ ...prev, barcode: scannedBarcode }));
    setPage(1);
    toast.success(`Barcode terdeteksi: ${scannedBarcode}`, { duration: 2000 });
  }, []);
  useBarcodeScanner(handleBarcodeScan);

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await categoryAPI.getAll();
      return data.data || [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['stock', { page, ...appliedFilters }],
    queryFn: async () => {
      const params = { page, limit: 20 };
      if (appliedFilters.search) params.search = appliedFilters.search;
      if (appliedFilters.barcode) params.barcode = appliedFilters.barcode;
      if (appliedFilters.categoryId) params.categoryId = appliedFilters.categoryId;
      if (appliedFilters.dateFrom) params.dateFrom = appliedFilters.dateFrom;
      if (appliedFilters.dateTo) params.dateTo = appliedFilters.dateTo;
      const { data: res } = await stockAPI.getAll(params);
      return res;
    },
  });

  const stockItems = data?.data || [];
  const pagination = data?.pagination || {};

  const applyFilters = () => {
    setAppliedFilters({ search, barcode, categoryId, dateFrom, dateTo });
    setPage(1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') applyFilters();
  };

  // Flatten categories for dropdown
  const categoryOptions = [];
  (categories || []).forEach((cat) => {
    categoryOptions.push({ id: cat.id, name: cat.name });
    if (cat.children) {
      cat.children.forEach((sub) => {
        categoryOptions.push({ id: sub.id, name: `└ ${sub.name}` });
        if (sub.children) {
          sub.children.forEach((subsub) => {
            categoryOptions.push({ id: subsub.id, name: `  └ ${subsub.name}` });
          });
        }
      });
    }
  });

  const getStockBadge = (product) => {
    if (product.stock <= 0) return <Badge variant="danger" size="sm">Habis</Badge>;
    if (product.stock <= product.minStock) return <Badge variant="warning" size="sm">Rendah</Badge>;
    return <Badge variant="success" size="sm">Aman</Badge>;
  };

  const columns = [
    {
      key: 'name',
      header: 'Produk',
      sortable: true,
      render: (_, row) => (
        <p className="font-medium text-gray-900">{row.name}</p>
      ),
    },
    {
      key: 'category',
      header: 'Kategori',
      render: (_, row) => <span className="text-gray-600">{row.category?.name || '-'}</span>,
    },
    {
      key: 'stock',
      header: 'Stok',
      sortable: true,
      render: (_, row) => (
        <span className={`font-semibold ${row.stock <= 0 ? 'text-red-600' : row.stock <= row.minStock ? 'text-yellow-600' : 'text-gray-900'}`}>
          {row.stock} {row.unitOfMeasure?.abbreviation || row.unit}
        </span>
      ),
    },
    {
      key: 'minStock',
      header: 'Stok Min.',
      render: (v) => <span className="text-gray-600">{v}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (_, row) => getStockBadge(row),
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: '100px',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); setHistoryProduct(row); }}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Riwayat Pergerakan"
            aria-label="Riwayat pergerakan"
          >
            <HiEye className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); setAdjustProduct(row); }}
              className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
              title="Sesuaikan Stok"
              aria-label="Sesuaikan stok"
            >
              <HiAdjustments className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Monitoring Stok</h1>
        <p className="text-sm text-gray-500 mt-1">Pantau stok barang secara real-time</p>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        {/* Date Range */}
        <CalendarPicker
          mode="range"
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to); }}
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white"
        >
          <option value="">Semua Kategori</option>
          {categoryOptions.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Cari produk"
          className="w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none"
        />
        <input
          type="text"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Cari barcode"
          className="w-36 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none"
        />
        <button
          type="button"
          onClick={applyFilters}
          className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500 text-white text-sm font-medium rounded-lg hover:bg-cyan-600 transition-colors whitespace-nowrap"
        >
          <HiFilter className="w-4 h-4" />
          Terapkan Filter
        </button>
      </div>

      {/* Table */}
      <Table
        columns={columns}
        data={stockItems}
        loading={isLoading}
        sortable
        emptyMessage="Tidak ada data stok"
      />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page || page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}

      {/* Movement History Modal */}
      {historyProduct && (
        <MovementHistoryModal
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}

      {/* Stock Adjustment Modal (ADMIN) */}
      {adjustProduct && (
        <AdjustStockModal
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
        />
      )}
    </div>
  );
}
