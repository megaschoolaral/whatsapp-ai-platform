import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findSession: vi.fn(), findTenant: vi.fn(), update: vi.fn() }));
vi.mock('../../prisma.js', () => ({
  prisma: {
    whatsappSession: { findUnique: mocks.findSession, update: mocks.update },
    tenant: { findUnique: mocks.findTenant },
  },
}));

import { getSendCapacity } from './antiBan.js';

const longAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTenant.mockResolvedValue({ warmupStartedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) }); // past warmup: hourlyHard 80, dailyHard 1000
});

describe('getSendCapacity', () => {
  it('is 0 without a session', async () => {
    mocks.findSession.mockResolvedValue(null);
    expect(await getSendCapacity('t1')).toEqual({ remaining: 0 });
  });

  it('returns the smaller of the hourly and daily headroom without changing counters', async () => {
    const now = new Date();
    mocks.findSession.mockResolvedValue({
      dailySendCount: 10,
      dayWindowStartedAt: now,
      hourlySendCount: 70,
      hourWindowStartedAt: now,
    });
    const res = await getSendCapacity('t1');
    expect(res.remaining).toBeLessThanOrEqual(10);
    expect(res.remaining).toBeGreaterThan(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('treats an expired window as empty', async () => {
    mocks.findSession.mockResolvedValue({
      dailySendCount: 999,
      dayWindowStartedAt: longAgo,
      hourlySendCount: 80,
      hourWindowStartedAt: longAgo,
    });
    expect((await getSendCapacity('t1')).remaining).toBeGreaterThan(10);
  });
});
