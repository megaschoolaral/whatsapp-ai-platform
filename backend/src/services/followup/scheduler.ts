import { prisma } from '../../prisma.js';
import { followupQueue, followupJobName } from '../../queues/index.js';

function jobId(tenantId: string, conversationId: string, stage: '1h' | '12h'): string {
  return `${tenantId}__${conversationId}__${stage}`;
}

export async function scheduleFollowups(
  tenantId: string,
  conversationId: string,
  jid: string,
): Promise<void> {
  const settings = await prisma.tenantFollowupSettings.findUnique({ where: { tenantId } });
  if (!settings || !settings.enabled) return;

  await cancelFollowups(tenantId, conversationId);

  const stages: Array<{ stage: '1h' | '12h'; delayMinutes: number }> = [
    { stage: '1h', delayMinutes: settings.delay1hMinutes },
    { stage: '12h', delayMinutes: settings.delay2hMinutes },
  ];

  for (const { stage, delayMinutes } of stages) {
    await followupQueue.add(
      followupJobName,
      { tenantId, conversationId, jid, stage },
      {
        delay: Math.max(0, delayMinutes * 60_000),
        jobId: jobId(tenantId, conversationId, stage),
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }
}

export async function cancelFollowups(tenantId: string, conversationId: string): Promise<void> {
  for (const stage of ['1h', '12h'] as const) {
    try {
      const existing = await followupQueue.getJob(jobId(tenantId, conversationId, stage));
      if (existing) await existing.remove();
    } catch {
      /* ignore */
    }
  }
}
