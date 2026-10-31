import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  create: vi.fn(),
  deleteManyPhoto: vi.fn(),
  deleteManySend: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('../../prisma.js', () => {
  const tx = {
    propertyPhoto: { count: mocks.count, create: mocks.create },
    photoSend: { deleteMany: mocks.deleteManySend },
  };
  return {
    prisma: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      propertyPhoto: { findFirst: mocks.findFirst, deleteMany: mocks.deleteManyPhoto },
      photoSend: { deleteMany: mocks.deleteManySend },
    },
  };
});

import { addPhoto, deletePhoto, InvalidImageError, PhotoLimitError } from './store.js';

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: 'p1' });
  mocks.deleteManyPhoto.mockResolvedValue({ count: 1 });
  mocks.deleteManySend.mockResolvedValue({ count: 0 });
});

describe('addPhoto', () => {
  it('rejects a non-image mime type', async () => {
    await expect(addPhoto('t1', 'room_4', Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(InvalidImageError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not a decodable image', async () => {
    await expect(addPhoto('t1', 'room_4', Buffer.from('not an image'), 'image/jpeg')).rejects.toBeInstanceOf(InvalidImageError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects the 11th photo and inserts nothing', async () => {
    mocks.count.mockResolvedValue(10);
    await expect(addPhoto('t1', 'room_4', await png(), 'image/png')).rejects.toBeInstanceOf(PhotoLimitError);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('stores a compressed jpeg and resets the sent records of that category', async () => {
    const res = await addPhoto('t1', 'room_4', await png(), 'image/png');
    expect(res).toEqual({ id: 'p1' });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', category: 'room_4', mimeType: 'image/jpeg' });
    expect(mocks.deleteManySend).toHaveBeenCalledWith({ where: { tenantId: 't1', category: 'room_4' } });
  });
});

describe('deletePhoto', () => {
  it('returns false and deletes nothing for another tenant\'s photo', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await deletePhoto('t1', 'foreign')).toBe(false);
    expect(mocks.deleteManyPhoto).not.toHaveBeenCalled();
  });

  it('deletes the photo and resets the sent records of its category', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'p1', category: 'kitchen' });
    expect(await deletePhoto('t1', 'p1')).toBe(true);
    expect(mocks.deleteManyPhoto).toHaveBeenCalledWith({ where: { id: 'p1', tenantId: 't1' } });
    expect(mocks.deleteManySend).toHaveBeenCalledWith({ where: { tenantId: 't1', category: 'kitchen' } });
  });
});
