const request = require('supertest');
const { adminToken, kasirToken, viewerToken, mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const app = require('../src/index');

beforeEach(() => resetMocks());

const sampleCategory = {
  id: 'cat-1', name: 'Semen', description: 'Kategori semen',
  parentId: null, isActive: true, children: [], _count: { products: 5 },
};

describe('GET /api/categories', () => {
  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(401);
  });

  test('should return categories', async () => {
    mockPrisma.category.findMany.mockResolvedValue([sampleCategory]);

    const res = await request(app)
      .get('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/categories/:id', () => {
  test('should return category by id', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({
      ...sampleCategory,
      parent: null,
      products: [],
      _count: { products: 5, children: 0 },
    });

    const res = await request(app)
      .get('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 404 for non-existent category', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/categories/non-existent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/categories', () => {
  test('should reject VIEWER role', async () => {
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(403);
  });

  test('should reject invalid data (short name)', async () => {
    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'X' });

    expect(res.status).toBe(422);
  });

  test('should create category successfully', async () => {
    mockPrisma.category.create.mockResolvedValue({ ...sampleCategory, parent: null });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Semen', description: 'Kategori semen' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('should create sub-category with valid parentId', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.create.mockResolvedValue({ ...sampleCategory, id: 'cat-2', parentId: 'cat-1', parent: { id: 'cat-1', name: 'Semen' } });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Semen Portland', parentId: 'cat-1' });

    expect(res.status).toBe(201);
  });
});

describe('PUT /api/categories/:id', () => {
  test('should update category', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.update.mockResolvedValue({ ...sampleCategory, name: 'Updated', parent: null });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .put('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should reject self-referencing parent', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);

    const res = await request(app)
      .put('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Semen', parentId: 'cat-1' });

    expect(res.status).toBe(400);
  });

  test('should return 404 for non-existent category', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .put('/api/categories/non-existent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test Category' });

    expect(res.status).toBe(404);
  });
});

describe('Kategori — nama ganda & lingkaran induk', () => {
  const post = (body) => request(app)
    .post('/api/categories')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
  const put = (id, body) => request(app)
    .put(`/api/categories/${id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);

  test('POST: nama sama pada induk yang sama → 409', async () => {
    mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-9' });

    const res = await post({ name: '  Semen ' });

    expect(res.status).toBe(409);
    expect(mockPrisma.category.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        name: { equals: 'Semen', mode: 'insensitive' }, parentId: null, isActive: true,
      }),
    }));
    expect(mockPrisma.category.create).not.toHaveBeenCalled();
  });

  test('PUT: mengganti nama menjadi nama kategori lain → 409', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Semen', parentId: null });
    mockPrisma.category.findFirst.mockResolvedValue({ id: 'cat-2' });

    const res = await put('cat-1', { name: 'Cat' });

    expect(res.status).toBe(409);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  test('PUT: menyimpan ulang tanpa mengubah nama/induk tidak dianggap duplikat', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Semen', parentId: null });
    mockPrisma.category.update.mockResolvedValue({ id: 'cat-1', name: 'Semen' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await put('cat-1', { name: 'Semen', description: 'baru' });

    expect(res.status).toBe(200);
    expect(mockPrisma.category.findFirst).not.toHaveBeenCalled();
  });

  test('PUT: induk := turunan sendiri (lingkaran) → 400', async () => {
    // A(cat-a) → B(cat-b) → C(cat-c); coba jadikan C induk dari A
    const tree = {
      'cat-a': { id: 'cat-a', name: 'A', parentId: null },
      'cat-b': { id: 'cat-b', name: 'B', parentId: 'cat-a' },
      'cat-c': { id: 'cat-c', name: 'C', parentId: 'cat-b' },
    };
    mockPrisma.category.findUnique.mockImplementation(({ where }) => Promise.resolve(tree[where.id] || null));

    const res = await put('cat-a', { name: 'Alat', parentId: 'cat-c' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/sub-kategorinya sendiri/);
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  test('PUT: memindahkan ke induk lain yang bukan turunan tetap boleh', async () => {
    const tree = {
      'cat-a': { id: 'cat-a', name: 'A', parentId: null },
      'cat-x': { id: 'cat-x', name: 'X', parentId: null },
    };
    mockPrisma.category.findUnique.mockImplementation(({ where }) => Promise.resolve(tree[where.id] || null));
    mockPrisma.category.update.mockResolvedValue({ id: 'cat-a' });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await put('cat-a', { name: 'Alat', parentId: 'cat-x' });

    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/categories/:id', () => {
  test('should deactivate category', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.category.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('should reject if has active children', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.count.mockResolvedValue(2);
    mockPrisma.product.count.mockResolvedValue(0);

    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 sub-kategori aktif/);
    // hanya sub-kategori AKTIF yang dihitung
    expect(mockPrisma.category.count).toHaveBeenCalledWith({ where: { parentId: 'cat-1', isActive: true } });
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  test('induk yang semua sub-kategorinya sudah nonaktif boleh dihapus', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.count.mockResolvedValue(0); // anak aktif = 0 (yang nonaktif tidak dihitung)
    mockPrisma.product.count.mockResolvedValue(0);
    mockPrisma.category.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  test('kategori yang masih dipakai produk aktif tidak boleh dihapus', async () => {
    mockPrisma.category.findUnique.mockResolvedValue(sampleCategory);
    mockPrisma.category.count.mockResolvedValue(0);
    mockPrisma.product.count.mockResolvedValue(3);

    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3 produk aktif/);
    expect(mockPrisma.product.count).toHaveBeenCalledWith({ where: { categoryId: 'cat-1', isActive: true } });
    expect(mockPrisma.category.update).not.toHaveBeenCalled();
  });

  test('should reject non-ADMIN', async () => {
    const res = await request(app)
      .delete('/api/categories/cat-1')
      .set('Authorization', `Bearer ${kasirToken}`);

    expect(res.status).toBe(403);
  });
});
