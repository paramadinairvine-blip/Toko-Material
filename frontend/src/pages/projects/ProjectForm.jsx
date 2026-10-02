import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiArrowLeft, HiPlus, HiTrash } from 'react-icons/hi';
import toast from 'react-hot-toast';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { projectAPI, productAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Card, Button, Input, Select, CalendarPicker } from '../../components/common';
import { PROJECT_STATUS, PROJECT_STATUS_LABELS } from '../../utils/constants';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import { formatRupiah } from '../../utils/formatCurrency';

const emptyMaterial = () => ({
  _key: Date.now() + Math.random(),
  productId: '',
  estimatedQty: '',
  usedQty: '',
  unitPrice: '',
  notes: '',
  product: null,
});

// ─── Progress Bar Component ────────────────────────────
function ProgressBar({ percent, size = 'md' }) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  const color =
    clampedPercent >= 100
      ? 'bg-green-500'
      : clampedPercent >= 75
        ? 'bg-blue-500'
        : clampedPercent >= 50
          ? 'bg-yellow-500'
          : 'bg-gray-400';

  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className={`w-full bg-gray-200 rounded-full ${height} overflow-hidden`}>
      <div
        className={`${color} ${height} rounded-full transition-all duration-300`}
        style={{ width: `${clampedPercent}%` }}
      />
    </div>
  );
}

export default function ProjectForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    description: '',
    status: PROJECT_STATUS.PLANNING,
    startDate: '',
    budget: '',
  });
  const [materials, setMaterials] = useState([emptyMaterial()]);
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);

  // ─── Fetch options ──────────────────────────────────
  const { data: products } = useQuery({
    queryKey: ['products-select'],
    queryFn: async () => {
      const { data } = await productAPI.getAll({ limit: 500 });
      return data.data || [];
    },
  });

  // ─── Load existing project ─────────────────────────
  const { data: existing } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data } = await projectAPI.getById(id);
      return data.data;
    },
    enabled: isEdit,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        description: existing.description || '',
        status: existing.status || PROJECT_STATUS.PLANNING,
        startDate: existing.startDate ? existing.startDate.slice(0, 10) : '',
        budget: existing.budget?.toString() || '',
      });
      if (existing.materials?.length > 0) {
        setMaterials(
          existing.materials.map((m) => ({
            _key: m.id || Date.now() + Math.random(),
            id: m.id,
            productId: m.productId || '',
            estimatedQty: m.estimatedQty?.toString() || '',
            usedQty: m.usedQty?.toString() || '0',
            savedUsedQty: m.usedQty || 0,
            unitPrice: m.unitPrice?.toString() || '',
            notes: m.notes || '',
            product: m.product || null,
          }))
        );
      }
    }
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Auto-calculate budget from materials ─────────
  const materialsTotal = materials.reduce((sum, m) => {
    const qty = parseFloat(m.estimatedQty) || 0;
    const price = parseFloat(m.unitPrice) || 0;
    return sum + qty * price;
  }, 0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (materialsTotal > 0) {
      setForm((prev) => ({ ...prev, budget: materialsTotal.toString() }));
    }
  }, [materialsTotal]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Realization calculations (edit mode) ─────────
  const materialsUsedTotal = materials.reduce((sum, m) => {
    const used = parseFloat(m.usedQty) || 0;
    const price = parseFloat(m.unitPrice) || 0;
    return sum + used * price;
  }, 0);

  const overallMaterialProgress = (() => {
    const totalEst = materials.reduce((s, m) => s + (parseFloat(m.estimatedQty) || 0), 0);
    const totalUsed = materials.reduce((s, m) => s + (parseFloat(m.usedQty) || 0), 0);
    return totalEst > 0 ? Math.round((totalUsed / totalEst) * 100) : 0;
  })();

  const budgetProgress = materialsTotal > 0
    ? Math.round((materialsUsedTotal / materialsTotal) * 100)
    : 0;

  // ─── Options ────────────────────────────────────────
  const statusOptions = Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const productOptions = (products || []).map((p) => ({
    value: p.id,
    label: p.name,
    product: p,
  }));

  const getProductById = (productId) =>
    (products || []).find((p) => p.id === productId) || null;

  // ─── Material helpers ──────────────────────────────
  const updateMaterial = (index, field, value) => {
    setMaterials((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'productId') {
        const product = getProductById(value);
        updated[index].product = product;
        updated[index].unitPrice = product?.sellPrice?.toString() || '';
      }
      return updated;
    });
    setIsDirty(true);
  };

  const addMaterial = () => {
    setMaterials((prev) => [...prev, emptyMaterial()]);
    setIsDirty(true);
  };

  const removeMaterial = (index) => {
    if (materials.length <= 1) {
      setMaterials([emptyMaterial()]);
    } else {
      setMaterials((prev) => prev.filter((_, i) => i !== index));
    }
    setIsDirty(true);
  };

  // ─── Submit ─────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: (data) => {
      if (isEdit) return projectAPI.update(id, data);
      return projectAPI.create(data);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Proyek berhasil diperbarui' : 'Proyek berhasil dibuat');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (isEdit) {
        queryClient.invalidateQueries({ queryKey: ['project', id] });
        queryClient.invalidateQueries({ queryKey: ['project-report', id] });
      }
      navigate('/proyek');
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menyimpan proyek')),
  });

  useUnsavedChanges(isDirty && !mutation.isSuccess);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Nama proyek wajib diisi';
    if (!form.startDate) errs.startDate = 'Tanggal mulai wajib diisi';
    if (!form.budget || parseFloat(form.budget) <= 0) errs.budget = 'Budget harus lebih dari 0';

    if (isEdit) {
      const invalid = materials.find((m) => m.savedUsedQty > 0 && (parseFloat(m.usedQty) || 0) < m.savedUsedQty);
      if (invalid) {
        const productName = invalid.product?.name || 'Material';
        toast.error(`${productName}: Terpakai tidak boleh kurang dari ${invalid.savedUsedQty}`);
        return false;
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const validMaterials = materials
      .filter((m) => m.productId)
      .map((m) => ({
        id: m.id || undefined,
        productId: m.productId,
        estimatedQty: parseFloat(m.estimatedQty) || 0,
        usedQty: isEdit ? (parseInt(m.usedQty, 10) || 0) : 0,
        unitPrice: parseFloat(m.unitPrice) || 0,
        notes: m.notes?.trim() || null,
      }));

    mutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      status: form.status,
      startDate: form.startDate ? new Date(form.startDate).toISOString() : null,
      budget: parseFloat(form.budget) || 0,
      materials: validMaterials,
    });
  };

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setIsDirty(true);
  };

  // ─── Chart data ─────────────────────────────────────
  const CHART_COLORS = ['#3b82f6', '#e5e7eb'];
  const materialChartData = [
    { name: 'Terpakai', value: overallMaterialProgress },
    { name: 'Sisa', value: Math.max(0, 100 - overallMaterialProgress) },
  ];
  const budgetChartData = [
    { name: 'Terpakai', value: budgetProgress },
    { name: 'Sisa', value: Math.max(0, 100 - budgetProgress) },
  ];

  // Check if there are any used materials
  const hasRealization = materials.some((m) => (parseFloat(m.usedQty) || 0) > 0);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/proyek')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Kembali ke daftar proyek"
        >
          <HiArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Proyek' : 'Tambah Proyek'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isEdit ? 'Perbarui informasi proyek dan realisasi material' : 'Buat proyek baru untuk mengelola kebutuhan material'}
          </p>
        </div>
      </div>

      {/* ─── Progress Summary (edit mode only) ──────────── */}
      {isEdit && hasRealization && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Material Progress */}
          <Card title="Progress Material" padding="md">
            <div className="flex items-center gap-6">
              <div className="w-32 h-32 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={materialChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {materialChartData.map((entry, i) => (
                        <Cell key={entry.name} fill={CHART_COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => `${val}%`} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                <div className="text-3xl font-bold text-blue-600">{overallMaterialProgress}%</div>
                <p className="text-sm text-gray-500">Material terealisasi</p>
                <div className="text-xs text-gray-400">
                  {materials.reduce((s, m) => s + (parseFloat(m.usedQty) || 0), 0)} dari{' '}
                  {materials.reduce((s, m) => s + (parseFloat(m.estimatedQty) || 0), 0)} total item
                </div>
              </div>
            </div>
          </Card>

          {/* Budget Progress */}
          <Card title="Progress Budget" padding="md">
            <div className="flex items-center gap-6">
              <div className="w-32 h-32 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={budgetChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={50}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {budgetChartData.map((entry, i) => (
                        <Cell key={entry.name} fill={i === 0 ? '#10b981' : '#e5e7eb'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => `${val}%`} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                <div className="text-3xl font-bold text-green-600">{budgetProgress}%</div>
                <p className="text-sm text-gray-500">Budget terpakai</p>
                <div className="text-xs text-gray-400">
                  {formatRupiah(materialsUsedTotal)} dari {formatRupiah(materialsTotal)}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <Card title="Informasi Proyek" padding="md" className="mb-6">
          <div className="space-y-4">
            <Input
              label="Nama Proyek *"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Masukkan nama proyek"
              error={errors.name}
              autoFocus
            />

            <Input
              label="Deskripsi"
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Deskripsi proyek (opsional)"
              textarea
              rows={3}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Status"
                value={form.status}
                onChange={(val) => updateField('status', val)}
                options={statusOptions}
              />
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tanggal Mulai *</label>
                <CalendarPicker
                  mode="single"
                  value={form.startDate}
                  onChange={(date) => updateField('startDate', date)}
                />
                {errors.startDate && <p className="text-xs text-red-500 mt-1">{errors.startDate}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimasi Budget (Rp) *
              </label>
              <div className="px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-semibold text-gray-900">
                {formatRupiah(form.budget)}
              </div>
              {materialsTotal === 0 && (
                <p className="text-xs text-gray-400 mt-1">Otomatis dihitung dari total material</p>
              )}
              {errors.budget && <p className="text-xs text-red-500 mt-1">{errors.budget}</p>}
            </div>
          </div>
        </Card>

        {/* Materials */}
        <Card
          title="Material yang Dibutuhkan"
          padding="none"
          className="mb-6"
          headerAction={
            <Button variant="outline" size="sm" icon={HiPlus} onClick={addMaterial}>
              Tambah Material
            </Button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-8">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 min-w-[200px]">Produk</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-20">Satuan</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-32">Estimasi</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-40">Harga</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-600 w-32">Subtotal</th>
                  {isEdit && (
                    <>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-24">Terpakai</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-20">Sisa</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 w-28">Progress</th>
                    </>
                  )}
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {materials.map((mat, idx) => {
                  const estQty = parseFloat(mat.estimatedQty) || 0;
                  const usedQty = parseFloat(mat.usedQty) || 0;
                  const price = parseFloat(mat.unitPrice) || 0;
                  const subtotal = estQty * price;
                  const remaining = estQty - usedQty;
                  const matPercent = estQty > 0 ? Math.round((usedQty / estQty) * 100) : 0;

                  return (
                    <tr key={mat._key} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <Select
                          value={mat.productId}
                          onChange={(val) => updateMaterial(idx, 'productId', val)}
                          options={productOptions}
                          placeholder="Pilih produk..."
                          searchable
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {mat.product?.unit || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                            {estQty > 0 ? estQty : '-'}
                          </div>
                        ) : (
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={mat.estimatedQty}
                            onChange={(e) => updateMaterial(idx, 'estimatedQty', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                          {price > 0 ? formatRupiah(price) : '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                          {subtotal > 0 ? formatRupiah(subtotal) : '-'}
                        </span>
                      </td>
                      {isEdit && (
                        <>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={mat.savedUsedQty || 0}
                              step="1"
                              value={mat.usedQty}
                              onChange={(e) => updateMaterial(idx, 'usedQty', e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="0"
                            />
                            {isEdit && mat.savedUsedQty > 0 && (parseFloat(mat.usedQty) || 0) < mat.savedUsedQty && (
                              <p className="text-xs text-red-500 mt-1">Minimal {mat.savedUsedQty}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-sm font-medium whitespace-nowrap ${remaining < 0 ? 'text-red-600' : remaining === 0 && estQty > 0 ? 'text-green-600' : 'text-gray-700'}`}>
                              {estQty > 0 ? remaining : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {estQty > 0 ? (
                              <div className="space-y-1">
                                <ProgressBar percent={matPercent} size="sm" />
                                <span className="text-xs text-gray-500">{matPercent}%</span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </td>
                        </>
                      )}
                      <td className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => removeMaterial(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          aria-label={`Hapus material baris ${idx + 1}`}
                        >
                          <HiTrash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Total row */}
              {materialsTotal > 0 && (
                <tfoot>
                  <tr className="bg-blue-50 border-t border-blue-100">
                    <td colSpan={5} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                      Total Estimasi Budget
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-blue-700 whitespace-nowrap">
                      {formatRupiah(materialsTotal)}
                    </td>
                    {isEdit && (
                      <>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-700">
                          {formatRupiah(materialsUsedTotal)}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-700 whitespace-nowrap">
                          {formatRupiah(Math.max(0, materialsTotal - materialsUsedTotal))}
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <ProgressBar percent={budgetProgress} size="sm" />
                            <span className="text-xs text-gray-500">{budgetProgress}%</span>
                          </div>
                        </td>
                      </>
                    )}
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {materials.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              Belum ada material. Klik &quot;Tambah Material&quot; untuk menambahkan.
            </div>
          )}
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate('/proyek')}>
            Batal
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {isEdit ? 'Simpan Perubahan' : 'Simpan Proyek'}
          </Button>
        </div>
      </form>
    </div>
  );
}
