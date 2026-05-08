import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { MODEL_PRICING, getTextModel, getVisionModel, getSttModel } from '../../config/model-pricing.js';

export const adminTenantModelsRouter = Router({ mergeParams: true });
adminTenantModelsRouter.use(requireAuth, requireRole('super_admin'));

const schema = z.object({
  textModelId: z.string(),
  visionModelId: z.string(),
  sttModelId: z.string(),
});

adminTenantModelsRouter.get('/', async (req, res) => {
  const choices = await prisma.tenantModelChoices.findUnique({ where: { tenantId: (req.params as Record<string,string>).tenantId } });
  res.json({ choices, catalog: MODEL_PRICING });
});

adminTenantModelsRouter.put('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  if (!getTextModel(parsed.data.textModelId)) {
    res.status(400).json({ error: 'Unknown text model' });
    return;
  }
  if (!getVisionModel(parsed.data.visionModelId)) {
    res.status(400).json({ error: 'Unknown vision model' });
    return;
  }
  if (!getSttModel(parsed.data.sttModelId)) {
    res.status(400).json({ error: 'Unknown stt model' });
    return;
  }
  const updated = await prisma.tenantModelChoices.upsert({
    where: { tenantId: (req.params as Record<string,string>).tenantId },
    create: { tenantId: (req.params as Record<string,string>).tenantId, ...parsed.data },
    update: parsed.data,
  });
  res.json(updated);
});
