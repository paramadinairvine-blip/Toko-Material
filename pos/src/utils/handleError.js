export function getErrorMessage(error, fallback = 'Terjadi kesalahan. Silakan coba lagi.') {
  if (!error) return fallback;

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
      // A deactivated account is refused at login with its own reason
      if (String(error.config?.url || '').includes('/auth/login')) {
        return serverMessage || 'Akun tidak aktif, silakan hubungi administrator';
      }
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
