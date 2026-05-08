import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';

export const adminUsageRouter = Router();
adminUsageRouter.use(requireAuth, requireRole('super_admin'));

adminUsageRouter.get('/', async (req, res) => {
  const tenantId = (req.query.tenantId as string | undefined) ?? undefined;
  const since = new Date();
  since.setDate(since.getDate() - 30);

  const where = { createdAt: { gte: since }, ...(tenantId ? { tenantId } : {}) };
  const grouped = await prisma.aiUsageLog.groupBy({
    by: ['tenantId', 'category', 'modelId'],
    where,
    _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true, durationSeconds: true },
    _count: { _all: true },
  });

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  const nameById = new Map(tenants.map((t) => [t.id, t.name]));
  res.json(
    grouped.map((g) => ({
      tenantId: g.tenantId,
      tenantName: nameById.get(g.tenantId) ?? '?',
      category: g.category,
      modelId: g.modelId,
      cost: g._sum.estimatedCostUsd ?? 0,
      inputTokens: g._sum.inputTokens ?? 0,
      outputTokens: g._sum.outputTokens ?? 0,
      durationSeconds: g._sum.durationSeconds ?? 0,
      calls: g._count._all,
    })),
  );
});

adminUsageRouter.get('/audit-log', async (req, res) => {
  const tenantId = (req.query.tenantId as string | undefined) ?? undefined;
  const logs = await prisma.apiKeyAuditLog.findMany({
    where: tenantId ? { tenantId } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  res.json(logs);
});
