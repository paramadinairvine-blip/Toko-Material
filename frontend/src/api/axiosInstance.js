import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach token
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 + refresh
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Network error (server down, no internet, CORS, etc.)
    if (!error.response) {
      error.message = 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
      return Promise.reject(error);
    }

    // If 401 and not already retrying
    if (error.response.status === 401 && !originalRequest._retry) {
      // Don't retry refresh or login endpoints
      if (
        originalRequest.url === '/auth/refresh' ||
        originalRequest.url === '/auth/login'
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return axiosInstance(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        const newToken = data.data.accessToken;

        localStorage.setItem('accessToken', newToken);
        axiosInstance.defaults.headers.Authorization = `Bearer ${newToken}`;
        originalRequest.headers.Authorization = `Bearer ${newToken}`;

        processQueue(null, newToken);
        return axiosInstance(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        const status = refreshError.response?.status;
        if (status === 401 || status === 403) {
          // Refresh token rejected: the session is really over
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/login';
        } else {
          // Temporary failure (server/network): keep the session so the next request can retry
          refreshError.message = refreshError.response
            ? 'Terjadi kesalahan pada server. Silakan coba lagi nanti.'
            : 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Format error messages in Indonesian
    if (error.response.status === 403) {
      error.message = String(originalRequest?.url || '').includes('/auth/login')
        ? error.response.data?.message || 'Akun tidak aktif, silakan hubungi administrator'
        : 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.';
    } else if (error.response.status === 404) {
      error.message = error.response.data?.message || 'Data tidak ditemukan.';
    } else if (error.response.status === 422) {
      error.message = error.response.data?.message || 'Data yang dikirim tidak valid.';
    } else if (error.response.status >= 500) {
      error.message = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
    } else if (error.response.data?.message) {
      error.message = error.response.data.message;
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
