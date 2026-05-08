import { prisma } from '../../prisma.js';
import type { Conversation, Message, MessageDirection } from '@prisma/client';

export async function upsertConversation(args: {
  tenantId: string;
  contactIdentifier: string;
  contactName?: string | null;
}): Promise<Conversation> {
  return prisma.conversation.upsert({
    where: {
      tenantId_contactIdentifier: {
        tenantId: args.tenantId,
        contactIdentifier: args.contactIdentifier,
      },
    },
    create: {
      tenantId: args.tenantId,
      contactIdentifier: args.contactIdentifier,
      contactName: args.contactName ?? null,
      status: 'ai_active',
    },
    update: {
      contactName: args.contactName ?? undefined,
      lastMessageAt: new Date(),
    },
  });
}

export async function appendMessage(args: {
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  sentBy: string;
  content: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  transcribedText?: string | null;
  aiConfidence?: number | null;
  whatsappMsgId?: string | null;
}): Promise<Message> {
  const msg = await prisma.message.create({
    data: {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      direction: args.direction,
      sentBy: args.sentBy,
      content: args.content,
      mediaUrl: args.mediaUrl ?? null,
      mediaType: args.mediaType ?? null,
      transcribedText: args.transcribedText ?? null,
      aiConfidence: args.aiConfidence ?? null,
      whatsappMsgId: args.whatsappMsgId ?? null,
    },
  });
  await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { lastMessageAt: new Date() },
  });
  return msg;
}

export async function getConversationHistory(conversationId: string, limit = 20) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows;
}
