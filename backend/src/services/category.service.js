const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');

const getAll = async () => {
  return prisma.category.findMany({
    where: { parentId: null, isActive: true },
    include: {
      children: {
        where: { isActive: true },
        include: {
          children: { where: { isActive: true } },
          _count: { select: { products: true } },
        },
      },
      _count: { select: { products: true } },
    },
    orderBy: { name: 'asc' },
  });
};

const getById = async (id) => {
  const category = await prisma.category.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
      children: {
        where: { isActive: true },
        include: { _count: { select: { products: true } } },
      },
      products: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          buyPrice: true,
          sellPrice: true,
          stock: true,
          image: true,
        },
        orderBy: { name: 'asc' },
      },
      _count: { select: { products: true, children: true } },
    },
  });

  if (!category) {
    throw new AppError('Kategori tidak ditemukan', 404);
  }

  return category;
};

const create = async ({ name, description, parentId, userId }) => {
  if (parentId) {
    const parent = await prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) {
      throw new AppError('Kategori induk tidak ditemukan', 404);
    }
    if (parent.isActive === false) {
      throw new AppError('Kategori induk sudah tidak aktif', 400);
    }
  }

  return prisma.category.create({
    data: {
      name,
      description,
      parentId: parentId || null,
      createdBy: userId,
    },
    include: {
      parent: { select: { id: true, name: true } },
    },
  });
};

const update = async (id, { name, description, parentId, userId }) => {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Kategori tidak ditemukan', 404);
  }

  if (parentId) {
    if (parentId === id) {
      throw new AppError('Kategori tidak boleh menjadi induk diri sendiri', 400);
    }
    const parent = await prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) {
      throw new AppError('Kategori induk tidak ditemukan', 404);
    }
    if (parent.isActive === false && parentId !== existing.parentId) {
      throw new AppError('Kategori induk sudah tidak aktif', 400);
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (parentId !== undefined) updateData.parentId = parentId || null;
  updateData.updatedBy = userId;

  const category = await prisma.category.update({
    where: { id },
    data: updateData,
    include: {
      parent: { select: { id: true, name: true } },
    },
  });

  return {
    category,
    oldData: { name: existing.name, description: existing.description, parentId: existing.parentId },
    newData: updateData,
  };
};

const remove = async (id, userId) => {
  const existing = await prisma.category.findUnique({
    where: { id },
    include: { _count: { select: { children: true, products: true } } },
  });

  if (!existing) {
    throw new AppError('Kategori tidak ditemukan', 404);
  }

  if (existing._count.children > 0) {
    throw new AppError('Kategori masih memiliki sub-kategori, hapus sub-kategori terlebih dahulu', 400);
  }

  await prisma.category.update({
    where: { id },
    data: { isActive: false, updatedBy: userId },
  });

  return { oldData: { name: existing.name, isActive: true } };
};

module.exports = { getAll, getById, create, update, remove };
