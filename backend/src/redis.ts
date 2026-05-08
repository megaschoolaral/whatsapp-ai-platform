import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  // eslint-disable-next-line no-console
  console.error('[redis] error:', err.message);
});
