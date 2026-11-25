import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findConversation: vi.fn(),
  createBooking: vi.fn(),
  getSheetsSettings: vi.fn(),
  add: vi.fn(),
  tz: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: {
    conversation: { findFirst: mocks.findConversation },
    booking: { create: mocks.createBooking },
    tenant: { findUnique: mocks.tz },
  },
}));
vi.mock('../sheets/settings.js', () => ({ getSheetsSettings: mocks.getSheetsSettings }));
vi.mock('../../queues/index.js', () => ({ reminderQueue: { add: mocks.add }, reminderJobName: 'reminder' }));

import { scheduleBookingReminders } from './schedule.js';

const HOUR = 3_600_000;
// 2026-11-25 00:00 UTC = 05:00 in Asia/Almaty
const NOW = new Date('2026-11-25T00:00:00Z');
const args = { tenantId: 't1', conversationId: 'c1', date: '2026-11-25', time: '00:00', name: 'Асель', phone: '87071112233', lang: 'kk' as const };
// appointment `h` hours after NOW, expressed as an Almaty wall-clock date and time
function at(h: number) {
  const local = new Date(NOW.getTime() + h * HOUR + 5 * HOUR);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getSheetsSettings.mockResolvedValue({ remindersEnabled: true });
  mocks.findConversation.mockResolvedValue({ id: 'c1', contactIdentifier: '123@lid' });
  mocks.tz.mockResolvedValue({ timezone: 'Asia/Almaty' });
  mocks.createBooking.mockResolvedValue({ id: 'b1' });
});
afterEach(() => vi.useRealTimers());

describe('scheduleBookingReminders', () => {
  it('saves the booking and adds a 10 h and a 1 h job when the appointment is 20 h away', async () => {
    await scheduleBookingReminders({ ...args, ...at(20) });
    expect(mocks.createBooking).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', conversationId: 'c1', jid: '123@lid', lang: 'kk', name: 'Асель' }),
    });
    expect(mocks.add).toHaveBeenCalledTimes(2);
    expect(mocks.add).toHaveBeenCalledWith(
      'reminder',
      { bookingId: 'b1', tenantId: 't1', stage: '10h' },
      expect.objectContaining({ jobId: 'b1__10h', delay: 10 * HOUR }),
    );
    expect(mocks.add).toHaveBeenCalledWith(
      'reminder',
      { bookingId: 'b1', tenantId: 't1', stage: '1h' },
      expect.objectContaining({ jobId: 'b1__1h', delay: 19 * HOUR }),
    );
  });

  it('adds only the 1 h job for an appointment 6 h away', async () => {
    await scheduleBookingReminders({ ...args, ...at(6) });
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0]![1].stage).toBe('1h');
  });

  it('creates nothing for an appointment under an hour away', async () => {
    await scheduleBookingReminders({ ...args, ...at(0.5) });
    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('creates nothing when reminders are switched off', async () => {
    mocks.getSheetsSettings.mockResolvedValue({ remindersEnabled: false });
    await scheduleBookingReminders({ ...args, ...at(20) });
    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("looks the conversation up by id and tenant, and ignores another tenant's conversation", async () => {
    mocks.findConversation.mockResolvedValue(null);
    await scheduleBookingReminders({ ...args, ...at(20) });
    expect(mocks.findConversation).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' } });
    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
});
