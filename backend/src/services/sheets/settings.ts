import { prisma } from '../../prisma.js';

export interface SheetsSettings {
  enabled: boolean;
  spreadsheetId: string | null;
  sheetName: string | null;
  daysAhead: number;
  remindersEnabled: boolean;
  /** Custom reminder text per stage and language; null = use the built-in default. */
  reminderTexts: { '10h': { ru: string | null; kk: string | null }; '1h': { ru: string | null; kk: string | null } };
}

const textOrNull = (v: string | null | undefined): string | null => (v && v.trim() ? v : null);

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
    remindersEnabled: row?.remindersEnabled ?? false,
    reminderTexts: {
      '10h': { ru: textOrNull(row?.reminder10hRu), kk: textOrNull(row?.reminder10hKk) },
      '1h': { ru: textOrNull(row?.reminder1hRu), kk: textOrNull(row?.reminder1hKk) },
    },
  };
}
