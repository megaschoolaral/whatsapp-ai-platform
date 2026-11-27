import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), update: vi.fn(), dropBuffer: vi.fn() }));
vi.mock('../../prisma.js', () => ({ prisma: { conversation: { findFirst: mocks.findFirst, update: mocks.update } } }));
vi.mock('../../auth/middleware.js', () => ({ requireAuth: vi.fn(), tenantIsolation: vi.fn() }));
vi.mock('../../services/inboundBuffer/buffer.js', () => ({ dropBuffer: mocks.dropBuffer }));
vi.mock('../../services/whatsapp/outbound.js', () => ({}));
vi.mock('../../services/whatsapp/manager.js', () => ({}));
vi.mock('../../services/conversations/stateMachine.js', () => ({}));
vi.mock('../../services/conversations/store.js', () => ({}));
vi.mock('../../services/realtime/socketRooms.js', () => ({}));
vi.mock('../../services/followup/scheduler.js', () => ({}));

import { resetContextHandler } from './inbox.js';

const res = () => {
  const r = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return r as unknown as Response & typeof r;
};
const req = (tenantScope: string) => ({ tenantScope, params: { id: 'c1' } }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
});

describe('resetContextHandler', () => {
  it('marks the moment of the reset on this tenant\'s chat and drops the pending AI buffer', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'c1', contactIdentifier: 'j@lid' });
    const r = res();
    await resetContextHandler(req('t1'), r);
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', tenantId: 't1' } });
    expect(mocks.update.mock.calls[0]![0].where).toEqual({ id: 'c1' });
    expect(mocks.update.mock.calls[0]![0].data.contextResetAt).toBeInstanceOf(Date);
    expect(mocks.dropBuffer).toHaveBeenCalledWith('t1', 'j@lid');
    expect(r.json).toHaveBeenCalledWith({ ok: true, contextResetAt: expect.any(String) });
  });

  it('answers 404 and changes nothing for a chat of another tenant', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const r = res();
    await resetContextHandler(req('t2'), r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
