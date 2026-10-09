// Synthetic files for the Firm Sign engine's unit tests (R18). No real documents.
import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFString, StandardFonts, degrees } from 'pdf-lib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A PNG from its IHDR fields and raw IDAT bytes, every CRC right: for broken-image tests. */
export function rawPng(
  ihdr: { width: number; height: number; depth: number; colour: number; lace?: number },
  idat: Buffer,
): Uint8Array {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(ihdr.width, 0);
  h.writeUInt32BE(ihdr.height, 4);
  h.set([ihdr.depth, ihdr.colour, 0, 0, ihdr.lace ?? 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', h),
      chunk('IDAT', idat),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** A real RGBA PNG of `width` x `height`, a dark stroke on transparent; `noise` makes it big. */
export function png(width: number, height: number, { noise = false } = {}): Uint8Array {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * (width * 4 + 1) + 1 + x * 4;
      const on = noise || Math.abs(y - height / 2) < 2;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw.set(
        noise
          ? [seed & 255, (seed >> 8) & 255, (seed >> 16) & 255, 255]
          : [20, 30, 60, on ? 255 : 0],
        at,
      );
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** A 4x2 baseline JPEG (grey). */
export const JPG_4X2 = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAACAAQBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==',
    'base64',
  ),
);

/** A 4x2 JPEG whose EXIF says to show it turned 90 degrees clockwise (a phone photo). */
export const JPG_4X2_EXIF_90 = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAACAAQBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/ACv/2Q==',
    'base64',
  ),
);

/** A PDF of `sizes.length` pages, each labelled "Page N (fake)"; `rotate` sets each page's /Rotate. */
export async function pdf(
  sizes: [number, number][],
  { rotate = [] as number[], mediaOrigin = [0, 0] as [number, number] } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  sizes.forEach(([w, h], i) => {
    const page = doc.addPage([w, h]);
    const [ox, oy] = mediaOrigin;
    if (ox || oy) page.setMediaBox(ox, oy, w, h);
    page.drawText(`Page ${i + 1} (fake)`, { x: ox + 20, y: oy + h - 40, size: 14, font });
    if (rotate[i]) page.setRotation(degrees(rotate[i]!));
  });
  return doc.save();
}

/** A PDF whose trailer names an /Encrypt dictionary, as a password-protected file does. */
export async function encryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 2,
    R: 3,
    O: PDFString.of('x'),
    U: PDFString.of('y'),
    P: -4,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}

/** A PDF whose AcroForm carries XFA. */
export async function xfaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.catalog.set(
    PDFName.of('AcroForm'),
    doc.context.obj({ Fields: [], XFA: PDFString.of('<xdp/>') }),
  );
  return doc.save();
}

/** A PDF with one filled text field and one checked box, for flatten tests. */
export async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const name = form.createTextField('fake.name');
  name.setText('Fake Person');
  name.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  const box = form.createCheckBox('fake.agree');
  box.check();
  box.addToPage(page, { x: 50, y: 650, width: 12, height: 12 });
  return doc.save();
}
