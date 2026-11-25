import { prisma } from '../../prisma.js';
import { reminderJobName, reminderQueue } from '../../queues/index.js';
import type { Lang } from '../sheets/language.js';
import { getSheetsSettings } from '../sheets/settings.js';
import { appointmentInstant, reminderDelays } from './time.js';

/**
 * Saves the booking the AI just made and queues its reminders (10 h and 1 h before).
 * Does nothing when the tenant has reminders off, the chat is not this tenant's, or no stage is still in the future.
 */
export async function scheduleBookingReminders(args: {
  tenantId: string;
  conversationId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  lang: Lang;
}): Promise<void> {
  const { tenantId, conversationId, date, time, name, phone, lang } = args;
  const settings = await getSheetsSettings(tenantId);
  if (!settings.remindersEnabled) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  const delays = reminderDelays(appointmentInstant(date, time, tenant?.timezone ?? 'Asia/Almaty'), new Date());
  if (!delays.length) return;

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conversation) return;

  const booking = await prisma.booking.create({
    data: { tenantId, conversationId, jid: conversation.contactIdentifier, date, time, name, phone, lang },
  });
  for (const { stage, delayMs } of delays) {
    await reminderQueue.add(
      reminderJobName,
      { bookingId: booking.id, tenantId, stage },
      {
        delay: delayMs,
        jobId: `${booking.id}__${stage}`,
        // Retries for a reconnecting WhatsApp, an anti-ban pause or a Sheets blip: 30 s, 1, 2, 4, 8 min.
        attempts: 6,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }
}
