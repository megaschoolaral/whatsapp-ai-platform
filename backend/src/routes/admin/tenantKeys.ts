import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { encrypt, decrypt, maskKey } from '../../crypto/aesGcm.js';
import { ensureCorpus } from '../../services/ai/rag.js';
import { loadTenantContext } from '../../services/tenantContext.js';

export const adminTenantKeysRouter = Router({ mergeParams: true });
adminTenantKeysRouter.use(requireAuth, requireRole('super_admin'));

const fields = ['openaiKey', 'geminiKey', 'xaiKey', 'elevenlabsKey', 'sonioxKey'] as const;
type FieldName = (typeof fields)[number];

const putSchema = z.object({
  openaiKey: z.string().nullable().optional(),
  geminiKey: z.string().nullable().optional(),
  xaiKey: z.string().nullable().optional(),
  elevenlabsKey: z.string().nullable().optional(),
  sonioxKey: z.string().nullable().optional(),
});

async function maskedView(tenantId: string) {
  const k = await prisma.tenantApiKeys.findUnique({ where: { tenantId } });
  if (!k) return null;
  const out: Record<string, string | null> = {};
  for (const f of fields) {
    const enc = (k as unknown as Record<string, string | null>)[f];
    if (!enc) {
      out[f] = null;
    } else {
      try {
        out[f] = maskKey(decrypt(enc));
      } catch {
        out[f] = '••••';
      }
    }
  }
  return { tenantId, ...out, geminiCorpusId: k.geminiCorpusId };
}

adminTenantKeysRouter.get('/', async (req, res) => {
  const view = await maskedView((req.params as Record<string,string>).tenantId);
  if (!view) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(view);
});

adminTenantKeysRouter.put('/', async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
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
    where: { tenantId: (req.params as Record<string,string>).tenantId },
    create: { tenantId: (req.params as Record<string,string>).tenantId, ...data },
    update: { ...data, updatedById: req.user!.userId },
  });
  for (const a of audit) {
    await prisma.apiKeyAuditLog.create({
      data: {
        tenantId: (req.params as Record<string,string>).tenantId,
        userId: req.user!.userId,
        field: a.field,
        action: a.action,
      },
    });
  }
  // If Gemini key set, ensure corpus exists
  if (data.geminiKey) {
    try {
      const tenant = await loadTenantContext((req.params as Record<string,string>).tenantId);
      if (tenant) {
        const corpusName = await ensureCorpus(tenant);
        await prisma.tenantApiKeys.update({
          where: { tenantId: (req.params as Record<string,string>).tenantId },
          data: { geminiCorpusId: corpusName },
        });
      }
    } catch {
      // Best effort — corpus can be created on first KB upload
    }
  }
  const view = await maskedView((req.params as Record<string,string>).tenantId);
  res.json(view);
});

const revealLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reveal requests. Try again later.' },
});

adminTenantKeysRouter.post('/reveal/:field', revealLimiter, async (req, res) => {
  const field = (req.params as Record<string,string>).field as FieldName;
  if (!fields.includes(field)) {
    res.status(400).json({ error: 'Unknown field' });
    return;
  }
  const k = await prisma.tenantApiKeys.findUnique({ where: { tenantId: (req.params as Record<string,string>).tenantId } });
  const enc = (k as unknown as Record<string, string | null> | null)?.[field];
  if (!enc) {
    res.json({ value: null });
    return;
  }
  try {
    const value = decrypt(enc);
    await prisma.apiKeyAuditLog.create({
      data: {
        tenantId: (req.params as Record<string,string>).tenantId,
        userId: req.user!.userId,
        field,
        action: 'revealed',
      },
    });
    res.json({ value });
  } catch {
    res.status(500).json({ error: 'Decryption failed' });
  }
});
