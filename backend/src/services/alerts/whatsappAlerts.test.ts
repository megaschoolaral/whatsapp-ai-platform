import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendAdminAlert = vi.fn();
const findUnique = vi.fn();
// Fake Redis: a plain map, so tests can also simulate a restart (memory wiped, Redis kept).
const { store, redisFake } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const redisFake = {
    set: async (key: string, value: string, mode?: string) => {
      if (mode === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  };
  return { store, redisFake };
});

vi.mock('./adminTelegram.js', () => ({ sendAdminAlert: (t: string) => sendAdminAlert(t) }));
vi.mock('../../prisma.js', () => ({ prisma: { tenant: { findUnique: (a: unknown) => findUnique(a) } } }));
vi.mock('../../redis.js', () => ({ redis: redisFake }));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  SOFT_ALERT_DELAY_MS,
  _resetAlertState,
  describeReason,
  isHardReason,
  markIntentionalDisconnect,
  notifyConnected,
  notifyDisconnected,
} from './whatsappAlerts.js';

const tenant = (over: Record<string, unknown> = {}) => ({
  name: 'хостел',
  status: 'active',
  whatsappSession: { phoneNumber: '77783026252', status: 'disconnected' },
  ...over,
});

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  sendAdminAlert.mockReset().mockResolvedValue(true);
  findUnique.mockReset().mockResolvedValue(tenant());
  store.clear();
  _resetAlertState();
});
afterEach(() => vi.useRealTimers());

describe('reason classification', () => {
  it('treats loggedOut, badSession, multideviceMismatch and connectionReplaced as hard', () => {
    for (const code of [401, 500, 411, 440]) expect(isHardReason(code)).toBe(true);
  });
  it('treats transient drops and unknown reasons as soft', () => {
    for (const code of [408, 428, 515, undefined]) expect(isHardReason(code)).toBe(false);
  });
  it('explains badSession in plain words', () => {
    expect(describeReason(500)).toContain('badSession');
  });
});

describe('notifyDisconnected', () => {
  it('alerts immediately when a hard reason needs a manual QR re-scan', async () => {
    notifyDisconnected('t1', 500);
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    const text = sendAdminAlert.mock.calls[0]![0] as string;
    expect(text).toContain('хостел');
    expect(text).toContain('77783026252');
    expect(text).toContain('badSession');
    expect(text).toContain('QR');
  });

  it('waits for a soft drop and alerts only if the tenant is still offline', async () => {
    notifyDisconnected('t1', 408);
    await vi.advanceTimersByTimeAsync(SOFT_ALERT_DELAY_MS - 1000);
    expect(sendAdminAlert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the soft drop recovered before the delay ran out', async () => {
    notifyDisconnected('t1', 408);
    notifyConnected('t1');
    await vi.advanceTimersByTimeAsync(SOFT_ALERT_DELAY_MS + 1000);
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it('stays silent when the session is already connected again at alert time', async () => {
    findUnique.mockResolvedValue(tenant({ whatsappSession: { phoneNumber: '1', status: 'connected' } }));
    notifyDisconnected('t1', 408);
    await vi.advanceTimersByTimeAsync(SOFT_ALERT_DELAY_MS + 1000);
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it('does not alert for tenants that are not active', async () => {
    findUnique.mockResolvedValue(tenant({ status: 'pending_setup' }));
    notifyDisconnected('t1', 500);
    await flush();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it('sends one alert per outage', async () => {
    notifyDisconnected('t1', 500);
    await flush();
    notifyDisconnected('t1', 500);
    notifyDisconnected('t1', 408);
    await vi.advanceTimersByTimeAsync(SOFT_ALERT_DELAY_MS + 1000);
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the alert after a restart in the middle of the outage', async () => {
    notifyDisconnected('t1', 401);
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    _resetAlertState(); // process restarted: memory is gone, the Redis marker is not
    notifyDisconnected('t1', 401);
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
  });

  it('alerts again for a new outage after the tenant reconnected', async () => {
    notifyDisconnected('t1', 500);
    await flush();
    notifyConnected('t1');
    await flush();
    sendAdminAlert.mockClear();
    notifyDisconnected('t1', 500);
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(sendAdminAlert.mock.calls[0]![0]).toContain('⚠️');
  });

  it('stays silent for a deliberate disconnect', async () => {
    markIntentionalDisconnect('t1');
    notifyDisconnected('t1', 401);
    await flush();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });

  it('does not mark a failed send as alerted, so the next drop can retry', async () => {
    sendAdminAlert.mockResolvedValueOnce(false);
    notifyDisconnected('t1', 500);
    await flush();
    notifyDisconnected('t1', 500);
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(2);
  });
});

describe('notifyConnected', () => {
  it('announces the reconnect only after an outage alert was sent', async () => {
    notifyDisconnected('t1', 500);
    await flush();
    sendAdminAlert.mockClear();
    notifyConnected('t1');
    await flush();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(sendAdminAlert.mock.calls[0]![0]).toContain('✅');
  });

  it('says nothing when no outage alert had been sent', async () => {
    notifyConnected('t1');
    await flush();
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});
