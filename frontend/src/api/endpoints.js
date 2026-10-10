import api from './axiosInstance';

// ==================== Auth ====================
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  refresh: (refreshToken) => api.post('/auth/refresh', { refreshToken }),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }),
  me: () => api.get('/auth/me'),
};

// ==================== User ====================
export const userAPI = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  remove: (id) => api.delete(`/users/${id}`),
  changePassword: (id, data) => api.put(`/users/${id}/change-password`, data),
};

// ==================== Category ====================
export const categoryAPI = {
  getAll: () => api.get('/categories'),
  getById: (id) => api.get(`/categories/${id}`),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  remove: (id) => api.delete(`/categories/${id}`),
};

// ==================== Brand ====================
export const brandAPI = {
  getAll: (params) => api.get('/brands', { params }),
  getById: (id) => api.get(`/brands/${id}`),
  create: (data) => api.post('/brands', data),
  update: (id, data) => api.put(`/brands/${id}`, data),
  remove: (id) => api.delete(`/brands/${id}`),
};

// ==================== Product ====================
export const productAPI = {
  getAll: (params) => api.get('/products', { params }),
  getById: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  remove: (id) => api.delete(`/products/${id}`),
  getByBarcode: (barcode) => api.get(`/products/barcode/${barcode}`),
  generateBarcode: (id) => api.post(`/products/${id}/generate-barcode`),
  uploadImage: (formData) =>
    api.post('/products/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
};

// ==================== Supplier ====================
export const supplierAPI = {
  getAll: (params) => api.get('/suppliers', { params }),
  getById: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  remove: (id) => api.delete(`/suppliers/${id}`),
};

// ==================== Transaction ====================
export const transactionAPI = {
  getAll: (params) => api.get('/transactions', { params }),
  getById: (id) => api.get(`/transactions/${id}`),
  create: (data) => api.post('/transactions', data),
  cancel: (id) => api.put(`/transactions/${id}/cancel`),
};

// ==================== Purchase Order ====================
export const purchaseOrderAPI = {
  getAll: (params) => api.get('/purchase-orders', { params }),
  getById: (id) => api.get(`/purchase-orders/${id}`),
  create: (data) => api.post('/purchase-orders', data),
  update: (id, data) => api.put(`/purchase-orders/${id}`, data),
  send: (id) => api.put(`/purchase-orders/${id}/send`),
  receive: (id, data) => api.put(`/purchase-orders/${id}/receive`, data),
  cancel: (id) => api.put(`/purchase-orders/${id}/cancel`),
};

// ==================== Stock ====================
export const stockAPI = {
  getAll: (params) => api.get('/stock', { params }),
  getByProduct: (productId, params) => api.get(`/stock/${productId}`, { params }),
  adjust: (data) => api.post('/stock/adjustment', data),
  getOpnameList: (params) => api.get('/stock-opname', { params }),
  createOpname: () => api.post('/stock-opname'),
  getOpnameById: (id) => api.get(`/stock-opname/${id}`),
  updateOpnameItem: (id, itemId, data) => api.put(`/stock-opname/${id}/items/${itemId}`, data),
  completeOpname: (id) => api.put(`/stock-opname/${id}/complete`),
};

// ==================== Project ====================
export const projectAPI = {
  getAll: (params) => api.get('/projects', { params }),
  getById: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  remove: (id) => api.delete(`/projects/${id}`),
  addMaterial: (id, data) => api.post(`/projects/${id}/materials`, data),
  updateMaterial: (id, materialId, data) => api.put(`/projects/${id}/materials/${materialId}`, data),
  getReport: (id) => api.get(`/projects/${id}/report`),
};

// ==================== Report ====================
export const reportAPI = {
  getDashboard: (params) => api.get('/reports/dashboard', { params }),
  getStock: (params) => api.get('/reports/stock', { params }),
  getFinancial: (params) => api.get('/reports/financial', { params }),
  getTrend: (params) => api.get('/reports/trend', { params }),
  getLabaRugi: (params) => api.get('/reports/laba-rugi', { params }),
};

// ==================== Notification ====================
export const notificationAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  getMe: (params) => api.get('/notifications/me', { params }),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  checkLowStock: () => api.post('/notifications/check-low-stock'),
};

// ==================== Return ====================
export const returnAPI = {
  getAll: (params) => api.get('/returns', { params }),
  getById: (id) => api.get(`/returns/${id}`),
  getByTransaction: (transactionId) => api.get(`/returns/transaction/${transactionId}`),
  create: (data) => api.post('/returns', data),
};

// ==================== Audit Log ====================
export const auditLogAPI = {
  getAll: (params) => api.get('/audit-logs', { params }),
  getById: (id) => api.get(`/audit-logs/${id}`),
  rollback: (id) => api.post(`/audit-logs/${id}/rollback`),
};

// ==================== Unit ====================
export const unitAPI = {
  getMeasures: () => api.get('/units/measures'),
  createMeasure: (data) => api.post('/units/measures', data),
  updateMeasure: (id, data) => api.put(`/units/measures/${id}`, data),
  deleteMeasure: (id) => api.delete(`/units/measures/${id}`),
  getLembaga: () => api.get('/units/lembaga'),
  createLembaga: (data) => api.post('/units/lembaga', data),
  updateLembaga: (id, data) => api.put(`/units/lembaga/${id}`, data),
  deleteLembaga: (id) => api.delete(`/units/lembaga/${id}`),
};
