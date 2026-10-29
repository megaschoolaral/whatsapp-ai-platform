import { logger } from '../../logger.js';
import { listSessions } from '../whatsapp/manager.js';
import { getAuthKeyCounts } from '../whatsapp/sessionStore.js';

const INTERVAL_MS = 5 * 60_000;
const MB = 1024 * 1024;

interface SnapshotInput {
  usage: Pick<NodeJS.MemoryUsage, 'rss' | 'heapTotal' | 'heapUsed' | 'external' | 'arrayBuffers'>;
  sessions: Array<{ tenantId: string; status: string }>;
  keyCounts: Record<string, number>;
}

export function snapshotMemory({ usage, sessions, keyCounts }: SnapshotInput) {
  const mb = (n: number) => Math.round(n / MB);
  return {
    rssMb: mb(usage.rss),
    heapTotalMb: mb(usage.heapTotal),
    heapUsedMb: mb(usage.heapUsed),
    externalMb: mb(usage.external),
    arrayBuffersMb: mb(usage.arrayBuffers),
    sessions: sessions.length,
    connected: sessions.filter((s) => s.status === 'connected').length,
    authKeys: keyCounts,
  };
}

/** Periodic memory line so a slow climb can be told apart: JS heap vs Buffers/native vs key caches. */
export function startMemoryMonitor(): void {
  const timer = setInterval(() => {
    try {
      logger.info(
        snapshotMemory({ usage: process.memoryUsage(), sessions: listSessions(), keyCounts: getAuthKeyCounts() }),
        '[memory]',
      );
    } catch (err) {
      logger.warn({ err }, '[memory] snapshot failed');
    }
  }, INTERVAL_MS);
  timer.unref();
}
