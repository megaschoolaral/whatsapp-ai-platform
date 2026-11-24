import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  resolveTextModel: vi.fn(),
  getSheetsSettings: vi.fn(),
  readSlots: vi.fn(),
  batchUpdate: vi.fn(),
}));

vi.mock('ai', async (orig) => ({ ...(await orig<typeof import('ai')>()), generateText: mocks.generateText }));
vi.mock('./providers.js', () => ({ resolveTextModel: mocks.resolveTextModel, resolveVisionModel: vi.fn() }));
vi.mock('./usageLog.js', () => ({ logTextUsage: vi.fn(), logVisionUsage: vi.fn() }));
vi.mock('./rag.js', () => ({ queryCorpus: vi.fn().mockResolvedValue('') }));
vi.mock('../photos/store.js', () => ({ listPhotoSummary: vi.fn().mockResolvedValue([]) }));
vi.mock('../sheets/settings.js', () => ({ getSheetsSettings: mocks.getSheetsSettings }));
vi.mock('../sheets/read.js', () => ({ readSlots: mocks.readSlots, invalidateSlots: vi.fn() }));
vi.mock('../sheets/client.js', () => ({ getSheetsClient: () => ({ spreadsheets: { values: { batchUpdate: mocks.batchUpdate } } }) }));

import { generateReply } from './generate.js';

const tenant = { id: 't1', aiPersona: 'p', timezone: 'Asia/Almaty' } as never;
const usage = { promptTokens: 1, completionTokens: 1 };
const args = { tenant, history: [], userMessage: 'хочу записаться', conversationId: 'c1' };
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const slot = (time: string, row: number, free = true) => ({ date: tomorrow, time, row, free });
const book = { date: tomorrow, time: '23:30', name: 'Асель', phone: '+7 707 430 4061' };

type Tools = { tools: { book_slot: { execute: (x: unknown, o: unknown) => Promise<unknown> } } };
const callBook = (a: Tools) => a.tools.book_slot.execute(book, { toolCallId: '1', messages: [] });

function model(provider = 'openai', supportsTools = true) {
  mocks.resolveTextModel.mockReturnValue({ meta: { provider, supportsVision: false, supportsTools }, sdkModel: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  model();
  mocks.getSheetsSettings.mockResolvedValue({ enabled: true, spreadsheetId: 's', sheetName: 'Ноябрь', daysAhead: 7 });
  mocks.readSlots.mockResolvedValue([slot('23:30', 5)]);
  mocks.batchUpdate.mockResolvedValue({});
  mocks.generateText.mockResolvedValue({ text: 'ok', usage });
});

describe('generateReply sheets', () => {
  it('adds nothing when the tenant has Sheets switched off', async () => {
    mocks.getSheetsSettings.mockResolvedValue({ enabled: false, spreadsheetId: null, sheetName: null, daysAhead: 7 });
    await generateReply(args);
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.tools).toBeUndefined();
    expect(call.messages[0].content).not.toContain('BOOKING');
    expect(mocks.readSlots).not.toHaveBeenCalled();
  });

  it('gives the model the free slots and the book_slot tool when switched on', async () => {
    await generateReply(args);
    const call = mocks.generateText.mock.calls[0]![0];
    expect(Object.keys(call.tools)).toEqual(['book_slot']);
    expect(call.messages[0].content).toContain(`${tomorrow}: 23:30`);
    expect(call.maxSteps).toBe(3);
  });

  it('does not continue after the tool call on Google models', async () => {
    model('google');
    await generateReply(args);
    expect(mocks.generateText.mock.calls[0]![0].maxSteps).toBe(1);
  });

  it('reports a booking', async () => {
    mocks.generateText.mockImplementation(async (a: Tools) => {
      await callBook(a);
      return { text: 'Записала вас', usage };
    });
    const res = await generateReply(args);
    expect(res).toMatchObject({ sheetsBooked: true, sheetsFailed: false, text: 'Записала вас' });
  });

  it('replaces the model text with our own list of free slots when the slot was taken before the write', async () => {
    mocks.readSlots.mockImplementation(async (_t: string, o?: { fresh?: boolean }) =>
      o?.fresh ? [slot('23:30', 5, false), slot('23:45', 6)] : [slot('23:30', 5)],
    );
    mocks.generateText.mockImplementation(async (a: Tools) => {
      await callBook(a);
      return { text: 'Записала вас на 23:30!', usage };
    });
    const res = await generateReply(args);
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
    expect(res.text).toContain('23:45');
    expect(res.text).not.toContain('Записала');
    expect(res.sheetsBooked).toBe(false);
  });

  it('does not confirm a booking when the write failed, and asks for a human', async () => {
    mocks.batchUpdate.mockRejectedValue(new Error('quota'));
    mocks.generateText.mockImplementation(async (a: Tools) => {
      await callBook(a);
      return { text: 'Записала вас на 23:30!', usage };
    });
    const res = await generateReply(args);
    expect(res.sheetsFailed).toBe(true);
    expect(res.text).not.toContain('Записала');
    expect(res.text).toContain('менеджер');
  });

  it('keeps the tool away and tells the model not to promise a time when the sheet cannot be read', async () => {
    mocks.readSlots.mockRejectedValue(new Error('403'));
    const res = await generateReply(args);
    const call = mocks.generateText.mock.calls[0]![0];
    expect(call.tools).toBeUndefined();
    expect(call.messages[0].content).toContain('cannot be read');
    expect(res.sheetsFailed).toBe(true);
  });
});
