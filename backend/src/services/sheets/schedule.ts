import type { Slot } from './types.js';

const WEEKDAY = '(?:понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)';
const DATE = '(\\d{1,2})\\s*[.,/]\\s*(\\d{1,2})(?:[.,/]\\d{2,4})?';
// "пн 02,11" (weekday first) and "23.11 пн" (date first): the clinic sheets use both.
const TITLE_WEEKDAY_FIRST = new RegExp(`^${WEEKDAY}[\\s.,]*${DATE}$`, 'i');
const TITLE_DATE_FIRST = new RegExp(`^${DATE}[\\s.,]*${WEEKDAY}$`, 'i');
const LOOKS_LIKE_TITLE = new RegExp(`^${WEEKDAY}(?![а-яё])`, 'i');
// 9:00, 09:00:00, 9.00, 9:00 AM, 1:30 PM
const TIME = /^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([ap]m)?$/i;
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
    const title = first.match(TITLE_WEEKDAY_FIRST) ?? first.match(TITLE_DATE_FIRST);
    if (title) {
      date = resolveDate(Number(title[1]), Number(title[2]), today);
      return;
    }
    if (LOOKS_LIKE_TITLE.test(first)) {
      // A day title we cannot read: its slots must not end up under the previous day.
      date = null;
      return;
    }
    const time = first.match(TIME);
    if (!time || !date) return;
    let hour = Number(time[1]);
    const minute = Number(time[2]);
    const meridiem = time[3]?.toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return;
    const free = !(cells[1] ?? '').trim() && !(cells[2] ?? '').trim();
    slots.push({ date, time: `${pad(hour)}:${pad(minute)}`, row: index + 1, free });
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
