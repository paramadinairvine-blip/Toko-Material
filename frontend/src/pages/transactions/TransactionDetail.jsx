import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HiArrowLeft, HiBan, HiPrinter, HiRefresh } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { transactionAPI } from '../../api/endpoints';
import { getErrorMessage } from '../../utils/handleError';
import { Card, Badge, Button, Loading, Table, Modal } from '../../components/common';
import { formatRupiah } from '../../utils/formatCurrency';
import { formatTanggalWaktu, formatTanggalPanjang } from '../../utils/formatDate';
import {
  TRANSACTION_TYPE_LABELS, TRANSACTION_TYPE_COLORS,
  TRANSACTION_STATUS_LABELS, TRANSACTION_STATUS_COLORS,
} from '../../utils/constants';
import useAuth from '../../hooks/useAuth';
import ReceiptPrint from '../../components/ReceiptPrint';
import DeliveryNotePrint from '../../components/DeliveryNotePrint';
import InvoicePrint from '../../components/InvoicePrint';
import ReturModal from '../../components/ReturModal';

export default function TransactionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isKasir } = useAuth();
  // Backend POST /returns is limited to ADMIN and KASIR
  const canReturn = isAdmin || isKasir;

  const [showCancel, setShowCancel] = useState(false);
  const [showRetur, setShowRetur] = useState(false);
  const [printMode, setPrintMode] = useState(null); // 'receipt' | 'delivery' | 'invoice'

  const { data: trx, isLoading } = useQuery({
    queryKey: ['transaction', id],
    queryFn: async () => {
      const { data } = await transactionAPI.getById(id);
      return data.data;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => transactionAPI.cancel(id),
    onSuccess: () => {
      toast.success('Transaksi berhasil dibatalkan');
      queryClient.invalidateQueries({ queryKey: ['transaction', id] });
      setShowCancel(false);
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal membatalkan')),
  });

  if (isLoading) return <Loading text="Memuat detail transaksi..." />;
  if (!trx) return <p className="text-center text-gray-500 py-12">Transaksi tidak ditemukan</p>;

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
      render: (_, row) => <span className="text-gray-600">{row.unit?.abbreviation || row.unit?.name || row.product?.unitOfMeasure?.abbreviation || row.product?.unit || '-'}</span>,
    },
    {
      key: 'quantity',
      header: 'Jumlah',
      render: (v) => <span className="font-medium">{v}</span>,
    },
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
          <button onClick={() => navigate('/transaksi')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Kembali">
            <HiArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{trx.transactionNumber}</h1>
              <Badge colorClass={TRANSACTION_STATUS_COLORS[trx.status]} size="sm">
                {TRANSACTION_STATUS_LABELS[trx.status]}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">{formatTanggalWaktu(trx.createdAt)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Print buttons */}
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={() => setPrintMode('receipt')} aria-label="Cetak nota">
            Nota
          </Button>
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={() => setPrintMode('delivery')} aria-label="Cetak surat jalan">
            Surat Jalan
          </Button>
          <Button variant="outline" size="sm" icon={HiPrinter} onClick={() => setPrintMode('invoice')} aria-label="Cetak faktur">
            Faktur
          </Button>

          {canReturn && trx.status === 'COMPLETED' && (
            <Button variant="outline" size="sm" icon={HiRefresh} onClick={() => setShowRetur(true)} aria-label="Retur transaksi"
              className="!text-green-600 !border-green-300 hover:!bg-green-50">
              Retur
            </Button>
          )}
          {isAdmin && trx.status === 'COMPLETED' && (
            <Button variant="danger" size="sm" icon={HiBan} onClick={() => setShowCancel(true)} aria-label="Batalkan transaksi">
              Batalkan
            </Button>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Informasi Transaksi" padding="md">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Nomor</span>
              <span className="text-sm font-mono font-medium">{trx.transactionNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Tanggal</span>
              <span className="text-sm">{formatTanggalPanjang(trx.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Tipe</span>
              <Badge colorClass={TRANSACTION_TYPE_COLORS[trx.type]} size="sm">
                {TRANSACTION_TYPE_LABELS[trx.type]}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Total</span>
              <span className="text-sm font-bold text-blue-600">{formatRupiah(trx.total)}</span>
            </div>
            {trx.notes && (
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 mb-1">Catatan</p>
                <p className="text-sm text-gray-700">{trx.notes}</p>
              </div>
            )}
          </div>
        </Card>

        <Card title="Kasir" padding="md">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-gray-500">Kasir</span>
              <span className="text-sm font-medium">{trx.creator?.fullName || '-'}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Items */}
      <Card title={`Item Transaksi (${trx.items?.length || 0})`} padding="none">
        <Table
          columns={itemColumns}
          data={trx.items || []}
          emptyMessage="Tidak ada item"
        />
        {trx.items?.length > 0 && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
            <div className="text-right">
              <p className="text-sm text-gray-500">Total Keseluruhan</p>
              <p className="text-xl font-bold text-blue-600">{formatRupiah(trx.total)}</p>
            </div>
          </div>
        )}
      </Card>

      {/* Cancel Modal */}
      <Modal
        isOpen={showCancel}
        onClose={() => setShowCancel(false)}
        title="Batalkan Transaksi"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowCancel(false)}>Batal</Button>
            <Button variant="danger" loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
              Batalkan Transaksi
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          Apakah Anda yakin ingin membatalkan transaksi{' '}
          <span className="font-semibold">{trx.transactionNumber}</span>?
          Stok barang akan dikembalikan.
        </p>
      </Modal>

      {/* Retur Modal */}
      {showRetur && (
        <ReturModal transaction={trx} onClose={() => setShowRetur(false)} />
      )}

      {/* Print Modals */}
      {printMode === 'receipt' && (
        <ReceiptPrint transaction={trx} onClose={() => setPrintMode(null)} />
      )}
      {printMode === 'delivery' && (
        <DeliveryNotePrint transaction={trx} onClose={() => setPrintMode(null)} />
      )}
      {printMode === 'invoice' && (
        <InvoicePrint transaction={trx} onClose={() => setPrintMode(null)} />
      )}
    </div>
  );
}
