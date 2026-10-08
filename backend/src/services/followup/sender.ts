import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { getSession } from '../whatsapp/manager.js';
import { sendHumanLikeText } from '../whatsapp/outbound.js';
import { appendMessage } from '../conversations/store.js';
import { emitToTenant } from '../realtime/socketRooms.js';

export async function sendFollowup(
  tenantId: string,
  conversationId: string,
  jid: string,
  stage: '1h' | '12h',
): Promise<void> {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conversation || conversation.status === 'resolved' || conversation.status === 'human_active') {
    return; // conversation moved on, nothing to do
  }

  const settings = await prisma.tenantFollowupSettings.findUnique({ where: { tenantId } });
  if (!settings || !settings.enabled) return;

  const text = stage === '1h' ? settings.message1Text : settings.message2Text;
  if (!text?.trim()) return;

  const session = getSession(tenantId);
  if (!session || session.status !== 'connected') {
    logger.warn({ tenantId, conversationId, stage }, '[followup] no live whatsapp session, skipping');
    return;
  }

  const result = await sendHumanLikeText({ tenantId, sock: session.sock, jid, text });
  if (!result.sent) {
    logger.warn({ tenantId, conversationId, stage, reason: result.reason }, '[followup] send blocked');
    return;
  }

  await appendMessage({
    tenantId,
    conversationId,
    direction: 'outgoing',
    sentBy: 'system_followup',
    content: text,
  });
  emitToTenant(tenantId, 'message:new', {
    conversationId,
    direction: 'outgoing',
    sentBy: 'system_followup',
    content: text,
  });
}
