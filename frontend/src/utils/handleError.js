/**
 * Extract a user-friendly error message from an Axios error object.
 * Works with the messages set by axiosInstance interceptor.
 *
 * @param {Error} error - Axios error or generic error
 * @param {string} [fallback] - Fallback message if nothing can be extracted
 * @returns {string}
 */
export function getErrorMessage(error, fallback = 'Terjadi kesalahan. Silakan coba lagi.') {
  if (!error) return fallback;

  // Network error (no response)
  if (!error.response) {
    return 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
  }

  const status = error.response.status;
  const serverMessage = error.response.data?.message;

  switch (status) {
    case 401:
      // A failed login is not an expired session: show the server's reason
      if (String(error.config?.url || '').includes('/auth/login')) {
        return serverMessage || 'Email atau password salah';
      }
      return 'Sesi Anda telah berakhir. Silakan login kembali.';
    case 403:
      return 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.';
    case 404:
      return serverMessage || 'Data tidak ditemukan.';
    case 422:
      return serverMessage || 'Data yang dikirim tidak valid.';
    default:
      if (status >= 500) {
        return 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
      }
      return serverMessage || fallback;
  }
}

/**
 * Extract field-level validation errors from a 422 response.
 * @param {Error} error - Axios error
 * @returns {Object} - { fieldName: errorMessage }
 */
export function getFieldErrors(error) {
  const fieldErrors = {};
  const errors = error?.response?.data?.errors;
  if (Array.isArray(errors)) {
    errors.forEach((e) => {
      if (e.field) fieldErrors[e.field] = e.message;
    });
  }
  return fieldErrors;
}
