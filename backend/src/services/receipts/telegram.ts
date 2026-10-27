const TIMEOUT_MS = 10_000;

/** Plain Telegram Bot API call; errors never carry the bot token (it sits in the URL). */
export async function sendTelegramMessage(a: { botToken: string; chatId: string; text: string }): Promise<void> {
  const redact = (message: string) => message.split(a.botToken).join('<token>');
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${a.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: a.chatId, text: a.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`Telegram request failed: ${redact(err instanceof Error ? err.message : String(err))}`);
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || body.ok === false) {
    throw new Error(`Telegram error ${res.status}: ${redact(body.description ?? 'unknown')}`);
  }
}
