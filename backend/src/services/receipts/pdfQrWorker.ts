// Runs in a short-lived child process: rendering a PDF pulls in pdf.js + a canvas (~500 MB RSS that is never
// handed back), which must not stay in the process that holds the WhatsApp sessions.
import { PNG } from 'pngjs';
import { decodeRgba } from './qrDecode.js';

// At a smaller scale jsQR fails on real Kaspi PDFs.
const PDF_RENDER_SCALE = 3;

async function readPdf(pdfBytes: Buffer): Promise<string | null> {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(pdfBytes, { scale: PDF_RENDER_SCALE });
  for await (const page of doc) {
    const png = PNG.sync.read(page);
    const url = decodeRgba(png.data, png.width, png.height);
    if (url) return url;
  }
  return null;
}

process.once('message', async (msg: { pdf: Uint8Array }) => {
  let url: string | null = null;
  try {
    url = await readPdf(Buffer.from(msg.pdf));
  } catch {
    /* unreadable PDF → no QR */
  }
  process.send?.({ url }, () => process.exit(0));
});
