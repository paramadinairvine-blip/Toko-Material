const AppError = require('./AppError');
const { DEFAULT_PAGE_SIZE } = require('./constants');

const MAX_PAGE_SIZE = 1000;

const isBlank = (v) => v === undefined || v === null || v === '';

const parsePositiveInt = (value, label) => {
  const str = String(value).trim();
  if (!/^\d+$/.test(str) || Number(str) < 1) {
    throw new AppError(`Parameter ${label} harus berupa bilangan bulat minimal 1`, 400);
  }
  return Number(str);
};

/**
 * Baca ?page & ?limit. Kosong → default; bukan bilangan bulat ≥ 1 → 400;
 * limit di atas batas → dipangkas ke maxLimit.
 */
const parsePagination = (query = {}, { defaultLimit = DEFAULT_PAGE_SIZE, maxLimit = MAX_PAGE_SIZE } = {}) => {
  const page = isBlank(query.page) ? 1 : parsePositiveInt(query.page, 'page');
  const limit = isBlank(query.limit) ? defaultLimit : Math.min(parsePositiveInt(query.limit, 'limit'), maxLimit);
  return { page, limit };
};

/** Nilai enum dari query string. Kosong → undefined; di luar daftar → 400. */
const parseEnumParam = (value, allowed, label) => {
  if (isBlank(value)) return undefined;
  const list = Array.isArray(allowed) ? allowed : Object.values(allowed);
  if (typeof value !== 'string' || !list.includes(value)) {
    throw new AppError(`Parameter ${label} harus salah satu dari: ${list.join(', ')}`, 400);
  }
  return value;
};

/** Parameter teks tunggal (menolak ?a=1&a=2 / objek yang membuat Prisma error). */
const parseStringParam = (value, label) => {
  if (isBlank(value)) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(`Parameter ${label} tidak valid`, 400);
  }
  return value;
};

module.exports = { MAX_PAGE_SIZE, parsePagination, parseEnumParam, parseStringParam };
