import jsQRModule from 'jsqr';
import sharp from 'sharp';
import { PNG } from 'pngjs';
import { logger } from '../../logger.js';

// Under NodeNext the CJS default import is typed as the module namespace, but at runtime it is the function.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

// At a smaller scale jsQR fails on real Kaspi PDFs.
const PDF_RENDER_SCALE = 3;

function decode(rgba: Uint8Array | Buffer, width: number, height: number): string | null {
  const code = jsQR(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
  return code?.data ?? null;
}

async function readFromImage(buf: Buffer): Promise<string | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decode(data, info.width, info.height);
}

async function readFromPdf(buf: Buffer): Promise<string | null> {
  // pdf-to-img is ESM-only and heavy; load it only when a PDF actually arrives.
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(buf, { scale: PDF_RENDER_SCALE });
  for await (const page of doc) {
    const png = PNG.sync.read(page);
    const url = decode(png.data, png.width, png.height);
    if (url) return url;
  }
  return null;
}

/** QR text from a photo or PDF, or `null` when there is none (or the file is unreadable). */
export async function readQrUrl(buf: Buffer, mimeType: string): Promise<string | null> {
  try {
    return mimeType === 'application/pdf' ? await readFromPdf(buf) : await readFromImage(buf);
  } catch (err) {
    logger.debug({ err }, '[receipts] QR read failed');
    return null;
  }
}
