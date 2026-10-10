import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiArrowLeft, HiPencil, HiPaperAirplane, HiCheck, HiBan } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { purchaseOrderAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Card, Badge, Button, Loading, Table, Modal } from '../../components/common';
import { formatRupiah } from '../../utils/formatCurrency';
import { formatTanggalWaktu } from '../../utils/formatDate';
import { PO_STATUS, PO_STATUS_LABELS, PO_STATUS_COLORS } from '../../utils/constants';
import useAuth from '../../hooks/useAuth';
import { useState, useEffect } from 'react';

const TIMELINE_CONFIG = {
  DRAFT: { label: 'Draft Dibuat', color: 'bg-gray-400' },
  SENT: { label: 'Dikirim ke Supplier', color: 'bg-blue-500' },
  PARTIALLY_RECEIVED: { label: 'Diterima Sebagian', color: 'bg-amber-500' },
  RECEIVED: { label: 'Barang Diterima', color: 'bg-green-500' },
  CANCELLED: { label: 'Dibatalkan', color: 'bg-red-500' },
};

// eslint-disable-next-line no-unused-vars
function StatusTimeline({ status, createdAt, updatedAt }) {
  const flow = ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'];
  const cancelled = status === 'CANCELLED';

  const getStepState = (step) => {
    if (cancelled && step === 'CANCELLED') return 'current';
    if (cancelled) {
      const idx = flow.indexOf(step);
      const cancelPoint = flow.indexOf(status) >= 0 ? flow.indexOf(status) : 0;
      return idx <= cancelPoint ? 'done' : 'pending';
    }
    const currentIdx = flow.indexOf(status);
    const stepIdx = flow.indexOf(step);
    if (stepIdx < currentIdx) return 'done';
    if (stepIdx === currentIdx) return 'current';
    return 'pending';
  };

  const steps = cancelled ? [...flow.slice(0, flow.indexOf('SENT') + 1), 'CANCELLED'] : flow;

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, idx) => {
        const state = getStepState(step);
        const config = TIMELINE_CONFIG[step];
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                  state === 'done' ? 'bg-green-500'
                    : state === 'current' ? config.color
                      : 'bg-gray-200'
                }`}
              >
                {state === 'done' ? '✓' : idx + 1}
              </div>
              <span className={`text-xs mt-1 whitespace-nowrap ${
                state === 'pending' ? 'text-gray-400' : 'text-gray-700 font-medium'
              }`}>
                {config.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-12 h-0.5 mx-1 ${
                state === 'done' ? 'bg-green-500' : 'bg-gray-200'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Helper: get unit display name for a PO item
 */
const getItemUnitName = (item) => {
  if (item.unit?.name) return item.unit.name;
  if (item.product?.unitOfMeasure?.name) return item.product.unitOfMeasure.name;
  if (item.product?.unit) return item.product.unit;
  return 'Pcs';
};

/**
 * Helper: get conversion factor for a PO item
 */
const getItemConversionFactor = (item) => {
  if (!item.unitId || !item.product) return 1;

  // Jika unitId PO = unitId base product, factor = 1
  if (item.unitId === item.product.unitId) return 1;

  // Cari di productUnits
  const pu = (item.product.productUnits || []).find(
    (pu) => pu.unit?.id === item.unitId
  );
  if (pu) return Number(pu.conversionFactor) || 1;

  // Fallback: hitung dari baseQty / quantity
  if (item.baseQty && item.quantity && item.quantity > 0) {
    return Math.round(item.baseQty / item.quantity);
  }

  return 1;
};

/**
 * Helper: get base unit name
 */
const getBaseUnitName = (item) => {
  if (item.product?.unitOfMeasure?.name) return item.product.unitOfMeasure.name;
  if (item.product?.unit) return item.product.unit;
  return 'Pcs';
};

export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isKasir } = useAuth();
  const canEdit = isAdmin || isKasir;

  const [actionModal, setActionModal] = useState(null);
  const [receivedQtys, setReceivedQtys] = useState({});

  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: async () => {
      const { data } = await purchaseOrderAPI.getById(id);
      return data.data;
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => purchaseOrderAPI.send(id),
    onSuccess: () => {
      toast.success('PO berhasil dikirim');
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
      setActionModal(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal mengirim PO')),
  });

  const receiveMutation = useMutation({
    mutationFn: (receivedItems) => purchaseOrderAPI.receive(id, { receivedItems }),
    onSuccess: () => {
      toast.success('Barang berhasil diterima, stok diperbarui');
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      setActionModal(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal menerima barang')),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseOrderAPI.cancel(id),
    onSuccess: () => {
      toast.success('PO berhasil dibatalkan');
      queryClient.invalidateQueries({ queryKey: ['purchase-order', id] });
      setActionModal(null);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal membatalkan PO')),
  });

  const handleAction = () => {
    if (actionModal === 'send') sendMutation.mutate();
    else if (actionModal === 'cancel') cancelMutation.mutate();
  };

  const handleReceive = () => {
    const over = (po?.items || []).find((item) => {
      const remaining = Math.max(0, item.quantity - (item.receivedQty || 0));
      return (parseInt(receivedQtys[item.id]) || 0) > remaining;
    });
    if (over) {
      const remaining = Math.max(0, over.quantity - (over.receivedQty || 0));
      toast.error(`${over.product?.name || 'Item'}: jumlah diterima melebihi sisa pesanan (maks ${remaining})`);
      return;
    }
    const items = (po?.items || []).map((item) => ({
      itemId: item.id,
      receivedQty: parseInt(receivedQtys[item.id]) || 0,
    }));
    const hasAnyQty = items.some((i) => i.receivedQty > 0);
    if (!hasAnyQty) {
      toast.error('Isi minimal 1 item yang diterima');
      return;
    }
    receiveMutation.mutate(items);
  };

  // Initialize receivedQtys when opening receive modal — pre-fill with remaining qty
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (actionModal === 'receive' && po?.items) {
      const initial = {};
      po.items.forEach((item) => {
        const remaining = item.quantity - (item.receivedQty || 0);
        initial[item.id] = Math.max(0, remaining);
      });
      setReceivedQtys(initial);
    }
  }, [actionModal, po?.items]);

  const isActionLoading = sendMutation.isPending || receiveMutation.isPending || cancelMutation.isPending;

  const actionModalConfig = {
    send: {
      title: 'Kirim PO ke Supplier',
      message: 'PO akan dikirim ke supplier. Lanjutkan?',
      buttonText: 'Kirim',
      variant: 'primary',
    },
    cancel: {
      title: 'Batalkan PO',
      message: 'Apakah Anda yakin? Tindakan ini tidak dapat dibatalkan.',
      buttonText: 'Batalkan PO',
      variant: 'danger',
    },
  };

  if (isLoading) return <Loading text="Memuat detail PO..." />;
  if (!po) return <p className="text-center text-gray-500 py-12">Purchase Order tidak ditemukan</p>;

  const modalCfg = actionModalConfig[actionModal] || {};

  const itemColumns = [
    {
      key: 'product',
      header: 'Produk',
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.product?.name || '-'}</p>
        </div>
      ),
    },
    {
      key: 'variant',
      header: 'Varian',
      render: (_, row) => <span className="text-gray-600">{row.variant?.name || '-'}</span>,
    },
    {
      key: 'unit',
      header: 'Satuan',
      render: (_, row) => {
        const unitName = getItemUnitName(row);
        const factor = getItemConversionFactor(row);
        const baseUnit = getBaseUnitName(row);
        return (
          <div>
            <span className="text-gray-600">{unitName}</span>
            {factor > 1 && (
              <span className="text-xs text-blue-500 ml-1">
                ({'\u00d7'}{factor} {baseUnit})
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'quantity',
      header: 'Dipesan',
      render: (v, row) => {
        const factor = getItemConversionFactor(row);
        const baseUnit = getBaseUnitName(row);
        return (
          <div>
            <span className="font-medium">{v}</span>
            {factor > 1 && (
              <span className="text-xs text-gray-400 ml-1">
                = {v * factor} {baseUnit}
              </span>
            )}
          </div>
        );
      },
    },
    ...(['RECEIVED', 'PARTIALLY_RECEIVED', 'CANCELLED'].includes(po.status) ? [{
      key: 'receivedQty',
      header: 'Diterima',
      render: (v, row) => {
        const qty = v ?? 0;
        const isShort = qty < row.quantity;
        const isCancelled = po.status === 'CANCELLED';
        const factor = getItemConversionFactor(row);
        const baseUnit = getBaseUnitName(row);
        return (
          <div>
            <span className={`font-medium ${isCancelled ? (qty > 0 ? 'text-blue-600' : 'text-gray-400') : isShort ? 'text-amber-600' : 'text-green-600'}`}>
              {qty} / {row.quantity}
              {isCancelled && qty < row.quantity && <span className="text-xs text-red-500 ml-1">(batal {row.quantity - qty})</span>}
              {!isCancelled && isShort && <span className="text-xs text-amber-500 ml-1">(sisa {row.quantity - qty})</span>}
            </span>
            {factor > 1 && (
              <div className="text-xs text-gray-400">
                = {(row.receivedBaseQty || qty * factor)} / {row.baseQty || row.quantity * factor} {baseUnit}
              </div>
            )}
          </div>
        );
      },
    }] : []),
    {
      key: 'price',
      header: 'Harga Satuan',
      render: (v) => formatRupiah(v),
    },
    {
      key: 'subtotal',
      header: 'Total',
      render: (v, row) => (
        <span className="font-medium text-gray-900">
          {formatRupiah(v || (row.quantity * row.price))}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/purchase-order')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Kembali">
            <HiArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{po.poNumber}</h1>
              {(() => {
                const hasReceived = po.status === 'CANCELLED' && po.items?.some((i) => (i.receivedQty || 0) > 0);
                return (
                  <Badge colorClass={hasReceived ? PO_STATUS_COLORS.PARTIALLY_RECEIVED : PO_STATUS_COLORS[po.status]} size="sm">
                    {hasReceived ? 'Sebagian Diterima' : PO_STATUS_LABELS[po.status]}
                  </Badge>
                );
              })()}
            </div>
            <p className="text-sm text-gray-500">Dibuat {formatTanggalWaktu(po.createdAt)}</p>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            {po.status === PO_STATUS.DRAFT && (
              <>
                <Button variant="outline" size="sm" icon={HiPencil} onClick={() => navigate(`/purchase-order/${id}/edit`)}>
                  Edit
                </Button>
                <Button size="sm" icon={HiPaperAirplane} onClick={() => setActionModal('send')}>
                  Kirim
                </Button>
                <Button variant="danger" size="sm" icon={HiBan} onClick={() => setActionModal('cancel')}>
                  Batalkan
                </Button>
              </>
            )}
            {(po.status === PO_STATUS.SENT || po.status === PO_STATUS.PARTIALLY_RECEIVED) && (
              <>
                <Button size="sm" icon={HiCheck} onClick={() => setActionModal('receive')}>
                  Terima Barang
                </Button>
                <Button variant="danger" size="sm" icon={HiBan} onClick={() => setActionModal('cancel')}>
                  {po.status === PO_STATUS.PARTIALLY_RECEIVED ? 'Batalkan Sisa' : 'Batalkan'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <Card padding="md">
        <p className="text-sm font-medium text-gray-700 mb-4">Status PO</p>
        <div className="flex justify-center overflow-x-auto py-2">
          <StatusTimeline status={po.status} createdAt={po.createdAt} updatedAt={po.updatedAt} />
        </div>
      </Card>

      {/* PO Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Informasi PO" padding="md">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">No. PO</span>
              <span className="text-sm font-mono font-medium">{po.poNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Tanggal</span>
              <span className="text-sm">{formatTanggalWaktu(po.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-sm font-bold text-blue-600">{formatRupiah(po.totalAmount)}</span>
            </div>
            {po.notes && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Catatan</p>
                <p className="text-sm text-gray-700">{po.notes}</p>
              </div>
            )}
            {po.status === 'CANCELLED' && po.items?.some((i) => (i.receivedQty || 0) > 0) && (
              <div className="pt-3 border-t border-gray-100">
                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-medium text-amber-800">Diterima sebagian, sisa pesanan dibatalkan</p>
                  <p className="text-xs text-amber-600 mt-1">
                    Barang yang sudah diterima tetap masuk stok. Sisa yang belum diterima dibatalkan.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card title="Informasi Supplier" padding="md">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Nama</span>
              <span className="text-sm font-medium">{po.supplier?.name || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Kontak</span>
              <span className="text-sm">{po.supplier?.contactName || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Telepon</span>
              <span className="text-sm">{po.supplier?.phone || '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Email</span>
              <span className="text-sm">{po.supplier?.email || '-'}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Items */}
      <Card title={`Item Pesanan (${po.items?.length || 0})`} padding="none">
        <Table
          columns={itemColumns}
          data={po.items || []}
          emptyMessage="Tidak ada item"
        />
        {po.items?.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Keseluruhan</p>
              <p className="text-xl font-bold text-blue-600">{formatRupiah(po.totalAmount)}</p>
            </div>
          </div>
        )}
      </Card>

      {/* Created/Updated info */}
      <div className="text-xs text-gray-400 text-right space-y-0.5">
        {po.createdBy && <p>Dibuat oleh: {po.createdBy.fullName}</p>}
        {po.updatedAt !== po.createdAt && <p>Terakhir diubah: {formatTanggalWaktu(po.updatedAt)}</p>}
      </div>

      {/* Action Modal (Send / Cancel) */}
      <Modal
        isOpen={!!actionModal && actionModal !== 'receive'}
        onClose={() => setActionModal(null)}
        title={modalCfg.title}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setActionModal(null)}>Batal</Button>
            <Button variant={modalCfg.variant} loading={isActionLoading} onClick={handleAction}>
              {modalCfg.buttonText}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">{modalCfg.message}</p>
      </Modal>

      {/* Receive Modal — tabel input qty per item dengan info konversi */}
      <Modal
        isOpen={actionModal === 'receive'}
        onClose={() => setActionModal(null)}
        title="Terima Barang"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setActionModal(null)}>Batal</Button>
            <Button loading={receiveMutation.isPending} onClick={handleReceive}>
              Terima Barang
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 mb-4">
          {po?.status === 'PARTIALLY_RECEIVED'
            ? 'Masukkan jumlah barang yang diterima pada batch ini. Default diisi sisa yang belum diterima.'
            : 'Masukkan jumlah barang yang diterima untuk setiap item. Default sudah diisi sesuai jumlah yang dipesan.'
          }
        </p>
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Produk</th>
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Satuan</th>
                <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Dipesan</th>
                {po?.status === 'PARTIALLY_RECEIVED' && (
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Sudah Diterima</th>
                )}
                <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Diterima Batch Ini</th>
              </tr>
            </thead>
            <tbody>
              {(po?.items || []).map((item) => {
                const remaining = item.quantity - (item.receivedQty || 0);
                const isFullyReceived = remaining <= 0;
                const factor = getItemConversionFactor(item);
                const unitName = getItemUnitName(item);
                const baseUnit = getBaseUnitName(item);
                const batchQty = parseInt(receivedQtys[item.id]) || 0;

                return (
                  <tr key={item.id} className={`border-b border-gray-100 ${isFullyReceived ? 'bg-green-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-900">{item.product?.name || '-'}</p>
                      {factor > 1 && (
                        <p className="text-xs text-blue-500 mt-0.5">
                          1 {unitName} = {factor} {baseUnit}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{unitName}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{item.quantity}</td>
                    {po?.status === 'PARTIALLY_RECEIVED' && (
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        <span className={isFullyReceived ? 'text-green-600 font-medium' : 'text-amber-600'}>
                          {item.receivedQty || 0}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      {isFullyReceived ? (
                        <span className="text-green-600 text-xs font-medium">Lengkap</span>
                      ) : (
                        <div>
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            value={receivedQtys[item.id] ?? remaining}
                            onChange={(e) => {
                              // Never more than what is still outstanding on this PO line
                              const raw = e.target.value;
                              const val = raw !== '' && Number(raw) > remaining ? String(remaining) : raw;
                              setReceivedQtys((prev) => ({ ...prev, [item.id]: val }));
                            }}
                            className="w-20 rounded border-gray-300 text-sm py-1.5 px-2 text-right focus:border-blue-500 focus:ring-blue-500"
                          />
                          <p className="text-xs text-gray-500 mt-1">Sisa: {remaining} {unitName} (maks)</p>
                          {factor > 1 && batchQty > 0 && (
                            <p className="text-xs text-gray-400 mt-1">
                              = {batchQty * factor} {baseUnit}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
