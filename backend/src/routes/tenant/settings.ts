import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../../prisma.js';
import { requireAuth, tenantIsolation } from '../../auth/middleware.js';
import { encrypt, decrypt, maskKey } from '../../crypto/aesGcm.js';
import { MODEL_PRICING, getTextModel, getVisionModel, getSttModel } from '../../config/model-pricing.js';
import { loadTenantContext } from '../../services/tenantContext.js';
import { ensureCorpus, uploadFileToCorpus, deleteFile } from '../../services/ai/rag.js';
import { connectTenant, disconnectTenant, resetTenantSession } from '../../services/whatsapp/connect.js';
import { getSession } from '../../services/whatsapp/manager.js';

export const tenantSettingsRouter = Router();
tenantSettingsRouter.use(requireAuth, tenantIsolation);

// PERSONA
tenantSettingsRouter.get('/persona', async (req, res) => {
  const t = await prisma.tenant.findUnique({ where: { id: req.tenantScope! } });
  res.json({ aiPersona: t?.aiPersona ?? '' });
});
tenantSettingsRouter.put('/persona', async (req, res) => {
  const parsed = z.object({ aiPersona: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const t = await prisma.tenant.update({
    where: { id: req.tenantScope! },
    data: { aiPersona: parsed.data.aiPersona },
  });
  res.json({ aiPersona: t.aiPersona });
});

// MODELS
tenantSettingsRouter.get('/models', async (req, res) => {
  const choices = await prisma.tenantModelChoices.findUnique({ where: { tenantId: req.tenantScope! } });
  res.json({ choices, catalog: MODEL_PRICING });
});
const modelsSchema = z.object({
  textModelId: z.string(),
  visionModelId: z.string(),
  sttModelId: z.string(),
});
tenantSettingsRouter.put('/models', async (req, res) => {
  const parsed = modelsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  if (!getTextModel(parsed.data.textModelId) || !getVisionModel(parsed.data.visionModelId) || !getSttModel(parsed.data.sttModelId)) {
    res.status(400).json({ error: 'Unknown model id' });
    return;
  }
  const updated = await prisma.tenantModelChoices.upsert({
    where: { tenantId: req.tenantScope! },
    create: { tenantId: req.tenantScope!, ...parsed.data },
    update: parsed.data,
  });
  res.json(updated);
});

// KEYS
const fields = ['openaiKey', 'geminiKey', 'xaiKey', 'elevenlabsKey', 'sonioxKey'] as const;
type FieldName = (typeof fields)[number];
const keysSchema = z.object({
  openaiKey: z.string().nullable().optional(),
  geminiKey: z.string().nullable().optional(),
  xaiKey: z.string().nullable().optional(),
  elevenlabsKey: z.string().nullable().optional(),
  sonioxKey: z.string().nullable().optional(),
});

async function maskedKeys(tenantId: string) {
  const k = await prisma.tenantApiKeys.findUnique({ where: { tenantId } });
  if (!k) return null;
  const out: Record<string, string | null> = {};
  for (const f of fields) {
    const enc = (k as unknown as Record<string, string | null>)[f];
    if (!enc) {
      out[f] = null;
      continue;
    }
    try {
      out[f] = maskKey(decrypt(enc));
    } catch {
      out[f] = '••••';
    }
  }
  return { ...out, geminiCorpusId: k.geminiCorpusId };
}

tenantSettingsRouter.get('/keys', async (req, res) => {
  const view = await maskedKeys(req.tenantScope!);
  res.json(view ?? {});
});
tenantSettingsRouter.put('/keys', async (req, res) => {
  const parsed = keysSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const data: Record<string, string | null> = {};
  const audit: Array<{ field: string; action: string }> = [];
  for (const f of fields) {
    const v = parsed.data[f];
    if (v === undefined) continue;
    if (v === null || v === '') {
      data[f] = null;
      audit.push({ field: f, action: 'cleared' });
    } else {
      data[f] = encrypt(v);
      audit.push({ field: f, action: 'set' });
    }
  }
  await prisma.tenantApiKeys.upsert({
    where: { tenantId: req.tenantScope! },
    create: { tenantId: req.tenantScope!, ...data },
    update: { ...data, updatedById: req.user!.userId },
  });
  for (const a of audit) {
    await prisma.apiKeyAuditLog.create({
      data: {
        tenantId: req.tenantScope!,
        userId: req.user!.userId,
        field: a.field,
        action: a.action,
      },
    });
  }
  res.json(await maskedKeys(req.tenantScope!));
});
tenantSettingsRouter.post('/keys/reveal/:field', async (req, res) => {
  const field = req.params.field as FieldName;
  if (!fields.includes(field)) {
    res.status(400).json({ error: 'Unknown field' });
    return;
  }
  const k = await prisma.tenantApiKeys.findUnique({ where: { tenantId: req.tenantScope! } });
  const enc = (k as unknown as Record<string, string | null> | null)?.[field];
  if (!enc) {
    res.json({ value: null });
    return;
  }
  try {
    const value = decrypt(enc);
    await prisma.apiKeyAuditLog.create({
      data: { tenantId: req.tenantScope!, userId: req.user!.userId, field, action: 'revealed' },
    });
    res.json({ value });
  } catch {
    res.status(500).json({ error: 'Decryption failed' });
  }
});

// KNOWLEDGE BASE
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
tenantSettingsRouter.get('/knowledge', async (req, res) => {
  const files = await prisma.knowledgeFile.findMany({
    where: { tenantId: req.tenantScope! },
    orderBy: { createdAt: 'desc' },
  });
  res.json(files);
});
tenantSettingsRouter.post('/knowledge', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file' });
    return;
  }
  const tenant = await loadTenantContext(req.tenantScope!);
  if (!tenant?.apiKeys.gemini) {
    res.status(400).json({ error: 'Gemini key required' });
    return;
  }
  let corpus = tenant.apiKeys.geminiCorpusId;
  if (!corpus) {
    corpus = await ensureCorpus(tenant);
    await prisma.tenantApiKeys.update({
      where: { tenantId: tenant.id },
      data: { geminiCorpusId: corpus },
    });
  }
  let result;
  try {
    result = await uploadFileToCorpus(tenant, corpus, req.file.originalname, req.file.buffer, req.file.mimetype);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }
  const saved = await prisma.knowledgeFile.create({
    data: {
      tenantId: tenant.id,
      filename: req.file.originalname,
      fileSizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      geminiFileId: result.fileId,
      geminiCorpusId: corpus,
      indexingState: 'PENDING',
      uploadedById: req.user!.userId,
    },
  });
  res.status(201).json(saved);
});
tenantSettingsRouter.delete('/knowledge/:fileId', async (req, res) => {
  const file = await prisma.knowledgeFile.findUnique({ where: { id: req.params.fileId } });
  if (!file || file.tenantId !== req.tenantScope!) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (file.geminiFileId) {
    const tenant = await loadTenantContext(req.tenantScope!);
    if (tenant) await deleteFile(tenant, file.geminiFileId).catch(() => undefined);
  }
  await prisma.knowledgeFile.delete({ where: { id: file.id } });
  res.json({ ok: true });
});

// USAGE
tenantSettingsRouter.get('/usage', async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const grouped = await prisma.aiUsageLog.groupBy({
    by: ['category', 'modelId'],
    where: { tenantId: req.tenantScope!, createdAt: { gte: since } },
    _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true, durationSeconds: true },
    _count: { _all: true },
  });
  const daily = await prisma.$queryRaw<Array<{ day: Date; cost: number }>>`
    SELECT DATE_TRUNC('day', "createdAt") as day, SUM("estimatedCostUsd")::float as cost
    FROM "AiUsageLog"
    WHERE "tenantId" = ${req.tenantScope!} AND "createdAt" >= ${since}
    GROUP BY day ORDER BY day ASC
  `.catch(() => []);
  res.json({ grouped, daily });
});

// WHATSAPP STATUS
tenantSettingsRouter.get('/whatsapp/status', async (req, res) => {
  const live = getSession(req.tenantScope!);
  const persisted = await prisma.whatsappSession.findUnique({ where: { tenantId: req.tenantScope! } });
  res.json({
    status: live?.status ?? persisted?.status ?? 'disconnected',
    qr: live?.lastQr ?? null,
    phoneNumber: persisted?.phoneNumber ?? null,
    lastConnectedAt: persisted?.lastConnectedAt ?? null,
  });
});
tenantSettingsRouter.post('/whatsapp/reconnect', async (req, res) => {
  // Wipe stored creds so Baileys generates a fresh QR instead of trying to resume an invalidated session
  await resetTenantSession(req.tenantScope!).catch(() => undefined);
  await connectTenant(req.tenantScope!);
  res.json({ ok: true });
});
