#!/usr/bin/env node
/**
 * Pemeriksaan data satuan & harga produk.
 *
 * CARA PAKAI (dari folder backend, memakai DATABASE_URL di .env / environment):
 *
 *   node scripts/check-product-units.js          # hanya MEMBACA dan mencetak laporan
 *   node scripts/check-product-units.js --fix    # memperbaiki dua hal yang aman (lihat di bawah)
 *
 * Yang diperiksa:
 *   1. Produk yang unitId-nya kosong (satuan dasar belum terhubung ke master satuan).
 *   2. Baris konversi satuan (ProductUnit) yang ditandai isBaseUnit padahal
 *      conversionFactor ≠ 1 (satuan dasar selalu berfaktor 1).
 *   3. Produk yang harga belinya TAMPAK terkali faktor kemasan, dilihat dari
 *      riwayat harga (mis. 1.000 → 24.000 pada produk dengan satuan "dus isi 24")
 *      atau harga beli > harga jual padahal harga beli ÷ faktor ≤ harga jual.
 *      Ini hanya DUGAAN untuk diperiksa manusia.
 *
 * Tanpa --fix skrip ini TIDAK menulis apa pun ke database.
 *
 * Dengan --fix skrip hanya:
 *   - mengisi unitId yang kosong dari nama satuan produk (kolom `unit`); bila
 *     master satuan dengan nama/singkatan itu belum ada, satuan dibuat dulu;
 *   - menghapus tanda isBaseUnit pada baris konversi yang faktornya ≠ 1.
 * Harga dan stok TIDAK PERNAH diubah — temuan no. 3 hanya dilaporkan.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const FIX = process.argv.includes('--fix');
const TOLERANCE = 0.01; // 1% — toleransi pembulatan saat membandingkan rasio harga

const prisma = new PrismaClient();

const rupiah = (value) => `Rp${Number(value).toLocaleString('id-ID')}`;
const approx = (a, b) => b !== 0 && Math.abs(a - b) / Math.abs(b) <= TOLERANCE;

/**
 * Cari master satuan berdasarkan nama/singkatan (tanpa beda huruf besar/kecil).
 */
const findUnit = (name) => prisma.unitOfMeasure.findFirst({
  where: {
    OR: [
      { name: { equals: name, mode: 'insensitive' } },
      { abbreviation: { equals: name, mode: 'insensitive' } },
    ],
  },
  orderBy: { isActive: 'desc' },
});

const createUnit = async (name) => {
  const base = name.toLowerCase().replace(/\s+/g, '').slice(0, 10) || 'unit';
  let abbreviation = base;
  for (let i = 2; i < 50; i++) {
    const taken = await prisma.unitOfMeasure.findUnique({ where: { abbreviation } });
    if (!taken) break;
    abbreviation = `${base.slice(0, 8)}${i}`;
  }
  return prisma.unitOfMeasure.create({ data: { name, abbreviation } });
};

// ─── 1. Produk tanpa unitId ─────────────────────────────────────────

const checkMissingUnitId = async () => {
  const products = await prisma.product.findMany({
    where: { unitId: null },
    select: { id: true, name: true, sku: true, unit: true, isActive: true },
    orderBy: { name: 'asc' },
  });

  console.log(`\n1. Produk tanpa unitId: ${products.length}`);
  let fixed = 0;
  for (const p of products) {
    const unitName = (p.unit || 'pcs').trim() || 'pcs';
    const existing = await findUnit(unitName);
    const status = p.isActive ? '' : ' [nonaktif]';
    if (!FIX) {
      const plan = existing ? `→ akan dihubungkan ke "${existing.name}"` : `→ master satuan "${unitName}" belum ada (akan dibuat)`;
      console.log(`   - ${p.sku}  ${p.name}${status}  satuan="${unitName}"  ${plan}`);
      continue;
    }
    const unit = existing || await createUnit(unitName);
    await prisma.product.update({ where: { id: p.id }, data: { unitId: unit.id } });
    fixed += 1;
    console.log(`   - ${p.sku}  ${p.name}${status}  → unitId diisi ("${unit.name}"${existing ? '' : ', satuan baru dibuat'})`);
  }
  return { found: products.length, fixed };
};

// ─── 2. isBaseUnit dengan faktor ≠ 1 ────────────────────────────────

const checkWrongBaseUnitFlag = async () => {
  const rows = await prisma.productUnit.findMany({
    where: { isBaseUnit: true, NOT: { conversionFactor: 1 } },
    include: {
      product: { select: { name: true, sku: true } },
      unit: { select: { name: true } },
    },
  });

  console.log(`\n2. Konversi bertanda satuan dasar tetapi faktor ≠ 1: ${rows.length}`);
  rows.forEach((row) => {
    console.log(`   - ${row.product.sku}  ${row.product.name}  satuan="${row.unit.name}"  faktor=${Number(row.conversionFactor)}${FIX ? '  → tanda satuan dasar dihapus' : ''}`);
  });

  let fixed = 0;
  if (FIX && rows.length > 0) {
    const result = await prisma.productUnit.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { isBaseUnit: false },
    });
    fixed = result.count;
  }
  return { found: rows.length, fixed };
};

// ─── 3. Harga beli tampak terkali faktor kemasan (laporan saja) ─────

const checkMultipliedBuyPrice = async () => {
  const products = await prisma.product.findMany({
    where: { productUnits: { some: { conversionFactor: { gt: 1 } } } },
    select: {
      id: true, name: true, sku: true, buyPrice: true, sellPrice: true,
      productUnits: { select: { conversionFactor: true, unit: { select: { name: true } } } },
      priceHistories: { orderBy: { createdAt: 'asc' }, select: { oldBuy: true, newBuy: true, createdAt: true } },
    },
    orderBy: { name: 'asc' },
  });

  const suspects = [];
  for (const p of products) {
    const buy = Number(p.buyPrice);
    const sell = Number(p.sellPrice);
    if (buy <= 0) continue;
    const factors = p.productUnits
      .map((u) => ({ factor: Number(u.conversionFactor), unitName: u.unit.name }))
      .filter((u) => u.factor > 1);

    let reason = null;
    for (const { factor, unitName } of factors) {
      // (a) lonjakan pada riwayat harga yang rasionya = faktor kemasan dan masih berlaku
      const jump = p.priceHistories.find((h) => Number(h.oldBuy) > 0
        && approx(Number(h.newBuy) / Number(h.oldBuy), factor)
        && approx(Number(h.newBuy), buy));
      if (jump) {
        reason = `riwayat harga ${rupiah(jump.oldBuy)} → ${rupiah(jump.newBuy)} (×${factor}, satuan "${unitName}") pada ${jump.createdAt.toISOString().slice(0, 10)}; harga per satuan dasar kemungkinan ${rupiah(Math.round(buy / factor))}`;
        break;
      }
      // (b) harga beli di atas harga jual, tetapi wajar bila dibagi faktor kemasan
      if (sell > 0 && buy > sell && buy / factor <= sell) {
        reason = `harga beli ${rupiah(buy)} > harga jual ${rupiah(sell)}; dibagi ${factor} ("${unitName}") menjadi ${rupiah(Math.round(buy / factor))}`;
        break;
      }
    }
    if (reason) suspects.push({ product: p, reason });
  }

  console.log(`\n3. Harga beli yang tampak terkali faktor kemasan (periksa manual, tidak diubah): ${suspects.length}`);
  suspects.forEach(({ product, reason }) => {
    console.log(`   - ${product.sku}  ${product.name}  beli=${rupiah(product.buyPrice)}  jual=${rupiah(product.sellPrice)}\n       ${reason}`);
  });
  return { found: suspects.length };
};

const main = async () => {
  console.log(`Pemeriksaan satuan produk — mode: ${FIX ? 'PERBAIKI (--fix)' : 'hanya baca'}`);

  const missing = await checkMissingUnitId();
  const flags = await checkWrongBaseUnitFlag();
  const prices = await checkMultipliedBuyPrice();

  console.log('\nRingkasan:');
  console.log(`   Produk tanpa unitId            : ${missing.found}${FIX ? ` (diperbaiki ${missing.fixed})` : ''}`);
  console.log(`   Tanda satuan dasar yang salah  : ${flags.found}${FIX ? ` (diperbaiki ${flags.fixed})` : ''}`);
  console.log(`   Dugaan harga beli terkali      : ${prices.found} (hanya laporan)`);
  if (!FIX && (missing.found > 0 || flags.found > 0)) {
    console.log('\nJalankan dengan --fix untuk mengisi unitId dan menghapus tanda satuan dasar yang salah.');
  }
};

main()
  .catch((err) => {
    console.error('Pemeriksaan gagal:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
