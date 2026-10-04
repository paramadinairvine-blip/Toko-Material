const prisma = require('../lib/prisma');
const { Prisma } = require('@prisma/client');
const { DEFAULT_PAGE_SIZE } = require('../utils/constants');
const AppError = require('../utils/AppError');

/**
 * Valid action types for audit logging.
 */
const ACTION_TYPES = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  ROLLBACK: 'ROLLBACK',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
};

/**
 * Map entity/tableName string to the corresponding Prisma model delegate.
 * Used by rollback to update the correct table.
 */
const getModelDelegate = (tableName) => {
  const map = {
    users: prisma.user,
    categories: prisma.category,
    products: prisma.product,
    suppliers: prisma.supplier,
    transactions: prisma.transaction,
    transaction_items: prisma.transactionItem,
    purchase_orders: prisma.purchaseOrder,
    purchase_order_items: prisma.purchaseOrderItem,
    stock_movements: prisma.stockMovement,
    stock_opnames: prisma.stockOpname,
    stock_opname_items: prisma.stockOpnameItem,
    projects: prisma.project,
    brands: prisma.brand,
    unit_of_measures: prisma.unitOfMeasure,
    unit_lembaga: prisma.unitLembaga,
    notifications: prisma.notification,
    transaction_returns: prisma.transactionReturn,
    transaction_return_items: prisma.transactionReturnItem,
  };

  return map[tableName] || null;
};

// ─── Aturan rollback ────────────────────────────────────────────────

/**
 * Tabel yang TIDAK boleh di-rollback dari audit log: perubahannya punya efek
 * samping (stok, pergerakan stok, status dokumen, saldo proyek) yang tidak
 * ikut dibalik bila hanya oldData yang ditulis ulang.
 */
const ROLLBACK_BLOCKED_TABLES = new Set([
  'transactions',
  'transaction_items',
  'transaction_returns',
  'transaction_return_items',
  'purchase_orders',
  'purchase_order_items',
  'stock_movements',
  'stock_opnames',
  'stock_opname_items',
  'projects',
  'project_materials',
]);

// Field yang tidak pernah dipulihkan lewat rollback (semua tabel)
const ROLLBACK_STRIP_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedAt',
  'stock', 'status', 'password',
]);

// Field tambahan per tabel (dijaga aturan bisnis lain, mis. admin aktif terakhir)
const ROLLBACK_STRIP_FIELDS_BY_TABLE = {
  users: new Set(['role', 'isActive']),
};

const ROLLBACK_ACTIONS = new Set([ACTION_TYPES.UPDATE, ACTION_TYPES.DELETE]);

const getScalarFieldNames = (tableName) => {
  const models = Prisma?.dmmf?.datamodel?.models;
  if (!Array.isArray(models)) return null;
  const model = models.find((m) => m.dbName === tableName);
  if (!model) return null;
  return new Set(model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum').map((f) => f.name));
};

const isPlainValue = (value) => value === null
  || ['string', 'number', 'boolean'].includes(typeof value)
  || value instanceof Date;

/**
 * Ambil data yang aman dipulihkan dari oldData sebuah log.
 * Hanya kolom skalar milik tabel tsb; buang id/timestamp/stok/status dan relasi.
 */
const buildRestoreData = (log) => {
  if (!log?.oldData || typeof log.oldData !== 'object' || Array.isArray(log.oldData)) return {};
  const scalarFields = getScalarFieldNames(log.entity);
  const tableStrip = ROLLBACK_STRIP_FIELDS_BY_TABLE[log.entity];
  const data = {};
  for (const [key, value] of Object.entries(log.oldData)) {
    if (ROLLBACK_STRIP_FIELDS.has(key)) continue;
    if (tableStrip && tableStrip.has(key)) continue;
    if (scalarFields && !scalarFields.has(key)) continue;
    if (!isPlainValue(value)) continue; // relasi (array/objek) tidak dipulihkan
    data[key] = value;
  }
  return data;
};

/**
 * Alasan log tidak bisa di-rollback, atau null bila bisa.
 */
const getRollbackBlockReason = (log) => {
  if (!ROLLBACK_ACTIONS.has(log.action)) {
    return 'Hanya perubahan (UPDATE/DELETE) yang dapat di-rollback';
  }
  if (ROLLBACK_BLOCKED_TABLES.has(log.entity)) {
    const label = ENTITY_LABELS[log.entity] || log.entity;
    return `Rollback tidak diizinkan untuk data ${label} karena memengaruhi stok/status. Lakukan koreksi melalui menu terkait.`;
  }
  if (!log.oldData) return 'Tidak ada data lama untuk di-rollback';
  if (!log.entityId) return 'ID record tidak ditemukan pada log ini';
  if (!getModelDelegate(log.entity)) return `Tabel "${log.entity}" tidak dikenali untuk rollback`;
  if (Object.keys(buildRestoreData(log)).length === 0) {
    return 'Tidak ada data yang dapat dipulihkan dari log ini';
  }
  return null;
};

const canRollback = (log) => getRollbackBlockReason(log) === null;

/**
 * Create an audit log entry.
 *
 * @param {object} params
 * @param {string}  params.userId     - ID of the user performing the action
 * @param {string}  params.action     - Action type (CREATE, UPDATE, DELETE, etc.)
 * @param {string}  params.tableName  - Target table / entity name
 * @param {string}  [params.recordId] - ID of the affected record
 * @param {object}  [params.oldData]  - Previous state (for UPDATE / DELETE)
 * @param {object}  [params.newData]  - New state (for CREATE / UPDATE)
 * @param {string}  [params.ipAddress]
 * @param {string}  [params.userAgent]
 * @returns {Promise<object>} Created audit log record
 */
const createLog = async ({ userId, action, tableName, recordId, oldData, newData, ipAddress, userAgent }) => {
  return prisma.auditLog.create({
    data: {
      userId: userId || null,
      action,
      entity: tableName,
      entityId: recordId || null,
      oldData: oldData || undefined,
      newData: newData || undefined,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    },
  });
};

/**
 * Get paginated audit logs with optional filters.
 *
 * @param {object}  params
 * @param {number}  [params.page=1]
 * @param {number}  [params.limit=DEFAULT_PAGE_SIZE]
 * @param {string}  [params.userId]
 * @param {string}  [params.tableName]
 * @param {string}  [params.action]
 * @param {string}  [params.startDate]
 * @param {string}  [params.endDate]
 * @returns {Promise<{ data: object[], total: number, page: number, limit: number }>}
 */
/**
 * Generate a human-readable description from an audit log entry.
 */
const ENTITY_LABELS = {
  users: 'pengguna',
  categories: 'kategori',
  products: 'produk',
  suppliers: 'supplier',
  transactions: 'transaksi',
  transaction_items: 'item transaksi',
  purchase_orders: 'purchase order',
  purchase_order_items: 'item PO',
  stock_movements: 'pergerakan stok',
  stock_opnames: 'stock opname',
  stock_opname_items: 'item opname',
  projects: 'proyek',
  project_materials: 'material proyek',
  brands: 'brand',
  unit_of_measures: 'satuan',
  unit_lembaga: 'unit lembaga',
  notifications: 'notifikasi',
  transaction_returns: 'retur transaksi',
  transaction_return_items: 'item retur',
};

const ACTION_VERBS = {
  CREATE: 'Menambah',
  UPDATE: 'Mengubah',
  DELETE: 'Menghapus',
  ROLLBACK: 'Rollback',
  LOGIN: 'Login ke sistem',
  LOGOUT: 'Logout dari sistem',
};

const generateDescription = (log) => {
  if (log.action === 'LOGIN') return 'Login ke sistem';
  if (log.action === 'LOGOUT') return 'Logout dari sistem';

  const verb = ACTION_VERBS[log.action] || log.action;
  const entityLabel = ENTITY_LABELS[log.entity] || log.entity;

  // Try to get a recognizable name from newData or oldData
  const data = log.newData || log.oldData || {};
  const name = data.name || data.fullName || data.invoiceNumber
    || data.poNumber || data.opnameNumber || data.sku || '';

  if (name) {
    return `${verb} ${entityLabel} "${name}"`;
  }

  return `${verb} ${entityLabel}`;
};

const getLogs = async ({ page = 1, limit = DEFAULT_PAGE_SIZE, userId, tableName, action, startDate, endDate } = {}) => {
  const where = {};

  if (userId) {
    where.userId = userId;
  }
  if (tableName) {
    where.entity = tableName;
  }
  if (action) {
    where.action = action;
  }
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  // Enrich with readable description and module label
  const enriched = data.map((log) => ({
    ...log,
    module: ENTITY_LABELS[log.entity] || log.entity || '-',
    description: generateDescription(log),
    canRollback: canRollback(log),
  }));

  return { data: enriched, total, page, limit };
};

/**
 * Get a single audit log by ID.
 *
 * @param {string} id
 * @returns {Promise<object|null>}
 */
const getLogById = async (id) => {
  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, fullName: true, email: true, role: true },
      },
    },
  });

  if (!log) {
    throw new AppError('Log audit tidak ditemukan', 404);
  }

  return { ...log, canRollback: canRollback(log) };
};

/**
 * Rollback a change by restoring oldData from an audit log entry.
 *
 * Steps:
 * 1. Read the audit log and its oldData
 * 2. Update the record in the target table with oldData
 * 3. Create a new audit log with action "ROLLBACK"
 *
 * @param {string} logId  - ID of the audit log to rollback
 * @param {string} userId - ID of the user performing the rollback
 * @returns {Promise<object>} The restored record
 */
const rollback = async (logId, userId) => {
  const log = await prisma.auditLog.findUnique({ where: { id: logId } });

  if (!log) {
    throw new AppError('Log audit tidak ditemukan', 404);
  }

  const blockReason = getRollbackBlockReason(log);
  if (blockReason) {
    throw new AppError(blockReason, 400);
  }

  const model = getModelDelegate(log.entity);

  // Get current state before rollback for the new audit log
  const currentRecord = await model.findUnique({ where: { id: log.entityId } });

  if (!currentRecord) {
    throw new AppError('Record yang akan di-rollback tidak ditemukan', 404);
  }

  // Hanya kolom skalar yang aman (tanpa id/timestamp/stok/status/relasi)
  const restoreData = buildRestoreData(log);

  // Update the record with old data
  const restored = await model.update({
    where: { id: log.entityId },
    data: restoreData,
  });

  // Create rollback audit log
  await createLog({
    userId,
    action: ACTION_TYPES.ROLLBACK,
    tableName: log.entity,
    recordId: log.entityId,
    oldData: currentRecord,
    newData: restored,
  });

  return restored;
};

module.exports = {
  ACTION_TYPES,
  createLog,
  getLogs,
  getLogById,
  rollback,
  canRollback,
};
