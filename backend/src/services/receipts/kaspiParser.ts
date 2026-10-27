export interface KaspiReceipt {
  receiptId: string;
  amount: number;
  sellerIin: string;
  clientIin: string | null;
  paymentMethod: string | null;
  datetime: string | null;
}

const FETCH_TIMEOUT_MS = 10_000;

/** The QR comes from an untrusted file, so only fetch real https Kaspi hosts (not `evil.com/kaspi.kz`). */
export function isKaspiUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (url.hostname === 'kaspi.kz' || url.hostname.endsWith('.kaspi.kz'));
  } catch {
    return false;
  }
}

export function extractNuxtJson(html: string): unknown[] {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Could not find __NUXT_DATA__ script tag');
  const parsed: unknown = JSON.parse(match[1]!);
  if (!Array.isArray(parsed)) throw new Error('__NUXT_DATA__ is not an array');
  return parsed;
}

/** Nuxt dedupes payload values: a field may be the value itself or an integer index into the array. */
function resolve(nuxt: unknown[], val: unknown): unknown {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < nuxt.length) return nuxt[val];
  return val;
}

function findDataObject(nuxt: unknown[]): Record<string, unknown> {
  for (const item of nuxt) {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'amount' in item && 'extTranId' in item) {
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(item)) resolved[key] = resolve(nuxt, val);
      return resolved;
    }
  }
  throw new Error('Could not find receipt data object in __NUXT_DATA__');
}

/** Look up a `payParameters` entry by a substring of its (Russian) label. */
function findFieldValue(nuxt: unknown[], data: Record<string, unknown>, label: string): string | null {
  const params = resolve(nuxt, data.payParameters);
  if (!Array.isArray(params)) return null;
  for (const ref of params) {
    const entry = resolve(nuxt, ref);
    if (!entry || typeof entry !== 'object') continue;
    const { name, value } = entry as { name?: unknown; value?: unknown };
    const resolvedName = resolve(nuxt, name);
    if (typeof resolvedName === 'string' && resolvedName.includes(label)) {
      const resolvedValue = resolve(nuxt, value);
      return typeof resolvedValue === 'string' ? resolvedValue : null;
    }
  }
  return null;
}

export function parseNuxtData(nuxt: unknown[]): KaspiReceipt {
  const data = findDataObject(nuxt);
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Could not find amount in receipt data');
  if (typeof data.extTranId !== 'string' || !data.extTranId) {
    throw new Error('Could not find receipt ID (extTranId)');
  }
  return {
    receiptId: data.extTranId,
    amount,
    sellerIin: findFieldValue(nuxt, data, 'ИИН/БИН продавца') ?? '',
    clientIin: typeof data.client_iin === 'string' ? data.client_iin : null,
    paymentMethod: findFieldValue(nuxt, data, 'Оплачено'),
    datetime: findFieldValue(nuxt, data, 'Дата и время') ?? (typeof data.saleDate === 'string' ? data.saleDate : null),
  };
}

export async function fetchKaspiReceipt(qrUrl: string): Promise<KaspiReceipt> {
  if (!isKaspiUrl(qrUrl)) throw new Error('Not a Kaspi receipt url');
  const res = await fetch(qrUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!isKaspiUrl(res.url)) throw new Error('Kaspi receipt redirected outside kaspi.kz');
  if (!res.ok) throw new Error(`Kaspi receipt fetch failed: ${res.status}`);
  return parseNuxtData(extractNuxtJson(await res.text()));
}
