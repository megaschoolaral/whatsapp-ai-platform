import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import type { Boom } from '@hapi/boom';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { makeDbAuthState, flushAuthKeys } from './sessionStore.js';
import { setSession, updateSession, getSession, removeSession } from './manager.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { handleIncomingMessage, handleOutgoingFromPhone } from './inbound.js';
import { handlePresenceUpdate } from './presence.js';
import { upsertSavedContacts } from './savedContacts.js';

const connecting = new Set<string>();

/**
 * Open a Baileys socket for the tenant. Concurrent calls (auto-reconnect + dashboard click)
 * are collapsed: a second socket for the same tenant would kick the first with `conflict: replaced`.
 */
export async function connectTenant(tenantId: string): Promise<void> {
  if (connecting.has(tenantId)) return;
  connecting.add(tenantId);
  try {
    await connectTenantInner(tenantId);
  } finally {
    connecting.delete(tenantId);
  }
}

async function connectTenantInner(tenantId: string): Promise<void> {
  const existing = getSession(tenantId);
  if (existing && existing.status !== 'closed') return;

  // Don't (re)connect deleted or suspended tenants — also stops the reconnect-with-backoff loop for them.
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (!tenant || tenant.status === 'suspended') {
    logger.info({ tenantId, status: tenant?.status ?? 'deleted' }, '[whatsapp] not connecting: tenant missing or suspended');
    return;
  }

  const { state, saveCreds, release } = await makeDbAuthState(tenantId);
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

  const onConnectionUpdate = async (update: Partial<import('baileys').ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;
    // Ignore late events from a stale socket (e.g. after a 515 restart or re-pair):
    // otherwise its `close` would tear down the live session and spawn a duplicate
    // socket, and the two would kick each other with `conflict: replaced`.
    if (getSession(tenantId)?.sock !== sock) {
      if (connection === 'close') {
        logger.info({ tenantId }, '[whatsapp] ignoring close from stale socket');
      }
      return;
    }
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
      // Start warmup timer + auto-activate if all prerequisites are met
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { apiKeys: true },
      });
      if (tenant) {
        const updates: Record<string, unknown> = {};
        if (!tenant.warmupStartedAt) updates.warmupStartedAt = new Date();
        if (
          tenant.status === 'pending_setup' &&
          tenant.apiKeys?.geminiKey &&
          tenant.aiPersona?.trim()
        ) {
          updates.status = 'active';
          logger.info({ tenantId }, '[whatsapp] auto-activated tenant on connect');
        }
        if (Object.keys(updates).length) {
          await prisma.tenant.update({ where: { id: tenantId }, data: updates });
        }
      }
      emitToTenant(tenantId, 'whatsapp:status', { tenantId, status: 'connected' });
    }
    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      logger.warn({ tenantId, reason }, '[whatsapp] connection closed');
      await release().catch((err) => logger.error({ err, tenantId }, '[whatsapp] auth key flush failed'));
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
          // Another connection replaced ours — stop reconnecting to avoid infinite conflict loop.
          // User must manually reconnect from the dashboard.
          removeSession(tenantId);
          logger.warn({ tenantId }, '[whatsapp] connection replaced — stopping auto-reconnect, manual reconnect required');
          await prisma.whatsappSession.update({
            where: { tenantId },
            data: { status: 'disconnected', lastDisconnectReason: 'connection_replaced' },
          }).catch(() => undefined);
          emitToTenant(tenantId, 'whatsapp:status', { tenantId, status: 'disconnected', reason: 'connection_replaced' });
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
  };
  sock.ev.on('connection.update', (update) => {
    onConnectionUpdate(update).catch((err) => logger.error({ err, tenantId }, '[whatsapp] connection.update handler error'));
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

  const onContacts = (contacts: Partial<import('baileys').Contact>[]) => {
    upsertSavedContacts(tenantId, contacts).catch((err) =>
      logger.error({ err, tenantId }, '[whatsapp] failed to save contacts'),
    );
  };
  sock.ev.on('contacts.upsert', onContacts);
  sock.ev.on('contacts.update', onContacts);

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
