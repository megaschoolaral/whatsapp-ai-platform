import { describe, expect, it } from 'vitest';
import { parseSchedule, upcomingFreeSlots } from './schedule.js';

const HEADER = ['Время', 'ФИ пациента', 'номер', 'коммент', 'записал', 'источник', 'услуга', 'пд'];

const sheet = [
  ['пн 02,11'],
  HEADER,
  ['12:30', 'Жансая Марат', '87075509253', 'пакет', 'Газиза', 'По рек', 'повторный', '✅'],
  ['13:00'],
  ['13:30', 'Кайраткызы К', '+7 707 430 4061'],
  ['вт 03,11'],
  ['9:00'],
  ['9:30', '', ''],
];

const today = new Date('2026-11-02T09:00:00Z');

describe('parseSchedule', () => {
  const slots = parseSchedule(sheet, today);

  it('skips the column header row', () => {
    expect(slots).toHaveLength(5);
  });

  it('marks a row with a name and phone as taken and an empty one as free, with its sheet row', () => {
    expect(slots.find((s) => s.time === '12:30')).toMatchObject({ date: '2026-11-02', free: false, row: 3 });
    expect(slots.find((s) => s.time === '13:00')).toMatchObject({ date: '2026-11-02', free: true, row: 4 });
  });

  it('puts rows under the nearest title above them and pads the time', () => {
    expect(slots.find((s) => s.date === '2026-11-03' && s.time === '09:00')).toMatchObject({ free: true, row: 7 });
  });

  it('parses titles typed differently', () => {
    for (const title of ['ПН  02.11', ' пн 02,11 ']) {
      const parsed = parseSchedule([[title], ['10:00']], today);
      expect(parsed).toEqual([{ date: '2026-11-02', time: '10:00', row: 2, free: true }]);
    }
  });

  it('puts January titles of a December sheet into next year', () => {
    const parsed = parseSchedule([['пн 05,01'], ['10:00']], new Date('2026-12-20T00:00:00Z'));
    expect(parsed[0]?.date).toBe('2027-01-05');
  });

  it('ignores rows before the first title', () => {
    expect(parseSchedule([['10:00'], ['пн 02,11'], ['11:00']], today)).toHaveLength(1);
  });
});

describe('parseSchedule tolerance', () => {
  it.each(['Пн, 02.11', 'пн 02, 11', 'понедельник 02.11', 'пн 02.11.2026', 'пн. 02.11', 'пн 02 ,11', 'пн 02/11'])(
    'reads the title %j',
    (title) => {
      expect(parseSchedule([[title], ['10:00']], today)).toEqual([{ date: '2026-11-02', time: '10:00', row: 2, free: true }]);
    },
  );

  it('does not put the slots under a title it cannot read onto the previous day', () => {
    const parsed = parseSchedule([['пн 25,11'], ['10:00'], ['вт 26-11'], ['11:00']], today);
    expect(parsed.map((s) => s.time)).toEqual(['10:00']);
  });

  it.each([
    ['09:00:00', '09:00'],
    ['9:00 AM', '09:00'],
    ['1:30 PM', '13:30'],
    ['12:00 AM', '00:00'],
    ['9.00', '09:00'],
  ])('reads the time %j as %s', (cell, expected) => {
    expect(parseSchedule([['пн 02,11'], [cell]], today)[0]?.time).toBe(expected);
  });
});

describe('upcomingFreeSlots', () => {
  const slots = parseSchedule(sheet, today);
  // 2026-11-02 13:15 in Asia/Almaty (UTC+5) is 08:15 UTC
  const now = new Date('2026-11-02T08:15:00Z');

  it('drops slots that already passed today and keeps later free ones', () => {
    const times = upcomingFreeSlots(slots, now, 'Asia/Almaty', 7).map((s) => `${s.date} ${s.time}`);
    expect(times).not.toContain('2026-11-02 13:00');
    expect(times).toEqual(['2026-11-03 09:00', '2026-11-03 09:30']);
  });

  it('drops dates beyond daysAhead', () => {
    expect(upcomingFreeSlots(slots, now, 'Asia/Almaty', 1)).toEqual([]);
  });
});
