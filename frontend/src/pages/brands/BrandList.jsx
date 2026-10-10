import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiPlus, HiPencil, HiTrash, HiCube, HiExternalLink } from 'react-icons/hi';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { brandAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Table, Badge, Button, SearchBar, Pagination, Modal, Breadcrumb } from '../../components/common';
import BrandForm from './BrandForm';
import useAuth from '../../hooks/useAuth';

export default function BrandList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin, isKasir } = useAuth();
  const canEdit = isAdmin || isKasir;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [productsBrand, setProductsBrand] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['brands', { page, search }],
    queryFn: async () => {
      const { data: res } = await brandAPI.getAll({
        page,
        limit: 20,
        search: search || undefined,
        // "Hapus" only deactivates a brand: hide deactivated ones, same as the unit list
        isActive: true,
      });
      return res;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => brandAPI.remove(id),
    onSuccess: () => {
      toast.success('Brand berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menghapus brand')),
  });

  const brands = data?.data || [];
  const pagination = data?.pagination || {};

  const handleAdd = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const handleEdit = (brand) => {
    setEditTarget(brand);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditTarget(null);
  };

  const handleShowProducts = async (brand) => {
    try {
      const { data: res } = await brandAPI.getById(brand.id);
      setProductsBrand(res.data || res);
    } catch {
      toast.error('Gagal memuat produk brand');
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Nama Brand',
      sortable: true,
      render: (v) => <span className="font-medium text-gray-900">{v}</span>,
    },
    {
      key: '_count',
      header: 'Jumlah Produk',
      render: (v, row) => (
        <button
          onClick={(e) => { e.stopPropagation(); if (v?.products > 0) handleShowProducts(row); }}
          className={`transition-transform ${v?.products > 0 ? 'cursor-pointer hover:scale-105' : 'cursor-default'}`}
          title={v?.products > 0 ? 'Klik untuk lihat daftar produk' : undefined}
        >
          <Badge variant="info" size="sm">
            {v?.products || 0} produk
          </Badge>
        </button>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (v) => (
        <Badge variant={v ? 'success' : 'danger'} size="sm">
          {v ? 'Aktif' : 'Non-Aktif'}
        </Badge>
      ),
    },
  ];

  if (canEdit) {
    columns.push({
      key: 'actions',
      header: 'Aksi',
      width: '100px',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleEdit(row); }}
            className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
            title="Edit"
            aria-label="Edit brand"
          >
            <HiPencil className="w-4 h-4" />
          </button>
          {isAdmin && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Hapus"
              aria-label="Hapus brand"
            >
              <HiTrash className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: 'Produk', to: '/produk' }, { label: 'Brand' }]} className="mb-4" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola brand / merek produk</p>
        </div>
        {canEdit && (
          <Button icon={HiPlus} onClick={handleAdd}>
            Tambah Brand
          </Button>
        )}
      </div>

      {/* Search */}
      <SearchBar
        placeholder="Cari nama brand..."
        onSearch={(v) => { setSearch(v); setPage(1); }}
        className="max-w-md"
      />

      {/* Table */}
      <Table
        columns={columns}
        data={brands}
        loading={isLoading}
        sortable
        emptyMessage="Belum ada brand. Klik tombol 'Tambah Brand' untuk memulai."
      />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page || page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}

      {/* Form Modal */}
      {formOpen && (
        <BrandForm brand={editTarget} onClose={handleFormClose} />
      )}

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Konfirmasi Hapus Brand"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteTarget?.id)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Apakah Anda yakin ingin menghapus brand{' '}
          <span className="font-semibold text-gray-900">{deleteTarget?.name}</span>?
          {deleteTarget?._count?.products > 0 && (
            <span className="block mt-2 text-amber-600">
              Brand ini memiliki {deleteTarget._count.products} produk terkait dan akan dinonaktifkan saja.
            </span>
          )}
        </p>
      </Modal>

      {/* Products by Brand Modal */}
      <Modal
        isOpen={!!productsBrand}
        onClose={() => setProductsBrand(null)}
        title={`Produk Brand "${productsBrand?.name || ''}"`}
        size="lg"
        footer={
          <Button variant="outline" onClick={() => setProductsBrand(null)}>Tutup</Button>
        }
      >
        {productsBrand?.products?.length > 0 ? (
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
            {productsBrand.products.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between py-3 px-1 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex-shrink-0 w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                    <HiCube className="w-5 h-5 text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                    <p className="text-xs text-gray-400">Stok: {(product.stock ?? 0).toLocaleString('id-ID')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant={product.isActive ? 'success' : 'danger'} size="sm">
                    {product.isActive ? 'Aktif' : 'Non-Aktif'}
                  </Badge>
                  <button
                    onClick={() => navigate(`/produk/${product.id}`)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Lihat detail produk"
                  >
                    <HiExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-8">Belum ada produk untuk brand ini.</p>
        )}
      </Modal>
    </div>
  );
}
