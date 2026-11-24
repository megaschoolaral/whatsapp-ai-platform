import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  findTenant: vi.fn(),
  upsert: vi.fn(),
  getSheetsSettings: vi.fn(),
  email: vi.fn(),
  readSlots: vi.fn(),
  invalidateSlots: vi.fn(),
}));

vi.mock('../../prisma.js', () => ({
  prisma: { tenant: { findUnique: mocks.findTenant }, tenantSheetsSettings: { upsert: mocks.upsert } },
}));
vi.mock('../../auth/middleware.js', () => ({ requireAuth: vi.fn(), requireRole: () => vi.fn() }));
vi.mock('../../services/sheets/client.js', () => ({ getServiceAccountEmail: mocks.email }));
vi.mock('../../services/sheets/read.js', () => ({ readSlots: mocks.readSlots, invalidateSlots: mocks.invalidateSlots }));
vi.mock('../../services/sheets/settings.js', async () => ({
  ...(await vi.importActual<typeof import('../../services/sheets/settings.js')>('../../services/sheets/settings.js')),
  getSheetsSettings: mocks.getSheetsSettings,
}));

import { checkSheetsHandler, getSheetsHandler, putSheetsHandler } from './tenantSheets.js';

function res() {
  const r = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return r as unknown as Response & typeof r;
}
const req = (body: unknown = {}, tenantId = 't1') => ({ params: { tenantId }, body }) as unknown as Request;
const ID = '1AbC-dEf_1234567890abcdefgh';
const saved = { enabled: false, spreadsheetId: null, sheetName: null, daysAhead: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSheetsSettings.mockResolvedValue(saved);
  mocks.findTenant.mockResolvedValue({ id: 't1', timezone: 'Asia/Almaty' });
  mocks.email.mockReturnValue('bot@project.iam.gserviceaccount.com');
});

describe('GET', () => {
  it('shows the settings of the requested tenant with the service account email', async () => {
    const r = res();
    await getSheetsHandler(req({}, 'tenant-b'), r);
    expect(mocks.getSheetsSettings).toHaveBeenCalledWith('tenant-b');
    expect(r.json).toHaveBeenCalledWith({ ...saved, serviceAccountEmail: 'bot@project.iam.gserviceaccount.com' });
  });
});

describe('PUT', () => {
  it('stores only the id parsed from a pasted link', async () => {
    const r = res();
    await putSheetsHandler(req({ spreadsheet: `https://docs.google.com/spreadsheets/d/${ID}/edit`, sheetName: 'Ноябрь' }), r);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' }, update: expect.objectContaining({ spreadsheetId: ID, sheetName: 'Ноябрь' }) }),
    );
    expect(mocks.invalidateSlots).toHaveBeenCalledWith('t1');
  });

  it('rejects a link that holds no sheet id', async () => {
    const r = res();
    await putSheetsHandler(req({ spreadsheet: 'hello' }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('refuses to switch on without a sheet name', async () => {
    mocks.getSheetsSettings.mockResolvedValue({ ...saved, spreadsheetId: ID });
    const r = res();
    await putSheetsHandler(req({ enabled: true }), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('refuses to switch on when the platform service account is not configured', async () => {
    mocks.email.mockReturnValue(null);
    mocks.getSheetsSettings.mockResolvedValue({ ...saved, spreadsheetId: ID, sheetName: 'Ноябрь' });
    const r = res();
    await putSheetsHandler(req({ enabled: true }), r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('answers 404 for an unknown tenant', async () => {
    mocks.findTenant.mockResolvedValue(null);
    const r = res();
    await putSheetsHandler(req({ enabled: false }), r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe('POST /check', () => {
  it('reports the number of free slots and days', async () => {
    const d = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    mocks.readSlots.mockResolvedValue([
      { date: d, time: '23:30', row: 2, free: true },
      { date: d, time: '23:45', row: 3, free: true },
    ]);
    const r = res();
    await checkSheetsHandler(req(), r);
    expect(mocks.readSlots).toHaveBeenCalledWith('t1', { fresh: true });
    expect(r.json).toHaveBeenCalledWith({ ok: true, freeSlots: 2, days: 1 });
  });

  it('turns a failure into ok:false with a message instead of throwing', async () => {
    mocks.readSlots.mockRejectedValue(new Error('The caller does not have permission'));
    const r = res();
    await checkSheetsHandler(req(), r);
    expect(r.status).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith({ ok: false, error: 'The caller does not have permission' });
  });
});
