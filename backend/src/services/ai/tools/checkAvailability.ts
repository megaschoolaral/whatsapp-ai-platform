import { tool } from 'ai';
import { z } from 'zod';
import { getAuthorizedClient, getBusyIntervals } from '../../calendar/googleCalendar.js';
import { formatLocalTime, zonedToUtc } from '../../calendar/timeUtils.js';
import type { TenantContext } from '../../tenantContext.js';

const SLOT_MINUTES = 60;
const STEP_MINUTES = 30;

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The day to check, as YYYY-MM-DD in the tenant timezone'),
  workStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('Start of working hours as HH:mm (use the hours from your instructions if given, default 09:00)'),
  workEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional()
    .describe('End of working hours as HH:mm (use the hours from your instructions if given, default 20:00)'),
});

export function checkAvailabilityTool(tenant: TenantContext) {
  return tool({
    description:
      "Read the specialist's Google Calendar for one day and return which times are busy and which 60-minute start times are free. " +
      'ALWAYS call this before telling the client that a time is free or taken, and before proposing alternative times. Never guess availability.',
    parameters: inputSchema,
    execute: async ({ date, workStart = '09:00', workEnd = '20:00' }) => {
      const tz = tenant.timezone;
      const dayStart = zonedToUtc(date, workStart, tz);
      const dayEnd = zonedToUtc(date, workEnd, tz);
      if (Number.isNaN(dayStart.getTime()) || Number.isNaN(dayEnd.getTime()) || dayEnd <= dayStart) {
        return { ok: false, reason: 'invalid_input' as const };
      }

      const auth = await getAuthorizedClient(tenant.id);
      if (!auth) {
        return { ok: false, reason: 'not_connected' as const };
      }

      let busy: Array<{ start: Date; end: Date }>;
      try {
        busy = await getBusyIntervals(auth.client, auth.calendarId, dayStart, dayEnd, tz);
      } catch (err) {
        console.error('[check_availability] Google Calendar call failed', { tenantId: tenant.id, err: (err as Error).message });
        return { ok: false, reason: 'calendar_error' as const };
      }

      const now = Date.now();
      const freeStartTimes: string[] = [];
      for (let t = dayStart.getTime(); t + SLOT_MINUTES * 60_000 <= dayEnd.getTime(); t += STEP_MINUTES * 60_000) {
        const slotEnd = t + SLOT_MINUTES * 60_000;
        if (t <= now) continue;
        const clash = busy.some((b) => b.start.getTime() < slotEnd && b.end.getTime() > t);
        if (!clash) freeStartTimes.push(formatLocalTime(new Date(t), tz));
      }

      return {
        ok: true as const,
        date,
        timezone: tz,
        slotMinutes: SLOT_MINUTES,
        busy: busy.map((b) => ({ from: formatLocalTime(b.start, tz), to: formatLocalTime(b.end, tz) })),
        freeStartTimes,
      };
    },
  });
}
