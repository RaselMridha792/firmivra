import { crc32, inflateSync } from 'node:zlib';
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
  const png = parsePng(b);
  return png && { width: png.width, height: png.height, turn: 0 };
}

export interface PngInfo {
  width: number;
  height: number;
}

/** Channels per colour type; the bit depths each allows (PNG spec 11.2.2). */
const COLOUR_TYPES: Partial<Record<number, { channels: number; depths: number[] }>> = {
  0: { channels: 1, depths: [1, 2, 4, 8, 16] },
  2: { channels: 3, depths: [8, 16] },
  3: { channels: 1, depths: [1, 2, 4, 8] },
  4: { channels: 2, depths: [8, 16] },
  6: { channels: 4, depths: [8, 16] },
};
/** Adam7 passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * A PNG checked the whole way before anything else decodes it: every chunk's CRC, IHDR's fields
 * against the spec, a size within IMAGE_LIMITS, and image data that inflates to exactly the
 * expected length with a valid filter byte on every row. A PNG that fails any of this can make
 * a decoder spin or blow up memory, so it's undefined here. `strict` also refuses bytes after IEND.
 */
export function parsePng(b: Uint8Array, { strict = false } = {}): PngInfo | undefined {
  try {
    return readPng(b, strict);
  } catch {
    return undefined; // a read past the end, or data that doesn't inflate
  }
}

function readPng(b: Uint8Array, strict: boolean): PngInfo | undefined {
  if (!PNG.every((x, i) => b[i] === x)) return undefined;
  const v = view(b);
  let header: { width: number; height: number; depth: number; colour: number; laced: boolean };
  let hasPalette = false;
  const data: Uint8Array[] = [];
  for (let at = 8, first = true; ; first = false) {
    const length = v.getUint32(at);
    const type = ascii(b, at + 4, 4);
    if (at + 12 + length > b.length) return undefined;
    const body = b.subarray(at + 8, at + 8 + length);
    if (crc32(b.subarray(at + 4, at + 8 + length)) !== v.getUint32(at + 8 + length)) {
      return undefined;
    }
    at += 12 + length;
    if (first !== (type === 'IHDR')) return undefined;
    if (type === 'IHDR') {
      if (length !== 13) return undefined;
      const h = view(body);
      const [depth, colour, compression, filter, lace] = body.subarray(8, 13);
      const allowed = COLOUR_TYPES[colour!];
      if (!allowed?.depths.includes(depth!) || compression !== 0 || filter !== 0) return undefined;
      if (lace !== 0 && lace !== 1) return undefined;
      header = {
        width: h.getUint32(0),
        height: h.getUint32(4),
        depth: depth!,
        colour: colour!,
        laced: lace === 1,
      };
      const { side, pixels } = IMAGE_LIMITS;
      const { width, height } = header;
      if (width < 1 || height < 1 || width > side || height > side || width * height > pixels) {
        return undefined;
      }
    } else if (type === 'PLTE') {
      hasPalette = true;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      if (strict && at !== b.length) return undefined;
      break;
    }
  }
  const { width, height, depth, colour, laced } = header!;
  if (colour === 3 && !hasPalette) return undefined;
  const bits = COLOUR_TYPES[colour]!.channels * depth;
  // Each row is one filter byte plus its packed pixels.
  const passes = laced
    ? ADAM7.map(([x0, y0, dx, dy]) => [Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)])
    : [[width, height]];
  const rows: number[] = [];
  let expected = 0;
  for (const [w, h] of passes) {
    if (w! <= 0 || h! <= 0) continue;
    const rowBytes = 1 + Math.ceil((w! * bits) / 8);
    for (let r = 0; r < h!; r++) rows.push(expected + r * rowBytes);
    expected += h! * rowBytes;
  }
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  if (raw.length !== expected) return undefined;
  if (rows.some((at) => raw[at]! > 4)) return undefined;
  return { width, height };
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
