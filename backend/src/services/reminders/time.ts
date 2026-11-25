export type ReminderStage = '10h' | '1h';

const HOUR = 3_600_000;
const STAGES: Array<{ stage: ReminderStage; beforeMs: number }> = [
  { stage: '10h', beforeMs: 10 * HOUR },
  { stage: '1h', beforeMs: 1 * HOUR },
];

/** Offset of `timeZone` from UTC at the given instant, in ms (positive east of Greenwich). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(instantMs))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant at which the wall clock of `timeZone` shows `date` (YYYY-MM-DD) and `time` (HH:mm). */
export function appointmentInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  // Two passes: the offset at the first guess can differ from the offset at the real instant around a DST change.
  const first = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  return new Date(wallAsUtc - zoneOffsetMs(first, timeZone));
}

/** The reminder stages whose send time is still in the future, with the delay until then. */
export function reminderDelays(startsAt: Date, now: Date): { stage: ReminderStage; delayMs: number }[] {
  return STAGES.map(({ stage, beforeMs }) => ({ stage, delayMs: startsAt.getTime() - beforeMs - now.getTime() })).filter(
    (x) => x.delayMs > 0,
  );
}
