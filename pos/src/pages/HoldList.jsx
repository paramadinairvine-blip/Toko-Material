import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiArrowLeft, HiTrash, HiRefresh, HiClock, HiShoppingCart } from 'react-icons/hi';
import toast from 'react-hot-toast';
import useHoldStore from '../stores/holdStore';
import useCartStore from '../stores/cartStore';
import { productAPI } from '../api/endpoints';
import { formatRupiah } from '../utils/formatCurrency';
import { EmptyState } from '../components/common';

export default function HoldList() {
  const navigate = useNavigate();
  const [restoringId, setRestoringId] = useState(null);
  const { holds, removeHold, clearAllHolds } = useHoldStore();
  const { items: cartItems, clearCart } = useCartStore();
  const addItem = useCartStore((s) => s.addItem);
  const setDiscount = useCartStore((s) => s.setDiscount);
  const setNotes = useCartStore((s) => s.setNotes);
  const setCustomerName = useCartStore((s) => s.setCustomerName);

  const handleRestore = async (hold) => {
    if (restoringId) return;
    if (cartItems.length > 0) {
      const confirmed = window.confirm(
        'Daftar pembelian saat ini masih ada isinya. Lanjutkan akan mengganti isi saat ini. Lanjutkan?'
      );
      if (!confirmed) return;
    }

    setRestoringId(hold.id);

    // Fetch fresh product data (price, stock, units) — the held snapshot may be stale
    const productIds = [...new Set(hold.items.map((item) => item.productId))];
    const freshProducts = {};
    await Promise.all(
      productIds.map(async (id) => {
        try {
          const { data: res } = await productAPI.getById(id);
          if (res?.data) freshProducts[id] = res.data;
        } catch {
          // Product deleted or unreachable — handled as a failed item below
        }
      })
    );

    clearCart();

    const failed = [];
    let priceUpdated = 0;

    // Restore items with correct unit info, current price and quantity
    hold.items.forEach((item) => {
      const heldName = item.product?.name || 'Produk';
      const product = freshProducts[item.productId];
      if (!product || product.isActive === false) {
        failed.push(`${heldName} (produk tidak tersedia)`);
        return;
      }

      const sellPrice = parseFloat(product.sellPrice) || 0;
      let unitInfo = null;
      let conversionFactor = 1;
      if (item.unitId && item.unitId !== product.unitId) {
        const pu = (product.productUnits || []).find((u) => u.unitId === item.unitId);
        if (!pu) {
          failed.push(`${product.name} (satuan ${item.unitName} tidak tersedia)`);
          return;
        }
        conversionFactor = parseFloat(pu.conversionFactor) || 1;
        unitInfo = {
          unitId: item.unitId,
          unitName: pu.unit?.abbreviation || item.unitName,
          unitPrice: sellPrice * conversionFactor,
          conversionFactor,
        };
      }

      // Validate the full held quantity against current stock
      const cart = useCartStore.getState();
      const stock = product.stock || 0;
      if (cart.getBaseQtyByProduct(product.id) + item.quantity * conversionFactor > stock) {
        const baseUnit = product.unitOfMeasure?.abbreviation || product.unit || 'pcs';
        failed.push(`${product.name} (stok sisa ${stock} ${baseUnit})`);
        return;
      }

      const result = addItem(product, unitInfo);
      if (result?.error) {
        failed.push(`${product.name} (stok tidak cukup)`);
        return;
      }

      const newPrice = unitInfo ? unitInfo.unitPrice : sellPrice;
      if (Math.abs(newPrice - (Number(item.unitPrice) || 0)) >= 1) priceUpdated += 1;

      // Set correct quantity using cartKey
      const cartKey = `${product.id}_${(unitInfo?.unitId ?? product.unitId) || 'base'}`;
      useCartStore.getState().updateQuantity(cartKey, item.quantity);
    });

    // Restore other data
    if (hold.discount) setDiscount(hold.discount);
    if (hold.notes) setNotes(hold.notes);
    if (hold.customerName) setCustomerName(hold.customerName);

    setRestoringId(null);

    if (priceUpdated > 0) {
      toast(`Harga ${priceUpdated} item diperbarui ke harga terbaru`, { duration: 4000, position: 'bottom-center' });
    }

    if (failed.length > 0) {
      // Keep the hold so nothing is lost; the cashier can fix stock and restore again
      toast.error(
        `Sebagian item tidak dapat dipulihkan (hold tetap disimpan):\n${failed.join('\n')}`,
        { duration: 8000, position: 'bottom-center' }
      );
    } else {
      removeHold(hold.id);
      toast.success('Transaksi dipulihkan', { duration: 2000, position: 'bottom-center' });
    }
    if (useCartStore.getState().items.length > 0) navigate('/kasir');
  };

  const handleDeleteHold = (holdId) => {
    removeHold(holdId);
    toast.success('Hold dihapus', { duration: 1500, position: 'bottom-center' });
  };

  const handleClearAll = () => {
    if (window.confirm('Hapus semua transaksi yang di-hold?')) {
      clearAllHolds();
      toast.success('Semua hold dihapus', { duration: 1500, position: 'bottom-center' });
    }
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Baru saja';
    if (diffMins < 60) return `${diffMins} menit lalu`;
    if (diffHours < 24) return `${diffHours} jam lalu`;

    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/kasir')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HiArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Transaksi Di-hold</h1>
            <p className="text-xs text-gray-500">{holds.length} transaksi tersimpan</p>
          </div>
        </div>
        {holds.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            <HiTrash className="w-3.5 h-3.5" />
            Hapus Semua
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {holds.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="Tidak ada transaksi di-hold"
              description="Transaksi yang di-hold dari kasir akan muncul di sini"
            />
          </div>
        ) : (
          <div className="grid gap-3 max-w-3xl mx-auto">
            {holds.map((hold) => (
              <div
                key={hold.id}
                className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow"
              >
                {/* Hold Header */}
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <HiShoppingCart className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {hold.customerName || `Hold #${hold.id.slice(-4)}`}
                      </p>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <HiClock className="w-3 h-3" />
                        {formatTime(hold.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-blue-600">
                      {formatRupiah(hold.subtotal - (hold.discount || 0))}
                    </p>
                    <p className="text-xs text-gray-500">{hold.itemCount} item</p>
                  </div>
                </div>

                {/* Item Preview */}
                <div className="px-4 py-2">
                  <div className="space-y-1">
                    {hold.items.slice(0, 3).map((item) => (
                      <div key={item.productId} className="flex justify-between text-xs text-gray-600">
                        <span className="truncate flex-1 mr-2">
                          {item.product?.name || 'Produk'}
                        </span>
                        <span className="text-gray-500 whitespace-nowrap">
                          {item.quantity} x {formatRupiah(item.unitPrice)}
                        </span>
                      </div>
                    ))}
                    {hold.items.length > 3 && (
                      <p className="text-xs text-gray-400 italic">
                        +{hold.items.length - 3} item lainnya...
                      </p>
                    )}
                  </div>
                  {hold.notes && (
                    <p className="mt-1 text-xs text-gray-500 italic border-t border-gray-50 pt-1">
                      Catatan: {hold.notes}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
                  <button
                    onClick={() => handleRestore(hold)}
                    disabled={!!restoringId}
                    className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <HiRefresh className={`w-4 h-4 ${restoringId === hold.id ? 'animate-spin' : ''}`} />
                    {restoringId === hold.id ? 'Memulihkan...' : 'Pulihkan'}
                  </button>
                  <button
                    onClick={() => handleDeleteHold(hold.id)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    title="Hapus hold"
                  >
                    <HiTrash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
