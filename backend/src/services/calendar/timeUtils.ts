// Small timezone helpers (no extra deps). Tenants have an IANA timezone like "Asia/Almaty".

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** Wall-clock `YYYY-MM-DD` + `HH:mm` in `timeZone` -> the matching UTC instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let utc = wall;
  for (let i = 0; i < 2; i++) {
    utc = wall - tzOffsetMs(new Date(utc), timeZone);
  }
  return new Date(utc);
}

/** `HH:mm` of an instant, as seen in `timeZone`. */
export function formatLocalTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(at);
}

/** `YYYY-MM-DD` of an instant, as seen in `timeZone`. */
export function formatLocalDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/**
 * Parses an ISO datetime coming from the model. If it carries an explicit offset ("Z" / "+05:00")
 * it is used as-is; if it is a bare local datetime ("2026-10-09T13:00:00") it is interpreted in
 * the tenant's timezone instead of the server's (UTC).
 */
export function parseTenantDateTime(input: string, timeZone: string): Date {
  const trimmed = input.trim();
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  if (hasOffset) return new Date(trimmed);
  const m = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (!m) return new Date(NaN);
  return zonedToUtc(m[1], m[2], timeZone);
}
