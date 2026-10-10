const prisma = require('../lib/prisma');
const AppError = require('./AppError');

/**
 * Convert a quantity from one unit to another for a specific product.
 * Uses the conversionFactor stored in ProductUnit.
 *
 * @param {number} quantity - The quantity to convert
 * @param {string} fromUnitId - Source unit ID
 * @param {string} toUnitId - Target unit ID
 * @param {string} productId - Product ID (conversion factors are per-product)
 * @returns {Promise<number>} Converted quantity
 */
const convert = async (quantity, fromUnitId, toUnitId, productId) => {
  if (fromUnitId === toUnitId) {
    return quantity;
  }

  const fromProductUnit = await prisma.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId: fromUnitId } },
  });

  if (!fromProductUnit) {
    throw new AppError(`Unit konversi tidak ditemukan untuk unit asal pada produk ini`, 400);
  }

  const toProductUnit = await prisma.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId: toUnitId } },
  });

  if (!toProductUnit) {
    throw new AppError(`Unit konversi tidak ditemukan untuk unit tujuan pada produk ini`, 400);
  }

  // Convert: source → base → target
  // baseQuantity = quantity * fromFactor
  // targetQuantity = baseQuantity / toFactor
  const baseQuantity = quantity * Number(fromProductUnit.conversionFactor);
  const targetQuantity = baseQuantity / Number(toProductUnit.conversionFactor);

  return targetQuantity;
};

/**
 * Convert a quantity to the base unit for a specific product.
 * The base unit has conversionFactor = 1 (isBaseUnit = true).
 *
 * @param {number} quantity - The quantity to convert
 * @param {string} unitId - Source unit ID
 * @param {string} productId - Product ID
 * @returns {Promise<number>} Quantity in base unit
 */
const getBaseQuantity = async (quantity, unitId, productId) => {
  const productUnit = await prisma.productUnit.findUnique({
    where: { productId_unitId: { productId, unitId } },
  });

  if (!productUnit) {
    throw new AppError(`Unit konversi tidak ditemukan untuk produk ini`, 400);
  }

  return quantity * Number(productUnit.conversionFactor);
};

module.exports = {
  convert,
  getBaseQuantity,
};
