import { useNavigate } from 'react-router-dom';
import { HiClipboardList, HiTrash, HiPause } from 'react-icons/hi';
import useCartStore from '../../stores/cartStore';
import useHoldStore from '../../stores/holdStore';
import CartItem from './CartItem';
import { formatRupiah } from '../../utils/formatCurrency';
import { Button, EmptyState } from '../common';
import toast from 'react-hot-toast';

export default function Cart() {
  const navigate = useNavigate();
  const { items, discount, getSubtotal, getGrandTotal, getItemCount, updateQuantity, removeItem, clearCart, setDiscount, notes, customerName } = useCartStore();
  const { addHold, holds } = useHoldStore();

  const subtotal = getSubtotal();
  const grandTotal = getGrandTotal();
  const itemCount = getItemCount();

  // Aggregate base qty per product across all units
  const productBaseQtyMap = {};
  items.forEach((i) => {
    const factor = i.conversionFactor || 1;
    productBaseQtyMap[i.productId] = (productBaseQtyMap[i.productId] || 0) + i.quantity * factor;
  });

  const handleClearCart = () => {
    if (items.length === 0) return;
    if (window.confirm('Kosongkan keranjang? Semua item akan dihapus.')) {
      clearCart();
    }
  };

  const hasOverStock = items.some((i) => {
    const stock = i.product?.stock || 0;
    return productBaseQtyMap[i.productId] > stock;
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <HiClipboardList className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">Daftar Pembelian</h3>
          </div>
          {holds.length > 0 && (
            <button
              onClick={() => navigate('/holds')}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-full transition-colors"
            >
              <HiPause className="w-3 h-3" />
              {holds.length} Hold
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            title="Belum ada item"
            description="Cari dan tambahkan produk untuk memulai transaksi"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <HiClipboardList className="w-5 h-5 text-gray-600" />
          <h3 className="font-semibold text-gray-900">
            Daftar Pembelian
            <span className="ml-1.5 text-xs font-normal text-gray-500">({itemCount} item)</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {holds.length > 0 && (
            <button
              onClick={() => navigate('/holds')}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded-full transition-colors"
            >
              <HiPause className="w-3 h-3" />
              {holds.length} Hold
            </button>
          )}
          <button
            onClick={handleClearCart}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors"
          >
            <HiTrash className="w-3.5 h-3.5" />
            Kosongkan
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-4">
        {items.map((item) => (
          <CartItem
            key={item.cartKey}
            item={item}
            onUpdateQty={updateQuantity}
            onRemove={removeItem}
            productBaseQtyMap={productBaseQtyMap}
          />
        ))}
      </div>

      {/* Summary */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 space-y-2">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Subtotal</span>
          <span>{formatRupiah(subtotal)}</span>
        </div>

        {/* Discount input */}
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-600">Diskon</span>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs">Rp</span>
            <input
              type="number"
              value={discount || ''}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setDiscount(Math.max(0, Math.min(val, subtotal)));
              }}
              placeholder="0"
              className="w-24 text-right text-sm border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
              min="0"
              max={subtotal}
            />
          </div>
        </div>

        <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200">
          <span>Total</span>
          <span className="text-blue-600">{formatRupiah(grandTotal)}</span>
        </div>

        <Button
          size="lg"
          className="w-full mt-2"
          disabled={hasOverStock}
          onClick={() => navigate('/checkout')}
        >
          {hasOverStock ? 'Stok tidak mencukupi' : `Proses Pembayaran`}
        </Button>

        <button
          onClick={() => {
            addHold({
              items: [...items],
              discount,
              notes,
              customerName,
            });
            clearCart();
            toast.success('Transaksi di-hold', { duration: 2000, position: 'bottom-center' });
          }}
          className="w-full mt-2 py-2.5 rounded-xl border-2 border-dashed border-gray-300 text-sm font-medium text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
        >
          <HiPause className="w-4 h-4" />
          Hold Transaksi
        </button>
      </div>
    </div>
  );
}
