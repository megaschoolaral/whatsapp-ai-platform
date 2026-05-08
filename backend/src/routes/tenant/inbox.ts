import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, tenantIsolation } from '../../auth/middleware.js';
import { sendHumanLikeText } from '../../services/whatsapp/outbound.js';
import { getSession } from '../../services/whatsapp/manager.js';
import { setStatus } from '../../services/conversations/stateMachine.js';
import { dropBuffer } from '../../services/inboundBuffer/buffer.js';
import { appendMessage } from '../../services/conversations/store.js';
import { emitToTenant } from '../../services/realtime/socketRooms.js';

export const tenantInboxRouter = Router();
tenantInboxRouter.use(requireAuth, tenantIsolation);

tenantInboxRouter.get('/conversations', async (req, res) => {
  const tenantId = req.tenantScope!;
  const status = req.query.status as string | undefined;
  const conversations = await prisma.conversation.findMany({
    where: { tenantId, ...(status ? { status: status as any } : {}) },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  res.json(conversations);
});

tenantInboxRouter.get('/conversations/:id/messages', async (req, res) => {
  const tenantId = req.tenantScope!;
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const messages = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  res.json({ conversation: conv, messages });
});

const replySchema = z.object({ text: z.string().min(1).max(4000) });
tenantInboxRouter.post('/conversations/:id/reply', async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const tenantId = req.tenantScope!;
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const session = getSession(tenantId);
  if (!session || session.status !== 'connected') {
    res.status(503).json({ error: 'WhatsApp not connected' });
    return;
  }
  // Drop AI buffer for this contact, mark human_active
  await dropBuffer(tenantId, conv.contactIdentifier);
  await setStatus(conv.id, 'human_active', { assignedOperatorId: req.user!.userId });

  const result = await sendHumanLikeText({
    tenantId,
    sock: session.sock,
    jid: conv.contactIdentifier,
    text: parsed.data.text,
  });
  if (!result.sent) {
    res.status(429).json({ error: result.reason ?? 'send_blocked' });
    return;
  }
  await appendMessage({
    tenantId,
    conversationId: conv.id,
    direction: 'outgoing',
    sentBy: req.user!.userId,
    content: parsed.data.text,
  });
  emitToTenant(tenantId, 'message:new', {
    conversationId: conv.id,
    direction: 'outgoing',
    sentBy: req.user!.userId,
    content: parsed.data.text,
  });
  res.json({ ok: true });
});

tenantInboxRouter.post('/conversations/:id/take-over', async (req, res) => {
  const tenantId = req.tenantScope!;
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await dropBuffer(tenantId, conv.contactIdentifier);
  await setStatus(conv.id, 'human_active', { assignedOperatorId: req.user!.userId });
  res.json({ ok: true });
});

tenantInboxRouter.post('/conversations/:id/return-to-ai', async (req, res) => {
  const tenantId = req.tenantScope!;
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await setStatus(conv.id, 'ai_active', { assignedOperatorId: null });
  res.json({ ok: true });
});

tenantInboxRouter.post('/conversations/:id/resolve', async (req, res) => {
  const tenantId = req.tenantScope!;
  const conv = await prisma.conversation.findFirst({ where: { id: req.params.id, tenantId } });
  if (!conv) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await setStatus(conv.id, 'resolved');
  res.json({ ok: true });
});
