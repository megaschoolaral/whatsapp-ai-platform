import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../../prisma.js', () => ({ prisma: { message: { findMany: mocks.findMany } } }));

import { getConversationHistory } from './store.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([{ id: 'b' }, { id: 'a' }]);
});

describe('getConversationHistory', () => {
  it('returns the latest messages oldest-first', async () => {
    expect((await getConversationHistory('c1', 5)).map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    expect(mocks.findMany.mock.calls[0]![0]).toMatchObject({ where: { conversationId: 'c1' }, take: 5 });
  });

  it('ignores messages from before the reset moment', async () => {
    const since = new Date('2026-11-27T10:00:00Z');
    await getConversationHistory('c1', 5, since);
    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({ conversationId: 'c1', createdAt: { gt: since } });
  });

  it('reads everything when there was no reset', async () => {
    await getConversationHistory('c1', 5, null);
    expect(mocks.findMany.mock.calls[0]![0].where).toEqual({ conversationId: 'c1' });
  });
});
