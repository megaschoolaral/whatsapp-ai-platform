import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { hashPassword } from '../../auth/password.js';
import { connectTenant, disconnectTenant } from '../../services/whatsapp/connect.js';

export const adminTenantsRouter = Router();

adminTenantsRouter.use(requireAuth, requireRole('super_admin'));

adminTenantsRouter.get('/', async (_req, res) => {
  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, email: true, lastLoginAt: true } },
      whatsappSession: { select: { status: true, phoneNumber: true } },
      _count: { select: { conversations: true, knowledgeFiles: true } },
    },
  });
  res.json(tenants);
});

const createSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().optional(),
  industry: z.string().optional(),
  timezone: z.string().default('Asia/Almaty'),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(8),
});

adminTenantsRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.ownerEmail } });
  if (existing) {
    res.status(409).json({ error: 'User with this email already exists' });
    return;
  }
  const owner = await prisma.user.create({
    data: {
      email: parsed.data.ownerEmail,
      passwordHash: await hashPassword(parsed.data.ownerPassword),
      role: 'tenant_admin',
      isActive: true,
      mustChangePassword: true,
    },
  });
  const tenant = await prisma.tenant.create({
    data: {
      name: parsed.data.name,
      contactEmail: parsed.data.contactEmail ?? null,
      industry: parsed.data.industry ?? null,
      timezone: parsed.data.timezone,
      ownerUserId: owner.id,
      status: 'pending_setup',
      modelChoices: { create: {} },
      apiKeys: { create: {} },
      whatsappSession: { create: {} },
    },
    include: { owner: true },
  });
  res.status(201).json(tenant);
});

adminTenantsRouter.get('/:tenantId', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.tenantId },
    include: {
      owner: { select: { id: true, email: true, lastLoginAt: true } },
      modelChoices: true,
      whatsappSession: { select: { status: true, phoneNumber: true, lastConnectedAt: true } },
      _count: { select: { conversations: true, knowledgeFiles: true, aiUsageLogs: true } },
    },
  });
  if (!tenant) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(tenant);
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  contactEmail: z.string().email().nullable().optional(),
  industry: z.string().nullable().optional(),
  timezone: z.string().optional(),
  aiPersona: z.string().optional(),
});
adminTenantsRouter.patch('/:tenantId', async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const t = await prisma.tenant.update({ where: { id: req.params.tenantId }, data: parsed.data });
  res.json(t);
});

adminTenantsRouter.post('/:tenantId/suspend', async (req, res) => {
  const reason = (req.body?.reason as string) ?? null;
  await prisma.tenant.update({
    where: { id: req.params.tenantId },
    data: { status: 'suspended', suspendedAt: new Date(), suspendedReason: reason },
  });
  await disconnectTenant(req.params.tenantId).catch(() => undefined);
  res.json({ ok: true });
});

adminTenantsRouter.post('/:tenantId/reactivate', async (req, res) => {
  await prisma.tenant.update({
    where: { id: req.params.tenantId },
    data: { status: 'active', suspendedAt: null, suspendedReason: null },
  });
  res.json({ ok: true });
});

adminTenantsRouter.post('/:tenantId/activate', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: req.params.tenantId },
    include: { apiKeys: true, modelChoices: true, whatsappSession: true },
  });
  if (!tenant) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!tenant.apiKeys?.geminiKey) {
    res.status(400).json({ error: 'Gemini key required before activation' });
    return;
  }
  if (!tenant.aiPersona?.trim()) {
    res.status(400).json({ error: 'AI persona must be set' });
    return;
  }
  if (!tenant.whatsappSession?.phoneNumber) {
    res.status(400).json({ error: 'WhatsApp must be connected before activation' });
    return;
  }
  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'active' } });
  // Ensure Baileys is running
  connectTenant(tenant.id).catch(() => undefined);
  res.json({ ok: true });
});

adminTenantsRouter.delete('/:tenantId', async (req, res) => {
  if (req.body?.confirm !== 'DELETE') {
    res.status(400).json({ error: 'Type DELETE to confirm' });
    return;
  }
  await disconnectTenant(req.params.tenantId).catch(() => undefined);
  await prisma.tenant.delete({ where: { id: req.params.tenantId } });
  res.json({ ok: true });
});

adminTenantsRouter.get('/:tenantId/onboarding', async (req, res) => {
  const t = await prisma.tenant.findUnique({
    where: { id: req.params.tenantId },
    include: {
      apiKeys: true,
      modelChoices: true,
      whatsappSession: true,
      _count: { select: { knowledgeFiles: true } },
    },
  });
  if (!t) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const steps = {
    info: !!t.name && !!t.timezone,
    credentials: !!t.ownerUserId,
    keys: !!t.apiKeys?.geminiKey,
    models: !!t.modelChoices,
    persona: !!t.aiPersona?.trim(),
    whatsapp: t.whatsappSession?.status === 'connected',
    knowledge: (t._count?.knowledgeFiles ?? 0) > 0,
  };
  const required = ['info', 'credentials', 'keys', 'models', 'persona', 'whatsapp'] as const;
  const ready = required.every((k) => steps[k]);
  res.json({ status: t.status, steps, ready });
});
