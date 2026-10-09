import { tool } from 'ai';
import { z } from 'zod';
import { prisma } from '../../../prisma.js';
import {
  getAuthorizedClient,
  isSlotFreeExcluding,
  moveBookingEvent,
  deleteBookingEvent,
} from '../../calendar/googleCalendar.js';
import { formatLocalDate, formatLocalTime, parseTenantDateTime } from '../../calendar/timeUtils.js';
import type { TenantContext } from '../../tenantContext.js';

const SLOT_MS = 60 * 60 * 1000;

function label(at: Date, tz: string): string {
  return `${formatLocalDate(at, tz)} ${formatLocalTime(at, tz)}`;
}

/** The client's own upcoming bookings in THIS conversation (never another client's). */
async function findUpcoming(tenantId: string, conversationId: string) {
  return prisma.appointment.findMany({
    where: { tenantId, conversationId, status: 'booked', startAt: { gt: new Date() } },
    orderBy: { startAt: 'asc' },
  });
}

type Found =
  | { kind: 'one'; appt: Awaited<ReturnType<typeof findUpcoming>>[number] }
  | { kind: 'none' }
  | { kind: 'multiple'; options: string[] };

async function pickAppointment(
  tenant: TenantContext,
  conversationId: string,
  currentStartAt: string | undefined,
): Promise<Found> {
  const upcoming = await findUpcoming(tenant.id, conversationId);
  if (upcoming.length === 0) return { kind: 'none' };
  if (currentStartAt) {
    const wanted = parseTenantDateTime(currentStartAt, tenant.timezone).getTime();
    const hit = upcoming.find((a) => a.startAt.getTime() === wanted);
    if (hit) return { kind: 'one', appt: hit };
    return { kind: 'multiple', options: upcoming.map((a) => label(a.startAt, tenant.timezone)) };
  }
  if (upcoming.length === 1) return { kind: 'one', appt: upcoming[0] };
  return { kind: 'multiple', options: upcoming.map((a) => label(a.startAt, tenant.timezone)) };
}

const currentStartSchema = z
  .string()
  .optional()
  .describe(
    'Only needed if the client has more than one upcoming appointment: the start of the one to change, ISO 8601 with offset, e.g. 2026-10-09T15:00:00+05:00',
  );

export function rescheduleAppointmentTool(tenant: TenantContext, conversationId: string) {
  return tool({
    description:
      "Move the client's existing upcoming appointment to a new time on the specialist's Google Calendar (same 60 minutes). " +
      'Use this when the client asks to change/move/reschedule their appointment — NEVER create a new booking for that. ' +
      'Call it only after the client has said the exact new date and time. It checks that the new time is free.',
    parameters: z.object({
      newStartAt: z
        .string()
        .describe('ISO 8601 datetime for the new start in the tenant timezone, e.g. 2026-10-09T18:00:00+05:00'),
      currentStartAt: currentStartSchema,
    }),
    execute: async ({ newStartAt, currentStartAt }) => {
      const tz = tenant.timezone;
      const newStart = parseTenantDateTime(newStartAt, tz);
      if (Number.isNaN(newStart.getTime())) return { ok: false, reason: 'invalid_time' as const };
      if (newStart.getTime() <= Date.now()) return { ok: false, reason: 'in_past' as const };

      const auth = await getAuthorizedClient(tenant.id);
      if (!auth) return { ok: false, reason: 'not_connected' as const };

      const found = await pickAppointment(tenant, conversationId, currentStartAt);
      if (found.kind === 'none') return { ok: false, reason: 'not_found' as const };
      if (found.kind === 'multiple') return { ok: false, reason: 'multiple' as const, options: found.options };

      const appt = found.appt;
      const newEnd = new Date(newStart.getTime() + SLOT_MS);
      try {
        const free = await isSlotFreeExcluding(auth.client, auth.calendarId, appt.googleEventId, newStart, newEnd);
        if (!free) return { ok: false, reason: 'slot_taken' as const };
        await moveBookingEvent(auth.client, auth.calendarId, appt.googleEventId, { startAt: newStart, endAt: newEnd, timezone: tz });
        await prisma.appointment.update({ where: { id: appt.id }, data: { startAt: newStart, endAt: newEnd } });
      } catch (err) {
        console.error('[reschedule_appointment] Google Calendar call failed', { tenantId: tenant.id, err: (err as Error).message });
        return { ok: false, reason: 'calendar_error' as const };
      }
      return { ok: true as const, from: label(appt.startAt, tz), to: label(newStart, tz) };
    },
  });
}

export function cancelAppointmentTool(tenant: TenantContext, conversationId: string) {
  return tool({
    description:
      "Cancel the client's existing upcoming appointment (removes it from the specialist's Google Calendar). " +
      'Call it only when the client clearly says they want to cancel and not move it.',
    parameters: z.object({ currentStartAt: currentStartSchema }),
    execute: async ({ currentStartAt }) => {
      const tz = tenant.timezone;
      const auth = await getAuthorizedClient(tenant.id);
      if (!auth) return { ok: false, reason: 'not_connected' as const };

      const found = await pickAppointment(tenant, conversationId, currentStartAt);
      if (found.kind === 'none') return { ok: false, reason: 'not_found' as const };
      if (found.kind === 'multiple') return { ok: false, reason: 'multiple' as const, options: found.options };

      const appt = found.appt;
      try {
        await deleteBookingEvent(auth.client, auth.calendarId, appt.googleEventId);
        await prisma.appointment.update({ where: { id: appt.id }, data: { status: 'cancelled' } });
      } catch (err) {
        console.error('[cancel_appointment] Google Calendar call failed', { tenantId: tenant.id, err: (err as Error).message });
        return { ok: false, reason: 'calendar_error' as const };
      }
      return { ok: true as const, was: label(appt.startAt, tz) };
    },
  });
}
