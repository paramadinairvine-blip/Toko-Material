const { mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const { formatWIB, wibDayStart, wibDayEnd, wibDateRange } = require('../src/utils/wib');
const { nextDailyNumber, nextOpnameNumber } = require('../src/utils/documentNumber');

beforeEach(() => resetMocks());

const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join('?') : String(call[0]));

describe('formatWIB — tidak bergantung zona waktu server', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  // 18:30 UTC tgl 9 = 01:30 WIB tgl 10
  const instant = new Date('2026-10-09T18:30:05Z');

  test.each(['UTC', 'Asia/Jakarta', 'America/New_York', 'Pacific/Auckland'])(
    'server %s → tetap tanggal & jam WIB',
    (tz) => {
      process.env.TZ = tz;
      expect(formatWIB(instant, 'yyyyMMdd')).toBe('20261010');
      expect(formatWIB(instant, 'yyyyMMdd-HHmmss')).toBe('20261010-013005');
    }
  );
});

describe('batas hari WIB untuk filter tanggal', () => {
  test('tanggal polos → 00:00:00 s.d. 23:59:59.999 WIB', () => {
    expect(wibDayStart('2026-10-10').toISOString()).toBe('2026-10-09T17:00:00.000Z');
    expect(wibDayEnd('2026-10-10').toISOString()).toBe('2026-10-10T16:59:59.999Z');
  });

  test('string ISO lengkap dipakai apa adanya', () => {
    expect(wibDayStart('2026-10-10T03:00:00.000Z').toISOString()).toBe('2026-10-10T03:00:00.000Z');
    expect(wibDayEnd('2026-10-10T03:00:00+07:00').toISOString()).toBe('2026-10-09T20:00:00.000Z');
  });

  test('tanggal tidak valid → AppError 400', () => {
    expect(() => wibDayStart('bukan-tanggal')).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => wibDayEnd('2026-13-45')).toThrow(expect.objectContaining({ status: 400 }));
  });

  test('wibDateRange: kosong → undefined, sebagian → hanya batas itu', () => {
    expect(wibDateRange(undefined, '')).toBeUndefined();
    expect(wibDateRange('2026-10-10', undefined)).toEqual({ gte: new Date('2026-10-09T17:00:00.000Z') });
  });
});

describe('nextDailyNumber', () => {
  const opts = { prefix: 'TRX', model: 'transaction', field: 'transactionNumber' };

  test('mengambil advisory lock SEBELUM membaca nomor terakhir', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue(null);

    const number = await nextDailyNumber(mockPrisma, opts);

    expect(number).toMatch(/^TRX-\d{8}-0001$/);
    const lockIdx = mockPrisma.$queryRaw.mock.calls.findIndex((c) => /pg_advisory_xact_lock/.test(sqlOf(c)));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(mockPrisma.$queryRaw.mock.calls[lockIdx][1]).toBe('docnum:TRX');
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[lockIdx])
      .toBeLessThan(mockPrisma.transaction.findFirst.mock.invocationCallOrder[0]);
  });

  test('melanjutkan nomor terakhir hari itu dengan format yang sama', async () => {
    const today = formatWIB(new Date(), 'yyyyMMdd');
    mockPrisma.transaction.findFirst.mockResolvedValue({ transactionNumber: `TRX-${today}-0041` });

    expect(await nextDailyNumber(mockPrisma, opts)).toBe(`TRX-${today}-0042`);
    expect(mockPrisma.transaction.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { transactionNumber: { startsWith: `TRX-${today}-` } },
    }));
  });

  test('kunci berbeda per jenis dokumen', async () => {
    mockPrisma.purchaseOrder.findFirst.mockResolvedValue(null);
    await nextDailyNumber(mockPrisma, { prefix: 'PO', model: 'purchaseOrder', field: 'poNumber' });
    expect(mockPrisma.$queryRaw.mock.calls[0][1]).toBe('docnum:PO');
  });
});

describe('nextOpnameNumber', () => {
  test('format OPN-YYYYMMDD-HHmmss dan dikunci', async () => {
    mockPrisma.stockOpname.findUnique.mockResolvedValue(null);

    const number = await nextOpnameNumber(mockPrisma);

    expect(number).toMatch(/^OPN-\d{8}-\d{6}$/);
    expect(sqlOf(mockPrisma.$queryRaw.mock.calls[0])).toMatch(/pg_advisory_xact_lock/);
  });

  test('detik yang sudah terpakai → geser ke detik kosong berikutnya', async () => {
    mockPrisma.stockOpname.findUnique
      .mockResolvedValueOnce({ id: 'a' })
      .mockResolvedValueOnce({ id: 'b' })
      .mockResolvedValue(null);

    const number = await nextOpnameNumber(mockPrisma);

    const tried = mockPrisma.stockOpname.findUnique.mock.calls.map((c) => c[0].where.opnameNumber);
    expect(tried).toHaveLength(3);
    expect(new Set(tried).size).toBe(3);
    expect(number).toBe(tried[2]);
    expect(number).toMatch(/^OPN-\d{8}-\d{6}$/);
  });
});
