// Synthetic files for the documents tests (R5): tiny PDFs and PNGs, Office Open XML packages
// built here as ZIPs, and the CFB container Office saves a password-protected file in.
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const pdf = (text = 'synthetic') => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
export const png = () =>
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48]);
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface ZipEntry {
  name: string;
  data: string | Buffer;
  /** 8 (deflate, the default) or 0 (stored); anything else is written as given. */
  method?: number;
  /** General purpose flags (1: encrypted). */
  flags?: number;
  /** The size the directory claims, when it should lie. */
  claimedSize?: number;
}

/** A ZIP with local headers, a central directory and its end record. */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data);
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(e.flags ?? 0, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc32(raw), 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(e.claimedSize ?? raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    central.push(dir, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const MAIN = { xlsx: '/xl/workbook.xml', docx: '/word/document.xml' };

/** [Content_Types].xml with the given overrides (part name to content type) and extra text. */
export function contentTypes(overrides: Record<string, string>, extra = ''): string {
  const parts = Object.entries(overrides)
    .map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `${extra}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `${parts}</Types>`
  );
}

/** A minimal, real-shaped .xlsx or .docx; `change` alters its parts before zipping. */
export function office(
  kind: 'xlsx' | 'docx',
  change: (parts: ZipEntry[]) => ZipEntry[] = (p) => p,
): Buffer {
  const main = MAIN[kind];
  const type = `${kind === 'xlsx' ? XLSX : DOCX}.main+xml`;
  return zip(
    change([
      { name: '[Content_Types].xml', data: contentTypes({ [main]: type }) },
      { name: '_rels/.rels', data: '<Relationships/>' },
      { name: main.slice(1), data: '<root>synthetic</root>' },
    ]),
  );
}

/**
 * A CFB (OLE2) file of 512-byte sectors: sector 0 holds the FAT, sector 1 the directory with the
 * root entry and the given stream names ("EncryptedPackage" for a password-protected file).
 */
export function cfb(streams: string[]): Buffer {
  const file = Buffer.alloc(512 * 3);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file, 0);
  file.writeUInt16LE(0x3e, 24);
  file.writeUInt16LE(3, 26);
  file.writeUInt16LE(0xfffe, 28);
  file.writeUInt16LE(9, 30);
  file.writeUInt16LE(6, 32);
  file.writeUInt32LE(1, 44); // one FAT sector
  file.writeUInt32LE(1, 48); // the directory starts at sector 1
  file.writeUInt32LE(0xfffffffe, 60);
  file.writeUInt32LE(0xfffffffe, 68); // no DIFAT sectors
  for (let i = 0; i < 109; i++) file.writeUInt32LE(i === 0 ? 0 : 0xffffffff, 76 + i * 4);
  const fat = 512;
  file.writeUInt32LE(0xfffffffd, fat); // sector 0: the FAT itself
  file.writeUInt32LE(0xfffffffe, fat + 4); // sector 1: the directory, one sector
  for (let i = 2; i < 128; i++) file.writeUInt32LE(0xffffffff, fat + i * 4);
  ['Root Entry', ...streams].forEach((name, i) => {
    const at = 1024 + i * 128;
    const encoded = Buffer.from(`${name}\0`, 'utf16le');
    encoded.copy(file, at);
    file.writeUInt16LE(encoded.length, at + 64);
    file.writeUInt8(i === 0 ? 5 : 2, at + 66);
  });
  return file;
}
