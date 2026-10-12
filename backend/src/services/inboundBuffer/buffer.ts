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
  /** DB Message.id of the stored incoming message */
  messageId?: string | null;
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
  messageId?: string | null;
  mediaSize?: number | null;
}): Promise<void> {
  const k = bufferKey(args.tenantId, args.contactJid);
  const meta = metaKey(args.tenantId, args.contactJid);
  const entry: BufferedMessage = {
    text: args.text,
    imageBase64: args.imageBase64 ?? null,
    imageMimeType: args.imageMimeType ?? null,
    whatsappMsgId: null,
    messageId: args.messageId ?? null,
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

function jobKey(tenantId: string, jid: string): string {
  return `wa:buffer:job:${tenantId}:${jid}`;
}

/** Remove the pending (delayed) flush job for this contact, if any. Active jobs can't be removed — that's fine. */
async function removePendingJob(tenantId: string, jid: string): Promise<void> {
  try {
    const prevId = await redis.get(jobKey(tenantId, jid));
    if (!prevId) return;
    const existing = await inboundFlushQueue.getJob(prevId);
    if (existing) await existing.remove();
  } catch {
    /* active/locked job — leave it */
  }
}

export async function scheduleFlush(tenantId: string, jid: string, delayMs: number): Promise<void> {
  await removePendingJob(tenantId, jid);
  // Unique id per schedule: a fixed id made BullMQ silently drop the new job
  // while the previous one was still active, leaving the message unanswered.
  const jobId = `${tenantId}__${jid.replace(/:/g, '_')}__${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await inboundFlushQueue.add(
    inboundFlushJobName,
    { tenantId, jid },
    { delay: Math.max(0, delayMs), jobId, removeOnComplete: 100, removeOnFail: 50 },
  );
  await redis.set(jobKey(tenantId, jid), jobId, 'EX', 600);
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
  await redis.del(k, meta, lockKey);

  const parsed = items.map((s: string) => JSON.parse(s) as BufferedMessage);
  return { messages: parsed, conversationId };
}

export async function dropBuffer(tenantId: string, jid: string): Promise<void> {
  await redis.del(bufferKey(tenantId, jid), metaKey(tenantId, jid));
  await removePendingJob(tenantId, jid);
  await redis.del(jobKey(tenantId, jid));
}
