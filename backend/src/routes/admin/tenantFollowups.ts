import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';

export const adminTenantFollowupsRouter = Router({ mergeParams: true });
adminTenantFollowupsRouter.use(requireAuth, requireRole('super_admin'));

adminTenantFollowupsRouter.get('/', async (req, res) => {
  const tenantId = (req.params as Record<string, string>).tenantId;
  const s = await prisma.tenantFollowupSettings.findUnique({ where: { tenantId } });
  res.json(
    s ?? {
      enabled: false,
      delay1hMinutes: 60,
      delay2hMinutes: 720,
      message1Text: '',
      message2Text: '',
    },
  );
});

const followupsSchema = z.object({
  enabled: z.boolean(),
  delay1hMinutes: z.number().int().min(1),
  delay2hMinutes: z.number().int().min(1),
  message1Text: z.string().max(4000),
  message2Text: z.string().max(4000),
});
adminTenantFollowupsRouter.put('/', async (req, res) => {
  const tenantId = (req.params as Record<string, string>).tenantId;
  const parsed = followupsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const updated = await prisma.tenantFollowupSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...parsed.data },
    update: parsed.data,
  });
  res.json(updated);
});
