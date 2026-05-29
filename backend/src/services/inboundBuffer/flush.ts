import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { readAndClearBuffer } from './buffer.js';
import { loadTenantContext } from '../tenantContext.js';
import { generateReply, type ChatTurn } from '../ai/generate.js';
import { getConversationHistory, appendMessage } from '../conversations/store.js';
import { setStatus } from '../conversations/stateMachine.js';
import { shouldHandoff } from '../conversations/handoff.js';
import { sendHumanLikeText } from '../whatsapp/outbound.js';
import { getSession } from '../whatsapp/manager.js';
import { emitToTenant } from '../realtime/socketRooms.js';

export async function flushBuffer(tenantId: string, jid: string): Promise<void> {
  const { messages, conversationId } = await readAndClearBuffer(tenantId, jid);
  if (!messages.length || !conversationId) return;

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) return;
  if (conversation.status === 'human_active' || conversation.status === 'awaiting_human') {
    return; // human took over while buffering
  }

  const tenant = await loadTenantContext(tenantId);
  if (!tenant || tenant.status !== 'active') {
    logger.warn({ tenantId }, '[flush] tenant not active, skipping AI');
    return;
  }

  const session = getSession(tenantId);
  if (!session || session.status !== 'connected') {
    logger.warn({ tenantId }, '[flush] no live whatsapp session');
    return;
  }

  // Combine buffered messages
  const combinedText = messages.map((m) => m.text).filter(Boolean).join('\n');
  const lastImage = [...messages].reverse().find((m) => m.imageBase64);

  // History from DB (excluding the messages we just stored — they'll be in DB already as incoming)
  const dbHistory = await getConversationHistory(conversationId, 30);
  const history: ChatTurn[] = dbHistory
    .slice(0, -1) // last one is the most recent incoming, will be supplied as userMessage
    .map((m) => ({
      role: m.direction === 'incoming' ? ('user' as const) : ('assistant' as const),
      content: m.transcribedText ?? m.content ?? '',
    }))
    .filter((t) => t.content);

  // If no text and no image (e.g. sticker, reaction, audio without STT) — skip silently
  if (!combinedText.trim() && !lastImage) {
    logger.warn({ tenantId, jid }, '[flush] no text or image content, skipping AI');
    return;
  }

  // Pre-handoff check by user content
  const handoff = shouldHandoff(combinedText);
  if (handoff.handoff) {
    await setStatus(conversationId, 'awaiting_human', { handoffReason: handoff.reason });
    emitToTenant(tenantId, 'conversation:updated', { conversationId, status: 'awaiting_human' });
    return;
  }

  let reply: { text: string; inputTokens: number; outputTokens: number };
  try {
    reply = await generateReply({
      tenant,
      history,
      userMessage: combinedText,
      imageBase64: lastImage?.imageBase64 ?? null,
      imageMimeType: lastImage?.imageMimeType ?? null,
      conversationId,
    });
  } catch (err) {
    logger.error({ err, tenantId }, '[flush] generateReply failed');
    await setStatus(conversationId, 'awaiting_human', { handoffReason: 'ai_error' });
    return;
  }

  const sendResult = await sendHumanLikeText({
    tenantId,
    sock: session.sock,
    jid,
    text: reply.text,
    markReadKey: messages[messages.length - 1]?.fromMeKey,
  });

  if (!sendResult.sent) {
    logger.warn({ tenantId, reason: sendResult.reason }, '[flush] outbound blocked');
    await setStatus(conversationId, 'awaiting_human', { handoffReason: sendResult.reason ?? 'send_blocked' });
    return;
  }

  await appendMessage({
    tenantId,
    conversationId,
    direction: 'outgoing',
    sentBy: 'ai',
    content: reply.text,
  });
  emitToTenant(tenantId, 'message:new', {
    conversationId,
    direction: 'outgoing',
    sentBy: 'ai',
    content: reply.text,
  });
}
