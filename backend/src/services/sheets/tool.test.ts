import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slot } from './types.js';

const mocks = vi.hoisted(() => ({
  readSlots: vi.fn(),
  invalidateSlots: vi.fn(),
  batchUpdate: vi.fn(),
  getValues: vi.fn(),
  batchClear: vi.fn(),
  locks: new Set<string>(),
  schedule: vi.fn(),
}));

vi.mock('../reminders/schedule.js', () => ({ scheduleBookingReminders: mocks.schedule }));

vi.mock('../../redis.js', () => ({
  redis: {
    set: async (k: string) => (mocks.locks.has(k) ? null : (mocks.locks.add(k), 'OK')),
    del: async (k: string) => void mocks.locks.delete(k),
  },
}));
vi.mock('../../prisma.js', () => ({ prisma: { tenant: { findUnique: async () => ({ timezone: 'Asia/Almaty' }) } } }));

vi.mock('./read.js', () => ({ readSlots: mocks.readSlots, invalidateSlots: mocks.invalidateSlots }));
vi.mock('./client.js', () => ({ getSheetsClient: () => ({ spreadsheets: { values: { batchUpdate: mocks.batchUpdate, get: mocks.getValues, batchClear: mocks.batchClear } } }) }));
vi.mock('./settings.js', () => ({
  getSheetsSettings: async () => ({ enabled: true, spreadsheetId: 'sheet-id', sheetName: 'Ноябрь', daysAhead: 7 }),
}));

import { bookSlot, bookedReply, buildSheetsTool, conflictReply, failedReply, needDetailsReply, sheetsPromptSection } from './tool.js';

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
  mocks.getValues.mockResolvedValue({ data: { values: [] } });
  mocks.batchClear.mockResolvedValue({});
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

describe('one booking per client', () => {
  // sheet rows are 1-based: values[row - 1]
  const sheet = (rows: Record<number, string[]>) => {
    const values: string[][] = [];
    for (const [r, v] of Object.entries(rows)) values[Number(r) - 1] = v;
    return { data: { values: Array.from(values, (v) => v ?? []) } };
  };
  const taken = (row: number, time = '10:00') => slot({ row, time, free: false });

  it('releases the same client\'s earlier AI booking after writing the new one', async () => {
    mocks.readSlots.mockResolvedValue([slot({ row: 9 }), taken(5, '13:00'), taken(6, '13:30')]);
    mocks.getValues.mockResolvedValue(
      sheet({
        5: ['13:00', 'Асель К', '87074304061', '', 'AI', 'WhatsApp'],
        6: ['13:30', 'Асель К', '+7 707 430 4061', '', 'AI', 'WhatsApp'],
      }),
    );
    expect(await bookSlot(args)).toEqual({ status: 'booked' });
    expect(mocks.batchClear).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id',
      requestBody: { ranges: ['Ноябрь!B5:F5', 'Ноябрь!B6:F6'] },
    });
    // the new row is written before anything is cleared
    expect(mocks.batchUpdate.mock.invocationCallOrder[0]).toBeLessThan(mocks.batchClear.mock.invocationCallOrder[0]!);
  });

  it('never clears a person\'s row, another client\'s row or a past booking', async () => {
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    mocks.readSlots.mockResolvedValue([
      slot({ row: 9 }),
      taken(5), // same phone but typed by a person (column E is not AI)
      taken(6), // another client
      { ...taken(7), date: past }, // same client, but a visit that is already over
    ]);
    mocks.getValues.mockResolvedValue(
      sheet({
        5: ['10:00', 'Асель К', '87074304061', '', 'Админ', ''],
        6: ['10:00', 'Бану', '87011112233', '', 'AI', 'WhatsApp'],
        7: ['10:00', 'Асель К', '87074304061', '', 'AI', 'WhatsApp'],
      }),
    );
    expect(await bookSlot(args)).toEqual({ status: 'booked' });
    expect(mocks.batchClear).not.toHaveBeenCalled();
  });

  it('keeps the booking successful when releasing the old row fails', async () => {
    mocks.readSlots.mockResolvedValue([slot({ row: 9 }), taken(5)]);
    mocks.getValues.mockResolvedValue(sheet({ 5: ['10:00', 'Асель К', '87074304061', '', 'AI', 'WhatsApp'] }));
    mocks.batchClear.mockRejectedValue(new Error('quota'));
    expect(await bookSlot(args)).toEqual({ status: 'booked' });
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

  it.each([
    ['an emoji instead of a name', { name: '😊' }],
    ['a phone number instead of a name', { name: '87028291238' }],
    ['a single letter as the name', { name: 'А' }],
    ['a phone that is too short', { phone: '123' }],
    ['a phone that is not a number', { phone: 'позже скажу' }],
  ])('writes nothing for %s', async (_d, over) => {
    expect(await bookSlot({ ...args, ...over })).toEqual({ status: 'missing_details' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });

  it('flags missing details on the tool state so the reply can ask for them', async () => {
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!({ date: D, time: T, name: '😊', phone: '87071112233' }, execOpts);
    expect(state.missingDetails).toBe(true);
    expect(state.failed).toBe(false);
  });

  it('does not book a slot that is in the past', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    mocks.readSlots.mockResolvedValue([slot({ date: yesterday })]);
    expect(await bookSlot({ ...args, date: yesterday })).toEqual({ status: 'not_found' });
    expect(mocks.batchUpdate).not.toHaveBeenCalled();
  });
});

describe('buildSheetsTool reminders', () => {
  const call = { date: D, time: T, name: 'Асель', phone: '87071112233' };
  const ctx = { tenantId: 't1', conversationId: 'c1', lang: 'kk' as const };

  it('schedules the reminders once after a booking', async () => {
    const { tool } = buildSheetsTool(ctx);
    await tool.execute!(call, execOpts);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledWith({
      tenantId: 't1', conversationId: 'c1', date: D, time: T, name: 'Асель', phone: '87071112233', lang: 'kk',
    });
  });

  it.each([
    ['taken', [slot({ free: false })], call],
    ['not_found', [slot()], { ...call, time: '09:05' }],
    ['missing_details', [slot()], { ...call, name: '😊' }],
  ])('does not schedule anything for %s', async (_s, slots, input) => {
    mocks.readSlots.mockResolvedValue(slots);
    const { tool } = buildSheetsTool(ctx);
    await tool.execute!(input, execOpts);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('does not schedule without a conversation', async () => {
    const { tool } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!(call, execOpts);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('keeps the booking successful when scheduling fails', async () => {
    mocks.schedule.mockRejectedValue(new Error('redis down'));
    const { tool, state } = buildSheetsTool(ctx);
    expect(await tool.execute!(call, execOpts)).toEqual({ status: 'booked' });
    expect(state.booked).toBe(true);
    expect(state.failed).toBe(false);
  });
});

describe('buildSheetsTool', () => {
  it('lets only one of two parallel calls for the same slot book it', async () => {
    let taken = false;
    mocks.readSlots.mockImplementation(async () => [slot({ free: !taken })]);
    mocks.batchUpdate.mockImplementation(async () => void (taken = true));
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    const call = { date: D, time: T, name: 'Асель', phone: '87071112233' };
    const results = await Promise.all([tool.execute!(call, execOpts), tool.execute!(call, execOpts)]);
    expect(results.map((r) => (r as { status: string }).status).sort()).toEqual(['booked', 'taken']);
    expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({ booked: true, conflict: true });
  });

  it('remembers what was booked', async () => {
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!({ date: D, time: T, name: 'Асель', phone: '87071112233' }, execOpts);
    expect(state.lastBooking).toEqual({ date: D, time: T });
  });

  it('flags a failure', async () => {
    mocks.batchUpdate.mockRejectedValue(new Error('x'));
    const { tool, state } = buildSheetsTool({ tenantId: 't1' });
    await tool.execute!({ date: D, time: T, name: 'Асель', phone: '87071112233' }, execOpts);
    expect(state.failed).toBe(true);
  });
});

describe('prompt text: already booked', () => {
  it('tells the model not to book again for thanks or confirmations, and that a new time replaces the old one', () => {
    const p = sheetsPromptSection([slot()]);
    expect(p).toMatch(/already booked/i);
    expect(p).toMatch(/thanks/i);
    expect(p).toMatch(/replaces|released/i);
  });
});

describe('prompt text', () => {
  it('tells the model to ask for the full name and never to take it from the WhatsApp profile', () => {
    const text = sheetsPromptSection([slot()]);
    expect(text).toContain('full name');
    expect(text).toContain('WhatsApp profile name');
  });

  it('tells the model to ask morning or afternoon first and then offer only one or two free times', () => {
    const text = sheetsPromptSection([slot({ time: '09:00' }), slot({ time: '09:30', row: 8 })]);
    expect(text).toContain('morning or afternoon');
    expect(text).toContain('one or two');
    expect(text).not.toContain('every free time');
    expect(text).toContain('asks whether there is room');
    expect(text).toContain('Do not name any time in that first reply');
  });

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

describe('replies in the client language', () => {
  const b = { date: '2026-11-25', time: '09:00' };

  it('confirms in Russian or Kazakh with the date as dd.mm', () => {
    expect(bookedReply(b, 'ru')).toContain('Записала');
    expect(bookedReply(b, 'kk')).toContain('жаздым');
    for (const lang of ['ru', 'kk'] as const) {
      expect(bookedReply(b, lang)).toContain('25.11');
      expect(bookedReply(b, lang)).toContain('09:00');
    }
  });

  it('every fallback reply exists in Kazakh and sends the client to a manager or asks for the missing details', () => {
    expect(conflictReply([slot()], 'kk')).toContain('бос');
    expect(conflictReply([], 'kk')).toContain('менеджер');
    expect(failedReply('kk')).toContain('менеджер');
    expect(needDetailsReply('kk')).toContain('телефон');
    expect(needDetailsReply('ru')).toContain('телефон');
  });
});
