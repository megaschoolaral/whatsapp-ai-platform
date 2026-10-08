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
