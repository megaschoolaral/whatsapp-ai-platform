import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegramMessage } from './telegram.js';

const TOKEN = '123456789:AAE-secret-token-value';
const args = { botToken: TOKEN, chatId: '-1001', text: 'Айбек, 77071110354, 10 000 ₸ төледі' };

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

describe('sendTelegramMessage', () => {
  it('posts the text to the bot sendMessage endpoint', async () => {
    const fetchMock = stubFetch({ ok: true });
    await sendTelegramMessage(args);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: '-1001', text: args.text });
  });

  it('throws with the Telegram description when the API answers ok:false', async () => {
    stubFetch({ ok: false, status: 400, json: { ok: false, description: 'chat not found' } });
    await expect(sendTelegramMessage(args)).rejects.toThrow(/chat not found/);
  });

  it('never leaks the token in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`request to .../bot${TOKEN}/sendMessage failed`)));
    const err = await sendTelegramMessage(args).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it('reports the underlying network cause of a failed fetch', async () => {
    const cause = Object.assign(new Error(`getaddrinfo ENOTFOUND api.telegram.org ${TOKEN}`), { code: 'ENOTFOUND' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })));
    const err = (await sendTelegramMessage(args).catch((e: Error) => e)) as Error;
    expect(err.message).toContain('ENOTFOUND');
    expect(err.message).not.toContain(TOKEN);
  });
});
