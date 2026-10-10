const prisma = require('../lib/prisma');
const { formatWIB } = require('./wib');

/**
 * Generate a unique barcode string.
 * Format: TMP-[KATEGORI_CODE]-[YYYYMMDD]-[RANDOM4DIGIT]
 * Example: TMP-SMN-20240115-4829
 *
 * Checks database to ensure no duplicate. Retries up to 10 times.
 *
 * @param {string} categoryCode - Short uppercase code for the category (e.g. "SMN", "BSI")
 * @returns {Promise<string>} Generated unique barcode
 */
const generateBarcode = async (categoryCode = 'GEN') => {
  const code = categoryCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const datePart = formatWIB(new Date(), 'yyyyMMdd');

  for (let i = 0; i < 10; i++) {
    const random = String(Math.floor(1000 + Math.random() * 9000));
    const barcode = `TMP-${code}-${datePart}-${random}`;

    const exists = await prisma.product.findUnique({ where: { barcode } });
    if (!exists) return barcode;
  }

  // Fallback: tambah timestamp ms untuk garansi unik
  const fallback = `TMP-${code}-${datePart}-${Date.now().toString().slice(-6)}`;
  return fallback;
};

module.exports = { generateBarcode };
