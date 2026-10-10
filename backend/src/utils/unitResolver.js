const AppError = require('./AppError');

const UNIT_NOT_REGISTERED = 'Satuan tidak terdaftar untuk produk ini';

const toFactor = (productUnit, productName) => {
  const factor = Number(productUnit.conversionFactor);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new AppError(
      `Faktor konversi satuan${productName ? ` untuk ${productName}` : ''} tidak valid. Periksa konfigurasi satuan produk.`,
      400
    );
  }
  return factor;
};

/**
 * Faktor konversi satuan → satuan dasar untuk satu produk.
 *
 * Aturan:
 *   - unitId kosong                       → satuan dasar (faktor 1)
 *   - ada ProductUnit (productId, unitId) → pakai conversionFactor-nya, apa pun
 *     nilai product.unitId maupun flag isBaseUnit (baris berfaktor 1 = dasar)
 *   - unitId = product.unitId tanpa ProductUnit → satuan dasar (faktor 1)
 *   - selain itu                          → 400, tidak diam-diam dianggap 1:1
 *
 * @param {object} product       minimal { unitId, name? }
 * @param {Array}  productUnits  baris ProductUnit milik produk tsb
 * @param {string|null} unitId
 */
const resolveFactor = (product, productUnits, unitId) => {
  if (!unitId) return 1;

  const pu = (productUnits || []).find((u) => u.unitId === unitId);
  if (pu) return toFactor(pu, product?.name);

  if (product && product.unitId && product.unitId === unitId) return 1;

  throw new AppError(UNIT_NOT_REGISTERED, 400);
};

/**
 * Versi yang membaca ProductUnit dari DB (di dalam transaksi).
 * `product` boleh dikirim bila sudah dibaca agar tidak query dua kali.
 */
const resolveFactorFromDb = async (tx, productId, unitId, product = null) => {
  if (!unitId) return 1;

  const pu = await tx.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId } },
  });
  if (pu) return toFactor(pu, product?.name);

  const p = product || await tx.product.findUnique({
    where: { id: productId },
    select: { unitId: true, name: true },
  });
  if (p && p.unitId && p.unitId === unitId) return 1;

  throw new AppError(UNIT_NOT_REGISTERED, 400);
};

/** Qty dalam satuan terpilih → qty satuan dasar (bilangan bulat). */
const toBaseQty = (quantity, factor) => Math.round(Number(quantity) * factor);

module.exports = { UNIT_NOT_REGISTERED, resolveFactor, resolveFactorFromDb, toBaseQty };
