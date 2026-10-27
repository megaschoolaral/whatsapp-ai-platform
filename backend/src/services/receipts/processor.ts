import type makeWASocket from 'baileys';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { sendHumanLikeText } from '../whatsapp/outbound.js';
import { appendMessage } from '../conversations/store.js';
import { setStatus } from '../conversations/stateMachine.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { buildClientReply, buildTelegramText, decideOutcome, phoneFromJid } from './decision.js';
import { fetchKaspiReceipt, isKaspiUrl, type KaspiReceipt } from './kaspiParser.js';
import { readQrUrl } from './qr.js';
import type { ReceiptSettings } from './settings.js';
import { sendTelegramMessage } from './telegram.js';

type Sock = ReturnType<typeof makeWASocket>;

const RETRY_REPLY =
  'Чекті оқу мүмкін болмады, қайта жіберіңіз.\nНе удалось прочитать чек, отправьте его ещё раз.';

interface ReceiptMessage {
  tenantId: string;
  sock: Sock;
  jid: string;
  jidAlt?: string | null;
  conversationId: string;
  contactName: string | null;
  buf: Buffer;
  mimeType: string;
  settings: ReceiptSettings;
}

// Rendering a PDF at scale 3 is memory-heavy, so receipts are processed strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => undefined);
  return result;
}

/** Stores the receipt; `false` when this receipt was already counted (unique per tenant). */
async function claimReceipt(a: ReceiptMessage, receipt: KaspiReceipt, qrUrl: string): Promise<boolean> {
  try {
    await prisma.receipt.create({
      data: {
        tenantId: a.tenantId,
        receiptId: receipt.receiptId,
        amount: Math.round(receipt.amount),
        sellerIin: receipt.sellerIin,
        paymentMethod: receipt.paymentMethod,
        qrUrl,
        conversationId: a.conversationId,
      },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false;
    throw err;
  }
}

async function replyToClient(a: ReceiptMessage, text: string): Promise<void> {
  try {
    const sent = await sendHumanLikeText({ tenantId: a.tenantId, sock: a.sock, jid: a.jid, text });
    if (!sent.sent) {
      logger.warn({ tenantId: a.tenantId, reason: sent.reason }, '[receipts] client reply blocked');
      return;
    }
    await appendMessage({
      tenantId: a.tenantId,
      conversationId: a.conversationId,
      direction: 'outgoing',
      sentBy: 'ai',
      content: text,
    });
    emitToTenant(a.tenantId, 'message:new', {
      conversationId: a.conversationId,
      direction: 'outgoing',
      sentBy: 'ai',
      content: text,
    });
  } catch (err) {
    logger.error({ err, tenantId: a.tenantId }, '[receipts] failed to reply to client');
  }
}

async function process(a: ReceiptMessage): Promise<'handled' | 'not_receipt'> {
  const qrUrl = await readQrUrl(a.buf, a.mimeType);
  if (!qrUrl || !isKaspiUrl(qrUrl)) return 'not_receipt';

  let receipt: KaspiReceipt;
  try {
    receipt = await fetchKaspiReceipt(qrUrl);
  } catch (err) {
    logger.warn({ err, tenantId: a.tenantId }, '[receipts] could not read Kaspi receipt');
    await replyToClient(a, RETRY_REPLY);
    return 'handled';
  }

  const outcome = decideOutcome(receipt.amount, a.settings.minAmount);
  const isNew = await claimReceipt(a, receipt, qrUrl);
  if (isNew) {
    try {
      await sendTelegramMessage({
        botToken: a.settings.telegramBotToken,
        chatId: a.settings.telegramChatId,
        text: buildTelegramText({
          clientName: a.contactName,
          phone: phoneFromJid(a.jid, a.jidAlt),
          amount: receipt.amount,
          iinMismatch: receipt.sellerIin !== a.settings.sellerIin,
        }),
      });
    } catch (err) {
      // The conversation still moves to awaiting_human below, so the owner sees it in the inbox.
      logger.error({ err, tenantId: a.tenantId, receiptId: receipt.receiptId }, '[receipts] Telegram notification failed');
    }
  } else {
    logger.info({ tenantId: a.tenantId, receiptId: receipt.receiptId }, '[receipts] duplicate receipt');
  }

  await replyToClient(a, buildClientReply(outcome));
  await setStatus(a.conversationId, 'awaiting_human', { handoffReason: 'receipt' });
  return 'handled';
}

/** `not_receipt` means the file has no Kaspi QR and should go on to the AI as a normal message. */
export function handleReceiptMessage(a: ReceiptMessage): Promise<'handled' | 'not_receipt'> {
  return runExclusive(() => process(a));
}
