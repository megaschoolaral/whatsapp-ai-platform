import { tool } from 'ai';
import { z } from 'zod';
import { getSendCapacity } from '../whatsapp/antiBan.js';
import { MAX_CATEGORIES_PER_REPLY, isPhotoCategory, type PhotoCategoryId } from './categories.js';
import { countCategoryPhotos, wasCategorySent } from './store.js';

export type PhotoToolStatus = 'queued' | 'already_sent' | 'no_photos' | 'blocked' | 'limit_reached' | 'invalid_category';

export async function decidePhotoRequest(args: {
  tenantId: string;
  conversationId: string;
  category: string;
  alreadyQueued: PhotoCategoryId[];
}): Promise<{ status: PhotoToolStatus }> {
  const { tenantId, conversationId, category, alreadyQueued } = args;
  if (!isPhotoCategory(category)) return { status: 'invalid_category' };
  if (alreadyQueued.includes(category)) return { status: 'already_sent' };
  if (alreadyQueued.length >= MAX_CATEGORIES_PER_REPLY) return { status: 'limit_reached' };
  if (await wasCategorySent(conversationId, category)) return { status: 'already_sent' };

  const count = await countCategoryPhotos(tenantId, category);
  if (count === 0) return { status: 'no_photos' };

  let queuedPhotos = 0;
  for (const q of alreadyQueued) queuedPhotos += await countCategoryPhotos(tenantId, q);
  const { remaining } = await getSendCapacity(tenantId);
  if (remaining < queuedPhotos + count) return { status: 'blocked' };
  return { status: 'queued' };
}

export function buildPhotoTool(ctx: { tenantId: string; conversationId: string }) {
  const queued: PhotoCategoryId[] = [];
  const photoTool = tool({
    description:
      'Send the hostel photos of one category to the client in WhatsApp. Call it when the client asks for photos or pictures of a category.',
    parameters: z.object({ category: z.string().describe('Category id from the list in the system prompt') }),
    execute: async ({ category }) => {
      const res = await decidePhotoRequest({ ...ctx, category, alreadyQueued: queued });
      if (res.status === 'queued') queued.push(category as PhotoCategoryId);
      return res;
    },
  });
  return { tool: photoTool, queued };
}

export function photoPromptSection(categories: { id: PhotoCategoryId; label: string; count: number }[]): string {
  const list = categories.map((c) => `- ${c.id}: ${c.label} (${c.count} фото)`).join('\n');
  return `\n\nPHOTOS: you can send the hostel's photos with the send_photos tool. Available categories:\n${list}
Rules:
- When the client asks for photos/pictures, call send_photos with the matching category id. Do not describe photos you did not send.
- If it is unclear which category the client means (e.g. "photos of the room" without the number of people), ask ONE short question about which category. This is the only case where you may ask the client a question.
- Tool result "queued": reply with one short sentence that you are sending the photos. The photos follow your message.
- "already_sent": say the photos were already sent above in this chat.
- "no_photos" or "invalid_category": say there are no photos of this at the moment.
- "blocked": say the photos will be sent shortly.
- "limit_reached": say you will send the other photos next.
- Never claim photos were sent unless the tool returned "queued".`;
}
