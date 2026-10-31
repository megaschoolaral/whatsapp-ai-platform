import type makeWASocket from 'baileys';
import { normalizeMessageContent } from 'baileys';
import type { WAMessage } from 'baileys';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { downloadMedia, compressImage } from './media.js';
import { upsertConversation, appendMessage } from '../conversations/store.js';
import { appendToBuffer } from '../inboundBuffer/buffer.js';
import { transcribe } from '../stt/index.js';
import { loadTenantContext } from '../tenantContext.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { setStatus } from '../conversations/stateMachine.js';
import { cancelFollowups } from '../followup/scheduler.js';
import { isSavedContact } from './savedContacts.js';
import { loadActiveReceiptSettings } from '../receipts/settings.js';
import { handleReceiptMessage } from '../receipts/processor.js';

type Sock = ReturnType<typeof makeWASocket>;

/** Only 1:1 chats are handled; groups, `status@broadcast`, broadcast lists and newsletters are ignored. */
function isDirectChatJid(jid: string | null | undefined): jid is string {
  if (!jid) return false;
  return !(jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter'));
}

/** A customer replying to someone's WhatsApp Status arrives as a normal 1:1 message quoting `status@broadcast`. */
function isReplyToStatus(msg: WAMessage): boolean {
  const content = normalizeMessageContent(msg.message);
  if (!content) return false;
  type Ctx = { remoteJid?: string | null; externalAdReply?: unknown; entryPointConversionSource?: string | null };
  return Object.values(content).some((part) => {
    if (typeof part !== 'object' || part === null) return false;
    const ctx = (part as { contextInfo?: Ctx }).contextInfo;
    if (ctx?.remoteJid !== 'status@broadcast') return false;
    // A click-to-WhatsApp ad shown in Status is a real lead, not a reply to someone's Status.
    return !(ctx.externalAdReply || ctx.entryPointConversionSource);
  });
}

/** Text of a message, also when it is wrapped (disappearing/view-once) or comes from a button/list/ad entry point. */
/**
 * No real content yet: an empty placeholder (Meta ad messages arrive empty until WhatsApp re-sends the real one,
 * the same message id) or a protocol/system message. Storing it would make the real message look like a duplicate.
 */
function hasNoContent(msg: WAMessage): boolean {
  const content = normalizeMessageContent(msg.message);
  if (!content) return true;
  return Object.keys(content).every(
    (k) => k === 'protocolMessage' || k === 'senderKeyDistributionMessage' || k === 'messageContextInfo',
  );
}

function extractText(msg: WAMessage): string {
  const m = normalizeMessageContent(msg.message);
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.buttonsMessage?.contentText ||
    m.templateMessage?.hydratedTemplate?.hydratedContentText ||
    m.interactiveMessage?.body?.text ||
    ''
  );
}

function detectMediaType(msg: WAMessage): 'image' | 'audio' | 'document' | null {
  const m = msg.message;
  if (!m) return null;
  if (m.imageMessage) return 'image';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  return null;
}

/**
 * Оператор WhatsApp телефонынан қолмен хабарлама жіберді.
 * Егер conversation ai_active болса → human_active-ке ауыстыр (бот тоқтайды).
 */
export async function handleOutgoingFromPhone(tenantId: string, msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!isDirectChatJid(jid)) return;

  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, contactIdentifier: jid, status: 'ai_active' },
  });
  if (!conversation) return; // Уже human_active / awaiting_human — ничего не делаем

  await setStatus(conversation.id, 'human_active', {});
  logger.info({ tenantId, jid }, '[inbound] operator sent from phone → human_active, bot stopped');
}

export async function handleIncomingMessage(tenantId: string, sock: Sock, msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!isDirectChatJid(jid)) {
    logger.info({ tenantId, jid }, '[inbound] ignored non-direct chat (group/status/broadcast/channel)');
    return; // skip groups, status updates, broadcast lists, channels
  }
  if (isReplyToStatus(msg)) {
    logger.info({ tenantId, jid }, '[inbound] ignored reply to a WhatsApp Status');
    return; // replies to a Status are not support requests; the AI must not answer them
  }
  if (hasNoContent(msg)) {
    logger.info(
      { tenantId, jid, msgId: msg.key.id, stubType: msg.messageStubType, keys: Object.keys(msg.message ?? {}) },
      '[inbound] skipped message without content (placeholder or protocol message)',
    );
    return;
  }
  const text = extractText(msg);
  const mediaType = detectMediaType(msg);
  if (!text && !mediaType) {
    const content = normalizeMessageContent(msg.message);
    logger.warn(
      { tenantId, jid, messageKeys: Object.keys(msg.message ?? {}), contentKeys: Object.keys(content ?? {}) },
      '[inbound] message without readable text or media',
    );
  }

  // Subscribe to presence so we can react to composing/paused
  try {
    await sock.presenceSubscribe(jid);
  } catch {
    /* ignore */
  }

  let conversation = await upsertConversation({
    tenantId,
    contactIdentifier: jid,
    contactName: msg.pushName ?? null,
  });

  // A customer writing into a resolved conversation reopens it (otherwise the AI replies while it still shows "resolved").
  if (conversation.status === 'resolved') {
    await setStatus(conversation.id, 'ai_active');
    conversation = { ...conversation, status: 'ai_active' };
  }

  // WhatsApp can redeliver the same message; skip if already stored.
  if (msg.key.id) {
    const dup = await prisma.message.findFirst({
      where: { conversationId: conversation.id, whatsappMsgId: msg.key.id },
      select: { id: true },
    });
    if (dup) return;
  }

  let imageBase64: string | null = null;
  let imageMimeType: string | null = null;
  let transcribedText: string | null = null;
  let mediaDescriptor: { type: string; size: number } | null = null;

  let mediaBuf: Buffer | null = null;

  if (mediaType) {
    const buf = await downloadMedia(msg);
    mediaBuf = buf;
    if (buf) {
      mediaDescriptor = { type: mediaType, size: buf.byteLength };
      if (mediaType === 'image') {
        const compressed = await compressImage(buf, msg.message?.imageMessage?.mimetype ?? 'image/jpeg');
        imageBase64 = compressed.buffer.toString('base64');
        imageMimeType = compressed.mimeType;
      } else if (mediaType === 'audio') {
        const tenant = await loadTenantContext(tenantId);
        if (tenant) {
          try {
            transcribedText = await transcribe(
              tenant,
              buf,
              msg.message?.audioMessage?.mimetype ?? 'audio/ogg',
              conversation.id,
            );
          } catch (err) {
            logger.warn({ err }, '[inbound] transcription failed');
          }
        }
      }
    }
  }

  const stored = await appendMessage({
    tenantId,
    conversationId: conversation.id,
    direction: 'incoming',
    sentBy: 'customer',
    content: text || null,
    mediaType: mediaType ?? null,
    transcribedText,
    whatsappMsgId: msg.key.id ?? null,
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastInboundMessageAt: new Date() },
  });
  await cancelFollowups(tenantId, conversation.id);

  emitToTenant(tenantId, 'message:new', {
    conversationId: conversation.id,
    direction: 'incoming',
    sentBy: 'customer',
    content: text,
    transcribedText,
    mediaType,
  });

  // Contacts saved in the owner's phone (friends, family) stay in the inbox but the AI never answers them.
  const saved = await isSavedContact(tenantId, [jid, msg.key.remoteJidAlt]);
  if (saved) logger.info({ tenantId, jid }, '[inbound] saved phone contact — AI skipped');

  // Kaspi receipt (QR in a photo or PDF): notify the owner's Telegram and hand the chat to a human instead of the AI.
  const receiptMime =
    mediaType === 'image'
      ? (msg.message?.imageMessage?.mimetype ?? 'image/jpeg')
      : mediaType === 'document' && msg.message?.documentMessage?.mimetype === 'application/pdf'
        ? 'application/pdf'
        : null;
  if (!saved && mediaBuf && receiptMime) {
    try {
      const receiptSettings = await loadActiveReceiptSettings(tenantId);
      if (receiptSettings) {
        const result = await handleReceiptMessage({
          tenantId,
          sock,
          jid,
          jidAlt: msg.key.remoteJidAlt,
          conversationId: conversation.id,
          contactName: conversation.contactName,
          buf: mediaBuf,
          mimeType: receiptMime,
          settings: receiptSettings,
        });
        if (result === 'handled') {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
          });
          return;
        }
      }
    } catch (err) {
      logger.error({ err, tenantId }, '[inbound] receipt check failed — continuing as a normal message');
    }
  }

  // If conversation is in human_active or awaiting_human, do NOT buffer for AI.
  if (saved || conversation.status === 'human_active' || conversation.status === 'awaiting_human') {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: { increment: 1 }, lastMessageAt: new Date() },
    });
    return;
  }

  // Else buffer for AI processing
  await appendToBuffer({
    tenantId,
    contactJid: jid,
    conversationId: conversation.id,
    text: transcribedText ?? text,
    imageBase64,
    imageMimeType,
    msgKey: msg.key,
    messageId: stored.id,
    mediaSize: mediaDescriptor?.size ?? null,
  });
}
