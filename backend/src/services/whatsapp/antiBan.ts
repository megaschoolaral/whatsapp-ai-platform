import { prisma } from '../../prisma.js';

export interface SendLimits {
  dailyHard: number;
  dailySoft: number;
  hourlyHard: number;
  hourlySoft: number;
  warmupDay: number;
}

export function warmupLimits(daysSinceWarmupStart: number): SendLimits {
  if (daysSinceWarmupStart <= 7) {
    return { dailyHard: 50, dailySoft: 20, hourlyHard: 30, hourlySoft: 15, warmupDay: daysSinceWarmupStart };
  }
  if (daysSinceWarmupStart <= 14) {
    return { dailyHard: 200, dailySoft: 100, hourlyHard: 50, hourlySoft: 30, warmupDay: daysSinceWarmupStart };
  }
  return { dailyHard: 1000, dailySoft: 500, hourlyHard: 80, hourlySoft: 30, warmupDay: daysSinceWarmupStart };
}

/**
 * Returns true if the tenant is allowed to send another message right now.
 * Updates per-window counters in DB.
 */
export async function canSendAndIncrement(tenantId: string): Promise<{
  allowed: boolean;
  reason?: string;
  limits: SendLimits;
}> {
  const session = await prisma.whatsappSession.findUnique({ where: { tenantId } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!session || !tenant) return { allowed: false, reason: 'no session', limits: warmupLimits(99) };

  const start = tenant.warmupStartedAt ?? new Date();
  const daysSince = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24));
  const limits = warmupLimits(daysSince);

  const now = new Date();

  let dailyCount = session.dailySendCount;
  let dayStart = session.dayWindowStartedAt ?? null;
  if (!dayStart || now.getTime() - dayStart.getTime() > 24 * 60 * 60 * 1000) {
    dayStart = now;
    dailyCount = 0;
  }

  let hourlyCount = session.hourlySendCount;
  let hourStart = session.hourWindowStartedAt ?? null;
  if (!hourStart || now.getTime() - hourStart.getTime() > 60 * 60 * 1000) {
    hourStart = now;
    hourlyCount = 0;
  }

  if (dailyCount >= limits.dailyHard) {
    return { allowed: false, reason: 'daily_hard_limit', limits };
  }
  if (hourlyCount >= limits.hourlyHard) {
    return { allowed: false, reason: 'hourly_hard_limit', limits };
  }

  await prisma.whatsappSession.update({
    where: { tenantId },
    data: {
      dailySendCount: dailyCount + 1,
      dayWindowStartedAt: dayStart,
      hourlySendCount: hourlyCount + 1,
      hourWindowStartedAt: hourStart,
    },
  });

  return { allowed: true, limits };
}
