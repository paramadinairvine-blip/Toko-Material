const request = require('supertest');
const { Prisma } = require('@prisma/client');
const { adminToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');
const { errorHandler } = require('../src/middlewares/errorHandler');
const AppError = require('../src/utils/AppError');

beforeEach(() => {
  resetMocks();
  mockPrisma.auditLog.create.mockResolvedValue({});
});

const prismaError = (code, meta) => new Prisma.PrismaClientKnownRequestError(
  `\nInvalid \`prisma.user.create()\` invocation in\n/Users/dev/backend/src/controllers/user.controller.js:98:36\n\nUnique constraint failed`,
  { code, clientVersion: '6.19.2', meta }
);

const get = (path) => request(app).get(path).set('Authorization', `Bearer ${adminToken}`);
const post = (path, body) => request(app).post(path).set('Authorization', `Bearer ${adminToken}`).send(body);
const put = (path, body) => request(app).put(path).set('Authorization', `Bearer ${adminToken}`).send(body);

const expectNoLeak = (res) => {
  expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|\/Users\/|_fkey|_key|constraint/i);
};

describe('errorHandler (unit)', () => {
  const run = (err, env) => {
    const previous = process.env.NODE_ENV;
    if (env) process.env.NODE_ENV = env;
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
    process.env.NODE_ENV = previous;
    return res;
  };

  test.each(['development', 'test', 'production'])('error tak dikenal → 500 pesan umum (NODE_ENV=%s)', (env) => {
    const res = run(new Error('connect ECONNREFUSED 10.0.0.5:5432 at /Users/dev/app.js'), env);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Terjadi kesalahan pada server' });
  });

  test('kode Prisma yang tidak dipetakan → 500 pesan umum, tanpa teks Prisma', () => {
    const res = run(prismaError('P2034', {}));
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe('Terjadi kesalahan pada server');
  });

  test('P2002 → 409 dengan nama kolom yang dimengerti', () => {
    expect(run(prismaError('P2002', { target: ['email'] })).body.message).toBe('Data dengan email tersebut sudah ada');
    expect(run(prismaError('P2002', { target: ['sku'] })).body.message).toBe('Data dengan SKU tersebut sudah ada');
    // nama constraint (bukan array kolom) tidak bocor
    const res = run(prismaError('P2002', { target: 'unit_of_measures_abbreviation_key' }));
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe('Data dengan singkatan tersebut sudah ada');
  });

  test('P2003 → 400 tanpa nama constraint', () => {
    const res = run(prismaError('P2003', { field_name: 'products_categoryId_fkey (index)' }));
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/kategori/);
    expect(res.body.message).not.toMatch(/fkey|index/);
  });

  test('P2025 → 404', () => {
    expect(run(prismaError('P2025', {})).statusCode).toBe(404);
  });

  test('PrismaClientValidationError → 400 tanpa detail', () => {
    const err = new Prisma.PrismaClientValidationError('Unknown argument `fieldAsing`. Available options...', { clientVersion: '6.19.2' });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Data yang dikirim tidak valid');
  });

  test('AppError tetap memakai status & pesannya', () => {
    const res = run(new AppError('Kategori tidak ditemukan', 404));
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Kategori tidak ditemukan');
  });

  test('JSON rusak → 400', () => {
    const err = Object.assign(new SyntaxError('Unexpected token r in JSON'), { status: 400, type: 'entity.parse.failed' });
    const res = run(err);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Format data (JSON) tidak valid');
  });
});

describe('Controller meneruskan error ke errorHandler', () => {
  test('email user duplikat saat create (P2002 dari DB) → 409', async () => {
    mockPrisma.user.create.mockRejectedValue(prismaError('P2002', { target: ['email'] }));

    const res = await post('/api/users', { fullName: 'Budi', email: 'budi@material.dn2', password: 'rahasia1', role: 'KASIR' });

    expect(res.status).toBe(409);
    expectNoLeak(res);
  });

  test('email user duplikat terdeteksi sebelum menulis → 409', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ email: 'budi@material.dn2', username: 'lain' });

    const res = await post('/api/users', { fullName: 'Budi', email: 'budi@material.dn2', password: 'rahasia1', role: 'KASIR' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Email/);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  test('singkatan satuan duplikat (P2002) → 409', async () => {
    mockPrisma.unitOfMeasure.create.mockRejectedValue(prismaError('P2002', { target: ['abbreviation'] }));

    const res = await post('/api/units/measures', { name: 'Kilogram', abbreviation: 'kg' });

    expect(res.status).toBe(409);
    expectNoLeak(res);
  });

  test('nama unit lembaga duplikat (P2002) → 409', async () => {
    mockPrisma.unitLembaga.create.mockRejectedValue(prismaError('P2002', { target: ['name'] }));

    const res = await post('/api/units/lembaga', { name: 'Asrama' });

    expect(res.status).toBe(409);
    expectNoLeak(res);
  });

  test('error database tak terduga → 500 pesan umum', async () => {
    mockPrisma.supplier.findMany.mockRejectedValue(new Error('Can\'t reach database server at `db.internal`:5432'));

    const res = await get('/api/suppliers');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Terjadi kesalahan pada server');
  });

  test('upload bukan gambar → 400', async () => {
    const res = await request(app)
      .post('/api/products/upload-image')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('image', Buffer.from('halo'), { filename: 'catatan.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Format file harus jpg, png, atau webp');
  });
});

describe('Validasi query string → 400', () => {
  test.each([
    '/api/users?page=-1',
    '/api/users?page=abc',
    '/api/users?limit=0',
    '/api/users?role=SALAH',
    '/api/products?page=-1',
    '/api/products?isActive=mungkin',
    '/api/suppliers?page=0',
    '/api/brands?page=-1',
    '/api/projects?status=SALAH',
    '/api/notifications?page=-1',
    '/api/audit-logs?page=-1',
    '/api/audit-logs?action=SALAH',
    '/api/audit-logs?startDate=bukan-tanggal',
    '/api/reports/financial?startDate=bukan-tanggal',
    '/api/reports/financial?type=SALAH',
    '/api/reports/financial?startDate=2026-10-10&endDate=2026-10-01',
    '/api/reports/trend?startDate=bukan-tanggal',
    '/api/reports/trend?endDate=2026-13-45',
    '/api/reports/laba-rugi?endDate=bukan-tanggal',
    '/api/reports/dashboard?startDate=bukan-tanggal',
  ])('%s', async (path) => {
    const res = await get(path);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expectNoLeak(res);
    // tidak ada query yang sempat dijalankan dengan nilai rusak
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.transaction.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  test('nilai yang valid tetap diterima', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await get('/api/users?page=2&limit=5&role=KASIR');

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null, role: 'KASIR' }, skip: 5, take: 5,
    }));
  });
});

describe('Validasi body proyek/material', () => {
  test('POST /projects/:id/materials {} → 422', async () => {
    const res = await post('/api/projects/proj-1/materials', {});
    expect(res.status).toBe(422);
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });

  test.each([[{ usedQty: 'abc' }], [{ usedQty: -1 }], [{ usedQty: 2.5 }], [{}]])(
    'PUT /projects/:id/materials/:mid %j → 422',
    async (body) => {
      const res = await put('/api/projects/proj-1/materials/m-1', body);
      expect(res.status).toBe(422);
      expect(mockPrisma.projectMaterial.update).not.toHaveBeenCalled();
    }
  );
});
