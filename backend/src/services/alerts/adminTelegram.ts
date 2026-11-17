import { env } from '../../env.js';
import { logger } from '../../logger.js';

const TIMEOUT_MS = 10_000;

/**
 * Sends a text to the platform admin's Telegram chat (TELEGRAM_ALERT_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID).
 * This is the operator's own alert bot, separate from the per-tenant receipt bots.
 * Never throws: an alert failure must not break the WhatsApp connection handler.
 * Returns `false` when alerts are not configured or the send failed.
 */
export async function sendAdminAlert(text: string): Promise<boolean> {
  const botToken = env.TELEGRAM_ALERT_BOT_TOKEN;
  const chatId = env.TELEGRAM_ALERT_CHAT_ID;
  if (!botToken || !chatId) {
    logger.warn('[alerts] TELEGRAM_ALERT_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID not set — alert skipped');
    return false;
  }
  const redact = (message: string) => message.split(botToken).join('<token>');
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!res.ok || body.ok === false) {
      logger.error({ status: res.status, description: body.description }, '[alerts] Telegram rejected the alert');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err: redact(err instanceof Error ? err.message : String(err)) }, '[alerts] Telegram alert failed');
    return false;
  }
}
