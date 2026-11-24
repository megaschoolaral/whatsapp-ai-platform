import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  readAndClearBuffer: vi.fn(),
  generateReply: vi.fn(),
  sendHumanLikeText: vi.fn(),
  sendQueuedPhotos: vi.fn(),
  setStatus: vi.fn(),
  scheduleFollowups: vi.fn(),
}));

vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../../prisma.js', () => ({
  prisma: { conversation: { findFirst: async () => ({ id: 'c1', status: 'ai_active' }) } },
}));
vi.mock('../../redis.js', () => ({ redis: { set: async () => 'OK', del: async () => 1 } }));
vi.mock('./buffer.js', () => ({ readAndClearBuffer: mocks.readAndClearBuffer, scheduleFlush: vi.fn() }));
vi.mock('../tenantContext.js', () => ({ loadTenantContext: async () => ({ id: 't1', status: 'active' }) }));
vi.mock('../ai/generate.js', () => ({ generateReply: mocks.generateReply }));
vi.mock('../conversations/store.js', () => ({
  getConversationHistory: async () => [],
  appendMessage: async () => ({}),
}));
vi.mock('../conversations/stateMachine.js', () => ({ setStatus: mocks.setStatus }));
vi.mock('../conversations/handoff.js', () => ({ shouldHandoff: () => ({ handoff: false }) }));
vi.mock('../whatsapp/outbound.js', () => ({ sendHumanLikeText: mocks.sendHumanLikeText }));
vi.mock('../whatsapp/manager.js', () => ({ getSession: () => ({ status: 'connected', sock: {} }) }));
vi.mock('../realtime/socketRooms.js', () => ({ emitToTenant: vi.fn() }));
vi.mock('../followup/scheduler.js', () => ({ scheduleFollowups: mocks.scheduleFollowups }));
vi.mock('../photos/send.js', () => ({ sendQueuedPhotos: mocks.sendQueuedPhotos }));

import { flushBuffer } from './flush.js';

const reply = (over: object = {}) => ({
  text: 'Отправляю', inputTokens: 1, outputTokens: 1, ragUsed: false, photoCategories: [], photoBlocked: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.readAndClearBuffer.mockResolvedValue({
    messages: [{ text: 'есть фото?', messageId: 'm1', ts: 1 }],
    conversationId: 'c1',
  });
  mocks.sendHumanLikeText.mockImplementation(async () => (mocks.order.push('text'), { sent: true }));
  mocks.sendQueuedPhotos.mockImplementation(async () => (mocks.order.push('photos'), { ok: true }));
  mocks.setStatus.mockImplementation(async () => void mocks.order.push('status'));
  mocks.scheduleFollowups.mockImplementation(async () => void mocks.order.push('followups'));
});

describe('flushBuffer photos', () => {
  it('sends the text first, then the queued photos, then schedules follow-ups', async () => {
    mocks.generateReply.mockResolvedValue(reply({ photoCategories: ['room_4'] }));
    await flushBuffer('t1', 'j@lid');
    expect(mocks.order).toEqual(['text', 'photos', 'followups']);
    expect(mocks.sendQueuedPhotos.mock.calls[0][0]).toMatchObject({ conversationId: 'c1', categories: ['room_4'] });
  });

  it('hands the chat to a human and skips follow-ups when sending photos fails, keeping the text', async () => {
    mocks.generateReply.mockResolvedValue(reply({ photoCategories: ['room_4'] }));
    mocks.sendQueuedPhotos.mockResolvedValue({ ok: false, reason: 'hourly_hard_limit' });
    await flushBuffer('t1', 'j@lid');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledOnce();
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'hourly_hard_limit' });
    expect(mocks.scheduleFollowups).not.toHaveBeenCalled();
  });

  it('hands the chat to a human after the text when the photo request was blocked by the send limits', async () => {
    mocks.generateReply.mockResolvedValue(reply({ photoBlocked: true }));
    await flushBuffer('t1', 'j@lid');
    expect(mocks.order).toEqual(['text', 'status']);
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'photo_capacity' });
    expect(mocks.sendQueuedPhotos).not.toHaveBeenCalled();
  });

  it('hands the chat to a human after the text when Google Sheets could not be read or written', async () => {
    mocks.generateReply.mockResolvedValue(reply({ sheetsFailed: true }));
    await flushBuffer('t1', 'j@lid');
    expect(mocks.order).toEqual(['text', 'status']);
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'sheets_error' });
    expect(mocks.scheduleFollowups).not.toHaveBeenCalled();
  });

  it('behaves as before when no photos are involved', async () => {
    mocks.generateReply.mockResolvedValue(reply());
    await flushBuffer('t1', 'j@lid');
    expect(mocks.order).toEqual(['text', 'followups']);
    expect(mocks.sendQueuedPhotos).not.toHaveBeenCalled();
  });
});
