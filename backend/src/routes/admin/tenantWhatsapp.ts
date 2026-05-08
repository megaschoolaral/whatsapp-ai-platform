import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { connectTenant, disconnectTenant, resetTenantSession } from '../../services/whatsapp/connect.js';
import { getSession } from '../../services/whatsapp/manager.js';

export const adminTenantWhatsappRouter = Router({ mergeParams: true });
adminTenantWhatsappRouter.use(requireAuth, requireRole('super_admin'));

adminTenantWhatsappRouter.post('/init', async (req, res) => {
  const tenantId = (req.params as Record<string,string>).tenantId;
  await connectTenant(tenantId);
  res.json({ ok: true });
});

adminTenantWhatsappRouter.get('/status', async (req, res) => {
  const tenantId = (req.params as Record<string,string>).tenantId;
  const live = getSession(tenantId);
  const persisted = await prisma.whatsappSession.findUnique({ where: { tenantId } });
  res.json({
    status: live?.status ?? persisted?.status ?? 'disconnected',
    qr: live?.lastQr ?? null,
    phoneNumber: persisted?.phoneNumber ?? null,
    lastConnectedAt: persisted?.lastConnectedAt ?? null,
    lastDisconnectReason: persisted?.lastDisconnectReason ?? null,
  });
});

adminTenantWhatsappRouter.post('/refresh-qr', async (req, res) => {
  const tenantId = (req.params as Record<string,string>).tenantId;
  // Wipe any partial/broken creds from prior attempts so we start clean.
  await resetTenantSession(tenantId).catch(() => undefined);
  await connectTenant(tenantId);
  res.json({ ok: true });
});

adminTenantWhatsappRouter.post('/disconnect', async (req, res) => {
  await disconnectTenant((req.params as Record<string,string>).tenantId);
  res.json({ ok: true });
});
