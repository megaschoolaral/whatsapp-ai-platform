import { Queue } from 'bullmq';
import { redis } from '../redis.js';

export const inboundFlushJobName = 'flush';

export const inboundFlushQueue = new Queue('inbound-flush', {
  connection: redis,
});
