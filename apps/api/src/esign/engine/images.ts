import { EsignEngineError } from './engine.types.js';

// JPG and PNG headers (ported from R13-api's engine branch), read before anything is decoded: a huge image is refused while it is
// still a few bytes, and a photo's EXIF orientation says how it is shown.

export type Turn = 0 | 90 | 180 | 270;
export interface ImageHeader {
  width: number;
  height: number;
  /** Clockwise turn that shows the image upright (JPEG EXIF orientation 3, 6 or 8). */
  turn: Turn;
}

export const IMAGE_LIMITS = { side: 10_000, pixels: 25_000_000 };

/** The stored size and orientation, or PDF_UNREADABLE for a broken or oversized image. */
export function readImageHeader(type: 'image/png' | 'image/jpeg', bytes: Uint8Array) {
  let header: ImageHeader | undefined;
  try {
    header = type === 'image/png' ? pngHeader(bytes) : jpegHeader(bytes);
  } catch {
    header = undefined; // a read past the end
  }
  const { side, pixels } = IMAGE_LIMITS;
  if (!header || header.width < 1 || header.height < 1)
    throw new EsignEngineError('PDF_UNREADABLE');
  if (header.width > side || header.height > side || header.width * header.height > pixels) {
    throw new EsignEngineError('PDF_UNREADABLE');
  }
  return header;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const ascii = (b: Uint8Array, at: number, length: number) =>
  Buffer.from(b.subarray(at, at + length)).toString('latin1');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngHeader(b: Uint8Array): ImageHeader | undefined {
  if (!PNG.every((x, i) => b[i] === x) || ascii(b, 12, 4) !== 'IHDR') return undefined;
  return { width: view(b).getUint32(16), height: view(b).getUint32(20), turn: 0 };
}

/** Start-of-frame markers (C4, C8 and CC are other segments). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const EXIF_TURNS: Partial<Record<number, Turn>> = { 3: 180, 6: 90, 8: 270 };

function jpegHeader(b: Uint8Array): ImageHeader | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  const v = view(b);
  let turn: Turn = 0;
  for (let at = 2; at + 4 <= b.length;) {
    if (b[at] !== 0xff) return undefined;
    const marker = b[at + 1]!;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined; // image data before any frame
    const length = v.getUint16(at + 2);
    if (SOF.has(marker)) return { height: v.getUint16(at + 5), width: v.getUint16(at + 7), turn };
    if (marker === 0xe1) turn = exifTurn(b.subarray(at + 4, at + 2 + length)) ?? turn;
    at += 2 + length;
  }
  return undefined;
}

/** EXIF IFD0's Orientation (tag 0x0112). Mirrored orientations are shown unturned. */
function exifTurn(segment: Uint8Array): Turn | undefined {
  try {
    return readOrientation(segment);
  } catch {
    return undefined; // a broken EXIF block: show the image as stored
  }
}

function readOrientation(segment: Uint8Array): Turn | undefined {
  if (ascii(segment, 0, 6) !== 'Exif\0\0') return undefined;
  const tiff = segment.subarray(6);
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const v = view(tiff);
  const le = order === 'II';
  const ifd = v.getUint32(4, le);
  for (let i = 0, count = v.getUint16(ifd, le); i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (v.getUint16(entry, le) === 0x0112) return EXIF_TURNS[v.getUint16(entry + 8, le)] ?? 0;
  }
  return undefined;
}
