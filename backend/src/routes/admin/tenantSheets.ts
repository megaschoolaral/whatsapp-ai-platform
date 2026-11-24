import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { getServiceAccountEmail } from '../../services/sheets/client.js';
import { invalidateSlots, readSlots } from '../../services/sheets/read.js';
import { upcomingFreeSlots } from '../../services/sheets/schedule.js';
import { getSheetsSettings, parseSpreadsheetId } from '../../services/sheets/settings.js';

export const adminTenantSheetsRouter = Router({ mergeParams: true });
adminTenantSheetsRouter.use(requireAuth, requireRole('super_admin'));

const putSchema = z.object({
  enabled: z.boolean().optional(),
  /** A sheet link or a bare id; an empty string clears it. */
  spreadsheet: z.string().optional(),
  sheetName: z.string().nullable().optional(),
  daysAhead: z.number().int().min(1).max(30).optional(),
});

const tenantIdOf = (req: Request) => (req.params as Record<string, string>).tenantId as string;

async function view(tenantId: string) {
  return { ...(await getSheetsSettings(tenantId)), serviceAccountEmail: getServiceAccountEmail() };
}

export async function getSheetsHandler(req: Request, res: Response) {
  res.json(await view(tenantIdOf(req)));
}

export async function putSheetsHandler(req: Request, res: Response) {
  const tenantId = tenantIdOf(req);
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
  const existing = await getSheetsSettings(tenantId);
  let spreadsheetId = existing.spreadsheetId;
  if (body.spreadsheet !== undefined) {
    if (body.spreadsheet.trim() === '') {
      spreadsheetId = null;
    } else {
      spreadsheetId = parseSpreadsheetId(body.spreadsheet);
      if (!spreadsheetId) {
        res.status(400).json({ error: 'Кесте сілтемесі немесе ID дұрыс емес' });
        return;
      }
    }
  }
  const sheetName = body.sheetName === undefined ? existing.sheetName : body.sheetName?.trim() || null;
  const enabled = body.enabled ?? existing.enabled;
  const daysAhead = body.daysAhead ?? existing.daysAhead;

  if (enabled) {
    if (!getServiceAccountEmail()) {
      res.status(400).json({ error: 'Платформада Google service account бапталмаған (GOOGLE_SERVICE_ACCOUNT_JSON)' });
      return;
    }
    if (!spreadsheetId || !sheetName) {
      res.status(400).json({ error: 'Қосу үшін кесте сілтемесі мен парақ атын көрсетіңіз' });
      return;
    }
  }

  const data = { enabled, spreadsheetId, sheetName, daysAhead };
  await prisma.tenantSheetsSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  await invalidateSlots(tenantId);
  res.json(await view(tenantId));
}

export async function checkSheetsHandler(req: Request, res: Response) {
  const tenantId = tenantIdOf(req);
  try {
    const [slots, settings, tenant] = await Promise.all([
      readSlots(tenantId, { fresh: true }),
      getSheetsSettings(tenantId),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
    ]);
    const free = upcomingFreeSlots(slots, new Date(), tenant?.timezone ?? 'Asia/Almaty', settings.daysAhead);
    res.json({ ok: true, freeSlots: free.length, days: new Set(free.map((s) => s.date)).size });
  } catch (err) {
    res.json({ ok: false, error: (err as Error).message.slice(0, 300) });
  }
}

adminTenantSheetsRouter.get('/', getSheetsHandler);
adminTenantSheetsRouter.put('/', putSheetsHandler);
adminTenantSheetsRouter.post('/check', checkSheetsHandler);
