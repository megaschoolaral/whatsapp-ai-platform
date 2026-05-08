import { Worker } from 'bullmq';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { inboundFlushJobName } from './index.js';
import { flushBuffer } from '../services/inboundBuffer/flush.js';

export function startWorkers(): void {
  const inboundWorker = new Worker(
    'inbound-flush',
    async (job) => {
      if (job.name !== inboundFlushJobName) return;
      const { tenantId, jid } = job.data as { tenantId: string; jid: string };
      try {
        await flushBuffer(tenantId, jid);
      } catch (err) {
        logger.error({ err, tenantId, jid }, '[worker] flushBuffer failed');
        throw err;
      }
    },
    { connection: redis, concurrency: 10 },
  );

  inboundWorker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, '[worker:inbound-flush] job failed');
  });
}
