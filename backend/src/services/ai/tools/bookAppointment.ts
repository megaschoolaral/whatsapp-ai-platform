import { tool } from 'ai';
import { z } from 'zod';
import { prisma } from '../../../prisma.js';
import { getAuthorizedClient, checkFreebusy, createBookingEvent } from '../../calendar/googleCalendar.js';
import type { TenantContext } from '../../tenantContext.js';

const inputSchema = z.object({
  clientName: z.string().min(2).describe("The client's name, exactly as the client told you in the conversation"),
  clientPhone: z
    .string()
    .min(5)
    .describe("The phone number the client told you in the conversation (not guessed, not the WhatsApp ID)"),
  service: z.string().min(2).describe('The service the client is booking, e.g. "Женская стрижка"'),
  requestedStartAt: z.string().describe('ISO 8601 datetime for the requested appointment start, in the tenant timezone'),
});

export function bookAppointmentTool(tenant: TenantContext, conversationId: string) {
  return tool({
    description:
      "Book a 60-minute appointment on the specialist's Google Calendar for the given client at the requested time. " +
      'Call this only after the client has explicitly confirmed a specific date and time AND has given you their name, ' +
      'their phone number and the service. If any of these is missing, ask the client for it first instead of calling this tool. ' +
      'If the tool reports the slot is busy, propose a different time to the client instead of calling it again immediately.',
    parameters: inputSchema,
    execute: async ({ clientName, clientPhone, service, requestedStartAt }) => {
      const auth = await getAuthorizedClient(tenant.id);
      if (!auth) {
        return { ok: false, reason: 'not_connected' as const };
      }
      const startAt = new Date(requestedStartAt);
      if (Number.isNaN(startAt.getTime())) {
        return { ok: false, reason: 'invalid_time' as const };
      }
      const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

      try {
        const isFree = await checkFreebusy(auth.client, auth.calendarId, startAt, endAt, tenant.timezone);
        if (!isFree) {
          return { ok: false, reason: 'slot_taken' as const };
        }

        const googleEventId = await createBookingEvent(auth.client, auth.calendarId, {
          clientName,
          clientPhone,
          service,
          startAt,
          endAt,
          timezone: tenant.timezone,
        });

        await prisma.appointment.create({
          data: { tenantId: tenant.id, conversationId, clientName, clientPhone, startAt, endAt, googleEventId },
        });
      } catch (err) {
        // Return the failure to the model instead of throwing, so the client always gets a reply.
        console.error('[book_appointment] Google Calendar call failed', { tenantId: tenant.id, err: (err as Error).message });
        return { ok: false, reason: 'calendar_error' as const };
      }

      return { ok: true as const, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
    },
  });
}
