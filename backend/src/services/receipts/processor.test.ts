import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readQrUrl: vi.fn(),
  fetchKaspiReceipt: vi.fn(),
  sendTelegramMessage: vi.fn(),
  sendHumanLikeText: vi.fn(),
  setStatus: vi.fn(),
  appendMessage: vi.fn(),
  emitToTenant: vi.fn(),
  receiptCreate: vi.fn(),
}));

vi.mock('./qr.js', () => ({ readQrUrl: mocks.readQrUrl }));
vi.mock('./kaspiParser.js', async (importActual) => ({
  ...(await importActual<typeof import('./kaspiParser.js')>()),
  fetchKaspiReceipt: mocks.fetchKaspiReceipt,
}));
vi.mock('./telegram.js', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));
vi.mock('../whatsapp/outbound.js', () => ({ sendHumanLikeText: mocks.sendHumanLikeText }));
vi.mock('../conversations/stateMachine.js', () => ({ setStatus: mocks.setStatus }));
vi.mock('../conversations/store.js', () => ({ appendMessage: mocks.appendMessage }));
vi.mock('../realtime/socketRooms.js', () => ({ emitToTenant: mocks.emitToTenant }));
vi.mock('../../prisma.js', () => ({ prisma: { receipt: { create: mocks.receiptCreate } } }));
vi.mock('../../logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { handleReceiptMessage } from './processor.js';

const settings = { sellerIin: '880511301234', minAmount: 10000, telegramBotToken: '1:abc', telegramChatId: '-100' };
const receipt = {
  receiptId: 'QR1',
  amount: 10000,
  sellerIin: '880511301234',
  clientIin: null,
  paymentMethod: 'Kaspi Gold',
  datetime: null,
};

function run(overrides: Partial<Parameters<typeof handleReceiptMessage>[0]> = {}) {
  return handleReceiptMessage({
    tenantId: 't1',
    sock: {} as never,
    jid: '77071110354@s.whatsapp.net',
    conversationId: 'c1',
    contactName: 'Айбек',
    buf: Buffer.from('x'),
    mimeType: 'application/pdf',
    settings,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readQrUrl.mockResolvedValue('https://pay.kaspi.kz/r/1');
  mocks.fetchKaspiReceipt.mockResolvedValue(receipt);
  mocks.receiptCreate.mockResolvedValue({});
  mocks.sendHumanLikeText.mockResolvedValue({ sent: true });
  mocks.sendTelegramMessage.mockResolvedValue(undefined);
  mocks.setStatus.mockResolvedValue(undefined);
  mocks.appendMessage.mockResolvedValue({});
});

describe('handleReceiptMessage', () => {
  it('is not a receipt when there is no QR code', async () => {
    mocks.readQrUrl.mockResolvedValue(null);
    expect(await run()).toBe('not_receipt');
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.sendHumanLikeText).not.toHaveBeenCalled();
  });

  it('is not a receipt when the QR is not a Kaspi url', async () => {
    mocks.readQrUrl.mockResolvedValue('https://evil.com/kaspi.kz');
    expect(await run()).toBe('not_receipt');
    expect(mocks.fetchKaspiReceipt).not.toHaveBeenCalled();
  });

  it('notifies Telegram, thanks the client and hands over when the amount is enough', async () => {
    expect(await run()).toBe('handled');
    expect(mocks.receiptCreate).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage.mock.calls[0]![0].text).toMatch(/Айбек, 77071110354, 10[\s ]000 ₸ төледі/);
    expect(mocks.sendHumanLikeText.mock.calls[0]![0].text).toContain('Чек қабылданды');
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'receipt' });
  });

  it('reports the real amount to Telegram and asks the client for the rest when underpaid', async () => {
    mocks.fetchKaspiReceipt.mockResolvedValue({ ...receipt, amount: 7000 });
    await run();
    expect(mocks.sendTelegramMessage.mock.calls[0]![0].text).toMatch(/7[\s ]000 ₸ төледі/);
    expect(mocks.sendHumanLikeText.mock.calls[0]![0].text).toMatch(/3[\s ]000/);
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'receipt' });
  });

  it('flags a receipt addressed to another IIN', async () => {
    mocks.fetchKaspiReceipt.mockResolvedValue({ ...receipt, sellerIin: '111111111111' });
    await run();
    expect(mocks.sendTelegramMessage.mock.calls[0]![0].text).toContain('ИИН сәйкес емес');
  });

  it('does not notify Telegram twice for a duplicate receipt but still answers the client', async () => {
    mocks.receiptCreate.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    expect(await run()).toBe('handled');
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.sendHumanLikeText.mock.calls[0]![0].text).toContain('Чек қабылданды');
  });

  it('asks the client to resend when the Kaspi page cannot be read', async () => {
    mocks.fetchKaspiReceipt.mockRejectedValue(new Error('boom'));
    expect(await run()).toBe('handled');
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.sendHumanLikeText.mock.calls[0]![0].text).toContain('қайта жіберіңіз');
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it('still answers the client and hands over when Telegram fails', async () => {
    mocks.sendTelegramMessage.mockRejectedValue(new Error('telegram down'));
    expect(await run()).toBe('handled');
    expect(mocks.sendHumanLikeText).toHaveBeenCalledOnce();
    expect(mocks.setStatus).toHaveBeenCalledWith('c1', 'awaiting_human', { handoffReason: 'receipt' });
  });

  it('processes one receipt at a time', async () => {
    let release!: (url: string | null) => void;
    mocks.readQrUrl.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = run();
    const second = run();
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.readQrUrl).toHaveBeenCalledTimes(1);
    release(null);
    await first;
    await second;
    expect(mocks.readQrUrl).toHaveBeenCalledTimes(2);
  });
});
