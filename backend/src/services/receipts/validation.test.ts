import { describe, expect, it } from 'vitest';
import { validateEnable } from './validation.js';

const complete = {
  sellerIin: '880511301234',
  telegramBotToken: '123456789:AAE-abcdefghijklmnopqrstuvwxyz012345',
  telegramChatId: '-1001234567890',
};

describe('validateEnable', () => {
  it('accepts complete settings', () => {
    expect(validateEnable(complete)).toBeNull();
  });
  it('requires the seller IIN', () => {
    expect(validateEnable({ ...complete, sellerIin: '' })).toMatch(/ИИН/);
    expect(validateEnable({ ...complete, sellerIin: null })).toMatch(/ИИН/);
  });
  it('requires the IIN to be exactly 12 digits', () => {
    expect(validateEnable({ ...complete, sellerIin: '12345' })).toMatch(/ИИН/);
    expect(validateEnable({ ...complete, sellerIin: '88051130123x' })).toMatch(/ИИН/);
  });
  it('requires a bot token in Telegram format', () => {
    expect(validateEnable({ ...complete, telegramBotToken: null })).toMatch(/токен/i);
    expect(validateEnable({ ...complete, telegramBotToken: 'not-a-token' })).toMatch(/токен/i);
  });
  it('requires the chat id', () => {
    expect(validateEnable({ ...complete, telegramChatId: '  ' })).toMatch(/арна/i);
  });
});
