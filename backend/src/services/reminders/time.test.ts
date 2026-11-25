import { describe, expect, it } from 'vitest';
import { appointmentInstant, reminderDelays } from './time.js';

const HOUR = 3_600_000;

describe('appointmentInstant', () => {
  it('turns a wall-clock time in the tenant zone into a UTC instant', () => {
    expect(appointmentInstant('2026-11-25', '09:00', 'Asia/Almaty').toISOString()).toBe('2026-11-25T04:00:00.000Z');
    expect(appointmentInstant('2026-11-25', '09:00', 'UTC').toISOString()).toBe('2026-11-25T09:00:00.000Z');
  });
});

describe('reminderDelays', () => {
  const now = new Date('2026-11-25T00:00:00Z');
  const at = (hoursAhead: number) => new Date(now.getTime() + hoursAhead * HOUR);

  it('schedules both stages when the appointment is far enough away', () => {
    expect(reminderDelays(at(20), now)).toEqual([
      { stage: '10h', delayMs: 10 * HOUR },
      { stage: '1h', delayMs: 19 * HOUR },
    ]);
  });

  it('keeps only the stages that are still in the future', () => {
    expect(reminderDelays(at(6), now)).toEqual([{ stage: '1h', delayMs: 5 * HOUR }]);
  });

  it('schedules nothing for an appointment one hour away or closer', () => {
    expect(reminderDelays(at(0.5), now)).toEqual([]);
    expect(reminderDelays(at(1), now)).toEqual([]);
  });
});
