import { redis } from '../../redis.js';
import { inboundFlushQueue, inboundFlushJobName } from '../../queues/index.js';

const INITIAL_WAIT_MS = 15_000;
const COMPOSING_EXTEND_MS = 15_000;
const PAUSED_FINAL_WAIT_MS = 5_000;
const HARD_CAP_MS = 60_000;
const BUFFER_TTL_S = 90;

interface BufferedMessage {
  text: string;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  whatsappMsgId?: string | null;
  fromMeKey?: object;
  ts: number;
}

function bufferKey(tenantId: string, jid: string): string {
  return `wa:buffer:${tenantId}:${jid}`;
}
function metaKey(tenantId: string, jid: string): string {
  return `wa:buffer:meta:${tenantId}:${jid}`;
}

export async function appendToBuffer(args: {
  tenantId: string;
  contactJid: string;
  conversationId: string;
  text: string;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  msgKey?: object;
  mediaSize?: number | null;
}): Promise<void> {
  const k = bufferKey(args.tenantId, args.contactJid);
  const meta = metaKey(args.tenantId, args.contactJid);
  const entry: BufferedMessage = {
    text: args.text,
    imageBase64: args.imageBase64 ?? null,
    imageMimeType: args.imageMimeType ?? null,
    whatsappMsgId: null,
    fromMeKey: args.msgKey,
    ts: Date.now(),
  };
  await redis.rpush(k, JSON.stringify(entry));
  await redis.expire(k, BUFFER_TTL_S);

  const existingStart = await redis.hget(meta, 'startedAt');
  if (!existingStart) {
    await redis.hset(meta, { startedAt: String(Date.now()), conversationId: args.conversationId });
    await redis.expire(meta, BUFFER_TTL_S);
  }

  await scheduleFlush(args.tenantId, args.contactJid, INITIAL_WAIT_MS);
}

export async function extendBufferTimer(
  tenantId: string,
  jid: string,
  reason: 'composing' | 'paused',
): Promise<void> {
  const k = bufferKey(tenantId, jid);
  const exists = await redis.exists(k);
  if (!exists) return;

  const meta = metaKey(tenantId, jid);
  const startedAtRaw = await redis.hget(meta, 'startedAt');
  const startedAt = startedAtRaw ? Number(startedAtRaw) : Date.now();
  const age = Date.now() - startedAt;
  if (age >= HARD_CAP_MS) {
    await scheduleFlush(tenantId, jid, 0);
    return;
  }

  const wait = reason === 'composing' ? COMPOSING_EXTEND_MS : PAUSED_FINAL_WAIT_MS;
  await scheduleFlush(tenantId, jid, Math.min(wait, HARD_CAP_MS - age));
}

async function scheduleFlush(tenantId: string, jid: string, delayMs: number): Promise<void> {
  const jobId = `${tenantId}:${jid}`;
  // Remove existing job to keep only the latest timer
  try {
    const existing = await inboundFlushQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    /* ignore */
  }
  await inboundFlushQueue.add(
    inboundFlushJobName,
    { tenantId, jid },
    { delay: Math.max(0, delayMs), jobId, removeOnComplete: 100, removeOnFail: 50 },
  );
}

export async function readAndClearBuffer(
  tenantId: string,
  jid: string,
): Promise<{ messages: BufferedMessage[]; conversationId: string | null }> {
  const k = bufferKey(tenantId, jid);
  const meta = metaKey(tenantId, jid);
  const lockKey = `wa:bufflock:${tenantId}:${jid}`;
  const lock = await redis.set(lockKey, '1', 'EX', 5, 'NX');
  if (!lock) return { messages: [], conversationId: null };

  const items = await redis.lrange(k, 0, -1);
  const conversationId = await redis.hget(meta, 'conversationId');
  await redis.del(k, meta);

  const parsed = items.map((s: string) => JSON.parse(s) as BufferedMessage);
  return { messages: parsed, conversationId };
}

export async function dropBuffer(tenantId: string, jid: string): Promise<void> {
  const k = bufferKey(tenantId, jid);
  const meta = metaKey(tenantId, jid);
  await redis.del(k, meta);
  const jobId = `${tenantId}:${jid}`;
  try {
    const existing = await inboundFlushQueue.getJob(jobId);
    if (existing) await existing.remove();
  } catch {
    /* ignore */
  }
}
