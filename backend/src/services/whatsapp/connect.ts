import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { makeDbAuthState } from './sessionStore.js';
import { setSession, updateSession, getSession, removeSession } from './manager.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { handleIncomingMessage, handleOutgoingFromPhone } from './inbound.js';
import { handlePresenceUpdate } from './presence.js';

export async function connectTenant(tenantId: string): Promise<void> {
  const existing = getSession(tenantId);
  if (existing && existing.status !== 'closed') return;

  const { state, saveCreds } = await makeDbAuthState(tenantId);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as unknown as [number, number, number] }));

  const sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
    version,
  });
  setSession(tenantId, { sock, status: 'connecting', lastQr: null });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      updateSession(tenantId, { status: 'qr', lastQr: qr });
      await prisma.whatsappSession.update({ where: { tenantId }, data: { status: 'qr' } }).catch(() => undefined);
      emitToTenant(tenantId, 'whatsapp:status', { tenantId, status: 'qr', qr });
    }
    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] ?? null;
      updateSession(tenantId, { status: 'connected' });
      await prisma.whatsappSession.update({
        where: { tenantId },
        data: {
          status: 'connected',
          phoneNumber: phone,
          lastConnectedAt: new Date(),
          lastDisconnectReason: null,
        },
      });
      // Start warmup timer if first connection
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (tenant && !tenant.warmupStartedAt) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { warmupStartedAt: new Date() },
        });
      }
      emitToTenant(tenantId, 'whatsapp:status', { tenantId, status: 'connected' });
    }
    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      logger.warn({ tenantId, reason }, '[whatsapp] connection closed');
      await prisma.whatsappSession.update({
        where: { tenantId },
        data: { status: 'disconnected', lastDisconnectReason: String(reason ?? 'unknown') },
      });
      updateSession(tenantId, { status: 'closed' });
      emitToTenant(tenantId, 'whatsapp:status', { tenantId, status: 'disconnected', reason: String(reason) });

      switch (reason) {
        case DisconnectReason.loggedOut:
        case DisconnectReason.badSession:
        case DisconnectReason.multideviceMismatch:
          // Do not auto-reconnect — manual re-auth required
          removeSession(tenantId);
          return;
        case DisconnectReason.connectionReplaced: {
          // Another connection replaced ours — wait and reconnect
          removeSession(tenantId);
          const replaceDelay = 8000 + Math.floor(Math.random() * 4000);
          logger.warn({ tenantId, replaceDelay }, '[whatsapp] connection replaced, reconnecting after delay');
          setTimeout(() => {
            connectTenant(tenantId).catch((err) => logger.error({ err }, '[whatsapp] reconnect after replaced failed'));
          }, replaceDelay);
          return;
        }
        default: {
          // Reconnect with backoff
          removeSession(tenantId);
          const retryDelay = 5000 + Math.floor(Math.random() * 5000);
          setTimeout(() => {
            connectTenant(tenantId).catch((err) => logger.error({ err }, '[whatsapp] reconnect failed'));
          }, retryDelay);
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key.fromMe) {
        // Оператор телефоннан қолмен жазды → ботты тоқтат
        handleOutgoingFromPhone(tenantId, m).catch((err) =>
          logger.error({ err, tenantId }, '[whatsapp] outgoing-from-phone handler error'),
        );
        continue;
      }
      try {
        await handleIncomingMessage(tenantId, sock, m);
      } catch (err) {
        logger.error({ err, tenantId }, '[whatsapp] inbound handler error');
      }
    }
  });

  sock.ev.on('presence.update', ({ id, presences }) => {
    handlePresenceUpdate(tenantId, id, presences).catch((err) =>
      logger.error({ err }, '[whatsapp] presence handler error'),
    );
  });
}

export async function disconnectTenant(tenantId: string): Promise<void> {
  const entry = getSession(tenantId);
  if (entry) {
    try {
      await entry.sock.logout();
    } catch {
      /* ignore */
    }
    removeSession(tenantId);
  }
  await prisma.whatsappSession.update({ where: { tenantId }, data: { status: 'disconnected' } }).catch(() => undefined);
}

/**
 * Wipe stored creds + keys for a tenant — call when re-pairing fresh
 * (e.g. after a failed scan, badSession, or loggedOut). Forces a brand-new QR.
 */
export async function resetTenantSession(tenantId: string): Promise<void> {
  await disconnectTenant(tenantId);
  await prisma.whatsappSession.update({
    where: { tenantId },
    data: {
      encryptedCreds: null,
      encryptedKeys: null,
      phoneNumber: null,
      status: 'disconnected',
      lastDisconnectReason: 'reset',
    },
  });
}
