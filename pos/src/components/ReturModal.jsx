import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HiMinus, HiPlus } from 'react-icons/hi';
import toast from 'react-hot-toast';
import { returnAPI } from '../api/endpoints';
import { formatRupiah } from '../utils/formatCurrency';
import { calcRefundPreview } from '../utils/refundPreview';
import Modal from './common/Modal';

export default function ReturModal({ transaction, onClose }) {
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState('');

  // Fetch already-returned quantities
  const { data: existingReturns } = useQuery({
    queryKey: ['returns-by-transaction', transaction.id],
    queryFn: async () => {
      const { data } = await returnAPI.getByTransaction(transaction.id);
      return data.data;
    },
  });

  // Calculate already returned per item
  const returnedMap = {};
  if (existingReturns) {
    for (const ret of existingReturns) {
      for (const item of ret.items) {
        returnedMap[item.transactionItemId] = (returnedMap[item.transactionItemId] || 0) + item.quantity;
      }
    }
  }

  const createMutation = useMutation({
    mutationFn: (data) => returnAPI.create(data),
    onSuccess: (res) => {
      // Show the refund actually recorded by the server
      const refund = res?.data?.data?.refundAmount;
      toast.success(
        refund !== undefined && refund !== null
          ? `Retur berhasil diproses. Refund: ${formatRupiah(refund)}`
          : 'Retur berhasil diproses',
        { duration: 6000 }
      );
      queryClient.invalidateQueries({ queryKey: ['returns-by-transaction', transaction.id] });
      queryClient.invalidateQueries({ queryKey: ['transactions-history'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err) => {
      const msg = err.response?.data?.message || 'Gagal memproses retur';
      toast.error(msg);
    },
  });

  const handleSubmit = () => {
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([transactionItemId, quantity]) => ({ transactionItemId, quantity }));

    if (items.length === 0) {
      toast.error('Pilih minimal 1 item untuk diretur');
      return;
    }

    createMutation.mutate({
      transactionId: transaction.id,
      reason: reason || undefined,
      items,
    });
  };

  const updateQty = (itemId, maxReturnable, delta) => {
    setQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.min(Math.max(0, current + delta), maxReturnable);
      return { ...prev, [itemId]: next };
    });
  };

  // Same calculation as the server (item & transaction discounts included)
  const { perItem: refundPerItem, total: totalRefund } = calcRefundPreview(transaction, quantities, existingReturns);
  const hasSelection = Object.values(quantities).some((q) => q > 0);
  const hasDiscount = Number(transaction.discount) > 0
    || (transaction.items || []).some((i) => Number(i.discount) > 0);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Retur Barang"
      size="lg"
    >
      <div className="space-y-4">
        {/* Transaction Info */}
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-500">Transaksi</p>
          <p className="font-mono font-bold text-gray-900">{transaction.transactionNumber}</p>
          {transaction.customerName && (
            <p className="text-sm text-gray-600 mt-1">{transaction.customerName}</p>
          )}
        </div>

        {/* Items */}
        <div className="space-y-2">
          {(transaction.items || []).map((item) => {
            const alreadyReturned = returnedMap[item.id] || 0;
            const maxReturnable = item.quantity - alreadyReturned;
            const qty = quantities[item.id] || 0;
            const price = Number(item.price || 0);

            if (maxReturnable <= 0) return null;

            return (
              <div key={item.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{item.product?.name || '-'}</p>
                    <p className="text-xs text-gray-500">
                      {formatRupiah(price)} / {item.unit?.abbreviation || item.product?.unitOfMeasure?.abbreviation || item.product?.unit || 'pcs'}
                      {alreadyReturned > 0 && (
                        <span className="text-orange-500 ml-2">({alreadyReturned} sudah diretur)</span>
                      )}
                    </p>
                    <p className="text-xs text-blue-600">Qty beli: {item.quantity} | Maks retur: {maxReturnable}</p>
                  </div>

                  {/* Qty Controls */}
                  <div className="flex items-center gap-2 ml-3">
                    <button
                      onClick={() => updateQty(item.id, maxReturnable, -1)}
                      disabled={qty <= 0}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                    >
                      <HiMinus className="w-3 h-3" />
                    </button>
                    <span className={`w-8 text-center font-bold text-sm ${qty > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {qty}
                    </span>
                    <button
                      onClick={() => updateQty(item.id, maxReturnable, 1)}
                      disabled={qty >= maxReturnable}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-100 text-green-600 hover:bg-green-200 disabled:opacity-30"
                    >
                      <HiPlus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {qty > 0 && (
                  <div className="mt-2 text-right">
                    <span className="text-sm font-medium text-red-600">{formatRupiah(refundPerItem[item.id] || 0)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reason */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Alasan (opsional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Barang rusak, salah kirim, dll."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Total + Submit */}
        {hasSelection && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-red-700">Total Refund</span>
              <span className="text-lg font-bold text-red-600">{formatRupiah(totalRefund)}</span>
            </div>
            {hasDiscount && (
              <p className="text-xs text-red-600 mt-1">Sudah memperhitungkan diskon pada transaksi ini.</p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium text-sm hover:bg-gray-200 transition-colors"
          >
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasSelection || createMutation.isPending}
            className="flex-1 py-2.5 bg-green-500 text-white rounded-lg font-medium text-sm hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Memproses...' : 'Proses Retur'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
