import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiArrowLeft } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { supplierAPI } from '../../api/endpoints';
import { getErrorMessage, getFieldErrors } from '../../utils/handleError';
import { Card, Button, Input } from '../../components/common';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';

export default function SupplierForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    contactName: '',
    phone: '',
    email: '',
    address: '',
  });
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);

  // Load existing supplier
  const { data: existing } = useQuery({
    queryKey: ['supplier', id],
    queryFn: async () => { const { data } = await supplierAPI.getById(id); return data.data; },
    enabled: isEdit,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        contactName: existing.contactName || '',
        phone: existing.phone || '',
        email: existing.email || '',
        address: existing.address || '',
      });
    }
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const mutation = useMutation({
    mutationFn: (data) => {
      if (isEdit) return supplierAPI.update(id, data);
      return supplierAPI.create(data);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Supplier berhasil diperbarui' : 'Supplier berhasil ditambahkan');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      navigate('/supplier');
    },
    onError: (err) => {
      const fieldErrors = getFieldErrors(err);
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
      }
      toast.error(getErrorMessage(err, 'Gagal menyimpan supplier'));
    },
  });

  useUnsavedChanges(isDirty && !mutation.isSuccess);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Nama supplier wajib diisi';
    const phone = form.phone.trim();
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone) {
      errs.phone = 'Nomor telepon wajib diisi';
    } else if (!/^\+?[\d\s-]+$/.test(phone)) {
      errs.phone = 'Nomor telepon hanya boleh berisi angka, spasi, tanda + dan -';
    } else if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      errs.phone = 'Nomor telepon harus 8-15 digit';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    mutation.mutate({
      name: form.name.trim(),
      contactName: form.contactName.trim() || null,
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      address: form.address.trim() || null,
    });
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/supplier')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Kembali"
        >
          <HiArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Supplier' : 'Tambah Supplier'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isEdit ? 'Perbarui informasi supplier' : 'Tambahkan supplier baru ke sistem'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card padding="md">
          <div className="space-y-4">
            <Input
              label="Nama Supplier *"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Masukkan nama supplier"
              error={errors.name}
              autoFocus
            />

            <Input
              label="Contact Person"
              value={form.contactName}
              onChange={(e) => updateField('contactName', e.target.value)}
              placeholder="Nama kontak"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Telepon *"
                value={form.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="08xxxxxxxxxx"
                error={errors.phone}
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="email@supplier.com"
                error={errors.email}
              />
            </div>

            <Input
              label="Alamat"
              value={form.address}
              onChange={(e) => updateField('address', e.target.value)}
              placeholder="Alamat lengkap supplier"
              textarea
              rows={3}
            />
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="outline" type="button" onClick={() => navigate('/supplier')}>
            Batal
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Simpan Perubahan' : 'Tambah Supplier'}
          </Button>
        </div>
      </form>
    </div>
  );
}
