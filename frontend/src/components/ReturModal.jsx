import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { returnAPI } from '../api/endpoints';
import { getErrorMessage } from '../utils/handleError';
import { formatRupiah } from '../utils/formatCurrency';
import { calcRefundPreview } from '../utils/refundPreview';
import { Modal, Button } from './common';

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
      queryClient.invalidateQueries({ queryKey: ['transaction'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Gagal memproses retur')),
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

  // Same calculation as the server (item & transaction discounts included)
  const { perItem: refundPerItem, total: totalRefund } = calcRefundPreview(transaction, quantities, existingReturns);
  const hasSelection = Object.values(quantities).some((q) => q > 0);
  const hasDiscount = Number(transaction.discount) > 0
    || (transaction.items || []).some((i) => Number(i.discount) > 0);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Retur - ${transaction.transactionNumber}`}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button
            variant="primary"
            loading={createMutation.isPending}
            onClick={handleSubmit}
            disabled={!hasSelection}
          >
            Proses Retur ({formatRupiah(totalRefund)})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Produk</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600 w-20">Qty Asli</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Sudah Retur</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600 w-24">Maks</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600 w-28">Qty Retur</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 w-28">Harga</th>
                <th className="text-right px-3 py-2 font-medium text-gray-600 w-32">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(transaction.items || []).map((item) => {
                const alreadyReturned = returnedMap[item.id] || 0;
                const maxReturnable = item.quantity - alreadyReturned;
                const qty = quantities[item.id] || 0;
                const price = Number(item.price || item.unitPrice || 0);
                const subtotal = refundPerItem[item.id] || 0;

                return (
                  <tr key={item.id} className={maxReturnable <= 0 ? 'opacity-40' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{item.product?.name || '-'}</p>
                    </td>
                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                    <td className="px-3 py-2 text-center text-orange-600 font-medium">{alreadyReturned}</td>
                    <td className="px-3 py-2 text-center text-blue-600 font-medium">{maxReturnable}</td>
                    <td className="px-3 py-2 text-center">
                      {maxReturnable > 0 ? (
                        <input
                          type="number"
                          min={0}
                          max={maxReturnable}
                          value={qty}
                          onChange={(e) => {
                            const val = Math.min(Math.max(0, parseInt(e.target.value) || 0), maxReturnable);
                            setQuantities((prev) => ({ ...prev, [item.id]: val }));
                          }}
                          className="w-20 text-center border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatRupiah(price)}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {qty > 0 ? formatRupiah(subtotal) : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Reason */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Alasan Retur (opsional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Barang rusak, salah kirim, dll."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            rows={2}
          />
        </div>

        {/* Total */}
        {hasSelection && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-red-700">Total Refund</span>
              <span className="text-lg font-bold text-red-600">{formatRupiah(totalRefund)}</span>
            </div>
            {hasDiscount && (
              <p className="text-xs text-red-600 mt-1">Sudah memperhitungkan diskon pada transaksi ini.</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
