import { DisconnectReason } from 'baileys';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { sendAdminAlert } from './adminTelegram.js';

/** Transient drops reconnect on their own; only alert if the tenant is still offline after this long. */
export const SOFT_ALERT_DELAY_MS = 3 * 60 * 1000;
/** A deliberate disconnect (dashboard "disconnect"/"reset") must not page the operator. */
const INTENTIONAL_TTL_MS = 60 * 1000;

/** Reasons where the bot does NOT reconnect by itself: a human has to scan the QR again. */
const HARD_REASONS = new Set<number>([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.connectionReplaced,
]);

const pending = new Map<string, NodeJS.Timeout>();
const intentional = new Map<string, NodeJS.Timeout>();

/**
 * "Outage already reported" marker. It lives in Redis (not memory) so a deploy or restart in the
 * middle of an outage does not report it again: one alert per outage, cleared on reconnect.
 */
const alertedKey = (tenantId: string) => `alerts:wa-disconnected:${tenantId}`;

/** Atomically marks the outage as reported; `false` if it already was. */
async function claimOutage(tenantId: string): Promise<boolean> {
  return (await redis.set(alertedKey(tenantId), '1', 'NX')) === 'OK';
}

export function isHardReason(reason: number | undefined): boolean {
  return reason !== undefined && HARD_REASONS.has(reason);
}

export function describeReason(reason: number | undefined): string {
  switch (reason) {
    case DisconnectReason.loggedOut:
      return 'устройство отвязано в WhatsApp (loggedOut, 401)';
    case DisconnectReason.badSession:
      return 'сессия повреждена (badSession, 500)';
    case DisconnectReason.multideviceMismatch:
      return 'несовместимость multi-device (411)';
    case DisconnectReason.connectionReplaced:
      return 'WhatsApp открыт в другом месте (connectionReplaced, 440)';
    case undefined:
      return 'причина неизвестна';
    default:
      return `обрыв связи (код ${reason})`;
  }
}

/** Call right before a deliberate logout/reset so the resulting `close` event stays silent. */
export function markIntentionalDisconnect(tenantId: string): void {
  clearTimeout(intentional.get(tenantId));
  const t = setTimeout(() => intentional.delete(tenantId), INTENTIONAL_TTL_MS);
  t.unref?.();
  intentional.set(tenantId, t);
}

async function loadTenant(tenantId: string) {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, status: true, whatsappSession: { select: { phoneNumber: true, status: true } } },
  });
}

async function sendDisconnectAlert(tenantId: string, reason: number | undefined, hard: boolean): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant || tenant.status !== 'active') return;
  if (tenant.whatsappSession?.status === 'connected') return; // came back while we waited
  if (!(await claimOutage(tenantId))) return; // this outage was already reported
  const phone = tenant.whatsappSession?.phoneNumber ? ` (${tenant.whatsappSession.phoneNumber})` : '';
  const action = hard
    ? 'Бот сам не переподключится — нужно заново отсканировать QR в кабинете тенанта.'
    : 'Бот пытается переподключиться, но за 3 минуты связь не вернулась.';
  const sent = await sendAdminAlert(
    `⚠️ WhatsApp отключён\nТенант: ${tenant.name}${phone}\nПричина: ${describeReason(reason)}\n${action}`,
  );
  // A failed send must not use up the one alert: release the marker so the next drop can retry.
  if (!sent) await redis.del(alertedKey(tenantId)).catch(() => undefined);
}

/**
 * Entry point from the Baileys `connection === 'close'` handler. Never throws.
 * `recovering`: the bot is already retrying on its own (e.g. a 500 within the retry budget),
 * so even a normally "hard" reason is treated as soft and only alerts if the outage persists.
 */
export function notifyDisconnected(tenantId: string, reason: number | undefined, recovering = false): void {
  if (intentional.has(tenantId)) return;
  clearTimeout(pending.get(tenantId));
  pending.delete(tenantId);

  const hard = !recovering && isHardReason(reason);
  const run = () => {
    pending.delete(tenantId);
    sendDisconnectAlert(tenantId, reason, hard).catch((err) =>
      logger.error({ err, tenantId }, '[alerts] disconnect alert failed'),
    );
  };
  if (hard) {
    run();
    return;
  }
  const t = setTimeout(run, SOFT_ALERT_DELAY_MS);
  t.unref?.();
  pending.set(tenantId, t);
}

/** Entry point from the Baileys `connection === 'open'` handler. Never throws. */
export function notifyConnected(tenantId: string): void {
  clearTimeout(pending.get(tenantId));
  pending.delete(tenantId);
  clearTimeout(intentional.get(tenantId));
  intentional.delete(tenantId);

  redis
    .del(alertedKey(tenantId))
    .then(async (removed) => {
      if (removed === 0) return; // we never reported an outage, so nothing to retract
      const tenant = await loadTenant(tenantId);
      if (!tenant) return;
      await sendAdminAlert(`✅ WhatsApp снова подключён\nТенант: ${tenant.name}`);
    })
    .catch((err) => logger.error({ err, tenantId }, '[alerts] reconnect alert failed'));
}

/** Test helper: drops in-memory timers (the Redis marker is the test's own fake). */
export function _resetAlertState(): void {
  for (const t of pending.values()) clearTimeout(t);
  for (const t of intentional.values()) clearTimeout(t);
  pending.clear();
  intentional.clear();
}
