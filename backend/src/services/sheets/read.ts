import { redis } from '../../redis.js';
import { getSheetsClient } from './client.js';
import { parseSchedule } from './schedule.js';
import { getSheetsSettings } from './settings.js';
import type { Slot } from './types.js';

const CACHE_TTL_SECONDS = 30;
const cacheKey = (tenantId: string) => `sheets:values:${tenantId}`;

/** Reads the tenant's schedule tab. Throws if Sheets is not configured or unreachable. */
export async function readSlots(tenantId: string, opts: { fresh?: boolean } = {}): Promise<Slot[]> {
  let values: string[][] | null = null;
  if (!opts.fresh) {
    const cached = await redis.get(cacheKey(tenantId));
    if (cached) values = JSON.parse(cached) as string[][];
  }
  if (!values) {
    const settings = await getSheetsSettings(tenantId);
    const client = getSheetsClient();
    if (!client || !settings.spreadsheetId || !settings.sheetName) throw new Error('Google Sheets is not configured');
    const res = await client.spreadsheets.values.get({
      spreadsheetId: settings.spreadsheetId,
      range: `${settings.sheetName}!A:H`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    values = (res.data.values ?? []) as string[][];
    await redis.set(cacheKey(tenantId), JSON.stringify(values), 'EX', CACHE_TTL_SECONDS);
  }
  return parseSchedule(values, new Date());
}

export async function invalidateSlots(tenantId: string): Promise<void> {
  await redis.del(cacheKey(tenantId));
}

/** The name and phone currently in the sheet row of a slot, read fresh; null when that date and time is not in the sheet. */
export async function readSlotPeople(
  tenantId: string,
  date: string,
  time: string,
): Promise<{ name: string; phone: string } | null> {
  const slot = (await readSlots(tenantId, { fresh: true })).find((s) => s.date === date && s.time === time);
  if (!slot) return null;
  const settings = await getSheetsSettings(tenantId);
  const client = getSheetsClient();
  if (!client || !settings.spreadsheetId || !settings.sheetName) throw new Error('Google Sheets is not configured');
  const res = await client.spreadsheets.values.get({
    spreadsheetId: settings.spreadsheetId,
    range: `${settings.sheetName}!B${slot.row}:C${slot.row}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const cells = (res.data.values?.[0] ?? []) as string[];
  return { name: (cells[0] ?? '').trim(), phone: (cells[1] ?? '').trim() };
}
