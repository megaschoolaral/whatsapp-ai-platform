import { prisma } from '../../prisma.js';

export interface SheetsSettings {
  enabled: boolean;
  spreadsheetId: string | null;
  sheetName: string | null;
  daysAhead: number;
}

/** Accepts a full Google Sheets link or a bare spreadsheet id. */
export function parseSpreadsheetId(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1] ?? null;
  return /^[A-Za-z0-9_-]{20,}$/.test(text) ? text : null;
}

export async function getSheetsSettings(tenantId: string): Promise<SheetsSettings> {
  const row = await prisma.tenantSheetsSettings.findUnique({ where: { tenantId } });
  return {
    enabled: row?.enabled ?? false,
    spreadsheetId: row?.spreadsheetId ?? null,
    sheetName: row?.sheetName ?? null,
    daysAhead: row?.daysAhead ?? 7,
  };
}
