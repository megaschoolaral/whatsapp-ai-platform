import { Worker } from 'bullmq';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { inboundFlushJobName, followupJobName } from './index.js';
import { flushBuffer } from '../services/inboundBuffer/flush.js';
import { sendFollowup } from '../services/followup/sender.js';

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

  const followupWorker = new Worker(
    'followup',
    async (job) => {
      if (job.name !== followupJobName) return;
      const { tenantId, conversationId, jid, stage } = job.data as {
        tenantId: string;
        conversationId: string;
        jid: string;
        stage: '1h' | '12h';
      };
      try {
        await sendFollowup(tenantId, conversationId, jid, stage);
      } catch (err) {
        logger.error({ err, tenantId, conversationId, stage }, '[worker] sendFollowup failed');
        throw err;
      }
    },
    { connection: redis, concurrency: 5 },
  );

  followupWorker.on('failed', (job, err) => {
    logger.error({ err, jobId: job?.id }, '[worker:followup] job failed');
  });
}
