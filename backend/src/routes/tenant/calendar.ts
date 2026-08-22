import { Router } from 'express';
import { prisma } from '../../prisma.js';
import { requireAuth, tenantIsolation } from '../../auth/middleware.js';
import { encrypt } from '../../crypto/aesGcm.js';
import { buildConsentUrl, verifyCalendarState, exchangeCodeForTokens } from '../../services/calendar/googleOAuth.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';

export const tenantCalendarRouter = Router();

// Public: Google redirects the browser here with no Authorization header, so this
// route must sit before the requireAuth middleware below. Tenant identity comes
// from the signed `state` param instead of the JWT.
tenantCalendarRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error || !code || !state) {
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=denied`);
    return;
  }
  let tenantId: string;
  try {
    tenantId = verifyCalendarState(state);
  } catch {
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=invalid_state`);
    return;
  }
  try {
    const { refreshToken, googleEmail } = await exchangeCodeForTokens(code);
    await prisma.tenantGoogleCalendar.upsert({
      where: { tenantId },
      create: { tenantId, encryptedRefreshToken: encrypt(refreshToken), googleEmail, status: 'connected' },
      update: {
        encryptedRefreshToken: encrypt(refreshToken),
        googleEmail,
        status: 'connected',
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    });
    res.redirect(`${env.APP_URL}/app/calendar?calendar_connected=1`);
  } catch (err) {
    logger.error({ err, tenantId }, '[calendar] OAuth callback failed');
    res.redirect(`${env.APP_URL}/app/calendar?calendar_error=exchange_failed`);
  }
});

tenantCalendarRouter.use(requireAuth, tenantIsolation);

tenantCalendarRouter.get('/status', async (req, res) => {
  const record = await prisma.tenantGoogleCalendar.findUnique({ where: { tenantId: req.tenantScope! } });
  res.json({
    connected: record?.status === 'connected',
    status: record?.status ?? 'disconnected',
    googleEmail: record?.googleEmail ?? null,
    connectedAt: record?.connectedAt ?? null,
    lastErrorMessage: record?.lastErrorMessage ?? null,
  });
});

tenantCalendarRouter.get('/connect-url', async (req, res) => {
  res.json({ url: buildConsentUrl(req.tenantScope!) });
});

tenantCalendarRouter.post('/disconnect', async (req, res) => {
  await prisma.tenantGoogleCalendar.deleteMany({ where: { tenantId: req.tenantScope! } });
  res.json({ ok: true });
});

tenantCalendarRouter.get('/appointments', async (req, res) => {
  const appointments = await prisma.appointment.findMany({
    where: { tenantId: req.tenantScope! },
    orderBy: { startAt: 'desc' },
    take: 50,
  });
  res.json(appointments);
});
