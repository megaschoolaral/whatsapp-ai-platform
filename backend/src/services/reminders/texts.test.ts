import { describe, expect, it } from 'vitest';
import { defaultReminderText, reminderText } from './texts.js';

const b = { date: '2026-11-26', time: '09:00' };

describe('reminderText defaults', () => {
  it('Russian 10 h and 1 h', () => {
    expect(reminderText('10h', 'ru', b)).toBe('Напоминаем: вы записаны на консультацию 26.11 в 09:00. Ждём вас!');
    expect(reminderText('1h', 'ru', b)).toBe('Напоминаем: через час, в 09:00, у вас консультация. Ждём вас!');
  });

  it('Kazakh 10 h and 1 h', () => {
    expect(reminderText('10h', 'kk', b)).toBe('Еске саламыз: сіз 26.11 күні сағат 09:00-ге консультацияға жазылғансыз. Күтеміз!');
    expect(reminderText('1h', 'kk', b)).toBe('Еске саламыз: бір сағаттан кейін, сағат 09:00-де, консультацияңыз бар. Күтеміз!');
  });

  it('exposes the defaults with the placeholders still in them', () => {
    expect(defaultReminderText('10h', 'ru')).toContain('{date}');
    expect(defaultReminderText('1h', 'kk')).toContain('{time}');
  });
});

describe('reminderText custom', () => {
  it('uses the custom text and fills {date} and {time}', () => {
    expect(reminderText('10h', 'ru', b, 'Ждём вас {date} в {time}!')).toBe('Ждём вас 26.11 в 09:00!');
  });

  it('fills every occurrence of a placeholder', () => {
    expect(reminderText('1h', 'ru', b, '{time}, {time}')).toBe('09:00, 09:00');
  });

  it('falls back to the default for an empty or blank custom text', () => {
    expect(reminderText('10h', 'ru', b, '   ')).toBe(reminderText('10h', 'ru', b));
    expect(reminderText('10h', 'ru', b, null)).toBe(reminderText('10h', 'ru', b));
  });

  it('sends a text without placeholders unchanged', () => {
    expect(reminderText('1h', 'kk', b, 'Күтеміз!')).toBe('Күтеміз!');
  });
});
