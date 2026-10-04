import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { HiShoppingCart } from 'react-icons/hi';
import { productAPI } from '../api/endpoints';
import useCartStore from '../stores/cartStore';
import ProductSearch from '../components/pos/ProductSearch';
import ProductGrid from '../components/pos/ProductGrid';
import Cart from '../components/pos/Cart';
import UnitPickerModal from '../components/pos/UnitPickerModal';
import useBarcodeScanner from '../hooks/useBarcodeScanner';

export default function Cashier() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [unitPickerProduct, setUnitPickerProduct] = useState(null);
  const searchRef = useRef(null);
  const addItem = useCartStore((s) => s.addItem);
  const items = useCartStore((s) => s.items);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', searchQuery],
    queryFn: () => productAPI.getAll({ search: searchQuery, limit: 100, isActive: true }),
    select: (res) => {
      const d = res.data.data;
      return Array.isArray(d) ? d : [];
    },
    staleTime: 30000,
  });

  const products = productsData || [];

  const hasMultipleUnits = (product) => {
    const extraUnits = (product.productUnits || []).filter((pu) => pu.unitId !== product.unitId);
    return extraUnits.length > 0;
  };

  const handleAddToCart = (product) => {
    if (hasMultipleUnits(product)) {
      setUnitPickerProduct(product);
      return;
    }
    const result = addItem(product);
    if (result?.error) {
      const baseUnit = product.unitOfMeasure?.abbreviation || product.unit || 'pcs';
      toast.error(`Stok ${product.name} tidak cukup (sisa ${result.stock} ${baseUnit})`, { duration: 2500, position: 'bottom-center' });
      return;
    }
    toast.success(`${product.name} ditambahkan`, { duration: 1500, position: 'bottom-center' });
  };

  const handleUnitSelected = (unitInfo) => {
    if (unitPickerProduct) {
      const result = addItem(unitPickerProduct, unitInfo);
      if (result?.error) {
        const baseUnit = unitPickerProduct.unitOfMeasure?.abbreviation || unitPickerProduct.unit || 'pcs';
        toast.error(`Stok ${unitPickerProduct.name} tidak cukup (sisa ${result.stock} ${baseUnit})`, { duration: 2500, position: 'bottom-center' });
        setUnitPickerProduct(null);
        return;
      }
      toast.success(`${unitPickerProduct.name} (${unitInfo.unitName}) ditambahkan`, { duration: 1500, position: 'bottom-center' });
      setUnitPickerProduct(null);
    }
  };

  // USB Barcode Scanner — auto-detect rapid keystrokes + Enter
  const handleBarcodeScan = async (barcodeValue) => {
    // The scanner typed the code into the focused search box — remove it so
    // consecutive scans don't pile up and filter the product list.
    searchRef.current?.removeScannedCode(barcodeValue);
    try {
      const { data: res } = await productAPI.getByBarcode(barcodeValue);
      const product = res.data;
      if (product) {
        handleAddToCart(product);
      } else {
        toast.error('Produk tidak ditemukan');
      }
    } catch {
      toast.error('Produk dengan barcode tersebut tidak ditemukan');
    }
  };

  useBarcodeScanner(handleBarcodeScan);

  return (
    <div className="h-[calc(100vh-3.5rem)] flex">
      {/* Left: Product Search & List (1/4 = 25%) */}
      <div className="w-1/4 min-w-[320px] flex flex-col overflow-hidden border-r border-gray-200">
        <div className="p-3 pb-2">
          <ProductSearch ref={searchRef} onSearch={setSearchQuery} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          <ProductGrid
            products={products}
            isLoading={isLoading}
            onAddToCart={handleAddToCart}
          />
        </div>
      </div>

      {/* Right: Cart (desktop) - takes 3/4 remaining space */}
      <div className="hidden lg:flex flex-[3] bg-gray-50 flex-col">
        <Cart />
      </div>

      {/* Mobile cart button */}
      <button
        onClick={() => setShowMobileCart(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 bg-blue-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:bg-blue-700 transition-colors"
      >
        <HiShoppingCart className="w-6 h-6" />
        {itemCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {itemCount}
          </span>
        )}
      </button>

      {/* Mobile cart drawer */}
      {showMobileCart && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileCart(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">Daftar Pembelian</h3>
              <button onClick={() => setShowMobileCart(false)} className="text-gray-500 hover:text-gray-700 text-lg">&times;</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Cart />
            </div>
          </div>
        </div>
      )}

      {/* Unit Picker Modal */}
      {unitPickerProduct && (
        <UnitPickerModal
          product={unitPickerProduct}
          onSelect={handleUnitSelected}
          onClose={() => setUnitPickerProduct(null)}
        />
      )}
    </div>
  );
}
