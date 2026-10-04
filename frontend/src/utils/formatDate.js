import { format } from 'date-fns';
import { id } from 'date-fns/locale';

/**
 * Format date: "21/02/2026"
 */
export const formatTanggal = (date) => {
  if (!date) return '-';
  return format(new Date(date), 'dd/MM/yyyy');
};

/**
 * Format date with time: "21/02/2026 14:30"
 */
export const formatTanggalWaktu = (date) => {
  if (!date) return '-';
  return format(new Date(date), 'dd/MM/yyyy HH:mm');
};

/**
 * Format long date: "21 Februari 2026"
 */
export const formatTanggalPanjang = (date) => {
  if (!date) return '-';
  return format(new Date(date), 'd MMMM yyyy', { locale: id });
};

/**
 * Tanggal hari ini (WIB, UTC+7) dalam format YYYY-MM-DD.
 * toISOString() memakai UTC, sehingga antara 00:00-07:00 WIB menghasilkan tanggal kemarin.
 */
export const todayWIB = () => {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

/**
 * Konversi tanggal YYYY-MM-DD ke ISO string dengan timezone WIB (UTC+7)
 */
export const startOfDayWIB = (dateStr) => {
  return new Date(dateStr + 'T00:00:00+07:00').toISOString();
};

export const endOfDayWIB = (dateStr) => {
  return new Date(dateStr + 'T23:59:59.999+07:00').toISOString();
};

export const startOfMonthWIB = (year, month) => {
  const m = String(month + 1).padStart(2, '0');
  return new Date(`${year}-${m}-01T00:00:00+07:00`).toISOString();
};

export const endOfMonthWIB = (year, month) => {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const m = String(month + 1).padStart(2, '0');
  const d = String(lastDay).padStart(2, '0');
  return new Date(`${year}-${m}-${d}T23:59:59.999+07:00`).toISOString();
};
