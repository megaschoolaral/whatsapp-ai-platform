import { describe, expect, it } from 'vitest';
import { parseSpreadsheetId } from './settings.js';

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
