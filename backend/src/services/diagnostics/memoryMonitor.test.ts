import { describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('../whatsapp/manager.js', () => ({ listSessions: vi.fn() }));
vi.mock('../whatsapp/sessionStore.js', () => ({ getAuthKeyCounts: vi.fn() }));

import { snapshotMemory } from './memoryMonitor.js';

describe('snapshotMemory', () => {
  it('reports process memory in whole MB plus session and key counts', () => {
    const snap = snapshotMemory({
      usage: { rss: 1_048_576 * 100, heapTotal: 1_048_576 * 60, heapUsed: 1_048_576 * 40, external: 1_048_576 * 5, arrayBuffers: 1_048_576 * 2 },
      sessions: [
        { tenantId: 'a', status: 'connected' },
        { tenantId: 'b', status: 'closed' },
      ],
      keyCounts: { a: 1200 },
    });
    expect(snap).toEqual({
      rssMb: 100,
      heapTotalMb: 60,
      heapUsedMb: 40,
      externalMb: 5,
      arrayBuffersMb: 2,
      sessions: 2,
      connected: 1,
      authKeys: { a: 1200 },
    });
  });
});
