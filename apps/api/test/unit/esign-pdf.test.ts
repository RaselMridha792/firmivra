// R13 engine 1: Firm Sign's PDF engine. Every file here is synthetic, made in the test.
import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFPage,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  compose,
  type EngineFile,
  EsignEngineError,
  flatten,
  inspect,
  sha256,
  stamp,
} from '../../src/esign/engine/pdf.service.js';

async function pdf(sizes: [number, number][], rotate = 0) {
  const doc = await PDFDocument.create();
  for (const size of sizes) doc.addPage(size).setRotation(degrees(rotate));
  return doc.save({ useObjectStreams: false });
}

/** A solid RGB PNG, built byte by byte. */
function png(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** The markers pdf-lib reads from a JPEG (SOI, a baseline SOF0 with the size, EOI). */
function jpeg(width: number, height: number) {
  const sof = [0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 255, width >> 8, width & 255];
  const components = [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...sof, ...components, 0xff, 0xd9]);
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EsignEngineError);
  return (error as EsignEngineError).code;
}

function content(page: PDFPage) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams
    .map((ref) => page.doc.context.lookup(ref))
    .map((s) =>
      s instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')
        : '',
    )
    .join('\n');
}

const file = (contentType: EngineFile['contentType'], bytes: Uint8Array): EngineFile => ({
  documentId: randomUUID(),
  contentType,
  bytes,
});

describe('inspect', () => {
  it('reads page count and sizes, with the page’s own rotation', async () => {
    expect(
      await inspect(
        await pdf([
          [612, 792],
          [300, 400],
        ]),
        'application/pdf',
      ),
    ).toEqual({
      pageCount: 2,
      pageSizes: [
        { width: 612, height: 792 },
        { width: 300, height: 400 },
      ],
    });
    const turned = await inspect(await pdf([[300, 400]], 90), 'application/pdf');
    expect(turned.pageSizes).toEqual([{ width: 400, height: 300 }]);
  });

  it('refuses an encrypted PDF', async () => {
    const text = Buffer.from(await pdf([[612, 792]])).toString('latin1');
    const encrypted = text.replace(
      /trailer\s*<</,
      (m) => `${m}\n/Encrypt << /Filter /Standard /V 1 /R 2 /P -4 /O <00> /U <00> >>`,
    );
    expect(encrypted).not.toBe(text);
    const bytes = Buffer.from(encrypted, 'latin1');
    expect(await refusal(inspect(bytes, 'application/pdf'))).toBe('PDF_ENCRYPTED');
    const locked = file('application/pdf', bytes);
    const plan = [{ documentId: locked.documentId, page: 0, rotation: 0 as const }];
    expect(await refusal(compose([locked], plan))).toBe('PDF_ENCRYPTED');
  });

  it('refuses unreadable files', async () => {
    const garbage = Buffer.from('%PDF-1.7 this is not really a PDF', 'latin1');
    expect(await refusal(inspect(garbage, 'application/pdf'))).toBe('PDF_UNREADABLE');
    expect(await refusal(inspect(Buffer.from('nope'), 'application/pdf'))).toBe('PDF_UNREADABLE');
    expect(await refusal(inspect(Buffer.from('nope'), 'image/png'))).toBe('PDF_UNREADABLE');
    expect(await refusal(inspect(Buffer.from('nope'), 'image/jpeg'))).toBe('PDF_UNREADABLE');
  });

  it('refuses more than 100 pages', async () => {
    const sizes = Array.from({ length: 101 }, (): [number, number] => [200, 200]);
    expect(await refusal(inspect(await pdf(sizes), 'application/pdf'))).toBe('TOO_MANY_PAGES');
    expect((await inspect(await pdf(sizes.slice(1)), 'application/pdf')).pageCount).toBe(100);
  });

  it('makes an image one US Letter page, turned to its shape', async () => {
    expect(await inspect(png(30, 20), 'image/png')).toEqual({
      pageCount: 1,
      pageSizes: [{ width: 792, height: 612 }],
    });
    expect(await inspect(jpeg(20, 30), 'image/jpeg')).toEqual({
      pageCount: 1,
      pageSizes: [{ width: 612, height: 792 }],
    });
  });
});

describe('compose', () => {
  it('builds the packet in plan order with each rotation', async () => {
    const a = file(
      'application/pdf',
      await pdf([
        [612, 792],
        [500, 400],
      ]),
    );
    const b = file('application/pdf', await pdf([[300, 400]], 90));
    const image = file('image/png', png(30, 20));
    const photo = file('image/jpeg', jpeg(20, 30));
    const packet = await compose(
      [a, b, image, photo],
      [
        { documentId: a.documentId, page: 1, rotation: 90 },
        { documentId: b.documentId, page: 0, rotation: 90 },
        { documentId: image.documentId, page: 0, rotation: 0 },
        { documentId: a.documentId, page: 0, rotation: 180 },
        { documentId: photo.documentId, page: 0, rotation: 270 },
        { documentId: a.documentId, page: 1, rotation: 0 },
      ],
    );
    const shown = [
      { width: 400, height: 500 },
      { width: 300, height: 400 },
      { width: 792, height: 612 },
      { width: 612, height: 792 },
      { width: 792, height: 612 },
      { width: 500, height: 400 },
    ];
    expect(packet).toMatchObject({ pageCount: 6, pageSizes: shown });
    expect(packet.sha256).toBe(sha256(packet.bytes));

    const doc = await PDFDocument.load(packet.bytes);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 180, 0, 180, 270, 0]);
    expect(doc.getPages().map((p) => p.getSize())).toEqual([
      { width: 500, height: 400 },
      { width: 300, height: 400 },
      { width: 792, height: 612 },
      { width: 612, height: 792 },
      { width: 612, height: 792 },
      { width: 500, height: 400 },
    ]);
    expect(await inspect(packet.bytes, 'application/pdf')).toEqual({
      pageCount: 6,
      pageSizes: shown,
    });
  });

  it('gives the same bytes for the same input', async () => {
    const a = file('application/pdf', await pdf([[612, 792]]));
    const plan = [{ documentId: a.documentId, page: 0, rotation: 90 as const }];
    expect((await compose([a], plan)).sha256).toBe((await compose([a], plan)).sha256);
  });

  it('refuses a plan beyond 100 pages or a page the file does not have', async () => {
    const a = file('application/pdf', await pdf([[612, 792]]));
    const page = { documentId: a.documentId, page: 0, rotation: 0 as const };
    expect(await refusal(compose([a], Array(101).fill(page)))).toBe('TOO_MANY_PAGES');
    await expect(compose([a], [{ ...page, page: 1 }])).rejects.toThrow(RangeError);
    await expect(compose([], [page])).rejects.toThrow(RangeError);
  });
});

describe('stamp and flatten', () => {
  it('stamps text in any script, checks and a PNG signature', async () => {
    const a = file('application/pdf', await pdf([[612, 792]]));
    const { bytes } = await compose([a], [{ documentId: a.documentId, page: 0, rotation: 0 }]);
    const box = { pageIndex: 0, x: 0.1, y: 0.1, w: 0.4, h: 0.04 };
    const stamped = await stamp(bytes, [
      { ...box, kind: 'text', text: 'Zoë Ångström' },
      { ...box, y: 0.2, kind: 'text', text: 'Ζωή Παπαδοπούλου, Жанна Петрова' },
      { ...box, y: 0.3, kind: 'text', text: 'জয়া রহমান' }, // outside Noto Sans: drawn as boxes
      { ...box, y: 0.4, kind: 'check' },
      { ...box, y: 0.5, kind: 'image', png: png(8, 4) },
    ]);
    const page = (await PDFDocument.load(stamped)).getPage(0);
    expect(content(page)).toMatch(/\bTf\b[\s\S]*\bTj\b/);
    expect(content(page)).toMatch(/\bDo\b/);
  });

  it('places a box on a rotated page where the editor showed it', async () => {
    const a = file('application/pdf', await pdf([[612, 792]]));
    const { bytes } = await compose([a], [{ documentId: a.documentId, page: 0, rotation: 90 }]);
    // Shown as 792 x 612. The box's top-left quarter is 396 x 306; a square image centres in it.
    const stamped = await stamp(bytes, [
      { pageIndex: 0, x: 0, y: 0, w: 0.5, h: 0.5, kind: 'image', png: png(4, 4) },
    ]);
    const drawn = content((await PDFDocument.load(stamped)).getPage(0));
    expect(drawn).toContain('0 1 -1 0 612 0 cm'); // shown space -> page space for /Rotate 90
    expect(drawn).toContain('1 0 0 1 45 306 cm');
  });

  it('flattens form fields and removes the form', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const field = doc.getForm().createTextField('client.name');
    field.setText('Synthetic Client');
    field.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    const before = await doc.save({ useObjectStreams: false });
    const packet = await compose(
      [file('application/pdf', before)].map((f) => ({ ...f, documentId: 'f' })),
      [{ documentId: 'f', page: 0, rotation: 0 }],
    );
    for (const bytes of [before, packet.bytes]) {
      const flattened = await flatten(bytes, new Date('2026-10-18T00:00:00Z'));
      const flat = await PDFDocument.load(flattened, { updateMetadata: false });
      expect(flat.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
      expect(flat.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
      expect(content(flat.getPage(0))).toMatch(/FlatWidget-\d+ Do/);
      expect(flat.getProducer()).toBe('Firmivra Firm Sign');
    }
  });

  it('gives the same hash for the same input and time', async () => {
    const a = file('application/pdf', await pdf([[612, 792]]));
    const at = new Date('2026-10-18T09:30:00Z');
    const signed = async (when: Date) => {
      const { bytes } = await compose([a], [{ documentId: a.documentId, page: 0, rotation: 0 }]);
      const stamps = [
        { pageIndex: 0, x: 0.1, y: 0.8, w: 0.3, h: 0.05, kind: 'text' as const, text: 'Zoë' },
        { pageIndex: 0, x: 0.5, y: 0.8, w: 0.3, h: 0.05, kind: 'image' as const, png: png(6, 3) },
      ];
      return sha256(await flatten(await stamp(bytes, stamps), when));
    };
    const first = await signed(at);
    expect(await signed(at)).toBe(first);
    expect(await signed(new Date('2026-10-18T09:31:00Z'))).not.toBe(first);
  });
});
