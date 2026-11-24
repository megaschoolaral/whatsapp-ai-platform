import type { Slot } from './types.js';

const TITLE = /^(?:пн|вт|ср|чт|пт|сб|вс)\s+(\d{1,2})[.,](\d{1,2})$/i;
const TIME = /^(\d{1,2}):(\d{2})$/;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The sheet titles carry no year: take the one that puts the date closest to today (handles Dec -> Jan). */
function resolveDate(day: number, month: number, today: Date): string | null {
  let best: { ms: number; year: number } | null = null;
  for (const year of [today.getUTCFullYear() - 1, today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const ms = Date.UTC(year, month - 1, day);
    if (new Date(ms).getUTCMonth() !== month - 1) continue; // 31.02 etc.
    if (!best || Math.abs(ms - today.getTime()) < Math.abs(best.ms - today.getTime())) best = { ms, year };
  }
  return best ? `${best.year}-${pad(month)}-${pad(day)}` : null;
}

/** Turns the sheet rows (columns A..H, row 1 first) into slots. A title row sets the date of the rows below it. */
export function parseSchedule(values: string[][], today: Date): Slot[] {
  const slots: Slot[] = [];
  let date: string | null = null;
  values.forEach((cells, index) => {
    const first = (cells[0] ?? '').trim();
    const title = first.match(TITLE);
    if (title) {
      date = resolveDate(Number(title[1]), Number(title[2]), today);
      return;
    }
    const time = first.match(TIME);
    if (!time || !date) return;
    const free = !(cells[1] ?? '').trim() && !(cells[2] ?? '').trim();
    slots.push({ date, time: `${pad(Number(time[1]))}:${time[2]}`, row: index + 1, free });
  });
  return slots;
}

function localNow(now: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Free slots from today (in the tenant's time zone, not earlier than now) through the next `daysAhead` days. */
export function upcomingFreeSlots(slots: Slot[], now: Date, timeZone: string, daysAhead: number): Slot[] {
  const local = localNow(now, timeZone);
  const lastDate = new Date(Date.parse(`${local.date}T00:00:00Z`) + (daysAhead - 1) * DAY_MS).toISOString().slice(0, 10);
  return slots.filter(
    (s) =>
      s.free &&
      s.date >= local.date &&
      s.date <= lastDate &&
      (s.date > local.date || s.time >= local.time),
  );
}
