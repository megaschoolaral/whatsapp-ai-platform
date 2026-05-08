import type makeWASocket from 'baileys';
import type { WAMessage } from 'baileys';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { downloadMedia, compressImage } from './media.js';
import { upsertConversation, appendMessage } from '../conversations/store.js';
import { appendToBuffer } from '../inboundBuffer/buffer.js';
import { transcribe } from '../stt/index.js';
import { loadTenantContext } from '../tenantContext.js';
import { emitToTenant } from '../realtime/socketRooms.js';

type Sock = ReturnType<typeof makeWASocket>;

function extractText(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
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

export async function handleIncomingMessage(tenantId: string, sock: Sock, msg: WAMessage): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return; // skip groups for now
  const text = extractText(msg);
  const mediaType = detectMediaType(msg);

  // Subscribe to presence so we can react to composing/paused
  try {
    await sock.presenceSubscribe(jid);
  } catch {
    /* ignore */
  }

  const conversation = await upsertConversation({
    tenantId,
    contactIdentifier: jid,
    contactName: msg.pushName ?? null,
  });

  let imageBase64: string | null = null;
  let imageMimeType: string | null = null;
  let transcribedText: string | null = null;
  let mediaDescriptor: { type: string; size: number } | null = null;

  if (mediaType) {
    const buf = await downloadMedia(msg);
    if (buf) {
      mediaDescriptor = { type: mediaType, size: buf.byteLength };
      if (mediaType === 'image') {
        const compressed = await compressImage(buf);
        imageBase64 = compressed.toString('base64');
        imageMimeType = msg.message?.imageMessage?.mimetype ?? 'image/jpeg';
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

  await appendMessage({
    tenantId,
    conversationId: conversation.id,
    direction: 'incoming',
    sentBy: 'customer',
    content: text || null,
    mediaType: mediaType ?? null,
    transcribedText,
    whatsappMsgId: msg.key.id ?? null,
  });

  emitToTenant(tenantId, 'message:new', {
    conversationId: conversation.id,
    direction: 'incoming',
    sentBy: 'customer',
    content: text,
    transcribedText,
    mediaType,
  });

  // If conversation is in human_active or awaiting_human, do NOT buffer for AI.
  if (conversation.status === 'human_active' || conversation.status === 'awaiting_human') {
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
    mediaSize: mediaDescriptor?.size ?? null,
  });
}
