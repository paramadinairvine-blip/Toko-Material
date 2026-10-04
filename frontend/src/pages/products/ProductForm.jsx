import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiPlus, HiTrash, HiUpload, HiArrowLeft, HiRefresh } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { productAPI, categoryAPI, brandAPI, unitAPI } from '../../api/endpoints';
import { Button, Input, Select, Card } from '../../components/common';
import { getErrorMessage } from '../../utils/handleError';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ─── Form state ──────────────────────────────────────
  const [form, setForm] = useState({
    name: '', categoryId: '', brandId: '', supplierId: '', description: '',
    unit: 'pcs', buyPrice: '', sellPrice: '', stock: '0',
    minStock: '0', maxStock: '', image: '', barcode: '',
  });
  const [barcodeMode, setBarcodeMode] = useState('auto');
  const [sellUnits, setSellUnits] = useState([]);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageProgress, setImageProgress] = useState(0);
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);

  // ─── Fetch options ───────────────────────────────────
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => { const { data } = await categoryAPI.getAll(); return data.data; },
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => { const { data } = await brandAPI.getAll(); return data.data; },
  });

  const { data: unitMeasures } = useQuery({
    queryKey: ['unitMeasures'],
    queryFn: async () => { const { data } = await unitAPI.getMeasures(); return data.data; },
  });

  // ─── Load existing product ──────────────────────────
  const { data: existing } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => { const { data } = await productAPI.getById(id); return data.data; },
    enabled: isEdit,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        categoryId: existing.categoryId || '',
        brandId: existing.brandId || '',
        supplierId: existing.supplierId || '',
        description: existing.description || '',
        unit: existing.unit || 'pcs',
        buyPrice: existing.buyPrice?.toString() || '',
        sellPrice: existing.sellPrice?.toString() || '',
        stock: existing.stock?.toString() || '0',
        minStock: existing.minStock?.toString() || '0',
        maxStock: existing.maxStock?.toString() || '',
        image: existing.image || '',
        barcode: existing.barcode || '',
      });
      if (existing.barcode) setBarcodeMode('manual');
      if (existing.image) setImagePreview(existing.image);
      if (existing.productUnits?.length) {
        setSellUnits(existing.productUnits.map((pu) => ({
          unitId: pu.unit?.id || pu.unitId,
          unitName: pu.unit?.name || '',
          qty: pu.conversionFactor?.toString() || '1',
          buyPrice: pu.buyPrice?.toString() || '',
          sellPrice: pu.sellPrice?.toString() || '',
          isDefault: pu.isBaseUnit || false,
        })));
      }
    }
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Category options (tree) ─────────────────────────
  const categoryOptions = [];
  if (categories) {
    categories.forEach((cat) => {
      categoryOptions.push({ value: cat.id, label: cat.name });
      if (cat.children) {
        cat.children.forEach((sub) => {
          categoryOptions.push({ value: sub.id, label: `  └ ${sub.name}` });
          if (sub.children) {
            sub.children.forEach((subsub) => {
              categoryOptions.push({ value: subsub.id, label: `     └ ${subsub.name}` });
            });
          }
        });
      }
    });
  }

  const brandOptions = (brands || []).map((b) => ({ value: b.id, label: b.name }));

  const commonUnits = ['pcs', 'kg', 'sak', 'box', 'batang', 'meter', 'liter', 'lembar', 'roll', 'set'];

  // ─── Handlers ────────────────────────────────────────
  const updateForm = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: null }));
  };

  const addSellUnit = () => {
    setSellUnits((prev) => [...prev, { unitId: '', unitName: '', qty: '1', buyPrice: '', sellPrice: '', isDefault: prev.length === 0 }]);
  };

  const updateSellUnit = (idx, field, value) => {
    setSellUnits((prev) => prev.map((u, i) => {
      if (i !== idx) return field === 'isDefault' && value ? { ...u, isDefault: false } : u;
      if (field === 'unitId') {
        // Common units not yet in master data are sent by name (backend creates them)
        if (value.startsWith('name:')) {
          return { ...u, unitId: '', unitName: value.slice(5) };
        }
        const selected = unitMeasures?.find((m) => m.id === value);
        return { ...u, unitId: value, unitName: selected?.name || '' };
      }
      return { ...u, [field]: value };
    }));
    setIsDirty(true);
  };

  const removeSellUnit = (idx) => {
    setSellUnits((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (prev[idx]?.isDefault && next.length > 0) {
        next[0].isDefault = true;
      }
      return next;
    });
    setIsDirty(true);
  };

  // Format angka dengan titik ribuan untuk display
  const formatThousands = (val) => {
    if (!val && val !== 0) return '';
    return String(val).replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  // Parse angka dari format titik ribuan
  const parseThousands = (val) => {
    return val.replace(/\./g, '');
  };

  // Handler untuk input harga dengan format titik ribuan
  const handlePriceChange = (field, value) => {
    const raw = parseThousands(value);
    updateForm(field, raw);
  };

  const handleUnitPriceChange = (idx, field, value) => {
    const raw = parseThousands(value);
    updateSellUnit(idx, field, raw);
  };

  const calcMargin = (buy, sell) => {
    const b = parseFloat(buy);
    const s = parseFloat(sell);
    if (!b || !s || b === 0) return '';
    return (((s - b) / b) * 100).toFixed(2);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 2MB');
      return;
    }
    setImageUploading(true);
    setImageProgress(0);
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setImageProgress(pct);
      }
    };
    reader.onload = () => {
      const base64 = reader.result;
      setImagePreview(base64);
      updateForm('image', base64);
      setImageUploading(false);
      setImageProgress(100);
      toast.success('Gambar berhasil dimuat');
    };
    reader.onerror = () => {
      setImageUploading(false);
      setImageProgress(0);
      toast.error('Gagal membaca file gambar');
    };
    reader.readAsDataURL(file);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) return productAPI.update(id, payload);
      return productAPI.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Produk berhasil diperbarui' : 'Produk berhasil ditambahkan');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      navigate('/produk');
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menyimpan produk')),
  });

  useUnsavedChanges(isDirty && !saveMutation.isSuccess);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Nama produk wajib diisi';
    if (!form.categoryId) errs.categoryId = 'Kategori wajib dipilih';
    if (!form.buyPrice || parseFloat(form.buyPrice) <= 0) errs.buyPrice = 'Harga beli wajib diisi';
    if (!form.sellPrice || parseFloat(form.sellPrice) <= 0) errs.sellPrice = 'Harga jual wajib diisi';
    if (barcodeMode === 'manual' && form.barcode && form.barcode.trim().length < 3) {
      errs.barcode = 'Barcode minimal 3 karakter';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      name: form.name,
      categoryId: form.categoryId,
      brandId: form.brandId || undefined,
      supplierId: form.supplierId || undefined,
      description: form.description || undefined,
      unit: form.unit,
      buyPrice: parseFloat(form.buyPrice) || 0,
      sellPrice: parseFloat(form.sellPrice) || 0,
      minStock: parseInt(form.minStock) || 0,
      maxStock: form.maxStock ? parseInt(form.maxStock) : undefined,
      image: form.image || undefined,
    };

    // Stock is only set on create; on edit it is changed via stock movements/opname,
    // so sending the (possibly stale) form value would overwrite live stock.
    if (!isEdit) {
      payload.stock = parseInt(form.stock) || 0;
    }

    if (barcodeMode === 'manual' && form.barcode.trim()) {
      payload.barcode = form.barcode.trim();
    }

    // On edit always send units (even []) so removing all extra units is saved
    if (isEdit || sellUnits.length > 0) {
      payload.units = sellUnits
        .filter((u) => u.unitId || u.unitName)
        .map((u) => ({
          unitId: u.unitId || undefined,
          unitName: u.unitName || undefined,
          conversionFactor: parseFloat(u.qty) || 1,
          isBaseUnit: u.isDefault,
        }));
    }

    saveMutation.mutate(payload);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={HiArrowLeft} onClick={() => navigate('/produk')}>Kembali</Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Produk' : 'Tambah Produk'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isEdit ? 'Perbarui informasi produk' : 'Isi data produk baru'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Informasi Dasar">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Nama Produk" value={form.name} onChange={(e) => updateForm('name', e.target.value)} error={errors.name} placeholder="Contoh: Semen Tiga Roda 50kg" className="md:col-span-2" autoFocus />
            <Select label="Kategori" options={categoryOptions} value={form.categoryId} onChange={(v) => updateForm('categoryId', v)} error={errors.categoryId} placeholder="Pilih kategori..." searchable />
            <Select label="Brand" options={brandOptions} value={form.brandId} onChange={(v) => updateForm('brandId', v)} placeholder="Pilih brand (opsional)..." searchable />
            <Input label="Deskripsi" type="textarea" value={form.description} onChange={(e) => updateForm('description', e.target.value)} placeholder="Deskripsi produk (opsional)" className="md:col-span-2" />
          </div>
        </Card>

        <Card title="Foto Produk">
          <div className="flex items-start gap-6">
            <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 flex-shrink-0 relative">
              {imageUploading ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-10">
                  <svg className="animate-spin w-8 h-8 text-blue-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-xs text-blue-600 font-medium">{imageProgress}%</span>
                  <div className="w-20 h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${imageProgress}%` }} />
                  </div>
                </div>
              ) : imagePreview ? (
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400 text-center px-2">Belum ada foto</span>
              )}
            </div>
            <div>
              <label className={`inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium transition-colors ${imageUploading ? 'text-gray-400 cursor-not-allowed opacity-60' : 'text-gray-700 hover:bg-gray-50 cursor-pointer'}`}>
                <HiUpload className="w-4 h-4" />
                {imageUploading ? 'Memproses...' : 'Upload Gambar'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageUpload} disabled={imageUploading} />
              </label>
              <p className="text-xs text-gray-500 mt-2">Format: JPG, PNG, WebP. Maks 2MB.</p>
            </div>
          </div>
        </Card>

        <Card title="Barcode">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="barcodeMode" checked={barcodeMode === 'auto'} onChange={() => { setBarcodeMode('auto'); updateForm('barcode', ''); }} className="text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-gray-700">Auto Generate</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="barcodeMode" checked={barcodeMode === 'manual'} onChange={() => setBarcodeMode('manual')} className="text-blue-600 focus:ring-blue-500" />
                <span className="text-sm font-medium text-gray-700">Input Manual</span>
              </label>
            </div>
            {barcodeMode === 'auto' ? (
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                <HiRefresh className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <p className="text-sm text-blue-700">
                  Barcode akan otomatis di-generate saat produk disimpan.
                  {isEdit && existing?.barcode && (
                    <span className="block mt-1 font-mono font-semibold">{existing.barcode}</span>
                  )}
                </p>
              </div>
            ) : (
              <Input label="Barcode" value={form.barcode} onChange={(e) => updateForm('barcode', e.target.value)} error={errors.barcode} placeholder="Masukkan barcode manual" />
            )}
          </div>
        </Card>

        <Card title="Harga & Stok">
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Satuan Terkecil</label>
                <select value={form.unit} onChange={(e) => updateForm('unit', e.target.value)} className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm">
                  {(unitMeasures?.length > 0 ? unitMeasures.map((u) => u.name.toLowerCase()) : commonUnits).map((u) => (
                    <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
                  ))}
                </select>
              </div>
              <Input label="Alert (Peringatan Stok)" type="number" value={form.minStock} onChange={(e) => updateForm('minStock', e.target.value)} placeholder="0" min="0" helperText="Notifikasi saat stok dibawah jumlah ini" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Satuan Jual</h4>
                  <p className="text-xs text-gray-400 mt-0.5">Tentukan harga untuk setiap paket satuan jual</p>
                </div>
                <Button variant="outline" size="sm" icon={HiPlus} onClick={addSellUnit} type="button">
                  Tambah Paket Jual
                </Button>
              </div>

              {sellUnits.length === 0 ? (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Satuan</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Berisi</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Harga Beli</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Harga Jual</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">% Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="px-3 py-2"><span className="text-gray-700 font-medium capitalize">{form.unit}</span></td>
                        <td className="px-3 py-2"><span className="text-gray-500">1 {form.unit}</span></td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 text-xs">Rp.</span>
                            <input type="text" inputMode="numeric" value={formatThousands(form.buyPrice)} onChange={(e) => handlePriceChange('buyPrice', e.target.value)} placeholder="0" className={`w-28 rounded text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500 ${errors.buyPrice ? 'border-red-400' : 'border-gray-300'}`} />
                          </div>
                          {errors.buyPrice && <p className="text-xs text-red-500 mt-1">{errors.buyPrice}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 text-xs">Rp.</span>
                            <input type="text" inputMode="numeric" value={formatThousands(form.sellPrice)} onChange={(e) => handlePriceChange('sellPrice', e.target.value)} placeholder="0" className={`w-28 rounded text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500 ${errors.sellPrice ? 'border-red-400' : 'border-gray-300'}`} />
                          </div>
                          {errors.sellPrice && <p className="text-xs text-red-500 mt-1">{errors.sellPrice}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-sm text-gray-500 font-mono">{calcMargin(form.buyPrice, form.sellPrice) ? `${calcMargin(form.buyPrice, form.sellPrice)}%` : '-'}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-2 py-2.5 text-center font-semibold text-gray-600 w-8"></th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Satuan Jual</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Berisi</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Harga Beli</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Harga Jual</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-gray-600">% Margin</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-gray-600">Default</th>
                        <th className="px-2 py-2.5 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100 bg-blue-50/30">
                        <td className="px-2 py-2 text-center"><span className="text-gray-400 text-xs">1</span></td>
                        <td className="px-3 py-2"><span className="text-gray-700 font-medium capitalize">{form.unit}</span><span className="text-xs text-blue-500 ml-1">(dasar)</span></td>
                        <td className="px-3 py-2"><span className="text-gray-500">1 {form.unit}</span></td>
                        <td className="px-3 py-2"><div className="flex items-center gap-1"><span className="text-gray-400 text-xs">Rp.</span><input type="text" inputMode="numeric" value={formatThousands(form.buyPrice)} onChange={(e) => handlePriceChange('buyPrice', e.target.value)} placeholder="0" className={`w-24 rounded text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500 ${errors.buyPrice ? 'border-red-400' : 'border-gray-300'}`} /></div>{errors.buyPrice && <p className="text-xs text-red-500 mt-1">{errors.buyPrice}</p>}</td>
                        <td className="px-3 py-2"><div className="flex items-center gap-1"><span className="text-gray-400 text-xs">Rp.</span><input type="text" inputMode="numeric" value={formatThousands(form.sellPrice)} onChange={(e) => handlePriceChange('sellPrice', e.target.value)} placeholder="0" className={`w-24 rounded text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500 ${errors.sellPrice ? 'border-red-400' : 'border-gray-300'}`} /></div>{errors.sellPrice && <p className="text-xs text-red-500 mt-1">{errors.sellPrice}</p>}</td>
                        <td className="px-3 py-2"><span className="text-sm text-gray-500 font-mono">{calcMargin(form.buyPrice, form.sellPrice) ? `${calcMargin(form.buyPrice, form.sellPrice)}%` : '-'}</span></td>
                        <td className="px-3 py-2 text-center"><input type="radio" name="defaultUnit" checked={!sellUnits.some(u => u.isDefault)} onChange={() => setSellUnits(prev => prev.map(u => ({ ...u, isDefault: false })))} className="text-blue-600 focus:ring-blue-500" /></td>
                        <td className="px-2 py-2"></td>
                      </tr>
                      {sellUnits.map((su, idx) => (
                        <tr key={idx} className="border-b border-gray-100">
                          <td className="px-2 py-2 text-center"><span className="text-gray-400 text-xs">{idx + 2}</span></td>
                          <td className="px-3 py-2">
                            <select value={su.unitId || (su.unitName ? `name:${su.unitName}` : '')} onChange={(e) => updateSellUnit(idx, 'unitId', e.target.value)} className="w-full rounded border-gray-300 text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500">
                              <option value="">Pilih...</option>
                              {unitMeasures?.map((u) => (<option key={u.id} value={u.id}>{u.name}</option>))}
                              {commonUnits.filter(cu => !unitMeasures?.some(m => m.name.toLowerCase() === cu)).map((u) => (<option key={u} value={`name:${u}`}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>))}
                            </select>
                          </td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1"><input type="number" value={su.qty} onChange={(e) => updateSellUnit(idx, 'qty', e.target.value)} placeholder="1" min="1" className="w-16 rounded border-gray-300 text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500" /><span className="text-gray-500 text-xs capitalize">{form.unit}</span></div></td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1"><span className="text-gray-400 text-xs">Rp.</span><input type="text" inputMode="numeric" value={formatThousands(su.buyPrice)} onChange={(e) => handleUnitPriceChange(idx, 'buyPrice', e.target.value)} placeholder="0" className="w-24 rounded border-gray-300 text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500" /></div></td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1"><span className="text-gray-400 text-xs">Rp.</span><input type="text" inputMode="numeric" value={formatThousands(su.sellPrice)} onChange={(e) => handleUnitPriceChange(idx, 'sellPrice', e.target.value)} placeholder="0" className="w-24 rounded border-gray-300 text-sm py-1.5 px-2 focus:border-blue-500 focus:ring-blue-500" /></div></td>
                          <td className="px-3 py-2"><span className="text-sm text-gray-500 font-mono">{calcMargin(su.buyPrice, su.sellPrice) ? `${calcMargin(su.buyPrice, su.sellPrice)}%` : '-'}</span></td>
                          <td className="px-3 py-2 text-center"><input type="radio" name="defaultUnit" checked={su.isDefault} onChange={() => setSellUnits(prev => prev.map((u, i) => ({ ...u, isDefault: i === idx })))} className="text-blue-600 focus:ring-blue-500" /></td>
                          <td className="px-2 py-2 text-center"><button type="button" onClick={() => removeSellUnit(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"><HiTrash className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-200">
                    <button type="button" onClick={addSellUnit} className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                      <HiPlus className="w-4 h-4" />
                      Tambah Paket Jual
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
          <Button variant="outline" onClick={() => navigate('/produk')}>Batal</Button>
          <Button type="submit" loading={saveMutation.isPending}>
            {isEdit ? 'Simpan Perubahan' : 'Simpan Produk'}
          </Button>
        </div>
      </form>
    </div>
  );
}
