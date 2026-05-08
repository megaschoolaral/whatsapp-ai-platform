import pino from 'pino';
import { env } from './env.js';

const redactPaths = [
  '*.openaiKey',
  '*.geminiKey',
  '*.xaiKey',
  '*.elevenlabsKey',
  '*.sonioxKey',
  '*.password',
  '*.passwordHash',
  '*.encryptedCreds',
  '*.encryptedKeys',
  'password',
  'passwordHash',
  'authorization',
  'req.headers.authorization',
];

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
