const { mockPrisma, resetMocks } = require('./helpers/setup');

jest.mock('../src/lib/prisma', () => require('./helpers/setup').mockPrisma);

const productService = require('../src/services/product.service');
const categoryService = require('../src/services/category.service');
const projectService = require('../src/services/project.service');
const auditLogService = require('../src/services/auditLog.service');

beforeEach(() => resetMocks());

describe('data master nonaktif', () => {
  test('produk baru menolak brand nonaktif', async () => {
    mockPrisma.brand.findUnique.mockResolvedValue({ id: 'b-1', name: 'Lama', isActive: false });

    await expect(productService.create({ name: 'Semen', brandId: 'b-1' }, 'user-1'))
      .rejects.toMatchObject({ status: 400, message: 'Brand sudah tidak aktif' });
    expect(mockPrisma.product.create).not.toHaveBeenCalled();
  });

  test('edit produk menolak pindah ke kategori nonaktif', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Semen', categoryId: 'c-lama' });
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'c-baru', name: 'Arsip', isActive: false });

    await expect(productService.update('p-1', { categoryId: 'c-baru' }, 'user-1'))
      .rejects.toMatchObject({ status: 400, message: 'Kategori sudah tidak aktif' });
  });

  test('kategori baru menolak induk nonaktif', async () => {
    mockPrisma.category.findUnique.mockResolvedValue({ id: 'c-1', name: 'Induk', isActive: false });

    await expect(categoryService.create({ name: 'Anak', parentId: 'c-1', userId: 'user-1' }))
      .rejects.toMatchObject({ status: 400, message: 'Kategori induk sudah tidak aktif' });
    expect(mockPrisma.category.create).not.toHaveBeenCalled();
  });

  test('material proyek menolak produk nonaktif', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'pr-1', isActive: true, status: 'PLANNING' });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', sellPrice: 1000, isActive: false });

    await expect(projectService.addMaterial('pr-1', { productId: 'p-1', estimatedQty: 2 }, 'user-1'))
      .rejects.toMatchObject({ status: 400, message: 'Produk sudah tidak aktif' });
    expect(mockPrisma.projectMaterial.create).not.toHaveBeenCalled();
  });
});

describe('rollback harga produk', () => {
  test('mencatat riwayat harga', async () => {
    mockPrisma.auditLog.findUnique.mockResolvedValue({
      id: 'log-1', action: 'UPDATE', entity: 'products', entityId: 'p-1',
      oldData: { name: 'Semen', buyPrice: 50000, sellPrice: 60000 },
    });
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p-1', name: 'Semen', buyPrice: 55000, sellPrice: 70000 });
    mockPrisma.product.update.mockResolvedValue({ id: 'p-1', name: 'Semen', buyPrice: 50000, sellPrice: 60000 });

    await auditLogService.rollback('log-1', 'user-1');

    expect(mockPrisma.priceHistory.create).toHaveBeenCalledWith({
      data: {
        productId: 'p-1', oldBuy: 55000, newBuy: 50000, oldSell: 70000, newSell: 60000, changedBy: 'user-1',
      },
    });
  });
});
