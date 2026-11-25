import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findBooking.mockResolvedValue(booking);
  mocks.findTenant.mockResolvedValue({ status: 'active' });
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
    mocks.findTenant.mockResolvedValue({ status: 'suspended' });
    await sendReminder('b1', 't1', '1h');
    mocks.findTenant.mockResolvedValue({ status: 'active' });
    mocks.getSession.mockReturnValue({ status: 'connecting' });
    await sendReminder('b1', 't1', '1h');
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('stores nothing when the anti-ban limits block the send', async () => {
    mocks.sendHumanLikeText.mockResolvedValue({ sent: false, reason: 'hourly_hard_limit' });
    await sendReminder('b1', 't1', '1h');
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
