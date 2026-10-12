import { downloadMediaMessage, type WAMessage } from 'baileys';
import sharp from 'sharp';

export async function downloadMedia(message: WAMessage): Promise<Buffer | null> {
  try {
    const buf = (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
    return buf;
  } catch {
    return null;
  }
}

/** Returns the (re-encoded) image and its real MIME type: compressed output is always JPEG. */
export async function compressImage(buf: Buffer, originalMime: string): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const buffer = await sharp(buf).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    return { buffer, mimeType: 'image/jpeg' };
  } catch {
    return { buffer: buf, mimeType: originalMime };
  }
}
