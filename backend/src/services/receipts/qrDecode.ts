import jsQRModule from 'jsqr';

// Under NodeNext the CJS default import is typed as the module namespace, but at runtime it is the function.
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

export function decodeRgba(rgba: Uint8Array | Buffer, width: number, height: number): string | null {
  const code = jsQR(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height);
  return code?.data ?? null;
}
