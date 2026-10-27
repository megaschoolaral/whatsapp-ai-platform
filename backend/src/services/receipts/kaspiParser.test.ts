import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractNuxtJson, fetchKaspiReceipt, isKaspiUrl, parseNuxtData } from './kaspiParser.js';

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/nuxt-data.json', import.meta.url), 'utf8'),
) as unknown[];

describe('isKaspiUrl', () => {
  it('accepts https kaspi.kz hosts and subdomains', () => {
    expect(isKaspiUrl('https://pay.kaspi.kz/receipt/1')).toBe(true);
    expect(isKaspiUrl('https://kaspi.kz/x')).toBe(true);
  });
  it('rejects lookalike hosts, paths and plain http', () => {
    expect(isKaspiUrl('https://evil.com/kaspi.kz')).toBe(false);
    expect(isKaspiUrl('https://kaspi.kz.evil.com/x')).toBe(false);
    expect(isKaspiUrl('https://notkaspi.kz/x')).toBe(false);
    expect(isKaspiUrl('http://kaspi.kz/x')).toBe(false);
    expect(isKaspiUrl('not a url')).toBe(false);
  });
});

describe('parseNuxtData', () => {
  it('resolves index references into receipt fields', () => {
    expect(parseNuxtData(fixture)).toEqual({
      receiptId: 'QR12992816084',
      amount: 10000,
      sellerIin: '880511301234',
      clientIin: '990101300123',
      paymentMethod: 'Kaspi Gold',
      datetime: '27.10.2026 10:15',
    });
  });
  it('throws when no object has both amount and extTranId', () => {
    expect(() => parseNuxtData([{ amount: 1 }, 5])).toThrow(/receipt data/i);
  });
  it('throws when the amount is not a positive number', () => {
    expect(() => parseNuxtData([{ amount: 1, extTranId: 2 }, 'abc', 'QR1'])).toThrow(/amount/i);
  });
});

describe('extractNuxtJson', () => {
  it('pulls the JSON array out of the __NUXT_DATA__ script tag', () => {
    const html = `<html><script type="application/json" id="__NUXT_DATA__">[1,"a"]</script></html>`;
    expect(extractNuxtJson(html)).toEqual([1, 'a']);
  });
  it('throws when the tag is missing', () => {
    expect(() => extractNuxtJson('<html></html>')).toThrow(/__NUXT_DATA__/);
  });
});

describe('fetchKaspiReceipt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('never makes a request for a non-Kaspi url', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchKaspiReceipt('https://evil.com/kaspi.kz')).rejects.toThrow(/kaspi/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a redirect that leaves kaspi.kz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, url: 'https://evil.com/', text: async () => '' }),
    );
    await expect(fetchKaspiReceipt('https://pay.kaspi.kz/r/1')).rejects.toThrow(/kaspi/i);
  });

  it('parses a receipt page', async () => {
    const html = `<script id="__NUXT_DATA__">${JSON.stringify(fixture)}</script>`;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, url: 'https://pay.kaspi.kz/r/1', text: async () => html }),
    );
    const receipt = await fetchKaspiReceipt('https://pay.kaspi.kz/r/1');
    expect(receipt.receiptId).toBe('QR12992816084');
  });
});
