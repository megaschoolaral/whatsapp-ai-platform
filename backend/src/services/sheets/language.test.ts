import { describe, expect, it } from 'vitest';
import { detectLang } from './language.js';

describe('detectLang', () => {
  it('detects Kazakh by its own letters', () => {
    expect(detectLang(['Сәлеметсізбе'])).toBe('kk');
    expect(detectLang(['Ертеңге консультацияға орын бар ма?'])).toBe('kk');
  });

  it('answers in Russian for Russian text and when there is no text', () => {
    expect(detectLang(['Здравствуйте, хочу записаться'])).toBe('ru');
    expect(detectLang([])).toBe('ru');
  });

  it('treats a chat as Kazakh if any of the given messages is Kazakh', () => {
    expect(detectLang(['Қалайсыз', '09:00', '87028291238'])).toBe('kk');
  });
});
