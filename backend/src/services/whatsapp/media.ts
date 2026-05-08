import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';
import sharp from 'sharp';

export async function downloadMedia(message: WAMessage): Promise<Buffer | null> {
  try {
    const buf = (await downloadMediaMessage(message, 'buffer', {})) as Buffer;
    return buf;
  } catch {
    return null;
  }
}

export async function compressImage(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return buf;
  }
}
