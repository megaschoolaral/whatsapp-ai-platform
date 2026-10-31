import type makeWASocket from 'baileys';
import { logger } from '../../logger.js';
import { appendMessage } from '../conversations/store.js';
import { emitToTenant } from '../realtime/socketRooms.js';
import { sendHumanLikePhoto } from '../whatsapp/outbound.js';
import type { PhotoCategoryId } from './categories.js';
import { getCategoryPhotos, recordCategorySent } from './store.js';

type Sock = ReturnType<typeof makeWASocket>;

/** Sends every photo of the given categories; a category is recorded as sent only when all its photos went out. */
export async function sendQueuedPhotos(args: {
  tenantId: string;
  conversationId: string;
  jid: string;
  sock: Sock;
  categories: PhotoCategoryId[];
}): Promise<{ ok: boolean; reason?: string }> {
  const { tenantId, conversationId, jid, sock } = args;
  for (const category of args.categories) {
    const photos = await getCategoryPhotos(tenantId, category);
    for (const photo of photos) {
      let result: { sent: boolean; reason?: string };
      try {
        result = await sendHumanLikePhoto({ tenantId, sock, jid, image: photo.data, mimeType: photo.mimeType });
      } catch (err) {
        logger.error({ err, tenantId, category }, '[photos] send failed');
        return { ok: false, reason: 'photo_send_failed' };
      }
      if (!result.sent) return { ok: false, reason: result.reason ?? 'photo_send_failed' };

      await appendMessage({
        tenantId,
        conversationId,
        direction: 'outgoing',
        sentBy: 'ai',
        content: null,
        mediaType: 'image',
      });
      emitToTenant(tenantId, 'message:new', {
        conversationId,
        direction: 'outgoing',
        sentBy: 'ai',
        content: null,
        mediaType: 'image',
      });
    }
    await recordCategorySent(tenantId, conversationId, category);
  }
  return { ok: true };
}
