import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BAD_SESSION_RETRY_DELAYS_MS,
  STABLE_AFTER_MS,
  nextBadSessionDelay,
  recordConnectionOpen,
  resetBadSessionRetries,
} from './badSessionRetry.js';

beforeEach(() => {
  vi.useFakeTimers();
  resetBadSessionRetries('t1');
  resetBadSessionRetries('t2');
});
afterEach(() => vi.useRealTimers());

describe('badSession retry budget', () => {
  it('hands out growing delays, then gives up', () => {
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[0]);
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[1]);
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[2]);
    expect(nextBadSessionDelay('t1')).toBeNull();
  });

  it('keeps a separate budget per tenant', () => {
    for (let i = 0; i < BAD_SESSION_RETRY_DELAYS_MS.length; i++) nextBadSessionDelay('t1');
    expect(nextBadSessionDelay('t1')).toBeNull();
    expect(nextBadSessionDelay('t2')).toBe(BAD_SESSION_RETRY_DELAYS_MS[0]);
  });

  it('forgives earlier 500s once the connection stayed up long enough', () => {
    nextBadSessionDelay('t1');
    nextBadSessionDelay('t1');
    recordConnectionOpen('t1');
    vi.advanceTimersByTime(STABLE_AFTER_MS + 1);
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[0]);
  });

  it('does not forgive a flapping connection that drops again before it is stable', () => {
    nextBadSessionDelay('t1');
    nextBadSessionDelay('t1');
    recordConnectionOpen('t1');
    vi.advanceTimersByTime(STABLE_AFTER_MS - 1000);
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[2]);
    vi.advanceTimersByTime(STABLE_AFTER_MS * 2);
    expect(nextBadSessionDelay('t1')).toBeNull();
  });

  it('starts from a clean budget after a deliberate reset', () => {
    nextBadSessionDelay('t1');
    nextBadSessionDelay('t1');
    resetBadSessionRetries('t1');
    expect(nextBadSessionDelay('t1')).toBe(BAD_SESSION_RETRY_DELAYS_MS[0]);
  });
});
