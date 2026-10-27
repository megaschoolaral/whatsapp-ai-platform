import QRCode from 'qrcode';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readQrUrl } from './qr.js';

describe('readQrUrl', () => {
  it('decodes a QR code from a PNG photo', async () => {
    const png = await QRCode.toBuffer('https://pay.kaspi.kz/test', { width: 400, margin: 4 });
    expect(await readQrUrl(png, 'image/png')).toBe('https://pay.kaspi.kz/test');
  });

  it('decodes a QR code from a JPEG photo', async () => {
    const png = await QRCode.toBuffer('https://pay.kaspi.kz/jpeg', { width: 400, margin: 4 });
    const jpeg = await sharp(png).jpeg({ quality: 90 }).toBuffer();
    expect(await readQrUrl(jpeg, 'image/jpeg')).toBe('https://pay.kaspi.kz/jpeg');
  });

  it('returns null for an image without a QR code', async () => {
    const blank = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } })
      .png()
      .toBuffer();
    expect(await readQrUrl(blank, 'image/png')).toBeNull();
  });

  it('returns null for garbage instead of throwing', async () => {
    expect(await readQrUrl(Buffer.from('not an image'), 'image/png')).toBeNull();
    expect(await readQrUrl(Buffer.from('not a pdf'), 'application/pdf')).toBeNull();
  });
});
