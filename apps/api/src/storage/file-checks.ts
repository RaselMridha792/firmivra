import { inflateRawSync } from 'node:zlib';
import type { DocumentErrorCode, UploadContentType } from '@firmivra/types';

// Confirm's checks of the stored bytes (docs/api/documents.yaml, "Excel and Word (confirm)").
// Everything is read in memory from the at most 10 MB the upload may hold; nothing is unpacked
// to disk and no general CFB, ZIP or XML library is used.

export type FileRefusal = Extract<
  DocumentErrorCode,
  'UPLOAD_MISMATCH' | 'FILE_PASSWORD_PROTECTED' | 'FILE_HAS_MACROS'
>;
const MISMATCH = 'UPLOAD_MISMATCH' as const;

/** First bytes of the types that are not Office packages: %PDF-, JPEG's SOI, PNG's signature. */
const SIGNATURES: Partial<Record<UploadContentType, readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (bytes: Uint8Array, sig: readonly number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/** Null when the bytes are what `contentType` says; else why confirm refuses them. */
export function checkFile(contentType: UploadContentType, bytes: Uint8Array): FileRefusal | null {
  const signature = SIGNATURES[contentType];
  if (signature) return startsWith(bytes, signature) ? null : MISMATCH;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 1. Office saves a file with a password as a CFB holding an EncryptedPackage stream.
  if (startsWith(buf, CFB)) return hasEncryptedPackage(buf) ? 'FILE_PASSWORD_PROTECTED' : MISMATCH;
  if (!startsWith(buf, ZIP)) return MISMATCH;
  try {
    return checkPackage(buf, `${contentType}.main+xml`);
  } catch {
    return MISMATCH; // a read past the end of a broken file
  }
}

// ---------- CFB (OLE2): a bounded walk of the directory ----------
const END_OF_CHAIN = 0xfffffffe;
const MAX_DIRECTORY_ENTRIES = 10_000;

function hasEncryptedPackage(buf: Buffer): boolean {
  if (buf.length < 512) return false;
  const shift = buf.readUInt16LE(30);
  if (shift !== 9 && shift !== 12) return false;
  const size = 1 << shift;
  const sectors = Math.floor(buf.length / size) - 1;
  const sector = (n: number) => buf.subarray((n + 1) * size, (n + 2) * size);
  // A chain stops at its end, at a sector seen twice or out of range, and after `sectors` steps.
  const chain = (start: number, next: (n: number) => number) => {
    const seen = new Set<number>();
    for (let n = start; n < sectors && !seen.has(n); n = next(n)) seen.add(n);
    return [...seen];
  };
  const perSector = size / 4;
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) fatSectors.push(buf.readUInt32LE(76 + i * 4));
  for (const d of chain(buf.readUInt32LE(68), (n) => sector(n).readUInt32LE(size - 4))) {
    for (let i = 0; i < perSector - 1; i++) fatSectors.push(sector(d).readUInt32LE(i * 4));
  }
  const firstOut = fatSectors.findIndex((n) => n >= sectors);
  const fat = firstOut === -1 ? fatSectors : fatSectors.slice(0, firstOut);
  const next = (n: number) => {
    const fs = fat[Math.floor(n / perSector)];
    return fs === undefined ? END_OF_CHAIN : sector(fs).readUInt32LE((n % perSector) * 4);
  };
  let entries = 0;
  for (const d of chain(buf.readUInt32LE(48), next)) {
    for (let at = 0; at + 128 <= size && entries < MAX_DIRECTORY_ENTRIES; at += 128, entries++) {
      const entry = sector(d).subarray(at, at + 128);
      const nameBytes = entry.readUInt16LE(64);
      if (nameBytes < 2 || nameBytes > 64) continue;
      if (entry.toString('utf16le', 0, nameBytes - 2) === 'EncryptedPackage') return true;
    }
  }
  return false;
}

// ---------- ZIP (Office Open XML) ----------
const CAP = 1 << 20;
const MAX_ENTRIES = 10_000;
const ALL_ONES = 0xffffffff;
interface Entry {
  method: number;
  compressed: number;
  size: number;
  local: number;
}

/** Entry names compared without case, `\` as `/`, without a leading `/`. */
const partName = (name: string) => name.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();

function checkPackage(buf: Buffer, mainType: string): FileRefusal | null {
  const entries = centralDirectory(buf);
  const types = entries?.get('[content_types].xml');
  const xml = entries && types ? readEntry(buf, types) : null;
  // No DTDs (packages never have one), so only XML's own entities can appear.
  if (!entries || xml === null || /<!doctype/i.test(xml)) return MISMATCH;
  if (/&(?!(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);)/i.test(xml)) return MISMATCH;
  const parts = declarations(xml);
  const macroType = /macroenabled|vbaproject|vbadata|macrosheet/;
  const macroPart = (name: string) =>
    /^vba(project|data)/.test(name.slice(name.lastIndexOf('/') + 1));
  if ([...entries.keys()].some(macroPart) || parts.some((p) => macroType.test(p.contentType))) {
    return 'FILE_HAS_MACROS';
  }
  const main = parts.some(
    (p) => p.override && p.contentType === mainType && entries.has(partName(p.partName)),
  );
  return main ? null : MISMATCH;
}

/** The central directory, found from its end record, under the caps; null when broken. */
function centralDirectory(buf: Buffer): Map<string, Entry> | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  let count = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || size === ALL_ONES || offset === ALL_ONES) {
    const locator = eocd - 20;
    if (locator < 0 || buf.readUInt32LE(locator) !== 0x07064b50) return null;
    const at = Number(buf.readBigUInt64LE(locator + 8));
    if (at + 56 > buf.length || buf.readUInt32LE(at) !== 0x06064b50) return null;
    count = Number(buf.readBigUInt64LE(at + 32));
    size = Number(buf.readBigUInt64LE(at + 40));
    offset = Number(buf.readBigUInt64LE(at + 48));
  }
  if (count > MAX_ENTRIES || size > CAP || offset + size > buf.length) return null;
  const entries = new Map<string, Entry>();
  const end = offset + size;
  for (let p = offset, i = 0; i < count; i++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const [nameLength, extraLength, commentLength] = [28, 30, 32].map((o) =>
      buf.readUInt16LE(p + o),
    );
    const next = p + 46 + nameLength! + extraLength! + commentLength!;
    if (next > end || flags & 1 || (method !== 0 && method !== 8)) return null;
    const entry = { method, compressed: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24) };
    let local = buf.readUInt32LE(p + 42);
    // ZIP64: the fields set to all ones are in the extra field (id 1), in this order.
    const big = zip64(buf.subarray(p + 46 + nameLength!, p + 46 + nameLength! + extraLength!));
    if (entry.size === ALL_ONES) entry.size = big.shift() ?? -1;
    if (entry.compressed === ALL_ONES) entry.compressed = big.shift() ?? -1;
    if (local === ALL_ONES) local = big.shift() ?? -1;
    if (entry.size < 0 || entry.compressed < 0 || local < 0) return null;
    const name = partName(
      buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLength!),
    );
    if (entries.has(name)) return null;
    entries.set(name, { ...entry, local });
    p = next;
  }
  return entries;
}

function zip64(extra: Buffer): number[] {
  for (let at = 0; at + 4 <= extra.length; at += 4 + extra.readUInt16LE(at + 2)) {
    if (extra.readUInt16LE(at) !== 1) continue;
    const values: number[] = [];
    for (let v = at + 4; v + 8 <= at + 4 + extra.readUInt16LE(at + 2); v += 8) {
      values.push(Number(extra.readBigUInt64LE(v)));
    }
    return values;
  }
  return [];
}

/** One entry inflated in memory, the cap counted on the output; null when it doesn't fit. */
function readEntry(buf: Buffer, entry: Entry): string | null {
  const at = entry.local;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) return null;
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  if (start + entry.compressed > buf.length) return null;
  const data = buf.subarray(start, start + entry.compressed);
  let out: Buffer;
  try {
    out = entry.method === 0 ? data : inflateRawSync(data, { maxOutputLength: CAP });
  } catch {
    return null;
  }
  if (out.length > CAP || out.length !== entry.size) return null;
  if (out[0] === 0xff && out[1] === 0xfe) return out.toString('utf16le', 2);
  const text = out.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a byte order mark
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? '';
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

/** The Default and Override declarations of [Content_Types].xml, values decoded, lower case. */
function declarations(xml: string) {
  const found = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(/<(?:[\w.-]+:)?(Default|Override)\b([^>]*)>/g);
  return [...found].map((tag) => {
    const attrs = new Map<string, string>();
    for (const a of (tag[2] ?? '').matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs.set(
        a[1]!,
        decode(a[2] ?? a[3] ?? '')
          .trim()
          .toLowerCase(),
      );
    }
    let name = attrs.get('PartName') ?? '';
    try {
      name = decodeURIComponent(name);
    } catch {
      // A broken escape stays as written; it then names no part.
    }
    return {
      override: tag[1] === 'Override',
      contentType: attrs.get('ContentType') ?? '',
      partName: name,
    };
  });
}
