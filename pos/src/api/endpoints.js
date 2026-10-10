import api from './axiosInstance';

// ==================== Auth ====================
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  // accessToken: only for revoking a session that was never stored (login refused for the role)
  logout: (refreshToken, accessToken) =>
    api.post('/auth/logout', { refreshToken }, accessToken ? { _token: accessToken, _retry: true } : undefined),
  me: () => api.get('/auth/me'),
};

// ==================== Product ====================
export const productAPI = {
  getAll: (params) => api.get('/products', { params }),
  getById: (id) => api.get(`/products/${id}`),
  getByBarcode: (barcode) => api.get(`/products/barcode/${barcode}`),
};

// ==================== Transaction ====================
export const transactionAPI = {
  getAll: (params) => api.get('/transactions', { params }),
  getById: (id) => api.get(`/transactions/${id}`),
  create: (data) => api.post('/transactions', data),
};

// ==================== Return ====================
export const returnAPI = {
  getAll: (params) => api.get('/returns', { params }),
  create: (data) => api.post('/returns', data),
  getByTransaction: (transactionId) => api.get(`/returns/transaction/${transactionId}`),
};

// ==================== Stock ====================
export const stockAPI = {
  getAll: (params) => api.get('/stock', { params }),
  getByProduct: (productId) => api.get(`/stock/${productId}`),
};

// ==================== Report ====================
export const reportAPI = {
  getDashboard: (params) => api.get('/reports/dashboard', { params }),
};

// ==================== Unit ====================
export const unitAPI = {
  getLembaga: () => api.get('/units/lembaga'),
};
