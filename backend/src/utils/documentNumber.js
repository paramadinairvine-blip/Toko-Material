const { formatWIB } = require('./wib');

/**
 * Kunci penomoran dokumen selama transaksi DB berjalan (advisory lock tingkat
 * transaksi, otomatis lepas saat COMMIT/ROLLBACK). Pembuatan dokumen yang
 * bersamaan jadi antre sehingga "nomor terakhir + 1" tidak pernah kembar.
 *
 * HARUS dipanggil di dalam prisma.$transaction, sebelum membaca nomor terakhir.
 */
const lockNumbering = async (tx, key) => {
  // ::text karena Prisma tidak bisa membaca kolom bertipe void
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
};

/**
 * Nomor urut harian: <PREFIX>-YYYYMMDD-XXXX (tanggal WIB).
 *
 * @param {object} tx        Prisma transaction client
 * @param {object} opts
 * @param {string} opts.prefix  mis. 'TRX', 'RTN', 'PO'
 * @param {string} opts.model   nama delegate Prisma, mis. 'transaction'
 * @param {string} opts.field   nama kolom nomor, mis. 'transactionNumber'
 */
const nextDailyNumber = async (tx, { prefix, model, field }) => {
  await lockNumbering(tx, `docnum:${prefix}`);

  const dayPrefix = `${prefix}-${formatWIB(new Date(), 'yyyyMMdd')}-`;

  const last = await tx[model].findFirst({
    where: { [field]: { startsWith: dayPrefix } },
    orderBy: { [field]: 'desc' },
    select: { [field]: true },
  });

  let seq = 1;
  if (last) {
    const lastSeq = parseInt(String(last[field]).replace(dayPrefix, ''), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${dayPrefix}${String(seq).padStart(4, '0')}`;
};

/**
 * Nomor stock opname: OPN-YYYYMMDD-HHmmss (WIB). Resolusinya 1 detik, jadi
 * bila detik itu sudah terpakai nomor digeser ke detik berikutnya yang kosong.
 */
const nextOpnameNumber = async (tx) => {
  await lockNumbering(tx, 'docnum:OPN');

  let at = new Date();
  for (let i = 0; i < 3600; i += 1) {
    const candidate = `OPN-${formatWIB(at, 'yyyyMMdd-HHmmss')}`;
    const taken = await tx.stockOpname.findUnique({
      where: { opnameNumber: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
    at = new Date(at.getTime() + 1000);
  }
  throw new Error('Gagal membuat nomor stock opname yang unik');
};

module.exports = { lockNumbering, nextDailyNumber, nextOpnameNumber };
