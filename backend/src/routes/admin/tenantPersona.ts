import { Router } from 'express';
import { z } from 'zod';
import { generateText } from 'ai';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { loadTenantContext } from '../../services/tenantContext.js';
import { resolveTextModel } from '../../services/ai/providers.js';

export const adminTenantPersonaRouter = Router({ mergeParams: true });
adminTenantPersonaRouter.use(requireAuth, requireRole('super_admin'));

adminTenantPersonaRouter.put('/', async (req, res) => {
  const parsed = z.object({ aiPersona: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const t = await prisma.tenant.update({
    where: { id: (req.params as Record<string,string>).tenantId },
    data: { aiPersona: parsed.data.aiPersona },
  });
  res.json({ aiPersona: t.aiPersona });
});

adminTenantPersonaRouter.post('/test', async (req, res) => {
  const parsed = z.object({ message: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const tenant = await loadTenantContext((req.params as Record<string,string>).tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  try {
    const { sdkModel } = resolveTextModel(tenant);
    const result = await generateText({
      model: sdkModel,
      messages: [
        { role: 'system', content: tenant.aiPersona || 'You are a helpful assistant.' },
        { role: 'user', content: parsed.data.message },
      ],
    });
    res.json({ reply: result.text });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
