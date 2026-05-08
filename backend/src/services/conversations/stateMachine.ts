import { prisma } from '../../prisma.js';
import type { ConversationStatus } from '@prisma/client';
import { emitToTenant } from '../realtime/socketRooms.js';

export async function setStatus(
  conversationId: string,
  status: ConversationStatus,
  extra: { handoffReason?: string | null; assignedOperatorId?: string | null } = {},
): Promise<void> {
  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status,
      handoffReason: extra.handoffReason ?? null,
      assignedOperatorId: extra.assignedOperatorId ?? null,
      lastHumanActivityAt: status === 'human_active' ? new Date() : undefined,
    },
  });
  emitToTenant(conv.tenantId, 'conversation:updated', {
    conversationId,
    status,
    handoffReason: extra.handoffReason ?? null,
  });
}
