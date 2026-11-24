import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slot } from './types.js';

const mocks = vi.hoisted(() => ({
  readSlots: vi.fn(),
  invalidateSlots: vi.fn(),
  batchUpdate: vi.fn(),
  locks: new Set<string>(),
}));

vi.mock('../../redis.js', () => ({
  redis: {
    set: async (k: string) => (mocks.locks.has(k) ? null : (mocks.locks.add(k), 'OK')),
    del: async (k: string) => void mocks.locks.delete(k),
  },
}));
vi.mock('../../prisma.js', () => ({ prisma: { tenant: { findUnique: async () => ({ timezone: 'Asia/Almaty' }) } } }));

vi.mock('./read.js', () => ({ readSlots: mocks.readSlots, invalidateSlots: mocks.invalidateSlots }));
vi.mock('./client.js', () => ({ getSheetsClient: () => ({ spreadsheets: { values: { batchUpdate: mocks.batchUpdate } } }) }));
vi.mock('./settings.js', () => ({
  getSheetsSettings: async () => ({ enabled: true, spreadsheetId: 'sheet-id', sheetName: 'Ноябрь', daysAhead: 7 }),
}));

import { bookSlot, buildSheetsTool, conflictReply, sheetsPromptSection } from './tool.js';

const D = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const T = '23:30';
const slot = (over: Partial<Slot> = {}): Slot => ({ date: D, time: T, row: 7, free: true, ...over });
const args = { tenantId: 't1', date: D, time: T, name: 'Асель', phone: '+7 707 430 4061' };
const execOpts = { toolCallId: 'c', messages: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locks.clear();
  mocks.readSlots.mockResolvedValue([slot()]);
  mocks.batchUpdate.mockResolvedValue({});
});

describe('bookSlot', () => {
  it('writes name, phone, AI and WhatsApp as plain text and touches no other column', async () => {
    expect(await bookSlot(args)).toEqual({ status: 'booked' });
    const body = mocks.batchUpdate.mock.calls[0]![0].requestBody;
    expect(mocks.readSlots).toHaveBeenCalledWith('t1', { fresh: true });
    expect(body.valueInputOption).toBe('RAW');
    expect(body.data).toEqual([
      { range: 'Ноябрь!B7:C7', values: [['Асель', '+7 707 430 4061']] },
      { range: 'Ноябрь!E7:F7', values: [['AI', 'WhatsApp']] },
    ]);
    expect(mocks.invalidateSlots).toHaveBeenCalledWith('t1');
  });

  it('writes the comment to column D only when there is one', async () => {
    await bookSlot({ ...args, comment: 'повторный узи' });
    const data = mocks.batchUpdate.mock.calls[0]![0].requestBody.data;
    expect(data).toContainEqual({ range: 'Ноябрь!D7', values: [['повторный узи']] });
  });

  it('writes nothing when the slot was already taken', async () => {
    mocks.readSlots.mockResolvedValue([slot({ free: false })]);
    expect(await bookSlot(args)).toEqual({ status: 'taken' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it('reports not_found for a time that is not in the sheet', async () => {
    expect(await bookSlot({ ...args, time: '09:05' })).toEqual({ status: 'not_found' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it('reports error when the Sheets API fails', async () => {
    mocks.batchUpdate.mockRejectedValue(new Error('quota'));
    expect(await bookSlot(args)).toEqual({ status: 'error' });
  });
});

describe('bookSlot guards', () => {
  it('serialises bookings of different conversations: only one of two clients gets the same slot', async () => {
    let taken = false;
    mocks.readSlots.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return [slot({ free: !taken })];
    });
    mocks.batchUpdate.mockImplementation(async () => void (taken = true));
    const results = await Promise.all([bookSlot(args), bookSlot({ ...args, name: 'Аружан' })]);
    expect(results.map((r) => r.status).sort()).toEqual(['booked', 'taken']);
    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
  });

  it('releases the lock after a failure so the next booking is not stuck', async () => {
    mocks.batchUpdate.mockRejectedValueOnce(new Error('x'));
    expect(await bookSlot(args)).toEqual({ status: 'error' });
    expect(await bookSlot(args)).toEqual({ status: 'booked' });
  });

  it.each([
    ['name', { name: '  ' }],
    ['phone', { phone: '' }],
  ])('writes nothing when the %s is empty', async (_f, over) => {
    expect(await bookSlot({ ...args, ...over })).toEqual({ status: 'missing_details' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it('does not book a slot that is in the past', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    mocks.readSlots.mockResolvedValue([slot({ date: yesterday })]);
    expect(await bookSlot({ ...args, date: yesterday })).toEqual({ status: 'not_found' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });
});

describe('buildSheetsTool', () => {
  it('lets only one of two parallel calls for the same slot book it', async () => {
    let taken = false;
    mocks.readSlots.mockImplementation(async () => [slot({ free: !taken })]);
    mocks.batchUpdate.mockImplementation(async () => void (taken = true));
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    const call = { date: D, time: T, name: 'Асель', phone: '1' };
    const results = await Promise.all([tool.execute!(call, execOpts), tool.execute!(call, execOpts)]);
    expect(results.map((r) => (r as { status: string }).status).sort()).toEqual(['booked', 'taken']);
    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ booked: true, conflict: true });
  });

  it('remembers what was booked', async () => {
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!({ date: D, time: T, name: 'А', phone: '1' }, execOpts);
    expect(state.lastBooking).toEqual({ date: D, time: T });
  });

  it('flags a failure', async () => {
    mocks.batchUpdate.mockRejectedValue(new Error('x'));
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!({ date: D, time: T, name: 'А', phone: '1' }, execOpts);
    expect(state.failed).toBe(true);
  });
});

describe('prompt text', () => {
  it('lists free slots by date and forbids claiming a booking without the tool result', () => {
    const text = sheetsPromptSection([slot(), slot({ time: '09:30', row: 8 })]);
    expect(text).toContain(D);
    expect(text).toContain(T);
    expect(text).toContain('09:30');
    expect(text).toContain('book_slot');
  });

  it('conflictReply lists at most 5 free slots, or sends the client to a manager when none are left', () => {
    const many = Array.from({ length: 8 }, (_, i) => slot({ time: `1${i}:00`, row: 10 + i }));
    expect(conflictReply(many).match(/1\d:00/g)).toHaveLength(5);
    const none = conflictReply([]);
    expect(none).not.toMatch(/\d\d:\d\d/);
    expect(none).toContain('менеджер');
  });
});
