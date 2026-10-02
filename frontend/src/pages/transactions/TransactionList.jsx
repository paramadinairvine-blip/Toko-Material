import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HiEye, HiSearch } from 'react-icons/hi';
import { transactionAPI } from '../../api/endpoints';
import { Table, Badge, Pagination, CalendarPicker } from '../../components/common';
import { formatRupiah } from '../../utils/formatCurrency';
import { formatTanggalWaktu, startOfDayWIB, endOfDayWIB } from '../../utils/formatDate';
import {
  TRANSACTION_TYPE_LABELS, TRANSACTION_TYPE_COLORS,
  TRANSACTION_STATUS_LABELS, TRANSACTION_STATUS_COLORS,
} from '../../utils/constants';

// The date filter comes from the URL, so it can be anything the user typed there
const isValidDateParam = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`));

export default function TransactionList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Applied filters & page live in the URL so they survive refresh and back navigation
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const dateParam = searchParams.get('date') || '';
  const appliedFilters = {
    search: searchParams.get('search') || '',
    date: isValidDateParam(dateParam) ? dateParam : '',
    customerName: searchParams.get('customerName') || '',
  };

  // Input values (only applied on search click / enter)
  const [search, setSearch] = useState(appliedFilters.search);
  const [date, setDate] = useState(appliedFilters.date);
  const [customerName, setCustomerName] = useState(appliedFilters.customerName);

  // Keep the inputs in step when the URL changes underneath (browser back / forward)
  const appliedKey = `${appliedFilters.search}|${appliedFilters.date}|${appliedFilters.customerName}`;
  const [syncedKey, setSyncedKey] = useState(appliedKey);
  if (syncedKey !== appliedKey) {
    setSyncedKey(appliedKey);
    setSearch(appliedFilters.search);
    setDate(appliedFilters.date);
    setCustomerName(appliedFilters.customerName);
  }

  // `replace` when nothing changes, so repeated clicks don't stack identical history entries
  const setPage = (p) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(p));
    setSearchParams(params, { replace: p === page });
  };

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (date) params.set('date', date);
    if (customerName) params.set('customerName', customerName);
    params.set('page', '1');
    const unchanged = page === 1
      && search === appliedFilters.search
      && date === appliedFilters.date
      && customerName === appliedFilters.customerName;
    setSearchParams(params, { replace: unchanged });
  };

  const hasFilters = Boolean(
    search || date || customerName
    || appliedFilters.search || appliedFilters.date || appliedFilters.customerName
  );

  const resetFilters = () => {
    setSearch('');
    setDate('');
    setCustomerName('');
    setSearchParams({});
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') applyFilters();
  };

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', { page, ...appliedFilters }],
    queryFn: async () => {
      const params = { page, limit: 20 };
      if (appliedFilters.search) params.search = appliedFilters.search;
      if (appliedFilters.customerName) params.customerName = appliedFilters.customerName;
      if (appliedFilters.date) {
        params.startDate = startOfDayWIB(appliedFilters.date);
        params.endDate = endOfDayWIB(appliedFilters.date);
      }
      const { data: res } = await transactionAPI.getAll(params);
      return res;
    },
  });

  const transactions = data?.data || [];
  const pagination = data?.pagination || {};

  const columns = [
    {
      key: 'createdAt',
      header: 'Tanggal',
      sortable: true,
      render: (v) => <span className="text-gray-600">{formatTanggalWaktu(v)}</span>,
    },
    {
      key: 'type',
      header: 'Tipe',
      render: (v) => (
        <Badge colorClass={TRANSACTION_TYPE_COLORS[v]} size="sm">
          {TRANSACTION_TYPE_LABELS[v] || v}
        </Badge>
      ),
    },
    {
      key: 'creator',
      header: 'Kasir',
      render: (_, row) => (
        <span className="text-gray-600">{row.creator?.fullName || '-'}</span>
      ),
    },
    {
      key: 'customerName',
      header: 'Customer',
      render: (v) => <span className="text-gray-600">{v || '-'}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      render: (v) => <span className="font-medium text-gray-900">{formatRupiah(v)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (v) => (
        <Badge colorClass={TRANSACTION_STATUS_COLORS[v]} size="sm">
          {TRANSACTION_STATUS_LABELS[v] || v}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Aksi',
      width: '60px',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/transaksi/${row.id}`); }}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Lihat Detail"
            aria-label="Lihat detail"
          >
            <HiEye className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daftar Transaksi</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola transaksi pengeluaran barang</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Cari nomor transaksi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-56"
        />
        <CalendarPicker
          mode="single"
          value={date}
          onChange={setDate}
          placeholder="Pilih tanggal"
        />
        <input
          type="text"
          placeholder="Nama Customer"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-48"
        />
        <button
          onClick={applyFilters}
          className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
          title="Cari"
        >
          <HiSearch className="w-5 h-5" />
        </button>
        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-3 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Table */}
      <Table
        columns={columns}
        data={transactions}
        loading={isLoading}
        sortable
        onRowClick={(row) => navigate(`/transaksi/${row.id}`)}
        emptyMessage="Tidak ada transaksi ditemukan"
      />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page || page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
