import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiPlus, HiPencil, HiLockClosed, HiBan, HiCheck, HiTrash } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { userAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Table, Badge, Button, SearchBar, Pagination, Modal, Input } from '../../components/common';
import { ROLE_LABELS, ROLE_COLORS } from '../../utils/constants';
import useAuth from '../../hooks/useAuth';
import UserForm from './UserForm';

export default function UserList() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', { page, search }],
    queryFn: async () => {
      const { data: res } = await userAPI.getAll({ page, limit: 20, search: search || undefined });
      return res;
    },
  });

  // Toggle active/inactive
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) => userAPI.update(id, { isActive }),
    onSuccess: (_, vars) => {
      toast.success(vars.isActive ? 'User berhasil diaktifkan' : 'User berhasil dinonaktifkan');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setToggleTarget(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal mengubah status user')),
  });

  // Delete user (soft delete)
  const deleteMutation = useMutation({
    mutationFn: (id) => userAPI.remove(id),
    onSuccess: () => {
      toast.success('User berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menghapus user')),
  });

  // Reset password
  const resetMutation = useMutation({
    mutationFn: ({ id, password }) => userAPI.changePassword(id, { newPassword: password }),
    onSuccess: () => {
      toast.success('Password berhasil direset');
      setResetTarget(null);
      setNewPassword('');
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal reset password')),
  });

  const users = data?.data || [];
  const pagination = data?.pagination || {};

  const handleEdit = (user) => {
    setEditTarget(user);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditTarget(null);
  };

  const handleResetPassword = () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }
    resetMutation.mutate({ id: resetTarget.id, password: newPassword });
  };

  const columns = [
    {
      key: 'fullName',
      header: 'Nama',
      sortable: true,
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.fullName}</p>
          <p className="text-xs text-gray-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (v) => (
        <Badge colorClass={ROLE_COLORS[v]} size="sm">
          {ROLE_LABELS[v] || v}
        </Badge>
      ),
    },
    {
      key: 'phone',
      header: 'Telepon',
      render: (v) => <span className="text-gray-600">{v || '-'}</span>,
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
    {
      key: 'actions',
      header: 'Aksi',
      width: '180px',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); handleEdit(row); }}
            className="p-1.5 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
            title="Edit"
            aria-label="Edit user"
          >
            <HiPencil className="w-4 h-4" />
          </button>
          {/* No deactivate/delete on your own account */}
          {row.id !== currentUser?.id && (
          <button
            onClick={(e) => { e.stopPropagation(); setToggleTarget(row); }}
            className={`p-1.5 rounded-lg transition-colors ${
              row.isActive
                ? 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
            }`}
            title={row.isActive ? 'Non-Aktifkan' : 'Aktifkan'}
            aria-label={row.isActive ? 'Non-aktifkan user' : 'Aktifkan user'}
          >
            {row.isActive ? <HiBan className="w-4 h-4" /> : <HiCheck className="w-4 h-4" />}
          </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setResetTarget(row); setNewPassword(''); }}
            className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="Reset Password"
            aria-label="Reset password"
          >
            <HiLockClosed className="w-4 h-4" />
          </button>
          {row.id !== currentUser?.id && (
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Hapus Permanen"
            aria-label="Hapus user permanen"
          >
            <HiTrash className="w-4 h-4" />
          </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pengguna</h1>
          <p className="text-sm text-gray-500 mt-1">Kelola akun pengguna sistem</p>
        </div>
        <Button icon={HiPlus} onClick={handleAdd}>
          Tambah User
        </Button>
      </div>

      {/* Search */}
      <SearchBar
        placeholder="Cari nama atau email..."
        onSearch={(v) => { setSearch(v); setPage(1); }}
        className="max-w-md"
      />

      {/* Table */}
      <Table
        columns={columns}
        data={users}
        loading={isLoading}
        sortable
        emptyMessage="Tidak ada pengguna ditemukan"
      />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page || page}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
        />
      )}

      {/* User Form Modal */}
      {formOpen && (
        <UserForm user={editTarget} onClose={handleFormClose} />
      )}

      {/* Toggle Active Modal */}
      <Modal
        isOpen={!!toggleTarget}
        onClose={() => setToggleTarget(null)}
        title={toggleTarget?.isActive ? 'Non-Aktifkan User' : 'Aktifkan User'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setToggleTarget(null)}>Batal</Button>
            <Button
              variant={toggleTarget?.isActive ? 'danger' : 'primary'}
              loading={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate({
                id: toggleTarget.id,
                isActive: !toggleTarget.isActive,
              })}
            >
              {toggleTarget?.isActive ? 'Non-Aktifkan' : 'Aktifkan'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {toggleTarget?.isActive ? (
            <>User <span className="font-semibold">{toggleTarget?.fullName}</span> tidak akan bisa login lagi.</>
          ) : (
            <>Aktifkan kembali akun <span className="font-semibold">{toggleTarget?.fullName}</span>?</>
          )}
        </p>
      </Modal>

      {/* Delete User Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Hapus User"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(deleteTarget.id)}
            >
              Hapus User
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            Apakah Anda yakin ingin menghapus user <span className="font-semibold">{deleteTarget?.fullName}</span>?
          </p>
          <p className="text-sm text-gray-500">
            User tidak akan bisa login dan dihapus dari daftar pengguna. Semua data historis (transaksi, PO, stok, dll) tetap tersimpan dengan aman.
          </p>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={!!resetTarget}
        onClose={() => { setResetTarget(null); setNewPassword(''); }}
        title="Reset Password"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setResetTarget(null); setNewPassword(''); }}>Batal</Button>
            <Button loading={resetMutation.isPending} onClick={handleResetPassword}>
              Reset Password
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Reset password untuk <span className="font-semibold">{resetTarget?.fullName}</span>
          </p>
          <Input
            label="Password Baru"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimal 6 karakter"
          />
        </div>
      </Modal>
    </div>
  );
}
