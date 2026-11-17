import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { TOKEN, envMock } = vi.hoisted(() => {
  const TOKEN = '123456789:AAE-secret-token-value';
  return {
    TOKEN,
    envMock: { TELEGRAM_ALERT_BOT_TOKEN: TOKEN as string | undefined, TELEGRAM_ALERT_CHAT_ID: '-1001' as string | undefined },
  };
});

vi.mock('../../env.js', () => ({ env: envMock }));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendAdminAlert } from './adminTelegram.js';

beforeEach(() => {
  envMock.TELEGRAM_ALERT_BOT_TOKEN = TOKEN;
  envMock.TELEGRAM_ALERT_CHAT_ID = '-1001';
});
afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: { ok: boolean; status?: number; json?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: async () => response.json ?? { ok: response.ok },
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('sendAdminAlert', () => {
  it('posts the text to the alert bot and reports success', async () => {
    const fetchMock = stubFetch({ ok: true });
    await expect(sendAdminAlert('hello')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: '-1001', text: 'hello' });
  });

  it('skips quietly (no request) when the alert bot is not configured', async () => {
    envMock.TELEGRAM_ALERT_BOT_TOKEN = undefined;
    const fetchMock = stubFetch({ ok: true });
    await expect(sendAdminAlert('hello')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when Telegram rejects the message', async () => {
    stubFetch({ ok: false, status: 400, json: { ok: false, description: 'chat not found' } });
    await expect(sendAdminAlert('hello')).resolves.toBe(false);
  });

  it('returns false instead of throwing on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`failed ${TOKEN}`)));
    await expect(sendAdminAlert('hello')).resolves.toBe(false);
  });
});
