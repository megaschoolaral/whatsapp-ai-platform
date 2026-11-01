import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveTextModel: vi.fn(),
  listPhotoSummary: vi.fn(),
  wasCategorySent: vi.fn(),
  countCategoryPhotos: vi.fn(),
  getSendCapacity: vi.fn(),
}));

vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: mocks.generateText }));
vi.mock('./providers.js', () => ({ resolveTextModel: mocks.resolveTextModel, resolveVisionModel: vi.fn() }));
vi.mock('./usageLog.js', () => ({ logTextUsage: vi.fn(), logVisionUsage: vi.fn() }));
vi.mock('./rag.js', () => ({ queryCorpus: vi.fn().mockResolvedValue('') }));
vi.mock('../photos/store.js', () => ({
  listPhotoSummary: mocks.listPhotoSummary,
  wasCategorySent: mocks.wasCategorySent,
  countCategoryPhotos: mocks.countCategoryPhotos,
}));
vi.mock('../whatsapp/antiBan.js', () => ({ getSendCapacity: mocks.getSendCapacity }));

import { generateReply } from './generate.js';

const tenant = { id: 't1', aiPersona: 'p', timezone: 'Asia/Almaty' } as never;
const usage = { promptTokens: 1, completionTokens: 1 };
const summaryWithPhotos = [
  { id: 'room_4', label: '4-местный номер', photos: [{ id: 'a', sizeBytes: 1 }] },
  { id: 'kitchen', label: 'Кухня', photos: [] },
];

function model(supportsTools: boolean, provider = 'openai') {
  mocks.resolveTextModel.mockReturnValue({ meta: { provider, supportsVision: false, supportsTools }, sdkModel: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  model(true);
  mocks.listPhotoSummary.mockResolvedValue(summaryWithPhotos);
  mocks.wasCategorySent.mockResolvedValue(false);
  mocks.countCategoryPhotos.mockResolvedValue(1);
  mocks.getSendCapacity.mockResolvedValue({ remaining: 50 });
  mocks.generateText.mockResolvedValue({ text: 'ok', usage });
});

const args = { tenant, history: [], userMessage: 'есть фото?', conversationId: 'c1' };

describe('generateReply photos', () => {
  it('reports when a photo request was blocked by the send limits', async () => {
    mocks.getSendCapacity.mockResolvedValue({ remaining: 1 });
    mocks.generateText.mockImplementation(async (a: { tools: { send_photos: { execute: (x: unknown, o: unknown) => Promise<unknown> } } }) => {
      await a.tools.send_photos.execute({ category: 'room_4' }, { toolCallId: '1', messages: [] });
      return { text: 'Скоро отправим', usage };
    });
    const res = await generateReply(args);
    expect(res.photoBlocked).toBe(true);
    expect(res.photoCategories).toEqual([]);
  });

  it('de-duplicates and caps the queued categories', async () => {
    mocks.generateText.mockImplementation(async (a: { tools: { send_photos: { execute: (x: unknown, o: unknown) => Promise<unknown> } } }) => {
      await Promise.all(['room_4', 'room_4', 'kitchen', 'lounge'].map((category, i) =>
        a.tools.send_photos.execute({ category }, { toolCallId: String(i), messages: [] })));
      return { text: 'ok', usage };
    });
    const res = await generateReply(args);
    expect(res.photoCategories.length).toBeLessThanOrEqual(2);
    expect(new Set(res.photoCategories).size).toBe(res.photoCategories.length);
  });

  it('does not continue after the tool call on Google models (Gemini 3 needs thought signatures the SDK drops)', async () => {
    model(true, 'google');
    await generateReply(args);
    expect(mocks.generateText.mock.calls[0][0].maxSteps).toBe(1);
  });

  it('keeps multi-step tool calls on other providers', async () => {
    await generateReply(args);
    expect(mocks.generateText.mock.calls[0][0].maxSteps).toBe(3);
  });

  it('passes no tools when the tenant has no photos', async () => {
    mocks.listPhotoSummary.mockResolvedValue([{ id: 'room_4', label: 'x', photos: [] }]);
    const res = await generateReply(args);
    expect(mocks.generateText.mock.calls[0][0].tools).toBeUndefined();
    expect(res.photoCategories).toEqual([]);
  });

  it('passes no tools when the model does not support tools', async () => {
    model(false);
    await generateReply(args);
    expect(mocks.generateText.mock.calls[0][0].tools).toBeUndefined();
  });

  it('registers send_photos and lists only categories that have photos', async () => {
    await generateReply(args);
    const call = mocks.generateText.mock.calls[0][0];
    expect(call.tools.send_photos).toBeDefined();
    const system = call.messages[0].content as string;
    expect(system).toContain('room_4');
    expect(system).not.toContain('kitchen');
  });

  it('surfaces the categories queued by the tool', async () => {
    mocks.generateText.mockImplementation(async (a: { tools: { send_photos: { execute: (x: unknown, o: unknown) => Promise<unknown> } } }) => {
      await a.tools.send_photos.execute({ category: 'room_4' }, { toolCallId: '1', messages: [] });
      return { text: 'Отправляю', usage };
    });
    const res = await generateReply(args);
    expect(res.photoCategories).toEqual(['room_4']);
    expect(res.text).toBe('Отправляю');
  });

  it('falls back to a short text when the model returns none after queuing photos', async () => {
    mocks.generateText.mockImplementation(async (a: { tools: { send_photos: { execute: (x: unknown, o: unknown) => Promise<unknown> } } }) => {
      await a.tools.send_photos.execute({ category: 'room_4' }, { toolCallId: '1', messages: [] });
      return { text: '', usage };
    });
    expect((await generateReply(args)).text).toBe('Фото отправляю.');
  });
});
