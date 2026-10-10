import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiPlus, HiPencil, HiTrash } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { unitAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Button, Badge, Modal, Loading, Input, Table } from '../../components/common';
import useAuth from '../../hooks/useAuth';

function UnitFormModal({ unit, onClose }) {
  const queryClient = useQueryClient();
  const isEdit = !!unit;

  const [name, setName] = useState(unit?.name || '');
  const [abbreviation, setAbbreviation] = useState(unit?.abbreviation || '');
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: (data) =>
      isEdit ? unitAPI.updateMeasure(unit.id, data) : unitAPI.createMeasure(data),
    onSuccess: () => {
      toast.success(isEdit ? 'Satuan berhasil diperbarui' : 'Satuan berhasil ditambahkan');
      queryClient.invalidateQueries({ queryKey: ['units-measures'] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menyimpan satuan')),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!name.trim()) errs.name = 'Nama satuan wajib diisi';
    if (!abbreviation.trim()) errs.abbreviation = 'Singkatan wajib diisi';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    mutation.mutate({ name: name.trim(), abbreviation: abbreviation.trim() });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit Satuan' : 'Tambah Satuan'}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>
            {isEdit ? 'Simpan' : 'Tambah'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nama Satuan"
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: null })); }}
          error={errors.name}
          placeholder="Contoh: Kilogram"
          autoFocus
        />
        <Input
          label="Singkatan"
          value={abbreviation}
          onChange={(e) => { setAbbreviation(e.target.value); setErrors((p) => ({ ...p, abbreviation: null })); }}
          error={errors.abbreviation}
          placeholder="Contoh: kg"
        />
      </form>
    </Modal>
  );
}

export default function UnitList() {
  const queryClient = useQueryClient();
  const { isAdmin, isKasir } = useAuth();
  const canEdit = isAdmin || isKasir;

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: units, isLoading } = useQuery({
    queryKey: ['units-measures'],
    queryFn: async () => {
      const { data } = await unitAPI.getMeasures();
      return data.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => unitAPI.deleteMeasure(id),
    onSuccess: () => {
      toast.success('Satuan berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['units-measures'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menghapus satuan')),
  });

  const handleAdd = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const handleEdit = (unit) => {
    setEditTarget(unit);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditTarget(null);
  };

  const columns = [
    {
      key: 'name',
      header: 'Nama Satuan',
      sortable: true,
      render: (val) => <span className="font-medium text-gray-900">{val}</span>,
    },
    {
      key: 'abbreviation',
      header: 'Singkatan',
      sortable: true,
      render: (val) => (
        <span className="text-sm font-mono text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
          {val}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (val) =>
        val !== false ? (
          <Badge variant="success" size="sm">Aktif</Badge>
        ) : (
          <Badge variant="danger" size="sm">Non-Aktif</Badge>
        ),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: 'Aksi',
            headerClassName: 'text-right',
            className: 'text-right',
            render: (_, row) => (
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); handleEdit(row); }}
                  className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                  title="Edit"
                >
                  <HiPencil className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Hapus"
                >
                  <HiTrash className="w-4 h-4" />
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Satuan</h1>
          <p className="text-sm text-gray-500 mt-1">
            Kelola satuan pengukuran yang digunakan di produk, PO, dan transaksi
          </p>
        </div>
        {canEdit && (
          <Button icon={HiPlus} onClick={handleAdd}>
            Tambah Satuan
          </Button>
        )}
      </div>

      {/* Unit Table */}
      <Table
        columns={columns}
        data={units || []}
        loading={isLoading}
        sortable
        emptyMessage='Belum ada satuan. Klik tombol "Tambah Satuan" untuk memulai.'
      />

      {/* Form Modal */}
      {formOpen && (
        <UnitFormModal unit={editTarget} onClose={handleFormClose} />
      )}

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Konfirmasi Hapus Satuan"
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
          Apakah Anda yakin ingin menghapus satuan{' '}
          <span className="font-semibold text-gray-900">
            {deleteTarget?.name} ({deleteTarget?.abbreviation})
          </span>
          ? Satuan yang masih dipakai produk aktif tidak bisa dihapus.
        </p>
      </Modal>
    </div>
  );
}
