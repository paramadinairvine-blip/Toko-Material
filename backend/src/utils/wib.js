const { format } = require('date-fns');
const AppError = require('./AppError');

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Format tanggal dalam WIB (+07:00) — tidak bergantung zona waktu server.
 * Jam dinding WIB dibaca lewat getter UTC lalu disusun ulang sebagai waktu
 * lokal agar date-fns (yang memformat waktu lokal) menghasilkan angka WIB.
 */
const formatWIB = (date, fmt) => {
  const w = new Date(date.getTime() + WIB_OFFSET_MS);
  const local = new Date(
    w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(),
    w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds(), w.getUTCMilliseconds()
  );
  return format(local, fmt);
};

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseBoundary = (value, suffix) => {
  const str = String(value).trim();
  const date = PLAIN_DATE.test(str) ? new Date(`${str}${suffix}`) : new Date(str);
  if (isNaN(date.getTime())) {
    throw new AppError('Format tanggal tidak valid', 400);
  }
  return date;
};

/**
 * Batas hari WIB untuk filter tanggal.
 * 'yyyy-MM-dd' polos → awal/akhir hari WIB; string ISO lengkap dipakai apa adanya.
 */
const wibDayStart = (d) => parseBoundary(d, 'T00:00:00.000+07:00');
const wibDayEnd = (d) => parseBoundary(d, 'T23:59:59.999+07:00');

/**
 * Bangun filter Prisma { gte, lte } dari rentang tanggal (boleh salah satu saja).
 * Mengembalikan undefined bila kedua batas kosong.
 */
const wibDateRange = (start, end) => {
  if (!start && !end) return undefined;
  const range = {};
  if (start) range.gte = wibDayStart(start);
  if (end) range.lte = wibDayEnd(end);
  return range;
};

module.exports = { WIB_OFFSET_MS, formatWIB, wibDayStart, wibDayEnd, wibDateRange };
