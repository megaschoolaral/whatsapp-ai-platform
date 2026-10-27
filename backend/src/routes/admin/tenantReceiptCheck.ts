import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { encrypt, decrypt, maskKey } from '../../crypto/aesGcm.js';
import { validateEnable } from '../../services/receipts/validation.js';

export const adminTenantReceiptCheckRouter = Router({ mergeParams: true });
adminTenantReceiptCheckRouter.use(requireAuth, requireRole('super_admin'));

const putSchema = z.object({
  enabled: z.boolean().optional(),
  sellerIin: z.string().nullable().optional(),
  minAmount: z.number().int().min(0).nullable().optional(),
  // Empty / omitted keeps the stored token; the admin UI only ever sees it masked.
  telegramBotToken: z.string().nullable().optional(),
  telegramChatId: z.string().nullable().optional(),
});

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

async function view(tenantId: string) {
  const row = await prisma.tenantReceiptSettings.findUnique({ where: { tenantId } });
  return {
    enabled: row?.enabled ?? false,
    sellerIin: row?.sellerIin ?? null,
    minAmount: row?.minAmount ?? null,
    telegramBotToken: maskKey(safeDecrypt(row?.telegramBotTokenEnc)),
    telegramChatId: row?.telegramChatId ?? null,
  };
}

adminTenantReceiptCheckRouter.get('/', async (req, res) => {
  const tenantId = (req.params as Record<string, string>).tenantId;
  res.json(await view(tenantId));
});

adminTenantReceiptCheckRouter.put('/', async (req, res) => {
  const tenantId = (req.params as Record<string, string>).tenantId;
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const body = parsed.data;
  const existing = await prisma.tenantReceiptSettings.findUnique({ where: { tenantId } });
  const sellerIin = body.sellerIin === undefined ? (existing?.sellerIin ?? null) : body.sellerIin?.trim() || null;
  const minAmount = body.minAmount === undefined ? (existing?.minAmount ?? null) : body.minAmount;
  const telegramChatId =
    body.telegramChatId === undefined ? (existing?.telegramChatId ?? null) : body.telegramChatId?.trim() || null;
  const newToken = body.telegramBotToken?.trim() || null;
  const telegramBotToken = newToken ?? safeDecrypt(existing?.telegramBotTokenEnc);
  const enabled = body.enabled ?? existing?.enabled ?? false;

  if (enabled) {
    const problem = validateEnable({ sellerIin, telegramBotToken, telegramChatId });
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
  }

  const data = {
    enabled,
    sellerIin,
    minAmount,
    telegramChatId,
    telegramBotTokenEnc: newToken ? encrypt(newToken) : (existing?.telegramBotTokenEnc ?? null),
  };
  await prisma.tenantReceiptSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  res.json(await view(tenantId));
});
