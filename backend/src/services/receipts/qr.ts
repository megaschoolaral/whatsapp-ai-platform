import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { logger } from '../../logger.js';
import { decodeRgba } from './qrDecode.js';

const PDF_WORKER_TIMEOUT_MS = 30_000;

async function readFromImage(buf: Buffer): Promise<string | null> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return decodeRgba(data, info.width, info.height);
}

/** PDFs are rendered in a throw-away child process so the heavy renderer's memory is freed afterwards. */
function readFromPdf(buf: Buffer): Promise<string | null> {
  return new Promise((resolve) => {
    const isTs = import.meta.url.endsWith('.ts'); // dev/tests run the sources through tsx, production runs dist/*.js
    const worker = fork(fileURLToPath(new URL(isTs ? './pdfQrWorker.ts' : './pdfQrWorker.js', import.meta.url)), [], {
      execArgv: isTs ? ['--import', 'tsx'] : [],
      serialization: 'advanced',
    });
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.kill();
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), PDF_WORKER_TIMEOUT_MS);
    worker.once('message', (msg: { url: string | null }) => finish(msg.url));
    worker.once('error', () => finish(null));
    worker.once('exit', () => finish(null));
    worker.send({ pdf: buf });
  });
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
