import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiX, HiShoppingCart } from 'react-icons/hi';
import { RiMoneyDollarCircleLine } from 'react-icons/ri';
import useCartStore from '../stores/cartStore';
import { transactionAPI } from '../api/endpoints';
import { formatRupiah } from '../utils/formatCurrency';
import { TRANSACTION_TYPES, TRANSACTION_TYPE_LABELS } from '../utils/constants';
import { getPrinterSettings, printReceipt, isRectaConfigured } from '../utils/printerService';
import ReceiptPrint from '../components/receipt/ReceiptPrint';

const paymentTypes = [
  { type: TRANSACTION_TYPES.CASH, label: 'TUNAI', color: 'bg-cyan-500 hover:bg-cyan-600 text-white' },
  { type: TRANSACTION_TYPES.BON, label: 'OVERBOOKING TU', color: 'bg-orange-400 hover:bg-orange-500 text-white' },
];

const quickAmounts = [500, 1000, 2000, 3000, 4000, 5000, 10000, 20000];

export default function Checkout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [receiptData, setReceiptData] = useState(null);
  const [cetakStruk, setCetakStruk] = useState(true);

  const {
    items, discount, notes, customerName, customerPhone, unitLembagaId, paymentType, paidAmount,
    setPaymentType, setPaidAmount, setNotes, setCustomerName, setCustomerPhone, setUnitLembagaId,
    getSubtotal, getGrandTotal, getChange, clearCart,
  } = useCartStore();

  const grandTotal = getGrandTotal();
  const change = getChange();

  // Load printer settings for cetak struk default
  useEffect(() => {
    const ps = getPrinterSettings();
    setCetakStruk(ps.cetakStruk !== false);
  }, []);

  // Keyboard shortcut: CTRL+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'Enter' && !createMutation.isPending) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const createMutation = useMutation({
    mutationFn: transactionAPI.create,
    onSuccess: async (res) => {
      toast.success('Transaksi berhasil!');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (cetakStruk) {
        const txData = res.data.data;
        // Auto-print via Recta if configured
        if (isRectaConfigured()) {
          const result = await printReceipt(txData, paymentType === 'CASH' ? paidAmount : txData.total, paymentType === 'CASH' ? getChange() : 0);
          if (result.success) {
            toast.success(result.message);
          } else {
            toast.error(result.message);
          }
        }
        setReceiptData(txData);
      } else {
        clearCart();
        navigate('/kasir');
      }
    },
    onError: (error) => {
      const resData = error.response?.data;
      if (resData?.code === 'PRICE_CHANGED') {
        const changes = resData.priceChanges || [];
        // Update cart prices to the current server prices. priceChanges has no unitId,
        // so match by productId + the price that was sent (oldPrice).
        const { items: cartItems, updateUnitPrice } = useCartStore.getState();
        changes.forEach((p) => {
          cartItems
            .filter((i) => i.productId === p.productId && Math.abs(Number(i.unitPrice) - Number(p.oldPrice)) < 1)
            .forEach((i) => updateUnitPrice(i.cartKey, Number(p.newPrice)));
        });
        const detail = changes.map(
          (p) => `${p.productName}: Rp ${Number(p.oldPrice).toLocaleString('id-ID')} → Rp ${Number(p.newPrice).toLocaleString('id-ID')}`
        ).join('\n');
        toast.error(
          `Harga berubah dan keranjang sudah diperbarui ke harga terbaru:\n${detail}\nPeriksa total & pembayaran, lalu proses ulang.`,
          { duration: 8000 }
        );
        queryClient.invalidateQueries({ queryKey: ['products'] });
      } else {
        toast.error(resData?.message || 'Gagal membuat transaksi');
      }
    },
  });

  const handleSubmit = () => {
    // Already paid (receipt showing) or still submitting: never create the transaction twice
    if (receiptData || createMutation.isPending) return;

    if (items.length === 0) {
      toast.error('Keranjang kosong');
      return;
    }

    if (paymentType === 'CASH' && paidAmount < grandTotal) {
      toast.error('Jumlah pembayaran kurang');
      return;
    }

    if (paymentType === 'BON' && (!unitLembagaId.trim() || !customerName.trim() || !customerPhone.trim())) {
      toast.error('Lengkapi semua field yang wajib diisi');
      return;
    }

    if (paymentType === 'BON' && !/^08\d{8,12}$/.test(customerPhone.trim())) {
      toast.error('Format nomor telepon harus 08xxxxxxxxxx (10-14 digit)');
      return;
    }

    const payload = {
      type: paymentType,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.unitPrice,
        unitId: item.unitId,
      })),
      discount: discount || 0,
      paidAmount: paymentType === 'CASH' ? paidAmount : grandTotal,
      notes: notes || undefined,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      kepanitiaan: unitLembagaId || undefined,
    };

    createMutation.mutate(payload);
  };

  const handleReceiptClose = () => {
    setReceiptData(null);
    clearCart();
    navigate('/kasir');
  };

  // Empty cart (e.g. page refreshed on /checkout): go back to the cashier screen
  useEffect(() => {
    if (items.length === 0 && !receiptData) {
      navigate('/kasir', { replace: true });
    }
  }, [items.length, receiptData, navigate]);

  if (items.length === 0 && !receiptData) {
    return null;
  }

  const paymentLabel = paymentTypes.find((p) => p.type === paymentType)?.label || 'TUNAI';

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-900">Pembayaran</h1>
        <button
          onClick={() => navigate('/kasir')}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <HiX className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content - 2 columns */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Metode Pembayaran */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Metode Pembayaran</h3>

            {/* Payment Type Buttons */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {paymentTypes.map((pt) => (
                <button
                  key={pt.type}
                  onClick={() => setPaymentType(pt.type)}
                  className={`py-3 px-4 rounded-xl text-sm font-bold transition-all ${
                    paymentType === pt.type
                      ? `${pt.color} ring-2 ring-offset-2 ring-blue-400`
                      : 'bg-white border-2 border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {pt.label}
                </button>
              ))}
            </div>

            {/* CASH specific fields */}
            {paymentType === 'CASH' && (
              <>
                {/* Nama Konsumen */}
                <div className="mb-4">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nama Konsumen"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                {/* Amount input */}
                <div className="mb-4">
                  <div className="flex items-center border-2 border-cyan-400 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-cyan-300">
                    <span className="px-4 py-3 text-gray-500 text-sm font-medium bg-gray-50 border-r border-gray-200">Rp.</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={paidAmount ? paidAmount.toLocaleString('id-ID') : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        setPaidAmount(parseInt(raw) || 0);
                      }}
                      className="flex-1 px-4 py-3 text-lg font-bold text-right outline-none"
                      placeholder="0"
                    />
                  </div>
                </div>

                {/* Quick amounts */}
                <div className="flex flex-wrap gap-2">
                  {quickAmounts.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setPaidAmount(paidAmount + amount)}
                      className="px-4 py-2 rounded-full text-sm font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors"
                    >
                      {amount.toLocaleString('id-ID')}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* OVERBOOKING TU fields */}
            {paymentType === 'BON' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Nama Pengambil <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nama pengambil barang"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Kepanitiaan/Kegiatan <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={unitLembagaId}
                    onChange={(e) => setUnitLembagaId(e.target.value)}
                    placeholder="Nama kepanitiaan atau kegiatan"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">No. Telepon <span className="text-red-500">*</span></label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9]/g, '');
                      setCustomerPhone(val);
                    }}
                    maxLength={14}
                    placeholder="08xxxxxxxxxx"
                    className={`w-full px-4 py-2.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                      customerPhone && !/^08\d{8,12}$/.test(customerPhone)
                        ? 'border-red-400'
                        : 'border-gray-300'
                    }`}
                  />
                  {customerPhone && !/^08\d{8,12}$/.test(customerPhone) && (
                    <p className="text-xs text-red-500 mt-1">Format: 08xxxxxxxxxx (10-14 digit)</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Tagihan */}
        <div className="w-[380px] border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
          <div className="p-5 flex-1">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-semibold text-gray-900 text-lg">Tagihan</h3>
              <span className={`text-sm font-bold ${
                paymentType === 'CASH' ? 'text-cyan-600' : 'text-orange-500'
              }`}>
                {paymentLabel}
              </span>
            </div>

            {/* Total Tagihan */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <HiShoppingCart className="w-5 h-5 text-orange-500" />
                <span className="text-sm font-semibold text-gray-700">Total Tagihan</span>
              </div>
              <span className="text-lg font-bold text-red-500">{formatRupiah(grandTotal)}</span>
            </div>

            {/* Pembayaran */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <RiMoneyDollarCircleLine className="w-5 h-5 text-cyan-500" />
                <span className="text-sm font-semibold text-gray-700">Pembayaran</span>
              </div>
              <span className="text-lg font-bold text-green-600">
                {formatRupiah(paymentType === 'CASH' ? paidAmount : grandTotal)}
              </span>
            </div>

            {/* Kembalian (CASH only) */}
            {paymentType === 'CASH' && paidAmount > 0 && (
              <div className={`mt-3 p-3 rounded-xl text-center ${
                change >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
              }`}>
                <p className="text-xs text-gray-500 mb-1">Kembalian</p>
                <p className={`text-2xl font-bold ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {formatRupiah(Math.abs(change))}
                </p>
                {change < 0 && <p className="text-xs text-red-500 mt-0.5">Pembayaran kurang</p>}
              </div>
            )}

            {/* Cetak Struk */}
            <div className="mt-5 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-600 mb-2">Cetak Struk</p>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="cetakStruk"
                    checked={cetakStruk === true}
                    onChange={() => setCetakStruk(true)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">Ya</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="cetakStruk"
                    checked={cetakStruk === false}
                    onChange={() => setCetakStruk(false)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">Tidak</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/kasir')}
          className="px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Close
        </button>
        <button
          onClick={handleSubmit}
          disabled={createMutation.isPending || (paymentType === 'CASH' && paidAmount < grandTotal) || (paymentType === 'BON' && (!unitLembagaId.trim() || !customerName.trim() || !customerPhone.trim() || !/^08\d{8,12}$/.test(customerPhone.trim())))}
          className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center leading-tight"
        >
          <span>Proses Pembayaran</span>
          <span className="text-[10px] font-normal opacity-80">(CTRL + Enter)</span>
        </button>
      </div>

      {/* Receipt Modal */}
      {receiptData && (
        <ReceiptPrint
          transaction={receiptData}
          paidAmount={paymentType === 'CASH' ? paidAmount : grandTotal}
          change={paymentType === 'CASH' ? change : 0}
          onClose={handleReceiptClose}
        />
      )}
    </div>
  );
}
