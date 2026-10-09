import { google } from 'googleapis';
import { prisma } from '../../prisma.js';
import { decrypt } from '../../crypto/aesGcm.js';
import { buildOAuth2Client, type CalendarOAuth2Client } from './googleOAuth.js';
import { logger } from '../../logger.js';

export async function getAuthorizedClient(
  tenantId: string,
): Promise<{ client: CalendarOAuth2Client; calendarId: string } | null> {
  const record = await prisma.tenantGoogleCalendar.findUnique({ where: { tenantId } });
  if (!record || record.status !== 'connected') return null;

  const client = buildOAuth2Client();
  client.setCredentials({ refresh_token: decrypt(record.encryptedRefreshToken) });

  try {
    await client.getAccessToken(); // forces a refresh now, surfaces revoked/expired tokens immediately
  } catch (err) {
    logger.error({ err, tenantId }, '[calendar] refresh token invalid, marking connection as error');
    await prisma.tenantGoogleCalendar.update({
      where: { tenantId },
      data: { status: 'error', lastErrorAt: new Date(), lastErrorMessage: (err as Error).message },
    });
    return null;
  }

  return { client, calendarId: record.calendarId };
}

export async function checkFreebusy(
  client: CalendarOAuth2Client,
  calendarId: string,
  startAt: Date,
  endAt: Date,
  timezone: string,
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startAt.toISOString(),
      timeMax: endAt.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });
  const busy = res.data.calendars?.[calendarId]?.busy ?? [];
  return busy.length === 0;
}

export async function getBusyIntervals(
  client: CalendarOAuth2Client,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  timezone: string,
): Promise<Array<{ start: Date; end: Date }>> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });
  const busy = res.data.calendars?.[calendarId]?.busy ?? [];
  return busy
    .filter((b) => b.start && b.end)
    .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));
}

export async function createBookingEvent(
  client: CalendarOAuth2Client,
  calendarId: string,
  args: { clientName: string; clientPhone: string; service: string; startAt: Date; endAt: Date; timezone: string },
): Promise<string> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${args.clientName} — ${args.clientPhone} — ${args.service}`,
      description: `Клиент: ${args.clientName}\nТелефон: ${args.clientPhone}\nУслуга: ${args.service}\nЗабронировано через WhatsApp AI`,
      start: { dateTime: args.startAt.toISOString(), timeZone: args.timezone },
      end: { dateTime: args.endAt.toISOString(), timeZone: args.timezone },
    },
  });
  if (!res.data.id) throw new Error('Google Calendar did not return an event id');
  return res.data.id;
}

/**
 * True if no OTHER event overlaps [startAt, endAt). Used when moving an existing booking, so the
 * booking's own old slot doesn't count as busy.
 */
export async function isSlotFreeExcluding(
  client: CalendarOAuth2Client,
  calendarId: string,
  excludeEventId: string,
  startAt: Date,
  endAt: Date,
): Promise<boolean> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  const res = await calendar.events.list({
    calendarId,
    timeMin: startAt.toISOString(),
    timeMax: endAt.toISOString(),
    singleEvents: true,
    maxResults: 50,
  });
  const clash = (res.data.items ?? []).some(
    (e) => e.id !== excludeEventId && e.status !== 'cancelled' && e.transparency !== 'transparent',
  );
  return !clash;
}

export async function moveBookingEvent(
  client: CalendarOAuth2Client,
  calendarId: string,
  eventId: string,
  args: { startAt: Date; endAt: Date; timezone: string },
): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      start: { dateTime: args.startAt.toISOString(), timeZone: args.timezone },
      end: { dateTime: args.endAt.toISOString(), timeZone: args.timezone },
    },
  });
}

/** Deletes the Google event; an already-deleted event (404/410) counts as success. */
export async function deleteBookingEvent(client: CalendarOAuth2Client, calendarId: string, eventId: string): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth: client });
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404 || code === 410) return;
    throw err;
  }
}
