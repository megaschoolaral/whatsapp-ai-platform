import sharp from 'sharp';
import { prisma } from '../../prisma.js';
import { compressImage } from '../whatsapp/media.js';
import { MAX_PHOTOS_PER_CATEGORY, PHOTO_CATEGORIES, type PhotoCategoryId } from './categories.js';

export class PhotoLimitError extends Error {}
export class InvalidImageError extends Error {}

export async function addPhoto(
  tenantId: string,
  category: PhotoCategoryId,
  buf: Buffer,
  mimeType: string,
): Promise<{ id: string }> {
  if (!mimeType.startsWith('image/')) throw new InvalidImageError('Not an image');
  try {
    await sharp(buf).metadata();
  } catch {
    throw new InvalidImageError('Cannot decode image');
  }
  const compressed = await compressImage(buf, mimeType);

  return prisma.$transaction(async (tx) => {
    const count = await tx.propertyPhoto.count({ where: { tenantId, category } });
    if (count >= MAX_PHOTOS_PER_CATEGORY) throw new PhotoLimitError(`Max ${MAX_PHOTOS_PER_CATEGORY} photos per category`);
    const created = await tx.propertyPhoto.create({
      data: {
        tenantId,
        category,
        mimeType: compressed.mimeType,
        data: compressed.buffer,
        sizeBytes: compressed.buffer.byteLength,
      },
      select: { id: true },
    });
    await tx.photoSend.deleteMany({ where: { tenantId, category } });
    return { id: created.id };
  });
}

export async function deletePhoto(tenantId: string, id: string): Promise<boolean> {
  const photo = await prisma.propertyPhoto.findFirst({ where: { id, tenantId }, select: { id: true, category: true } });
  if (!photo) return false;
  await prisma.propertyPhoto.deleteMany({ where: { id, tenantId } });
  await prisma.photoSend.deleteMany({ where: { tenantId, category: photo.category } });
  return true;
}

export async function listPhotoSummary(tenantId: string) {
  const rows = await prisma.propertyPhoto.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, category: true, sizeBytes: true },
  });
  return PHOTO_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    photos: rows.filter((r) => r.category === c.id).map((r) => ({ id: r.id, sizeBytes: r.sizeBytes })),
  }));
}

export async function getPhotoData(tenantId: string, id: string): Promise<{ data: Buffer; mimeType: string } | null> {
  const p = await prisma.propertyPhoto.findFirst({ where: { id, tenantId }, select: { data: true, mimeType: true } });
  return p ? { data: Buffer.from(p.data), mimeType: p.mimeType } : null;
}

export async function getCategoryPhotos(
  tenantId: string,
  category: PhotoCategoryId,
): Promise<{ id: string; data: Buffer; mimeType: string }[]> {
  const rows = await prisma.propertyPhoto.findMany({
    where: { tenantId, category },
    orderBy: { createdAt: 'asc' },
    select: { id: true, data: true, mimeType: true },
  });
  return rows.map((r) => ({ id: r.id, data: Buffer.from(r.data), mimeType: r.mimeType }));
}

export async function tenantHasPhotos(tenantId: string): Promise<boolean> {
  return (await prisma.propertyPhoto.count({ where: { tenantId } })) > 0;
}

export async function wasCategorySent(conversationId: string, category: PhotoCategoryId): Promise<boolean> {
  const row = await prisma.photoSend.findUnique({
    where: { conversationId_category: { conversationId, category } },
    select: { id: true },
  });
  return !!row;
}

export async function recordCategorySent(tenantId: string, conversationId: string, category: PhotoCategoryId): Promise<void> {
  await prisma.photoSend.upsert({
    where: { conversationId_category: { conversationId, category } },
    create: { tenantId, conversationId, category },
    update: { sentAt: new Date() },
  });
}
