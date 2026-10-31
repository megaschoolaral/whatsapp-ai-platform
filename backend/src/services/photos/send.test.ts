import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCategoryPhotos: vi.fn(),
  recordCategorySent: vi.fn(),
  sendHumanLikePhoto: vi.fn(),
  appendMessage: vi.fn(),
  emitToTenant: vi.fn(),
}));

vi.mock('./store.js', () => ({ getCategoryPhotos: mocks.getCategoryPhotos, recordCategorySent: mocks.recordCategorySent }));
vi.mock('../whatsapp/outbound.js', () => ({ sendHumanLikePhoto: mocks.sendHumanLikePhoto }));
vi.mock('../conversations/store.js', () => ({ appendMessage: mocks.appendMessage }));
vi.mock('../realtime/socketRooms.js', () => ({ emitToTenant: mocks.emitToTenant }));

import { sendQueuedPhotos } from './send.js';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, data: Buffer.from('x'), mimeType: 'image/jpeg' }));
const args = { tenantId: 't1', conversationId: 'c1', jid: 'j@lid', sock: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendHumanLikePhoto.mockResolvedValue({ sent: true });
  mocks.appendMessage.mockResolvedValue({});
});

describe('sendQueuedPhotos', () => {
  it('does nothing for an empty list', async () => {
    expect(await sendQueuedPhotos({ ...args, categories: [] })).toEqual({ ok: true });
    expect(mocks.sendHumanLikePhoto).not.toHaveBeenCalled();
  });

  it('sends every photo, stores each as an outgoing AI image and records the category once', async () => {
    mocks.getCategoryPhotos.mockResolvedValue(photos(3));
    expect(await sendQueuedPhotos({ ...args, categories: ['room_4'] })).toEqual({ ok: true });
    expect(mocks.sendHumanLikePhoto).toHaveBeenCalledTimes(3);
    expect(mocks.appendMessage).toHaveBeenCalledTimes(3);
    expect(mocks.appendMessage.mock.calls[0][0]).toMatchObject({
      tenantId: 't1', conversationId: 'c1', direction: 'outgoing', sentBy: 'ai', content: null, mediaType: 'image',
    });
    expect(mocks.recordCategorySent).toHaveBeenCalledOnce();
    expect(mocks.recordCategorySent).toHaveBeenCalledWith('t1', 'c1', 'room_4');
  });

  it('stops at the first failed send and does not record that category', async () => {
    mocks.getCategoryPhotos.mockResolvedValue(photos(5));
    mocks.sendHumanLikePhoto
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: true })
      .mockResolvedValueOnce({ sent: false, reason: 'hourly_hard_limit' });
    const res = await sendQueuedPhotos({ ...args, categories: ['room_4', 'kitchen'] });
    expect(res).toEqual({ ok: false, reason: 'hourly_hard_limit' });
    expect(mocks.sendHumanLikePhoto).toHaveBeenCalledTimes(3);
    expect(mocks.recordCategorySent).not.toHaveBeenCalled();
  });

  it('treats a thrown send error as a failure instead of crashing', async () => {
    mocks.getCategoryPhotos.mockResolvedValue(photos(2));
    mocks.sendHumanLikePhoto.mockRejectedValue(new Error('socket closed'));
    const res = await sendQueuedPhotos({ ...args, categories: ['room_4'] });
    expect(res.ok).toBe(false);
    expect(mocks.recordCategorySent).not.toHaveBeenCalled();
  });
});
