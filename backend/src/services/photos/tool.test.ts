import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wasCategorySent: vi.fn(),
  countCategoryPhotos: vi.fn(),
  getSendCapacity: vi.fn(),
}));

vi.mock('./store.js', () => ({ wasCategorySent: mocks.wasCategorySent, countCategoryPhotos: mocks.countCategoryPhotos }));
vi.mock('../whatsapp/antiBan.js', () => ({ getSendCapacity: mocks.getSendCapacity }));

import { buildPhotoTool, decidePhotoRequest, photoPromptSection } from './tool.js';

const base = { tenantId: 't1', conversationId: 'c1', alreadyQueued: [] as never[] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.wasCategorySent.mockResolvedValue(false);
  mocks.countCategoryPhotos.mockResolvedValue(5);
  mocks.getSendCapacity.mockResolvedValue({ remaining: 50 });
});

describe('decidePhotoRequest', () => {
  it('rejects a category that is not in the list', async () => {
    expect(await decidePhotoRequest({ ...base, category: 'room_3' })).toEqual({ status: 'invalid_category' });
  });

  it('says already_sent when the category was sent in this conversation', async () => {
    mocks.wasCategorySent.mockResolvedValue(true);
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'already_sent' });
  });

  it('says no_photos when the tenant has none in the category', async () => {
    mocks.countCategoryPhotos.mockResolvedValue(0);
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'no_photos' });
  });

  it('says blocked when the remaining send capacity cannot fit the whole category', async () => {
    mocks.getSendCapacity.mockResolvedValue({ remaining: 3 });
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'blocked' });
  });

  it('counts photos already queued in this reply against the capacity', async () => {
    mocks.getSendCapacity.mockResolvedValue({ remaining: 8 });
    expect(await decidePhotoRequest({ ...base, category: 'room_4', alreadyQueued: ['kitchen'] })).toEqual({ status: 'blocked' });
  });

  it('refuses a third category in one reply', async () => {
    expect(await decidePhotoRequest({ ...base, category: 'lounge', alreadyQueued: ['kitchen', 'room_4'] })).toEqual({
      status: 'limit_reached',
    });
  });

  it('queues when everything fits', async () => {
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'queued' });
  });
});

describe('buildPhotoTool', () => {
  it('records the category only when it was queued and does not queue it twice', async () => {
    const { tool: t, queued } = buildPhotoTool({ tenantId: 't1', conversationId: 'c1' });
    const out = await t.execute!({ category: 'room_4' }, { toolCallId: 'x', messages: [] });
    expect(out).toEqual({ status: 'queued' });
    expect(queued).toEqual(['room_4']);
    const again = await t.execute!({ category: 'room_4' }, { toolCallId: 'y', messages: [] });
    expect(again).toEqual({ status: 'already_sent' });
    expect(queued).toEqual(['room_4']);
  });

  it('does not queue an invalid category', async () => {
    const { tool: t, queued } = buildPhotoTool({ tenantId: 't1', conversationId: 'c1' });
    expect(await t.execute!({ category: 'nope' }, { toolCallId: 'x', messages: [] })).toEqual({ status: 'invalid_category' });
    expect(queued).toEqual([]);
  });
});

describe('buildPhotoTool concurrency and capacity', () => {
  it('never queues more than 2 categories when the model calls the tool in parallel', async () => {
    const { tool: t, queued } = buildPhotoTool({ tenantId: 't1', conversationId: 'c1' });
    const call = (category: string) => t.execute!({ category }, { toolCallId: category, messages: [] });
    await Promise.all([call('kitchen'), call('bathroom'), call('lounge')]);
    expect(queued).toHaveLength(2);
  });

  it('queues a category once when it is requested twice in parallel', async () => {
    const { tool: t, queued } = buildPhotoTool({ tenantId: 't1', conversationId: 'c1' });
    const call = (id: string) => t.execute!({ category: 'room_4' }, { toolCallId: id, messages: [] });
    await Promise.all([call('a'), call('b')]);
    expect(queued).toEqual(['room_4']);
  });

  it('flags the tool state as blocked when capacity is too low', async () => {
    mocks.getSendCapacity.mockResolvedValue({ remaining: 2 });
    const built = buildPhotoTool({ tenantId: 't1', conversationId: 'c1' });
    await built.tool.execute!({ category: 'room_4' }, { toolCallId: 'x', messages: [] });
    expect(built.state.blocked).toBe(true);
    expect(built.queued).toEqual([]);
  });

  it('reserves one send slot for the text reply', async () => {
    mocks.countCategoryPhotos.mockResolvedValue(5);
    mocks.getSendCapacity.mockResolvedValue({ remaining: 5 });
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'blocked' });
    mocks.getSendCapacity.mockResolvedValue({ remaining: 6 });
    expect(await decidePhotoRequest({ ...base, category: 'room_4' })).toEqual({ status: 'queued' });
  });
});

describe('photoPromptSection', () => {
  it('lists the categories with counts and mentions the tool', () => {
    const text = photoPromptSection([{ id: 'room_4', label: '4-местный номер', count: 3 }]);
    expect(text).toContain('room_4');
    expect(text).toContain('send_photos');
  });
});
