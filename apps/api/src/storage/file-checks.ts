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
  if (!entries) return MISMATCH;
  // Macro parts by name first, so a macro file is FILE_HAS_MACROS whatever its XML holds.
  const macroPart = (name: string) =>
    /^vba(project|data)/.test(name.slice(name.lastIndexOf('/') + 1));
  if ([...entries.keys()].some(macroPart)) return 'FILE_HAS_MACROS';
  const types = entries.get('[content_types].xml');
  const xml = types ? readEntry(buf, types) : null;
  // No DTDs (packages never have one), so only XML's own entities can appear. No NUL, and only
  // a UTF-8 or UTF-16 encoding (the bytes are read as one of those).
  if (xml === null || /<!doctype/i.test(xml) || xml.includes('\0')) return MISMATCH;
  if (!/^(?:utf-8|utf-16)$/i.test(declaredEncoding(xml) ?? 'utf-8')) return MISMATCH;
  if (/&(?!(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);)/i.test(xml)) return MISMATCH;
  const parts = declarations(xml);
  if (!parts) return MISMATCH;
  const macroType = /macroenabled|vbaproject|vbadata|macrosheet/;
  if (parts.some((p) => macroType.test(p.contentType))) return 'FILE_HAS_MACROS';
  // Office writes Default and Override with their own attributes only, never with a prefix.
  if (parts.some((p) => p.unusual)) return MISMATCH;
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
  // The end record's comment ends the file: nothing after it (a signature found inside a
  // comment, or bytes appended after the end record, is not this end record).
  if (eocd + 22 + buf.readUInt16LE(eocd + 20) !== buf.length) return null;
  let count = buf.readUInt16LE(eocd + 10);
  let size = buf.readUInt32LE(eocd + 12);
  let offset = buf.readUInt32LE(eocd + 16);
  const locator = eocd - 20;
  if (locator >= 0 && buf.readUInt32LE(locator) === 0x07064b50) {
    // ZIP64: the locator points at the ZIP64 end record, which ends where the locator starts,
    // and every end record field that is not all ones must say what the ZIP64 record says.
    const at = Number(buf.readBigUInt64LE(locator + 8));
    if (at + 56 > locator || buf.readUInt32LE(at) !== 0x06064b50) return null;
    if (at + 12 + Number(buf.readBigUInt64LE(at + 4)) !== locator) return null;
    const big = [32, 40, 48].map((o) => Number(buf.readBigUInt64LE(at + o)));
    const agrees = (small: number, ones: number, value: number) =>
      small === ones || small === value;
    if (
      !agrees(count, 0xffff, big[0]!) ||
      !agrees(size, ALL_ONES, big[1]!) ||
      !agrees(offset, ALL_ONES, big[2]!)
    ) {
      return null;
    }
    [count, size, offset] = big as [number, number, number];
  } else if (count === 0xffff || size === ALL_ONES || offset === ALL_ONES) {
    return null;
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
    // No NUL or other control character in a name (in its bytes, and once decoded).
    const rawName = buf.subarray(p + 46, p + 46 + nameLength!);
    if (rawName.some((b) => b < 0x20 || b === 0x7f)) return null;
    const decoded = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (flags & 0x800 && /\p{Cc}/u.test(decoded)) return null;
    const name = partName(decoded);
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

/** The encoding the XML declaration at the very start names, or null when it names none. */
function declaredEncoding(xml: string): string | null {
  const end = /^<\?xml[ \t\r\n]/.test(xml) ? xml.indexOf('?>') : -1;
  if (end < 0) return null;
  const found = /[ \t\r\n]encoding[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/.exec(
    xml.slice(0, end),
  );
  return found ? (found[1] ?? found[2] ?? '') : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (value: string) =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? '';
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

interface Declaration {
  override: boolean;
  /** Decoded, trimmed, lower case. */
  contentType: string;
  /** Decoded (entities, then %-escapes), trimmed, lower case. */
  partName: string;
  /** A prefix, or an attribute other than its own two: Office never writes either. */
  unusual: boolean;
}

const OWN_ATTRIBUTES = {
  Default: ['Extension', 'ContentType'],
  Override: ['PartName', 'ContentType'],
} as const;
const NAME = /[^\s<>"'=/]+/y;
const SPACE = /[ \t\r\n]*/y;

/** Moves past XML white space from `at`; returns the new position. */
function skipSpace(xml: string, at: number): number {
  SPACE.lastIndex = at;
  SPACE.exec(xml);
  return SPACE.lastIndex;
}

/**
 * A start tag at `lt`, read as an XML parser reads it: attribute values are quoted, so a `>`
 * inside one does not end the tag. Null when it is not well-formed (a value with `<`, an
 * attribute twice, no space between attributes).
 */
function startTag(xml: string, lt: number) {
  NAME.lastIndex = lt + 1;
  const name = NAME.exec(xml)?.[0];
  if (!name) return null;
  const attributes = new Map<string, string>();
  let at = NAME.lastIndex;
  for (;;) {
    const spaced = skipSpace(xml, at);
    if (xml.startsWith('/>', spaced)) return { name, attributes, end: spaced + 2 };
    if (xml[spaced] === '>') return { name, attributes, end: spaced + 1 };
    if (spaced === at) return null;
    NAME.lastIndex = spaced;
    const attribute = NAME.exec(xml)?.[0];
    if (!attribute || attributes.has(attribute)) return null;
    at = skipSpace(xml, NAME.lastIndex);
    if (xml[at] !== '=') return null;
    at = skipSpace(xml, at + 1);
    const quote = xml[at];
    if (quote !== '"' && quote !== "'") return null;
    const close = xml.indexOf(quote, at + 1);
    if (close < 0) return null;
    const value = xml.slice(at + 1, close);
    if (value.includes('<')) return null;
    attributes.set(attribute, value);
    at = close + 1;
  }
}

/**
 * The Default and Override declarations of [Content_Types].xml in document order, or null when
 * the XML is not well-formed. Comments, processing instructions and CDATA are skipped as a
 * parser skips them (each ends at its own terminator, nothing inside counts), so neither a
 * quoted `>` nor a comment opened inside a processing instruction hides a declaration. DTDs are
 * refused before this runs.
 */
function declarations(xml: string): Declaration[] | null {
  const found: Declaration[] = [];
  const skipTo = (from: number, end: string) => {
    const at = xml.indexOf(end, from);
    return at < 0 ? -1 : at + end.length;
  };
  // The XML declaration, only at the very start.
  let at = /^<\?xml[ \t\r\n]/.test(xml) ? skipTo(5, '?>') : 0;
  while (at >= 0 && at < xml.length) {
    const lt = xml.indexOf('<', at);
    if (lt < 0) break;
    if (xml.startsWith('<!--', lt)) at = skipTo(lt + 4, '-->');
    else if (xml.startsWith('<![CDATA[', lt)) at = skipTo(lt + 9, ']]>');
    else if (xml[lt + 1] === '?') {
      // A processing instruction; its target is never `xml` after the start.
      if (/^<\?xml(?![^\s?])/i.test(xml.slice(lt, lt + 6))) return null;
      at = skipTo(lt + 2, '?>');
    } else if (xml[lt + 1] === '!') return null;
    else if (xml[lt + 1] === '/') {
      at = skipTo(lt, '>');
      if (at >= 0 && !/^<\/[^\s<>"'=/]+[ \t\r\n]*>$/.test(xml.slice(lt, at))) return null;
    } else {
      const tag = startTag(xml, lt);
      if (!tag) return null;
      at = tag.end;
      const local = tag.name.slice(tag.name.indexOf(':') + 1);
      if (local !== 'Default' && local !== 'Override') continue;
      const own: readonly string[] = OWN_ATTRIBUTES[local];
      const value = (name: string) =>
        decode(tag.attributes.get(name) ?? '')
          .trim()
          .toLowerCase();
      let name = value('PartName');
      try {
        name = decodeURIComponent(name);
      } catch {
        // A broken escape stays as written; it then names no part.
      }
      found.push({
        override: local === 'Override',
        contentType: value('ContentType'),
        partName: name,
        unusual: local !== tag.name || [...tag.attributes.keys()].some((a) => !own.includes(a)),
      });
    }
  }
  return at < 0 ? null : found;
}
