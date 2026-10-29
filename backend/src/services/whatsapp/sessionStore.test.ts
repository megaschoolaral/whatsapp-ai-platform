import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), update: vi.fn() }));

vi.mock('../../prisma.js', () => ({ prisma: { whatsappSession: { upsert: mocks.upsert, update: mocks.update } } }));
vi.mock('../../crypto/aesGcm.js', () => ({ encrypt: (s: string) => s, decrypt: (s: string) => s }));
vi.mock('../../logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { getAuthKeyCounts, makeDbAuthState } from './sessionStore.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsert.mockResolvedValue({ encryptedCreds: null, encryptedKeys: null });
  mocks.update.mockResolvedValue({});
});

describe('makeDbAuthState release', () => {
  it('counts keys while the state is live and forgets the tenant once released', async () => {
    const { state, release } = await makeDbAuthState('t1');
    await state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } });
    expect(getAuthKeyCounts()).toEqual({ t1: 1 });
    await release();
    expect(getAuthKeyCounts()).toEqual({});
  });

  it('flushes pending keys when released', async () => {
    const { state, release } = await makeDbAuthState('t2');
    await state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } });
    await release();
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it('does not drop a newer state for the same tenant when an older one is released', async () => {
    const first = await makeDbAuthState('t3');
    const second = await makeDbAuthState('t3');
    await second.state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } });
    await first.release();
    expect(getAuthKeyCounts()).toEqual({ t3: 1 });
    await second.release();
    expect(getAuthKeyCounts()).toEqual({});
  });
});
