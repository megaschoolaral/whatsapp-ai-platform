import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
const findUnique = vi.hoisted(() => vi.fn());
vi.mock('../../prisma.js', () => ({ prisma: { tenantSheetsSettings: { findUnique } } }));
import { getSheetsSettings, parseSpreadsheetId } from './settings.js';

describe('parseSpreadsheetId', () => {
  it('takes the id out of a full sheet link', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_1234567890abcdefgh/edit#gid=0')).toBe(
      '1AbC-dEf_1234567890abcdefgh',
    );
  });

  it('accepts a bare id', () => {
    expect(parseSpreadsheetId('1AbC-dEf_1234567890abcdefgh')).toBe('1AbC-dEf_1234567890abcdefgh');
  });

  it('rejects text that is not a sheet link or id', () => {
    expect(parseSpreadsheetId('hello')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
  });
});

describe('getSheetsSettings reminders', () => {
  it('defaults to reminders off and no custom texts without a row', async () => {
    findUnique.mockResolvedValue(null);
    const s = await getSheetsSettings('t1');
    expect(s.remindersEnabled).toBe(false);
    expect(s.reminderTexts).toEqual({ '10h': { ru: null, kk: null }, '1h': { ru: null, kk: null } });
  });

  it('maps the stored columns; an empty text counts as no custom text', async () => {
    findUnique.mockResolvedValue({
      enabled: true, spreadsheetId: 's', sheetName: 'x', daysAhead: 7, remindersEnabled: true,
      reminder10hRu: 'Привет {time}', reminder10hKk: '', reminder1hRu: null, reminder1hKk: 'Сәлем',
    });
    const s = await getSheetsSettings('t1');
    expect(s.remindersEnabled).toBe(true);
    expect(s.reminderTexts).toEqual({ '10h': { ru: 'Привет {time}', kk: null }, '1h': { ru: null, kk: 'Сәлем' } });
  });
});
