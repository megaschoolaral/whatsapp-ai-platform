import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  settings: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock('./client.js', () => ({ getSheetsClient: () => ({ spreadsheets: { values: { get: mocks.get } } }) }));
vi.mock('./settings.js', () => ({ getSheetsSettings: mocks.settings }));
vi.mock('../../redis.js', () => ({
  redis: {
    get: async (k: string) => mocks.store.get(k) ?? null,
    set: async (k: string, v: string) => void mocks.store.set(k, v),
    del: async (k: string) => void mocks.store.delete(k),
  },
}));

import { invalidateSlots, readSlots } from './read.js';

const rows = (name: string) => ({ data: { values: [['пн 02,11'], ['10:00', name, name ? '1' : '']] } });

beforeEach(() => {
  mocks.store.clear();
  mocks.get.mockReset();
  mocks.settings.mockReset();
  mocks.settings.mockResolvedValue({ enabled: true, spreadsheetId: 'sheet-id', sheetName: 'Ноябрь', daysAhead: 7 });
});

describe('readSlots', () => {
  it('reads the whole tab A:H and serves a second call from the cache', async () => {
    mocks.get.mockResolvedValue(rows(''));
    await readSlots('t1');
    const slots = await readSlots('t1');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(
      expect.objectContaining({ spreadsheetId: 'sheet-id', range: 'Ноябрь!A:H', valueRenderOption: 'FORMATTED_VALUE' }),
    );
    expect(slots[0]).toMatchObject({ time: '10:00', free: true });
  });

  it('fresh bypasses the cache', async () => {
    mocks.get.mockResolvedValue(rows(''));
    await readSlots('t1');
    await readSlots('t1', { fresh: true });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('reads again after invalidateSlots', async () => {
    mocks.get.mockResolvedValue(rows(''));
    await readSlots('t1');
    await invalidateSlots('t1');
    await readSlots('t1');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('never serves one tenant the cache of another', async () => {
    mocks.get.mockResolvedValueOnce(rows('')).mockResolvedValueOnce(rows('Асель'));
    const a = await readSlots('tenant-a');
    const b = await readSlots('tenant-b');
    expect(a[0]?.free).toBe(true);
    expect(b[0]?.free).toBe(false);
  });

  it('throws when the sheet is not configured', async () => {
    mocks.settings.mockResolvedValue({ enabled: true, spreadsheetId: null, sheetName: null, daysAhead: 7 });
    await expect(readSlots('t1')).rejects.toThrow();
  });
});
