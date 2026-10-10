const AppError = require('./AppError');
const { DEFAULT_PAGE_SIZE } = require('./constants');

const PLAIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isBlank = (value) => value === undefined || value === null || value === '';

/**
 * Bilangan bulat positif dari query string. Kosong → nilai default.
 * Selain bilangan bulat ≥ 1 → 400 (bukan diam-diam dipakai apa adanya).
 */
const parsePositiveInt = (value, fallback, name) => {
  if (isBlank(value)) return fallback;
  const text = String(value).trim();
  if (Array.isArray(value) || !/^\d+$/.test(text) || Number(text) < 1 || !Number.isSafeInteger(Number(text))) {
    throw new AppError(`Parameter ${name} harus berupa bilangan bulat minimal 1`, 400);
  }
  return Number(text);
};

/**
 * Ambil page/limit/skip dari query. page & limit harus bilangan bulat ≥ 1.
 */
const parsePagination = (query = {}, defaultLimit = DEFAULT_PAGE_SIZE) => {
  const page = parsePositiveInt(query.page, 1, 'page');
  const limit = parsePositiveInt(query.limit, defaultLimit, 'limit');
  return { page, limit, skip: (page - 1) * limit };
};

/**
 * Nilai enum dari query. Kosong → undefined; nilai di luar daftar → 400.
 */
const parseEnumParam = (value, allowed, name) => {
  if (isBlank(value)) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new AppError(`Parameter ${name} harus salah satu dari: ${allowed.join(', ')}`, 400);
  }
  return value;
};

/**
 * 'true' / 'false' dari query. Kosong → undefined; nilai lain → 400.
 */
const parseBooleanParam = (value, name) => {
  if (isBlank(value)) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new AppError(`Parameter ${name} harus bernilai true atau false`, 400);
};

/**
 * Ubah parameter tanggal menjadi Date.
 *
 * - Tanggal polos `YYYY-MM-DD` dibaca sebagai hari kalender WIB (+07:00):
 *   awal hari 00:00:00 atau, dengan `endOfDay`, akhir hari 23:59:59.999 —
 *   tidak bergantung zona waktu server.
 * - String ISO lengkap (mengandung jam) dipakai apa adanya.
 * - Kosong → null; bukan tanggal yang valid → 400.
 */
const parseDateParam = (value, { endOfDay = false, name = 'tanggal' } = {}) => {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new AppError(`Parameter ${name} bukan tanggal yang valid`, 400);
    return value;
  }
  if (typeof value !== 'string') {
    throw new AppError(`Parameter ${name} bukan tanggal yang valid`, 400);
  }

  const text = value.trim();
  const date = PLAIN_DATE_RE.test(text)
    ? new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+07:00`)
    : new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Parameter ${name} bukan tanggal yang valid`, 400);
  }
  return date;
};

/**
 * Filter rentang tanggal Prisma ({ gte, lte }) dari startDate/endDate.
 * Mengembalikan null bila keduanya kosong.
 */
const buildDateRange = (startDate, endDate) => {
  const start = parseDateParam(startDate, { name: 'startDate' });
  const end = parseDateParam(endDate, { endOfDay: true, name: 'endDate' });
  if (start && end && start > end) {
    throw new AppError('Parameter startDate tidak boleh setelah endDate', 400);
  }
  if (!start && !end) return null;
  const range = {};
  if (start) range.gte = start;
  if (end) range.lte = end;
  return range;
};

module.exports = {
  parsePagination,
  parseEnumParam,
  parseBooleanParam,
  parseDateParam,
  buildDateRange,
};
