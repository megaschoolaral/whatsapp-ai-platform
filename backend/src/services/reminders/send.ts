import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { appendMessage } from '../conversations/store.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { readSlotPeople } from '../sheets/read.js';
import { getSheetsSettings } from '../sheets/settings.js';
import { getSession } from '../whatsapp/manager.js';
import { sendHumanLikeText } from '../whatsapp/outbound.js';
import { reminderText } from './texts.js';
import type { ReminderStage } from './time.js';

const lastDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/** True when the sheet row still holds the client who booked: same phone (last 10 digits) or same name. */
export function sameClient(booking: { name: string; phone: string }, cell: { name: string; phone: string }): boolean {
  const samePhone = lastDigits(booking.phone).length > 0 && lastDigits(booking.phone) === lastDigits(cell.phone);
  const sameName = booking.name.trim() !== '' && booking.name.trim().toLowerCase() === cell.name.trim().toLowerCase();
  return samePhone || sameName;
}

/** Sends one reminder, but only if everything still holds; every skip is logged with its reason. */
export async function sendReminder(bookingId: string, tenantId: string, stage: ReminderStage): Promise<void> {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, tenantId } });
  if (!booking) return;
  const skip = (reason: string) => logger.info({ tenantId, bookingId, stage, reason }, '[reminder] skipped');

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== 'active') return skip('tenant_not_active');

  const settings = await getSheetsSettings(tenantId);
  if (!settings.enabled || !settings.remindersEnabled) return skip('reminders_off');

  const cell = await readSlotPeople(tenantId, booking.date, booking.time);
  if (!cell || !sameClient(booking, cell)) return skip('sheet_row_changed');

  const session = getSession(tenantId);
  if (!session || session.status !== 'connected') return skip('no_whatsapp_session');

  const lang = booking.lang === 'kk' ? 'kk' : 'ru';
  const text = reminderText(stage, lang, booking, settings.reminderTexts[stage][lang]);
  const result = await sendHumanLikeText({ tenantId, sock: session.sock, jid: booking.jid, text });
  if (!result.sent) return skip(`send_blocked:${result.reason ?? 'unknown'}`);

  await appendMessage({
    tenantId,
    conversationId: booking.conversationId,
    direction: 'outgoing',
    sentBy: 'system_reminder',
    content: text,
  });
  emitToTenant(tenantId, 'message:new', {
    conversationId: booking.conversationId,
    direction: 'outgoing',
    sentBy: 'system_reminder',
    content: text,
  });
}
