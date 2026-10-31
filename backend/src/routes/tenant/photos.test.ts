import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  addPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  getPhotoData: vi.fn(),
  listPhotoSummary: vi.fn(),
}));

vi.mock('../../services/photos/store.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/photos/store.js')>('../../services/photos/store.js');
  return { ...actual, ...mocks };
});
vi.mock('../../prisma.js', () => ({ prisma: {} }));
vi.mock('../../auth/middleware.js', () => ({ requireAuth: vi.fn(), tenantIsolation: vi.fn() }));

import { InvalidImageError, PhotoLimitError } from '../../services/photos/store.js';
import { deletePhotoHandler, photoImageHandler, uploadPhotoHandler } from './photos.js';

function res() {
  const r = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return r as unknown as Response & typeof r;
}
function req(over: Partial<Request> & { file?: unknown }): Request {
  return { tenantScope: 't1', params: {}, ...over } as unknown as Request;
}
const file = { buffer: Buffer.from('x'), mimetype: 'image/png' };

beforeEach(() => vi.clearAllMocks());

describe('uploadPhotoHandler', () => {
  it('answers 400 for an unknown category', async () => {
    const r = res();
    await uploadPhotoHandler(req({ params: { category: 'room_3' }, file }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mocks.addPhoto).not.toHaveBeenCalled();
  });

  it('answers 400 when the file is missing', async () => {
    const r = res();
    await uploadPhotoHandler(req({ params: { category: 'room_4' } }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('answers 400 for an invalid image', async () => {
    mocks.addPhoto.mockRejectedValue(new InvalidImageError('bad'));
    const r = res();
    await uploadPhotoHandler(req({ params: { category: 'room_4' }, file }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('answers 409 when the category is full', async () => {
    mocks.addPhoto.mockRejectedValue(new PhotoLimitError('full'));
    const r = res();
    await uploadPhotoHandler(req({ params: { category: 'room_4' }, file }), r);
    expect(r.status).toHaveBeenCalledWith(409);
  });

  it('answers 201 with the new id and scopes the upload to the tenant', async () => {
    mocks.addPhoto.mockResolvedValue({ id: 'p1' });
    const r = res();
    await uploadPhotoHandler(req({ params: { category: 'room_4' }, file }), r);
    expect(mocks.addPhoto).toHaveBeenCalledWith('t1', 'room_4', file.buffer, 'image/png');
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json).toHaveBeenCalledWith({ id: 'p1' });
  });
});

describe('deletePhotoHandler', () => {
  it('answers 404 when the store does not find the photo for this tenant', async () => {
    mocks.deletePhoto.mockResolvedValue(false);
    const r = res();
    await deletePhotoHandler(req({ params: { id: 'foreign' } }), r);
    expect(mocks.deletePhoto).toHaveBeenCalledWith('t1', 'foreign');
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it('answers 204 on success', async () => {
    mocks.deletePhoto.mockResolvedValue(true);
    const r = res();
    await deletePhotoHandler(req({ params: { id: 'p1' } }), r);
    expect(r.status).toHaveBeenCalledWith(204);
  });
});

describe('photoImageHandler', () => {
  it('answers 404 for a photo of another tenant', async () => {
    mocks.getPhotoData.mockResolvedValue(null);
    const r = res();
    await photoImageHandler(req({ params: { id: 'foreign' } }), r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it('serves the bytes with the stored content type', async () => {
    mocks.getPhotoData.mockResolvedValue({ data: Buffer.from('img'), mimeType: 'image/jpeg' });
    const r = res();
    await photoImageHandler(req({ params: { id: 'p1' } }), r);
    expect(r.setHeader).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(r.send).toHaveBeenCalledWith(Buffer.from('img'));
  });
});
