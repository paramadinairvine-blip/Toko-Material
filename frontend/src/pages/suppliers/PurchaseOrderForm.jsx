import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiPlus, HiTrash, HiArrowLeft } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { purchaseOrderAPI, supplierAPI, productAPI, unitAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Card, Button, Select } from '../../components/common';
import useUnsavedChanges from '../../hooks/useUnsavedChanges';
import { formatRupiah } from '../../utils/formatCurrency';

const emptyItem = () => ({
  _key: Date.now() + Math.random(),
  productId: '',
  variantId: '',
  unitId: '',
  quantity: '1',
  unitPrice: '',
  product: null,
});

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([emptyItem()]);
  const [errors, setErrors] = useState({});
  const [isDirty, setIsDirty] = useState(false);

  // ─── Fetch options ──────────────────────────────────
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers-select'],
    queryFn: async () => {
      const { data } = await supplierAPI.getAll({ limit: 200 });
      return data.data || [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ['products-select'],
    queryFn: async () => {
      const { data } = await productAPI.getAll({ limit: 500 });
      return data.data || [];
    },
  });

  const { data: units } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      const { data } = await unitAPI.getMeasures();
      return data.data || [];
    },
  });

  // ─── Load existing PO ──────────────────────────────
  const { data: existing } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const { data } = await purchaseOrderAPI.getById(id);
      return data.data;
    },
    enabled: isEdit,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (existing) {
      setSupplierId(existing.supplierId || '');
      setNotes(existing.notes || '');
      if (existing.items?.length > 0) {
        setItems(
          existing.items.map((item) => ({
            _key: item.id || Date.now() + Math.random(),
            productId: item.productId || '',
            variantId: item.variantId || '',
            unitId: item.unitId || '',
            quantity: item.quantity?.toString() || '1',
            unitPrice: (item.unitPrice ?? item.price)?.toString() || '',
            product: item.product || null,
          }))
        );
      }
    }
  }, [existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ─── Supplier options ──────────────────────────────
  const supplierOptions = (suppliers || []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  // ─── Product options ───────────────────────────────
  const productOptions = (products || []).map((p) => ({
    value: p.id,
    label: p.name,
    product: p,
  }));

  // ─── Helpers ───────────────────────────────────────
  const getProductById = (productId) => {
    return (products || []).find((p) => p.id === productId) || null;
  };

  const getUnitOptions = (productId) => {
    const product = getProductById(productId);
    const opts = [];
    if (product?.unitOfMeasure) {
      opts.push({ value: product.unitOfMeasure.id, label: product.unitOfMeasure.name });
    } else if (product?.unitId) {
      const u = (units || []).find((un) => un.id === product.unitId);
      if (u) opts.push({ value: u.id, label: u.name });
    }
    if (product?.productUnits?.length > 0) {
      product.productUnits.forEach((pu) => {
        if (pu.unit && !opts.find((o) => o.value === pu.unit.id)) {
          opts.push({ value: pu.unit.id, label: `${pu.unit.name} (×${pu.conversionFactor})` });
        }
      });
    }
    if (opts.length === 0) {
      return (units || []).map((u) => ({ value: u.id, label: u.name }));
    }
    return opts;
  };

  const getUnitLabel = (productId) => {
    const product = getProductById(productId);
    if (product?.unit) return product.unit.charAt(0).toUpperCase() + product.unit.slice(1);
    if (product?.unitOfMeasure?.name) return product.unitOfMeasure.name;
    return 'Pcs';
  };

  // Buy price for the chosen unit: product.buyPrice (per base unit) × conversion factor
  const getUnitBuyPrice = (product, unitId) => {
    if (!product) return '';
    const base = parseFloat(product.buyPrice) || 0;
    const baseUnitId = product.unitOfMeasure?.id || product.unitId || '';
    let factor = 1;
    if (unitId && unitId !== baseUnitId) {
      const pu = (product.productUnits || []).find((u) => (u.unit?.id || u.unitId) === unitId);
      factor = parseFloat(pu?.conversionFactor) || 1;
    }
    const price = base * factor;
    return price > 0 ? price.toString() : '';
  };

  const updateItem = (index, field, value) => {
    setIsDirty(true);
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      if (field === 'productId') {
        const product = getProductById(value);
        updated[index].product = product;
        updated[index].variantId = '';
        updated[index].unitId = product?.unitOfMeasure?.id || product?.unitId || '';
        updated[index].unitPrice = getUnitBuyPrice(product, updated[index].unitId);
      }

      if (field === 'unitId') {
        const product = updated[index].product || getProductById(updated[index].productId);
        updated[index].unitPrice = getUnitBuyPrice(product, value);
      }

      return updated;
    });
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const calcItemTotal = (item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.unitPrice) || 0;
    return qty * price;
  };

  const grandTotal = items.reduce((sum, item) => sum + calcItemTotal(item), 0);

  // ─── Mutations ─────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (isEdit) return purchaseOrderAPI.update(id, data);
      return purchaseOrderAPI.create(data);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'PO berhasil diperbarui' : 'PO berhasil dibuat');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate('/purchase-order');
    },
    onError: (err) => {
      const fieldErrors = err?.response?.data?.errors;
      if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        fieldErrors.forEach((e) => toast.error(`${e.field}: ${e.message}`));
      } else {
        toast.error(getErrorMessage(err, 'Gagal menyimpan PO'));
      }
    },
  });

  const saveAndSendMutation = useMutation({
    mutationFn: async (data) => {
      let poId = id;
      if (isEdit) {
        await purchaseOrderAPI.update(id, data);
      } else {
        const res = await purchaseOrderAPI.create(data);
        poId = res.data?.data?.id;
        if (!poId) throw new Error('Gagal mendapatkan ID PO dari server');
      }
      await purchaseOrderAPI.send(poId);
      return poId;
    },
    onSuccess: () => {
      toast.success('PO berhasil disimpan dan dikirim ke supplier');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      navigate('/purchase-order');
    },
    onError: (err) => {
      const fieldErrors = err?.response?.data?.errors;
      if (Array.isArray(fieldErrors) && fieldErrors.length > 0) {
        fieldErrors.forEach((e) => toast.error(`${e.field}: ${e.message}`));
      } else {
        toast.error(getErrorMessage(err, 'Gagal menyimpan & mengirim PO'));
      }
    },
  });

  const validate = () => {
    const errs = {};
    if (!supplierId) errs.supplierId = 'Supplier wajib dipilih';
    const validItems = items.filter((item) => item.productId);
    if (validItems.length === 0) errs.items = 'Minimal 1 item produk';
    for (let i = 0; i < validItems.length; i++) {
      if (!validItems[i].quantity || parseFloat(validItems[i].quantity) <= 0) {
        errs.items = `Jumlah item ke-${i + 1} harus lebih dari 0`;
        break;
      }
      if (!validItems[i].unitPrice || parseFloat(validItems[i].unitPrice) <= 0) {
        errs.items = `Harga satuan item ke-${i + 1} harus lebih dari 0`;
        break;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const buildPayload = () => ({
    supplierId,
    notes: notes.trim() || null,
    items: items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: item.productId,
        variantId: item.variantId || null,
        unitId: item.unitId || null,
        quantity: parseFloat(item.quantity),
        price: parseFloat(item.unitPrice),
      })),
  });

  const handleSaveDraft = (e) => {
    e.preventDefault();
    if (!validate()) return;
    saveMutation.mutate(buildPayload());
  };

  const handleSavePO = () => {
    if (!validate()) return;
    saveAndSendMutation.mutate(buildPayload());
  };

  const isSubmitting = saveMutation.isPending || saveAndSendMutation.isPending;

  useUnsavedChanges(isDirty && !saveMutation.isSuccess && !saveAndSendMutation.isSuccess);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/purchase-order')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Kembali"
        >
          <HiArrowLeft className="w-5 h-5 text-gray-500" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEdit ? 'Edit Purchase Order' : 'Buat Purchase Order'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {isEdit ? 'Perbarui data purchase order' : 'Buat pesanan baru ke supplier'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSaveDraft}>
        {/* Informasi PO */}
        <Card title="INFORMASI PO" padding="md" className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Select
              label="Supplier *"
              value={supplierId}
              onChange={(val) => { setSupplierId(val); setIsDirty(true); }}
              options={supplierOptions}
              placeholder="Pilih supplier..."
              searchable
              error={errors.supplierId}
              autoFocus
            />
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Catatan</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setIsDirty(true); }}
                placeholder="Catatan untuk PO ini (opsional)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </Card>

        {/* Item Pesanan */}
        <Card
          title={
            <span className="flex items-center gap-2">
              ITEM PESANAN
              <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold text-white bg-blue-500 rounded-full">
                {items.filter(i => i.productId).length || items.length}
              </span>
            </span>
          }
          padding="none"
          className="mb-6"
          headerAction={
            <Button variant="outline" size="sm" icon={HiPlus} onClick={addItem} type="button">
              Tambah
            </Button>
          }
        >
          {errors.items && (
            <div className="px-4 pt-3">
              <p className="text-sm text-red-600">{errors.items}</p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider w-8">#</th>
                  <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider min-w-[160px]">Produk</th>
                  <th className="text-left px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider w-28">Satuan</th>
                  <th className="text-center px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider w-20">Qty</th>
                  <th className="text-center px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider w-28">Harga</th>
                  <th className="text-right px-3 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider w-28">Subtotal</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={item._key} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-gray-400 font-medium">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={item.productId}
                        onChange={(val) => updateItem(idx, 'productId', val)}
                        options={productOptions}
                        placeholder="Pilih produk..."
                        searchable
                      />
                    </td>
                    <td className="px-3 py-2">
                      {item.productId ? (
                        <Select
                          value={item.unitId}
                          onChange={(val) => updateItem(idx, 'unitId', val)}
                          options={getUnitOptions(item.productId)}
                          placeholder={getUnitLabel(item.productId)}
                        />
                      ) : (
                        <span className="text-gray-400 text-sm">Pcs</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        placeholder="1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-center text-gray-700">
                        {parseFloat(item.unitPrice) > 0 ? `Rp ${parseFloat(item.unitPrice).toLocaleString('id-ID')}` : '-'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-700 whitespace-nowrap">
                      {formatRupiah(calcItemTotal(item))}
                    </td>
                    <td className="px-1 py-2">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="p-1 text-red-400 hover:text-red-600 transition-colors"
                          aria-label="Hapus item"
                        >
                          <HiTrash className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total */}
          <div className="flex items-center justify-end gap-4 px-4 py-3 border-t border-gray-200">
            <span className="text-sm font-semibold text-gray-600">Total Keseluruhan</span>
            <span className="text-xl font-bold text-blue-600">{formatRupiah(grandTotal)}</span>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" type="button" onClick={() => navigate('/purchase-order')}>
            Batal
          </Button>
          <Button type="submit" variant="outline" loading={saveMutation.isPending} disabled={isSubmitting}>
            Simpan Draft
          </Button>
          <Button type="button" onClick={handleSavePO} loading={saveAndSendMutation.isPending} disabled={isSubmitting}>
            Simpan PO
          </Button>
        </div>
      </form>
    </div>
  );
}
