import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  findTenant: vi.fn(),
  getSheetsSettings: vi.fn(),
  readSlotPeople: vi.fn(),
  getSession: vi.fn(),
  sendHumanLikeText: vi.fn(),
  appendMessage: vi.fn(),
  emitToTenant: vi.fn(),
}));

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../prisma.js', () => ({
  prisma: { booking: { findFirst: mocks.findBooking }, tenant: { findUnique: mocks.findTenant } },
}));
vi.mock('../sheets/settings.js', () => ({ getSheetsSettings: mocks.getSheetsSettings }));
vi.mock('../sheets/read.js', () => ({ readSlotPeople: mocks.readSlotPeople }));
vi.mock('../whatsapp/manager.js', () => ({ getSession: mocks.getSession }));
vi.mock('../whatsapp/outbound.js', () => ({ sendHumanLikeText: mocks.sendHumanLikeText }));
vi.mock('../conversations/store.js', () => ({ appendMessage: mocks.appendMessage }));
vi.mock('../realtime/socketRooms.js', () => ({ emitToTenant: mocks.emitToTenant }));

import { sameClient, sendReminder } from './send.js';

const booking = {
  id: 'b1', tenantId: 't1', conversationId: 'c1', jid: '123@lid', date: '2026-11-26', time: '09:00',
  name: 'Асель', phone: '87028291238', lang: 'kk',
};
const noCustom = { '10h': { ru: null, kk: null }, '1h': { ru: null, kk: null } };

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findBooking.mockResolvedValue(booking);
  vi.useFakeTimers({ toFake: ['Date'] });
  // 03:00 UTC = 08:00 in Almaty: exactly one hour before the 09:00 appointment on 2026-11-26
  vi.setSystemTime(new Date('2026-11-26T03:00:00Z'));
  mocks.findTenant.mockResolvedValue({ status: 'active', timezone: 'Asia/Almaty' });
  mocks.getSheetsSettings.mockResolvedValue({ enabled: true, remindersEnabled: true, reminderTexts: noCustom });
  mocks.readSlotPeople.mockResolvedValue({ name: 'Асель', phone: '87028291238' });
  mocks.getSession.mockReturnValue({ status: 'connected', sock: {} });
  mocks.sendHumanLikeText.mockResolvedValue({ sent: true });
});

describe('sendReminder', () => {
  it('sends the default text in the booking language and stores it as an outgoing message', async () => {
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        jid: '123@lid',
        text: 'Еске саламыз: бір сағаттан кейін, сағат 09:00-де, консультацияңыз бар. Күтеміз!',
      }),
    );
    expect(mocks.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', conversationId: 'c1', direction: 'outgoing', sentBy: 'system_reminder' }),
    );
  });

  it("sends the tenant's custom text for that stage and language", async () => {
    mocks.getSheetsSettings.mockResolvedValue({
      enabled: true,
      remindersEnabled: true,
      reminderTexts: { ...noCustom, '10h': { ru: null, kk: 'Ертең {time}-де күтеміз' } },
    });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z')); // exactly 10 h before 09:00 Almaty
    await sendReminder('b1', 't1', '10h');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ертең 09:00-де күтеміз' }));
  });

  it('does not send when a person put someone else in that row', async () => {
    mocks.readSlotPeople.mockResolvedValue({ name: 'Нурай', phone: '87079562517' });
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('does not send when the row was emptied or removed', async () => {
    mocks.readSlotPeople.mockResolvedValue({ name: '', phone: '' });
    await sendReminder('b1', 't1', '1h');
    mocks.readSlotPeople.mockResolvedValue(null);
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('does not send when reminders or Sheets were switched off after the booking', async () => {
    mocks.getSheetsSettings.mockResolvedValue({ enabled: true, remindersEnabled: false, reminderTexts: noCustom });
    await sendReminder('b1', 't1', '1h');
    mocks.getSheetsSettings.mockResolvedValue({ enabled: false, remindersEnabled: true, reminderTexts: noCustom });
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('does not send for an inactive tenant or without a connected WhatsApp session', async () => {
    mocks.findTenant.mockResolvedValue({ status: 'suspended', timezone: 'Asia/Almaty' });
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('fails the job (so BullMQ retries it) when WhatsApp is reconnecting, instead of dropping the reminder', async () => {
    mocks.getSession.mockReturnValue({ status: 'connecting' });
    await expect(sendReminder('b1', 't1', '1h')).rejects.toThrow('no_whatsapp_session');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('does not retry when the sheet row changed: that skip is final', async () => {
    mocks.readSlotPeople.mockResolvedValue({ name: 'Нурай', phone: '87079562517' });
    await expect(sendReminder('b1', 't1', '1h')).resolves.toBeUndefined();
  });

  it('sends a reminder that is a few minutes late', async () => {
    vi.setSystemTime(new Date('2026-11-26T03:10:00Z'));
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledTimes(1);
  });

  it('drops a 1 h reminder that is too late to say "in an hour", and any reminder after the appointment started', async () => {
    vi.setSystemTime(new Date('2026-11-26T03:25:00Z'));
    await sendReminder('b1', 't1', '1h');
    vi.setSystemTime(new Date('2026-11-26T04:10:00Z'));
    await sendReminder('b1', 't1', '10h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('still sends the 10 h reminder on time', async () => {
    vi.setSystemTime(new Date('2026-11-25T18:05:00Z'));
    await sendReminder('b1', 't1', '10h');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledTimes(1);
  });

  it('stores nothing and fails the job for a retry when the anti-ban limits block the send', async () => {
    mocks.sendHumanLikeText.mockResolvedValue({ sent: false, reason: 'hourly_hard_limit' });
    await expect(sendReminder('b1', 't1', '1h')).rejects.toThrow('hourly_hard_limit');
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("looks the booking up by id and tenant, so another tenant's booking is never read", async () => {
    mocks.findBooking.mockResolvedValue(null);
    await sendReminder('b1', 'other-tenant', '1h');
    expect(mocks.findBooking).toHaveBeenCalledWith({ where: { id: 'b1', tenantId: 'other-tenant' } });
    expect(mocks.readSlotPeople).not.toHaveBeenCalled();
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });
});

describe('sameClient', () => {
  const b = { name: 'Асель', phone: '+7 702 829 1238' };

  it('matches the same phone written differently', () => {
    expect(sameClient(b, { name: 'другое', phone: '87028291238' })).toBe(true);
  });

  it('matches the same name ignoring case and spaces', () => {
    expect(sameClient(b, { name: '  асель ', phone: '' })).toBe(true);
  });

  it('does not match another person or an empty row', () => {
    expect(sameClient(b, { name: 'Нурай', phone: '87079562517' })).toBe(false);
    expect(sameClient(b, { name: '', phone: '' })).toBe(false);
  });
});
