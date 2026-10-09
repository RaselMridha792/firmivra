// Unit tests for R18 step 3, the Firm Sign engine's inspect and compose: page counts and shown
// sizes, refusals (encrypted, malformed, XFA, over 100 pages), the page plan's order and
// rotation, and JPG and PNG files becoming one page each.
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EsignEngineError, type SourceFile } from '../../src/esign/engine/engine.types.js';
import { compose, imagePageSize, inspect } from '../../src/esign/engine/pdf-compose.js';
import { parsePng } from '../../src/esign/engine/images.js';
import {
  encryptedPdf,
  JPG_4X2,
  JPG_4X2_EXIF_90,
  pdf,
  png,
  rawPng,
  xfaPdf,
} from './esign-engine-fixtures.js';

const PDF = 'application/pdf' as const;
const refusal = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EsignEngineError);
  return (error as EsignEngineError).code;
};

describe('inspect', () => {
  it('reads page count and sizes', async () => {
    const bytes = await pdf([
      [612, 792],
      [842, 595],
    ]);
    expect(await inspect({ contentType: PDF, bytes })).toEqual({
      pageCount: 2,
      pageSizes: [
        { width: 612, height: 792 },
        { width: 842, height: 595 },
      ],
    });
  });

  it("gives a page's size as shown, after its own /Rotate", async () => {
    const bytes = await pdf([[612, 792]], { rotate: [90] });
    expect((await inspect({ contentType: PDF, bytes })).pageSizes).toEqual([
      { width: 792, height: 612 },
    ]);
  });

  it('refuses encrypted files', async () => {
    expect(await refusal(inspect({ contentType: PDF, bytes: await encryptedPdf() }))).toBe(
      'PDF_ENCRYPTED',
    );
  });

  it('refuses malformed and XFA files', async () => {
    const junk = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf (fake)');
    expect(await refusal(inspect({ contentType: PDF, bytes: junk }))).toBe('PDF_UNREADABLE');
    expect(await refusal(inspect({ contentType: PDF, bytes: await xfaPdf() }))).toBe(
      'PDF_UNREADABLE',
    );
    const badImage = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(await refusal(inspect({ contentType: 'image/png', bytes: badImage }))).toBe(
      'PDF_UNREADABLE',
    );
  });

  it('refuses files over 10 MB', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode('%PDF-1.7'));
    expect(await refusal(inspect({ contentType: PDF, bytes: big }))).toBe('PDF_UNREADABLE');
    expect(await refusal(inspect({ contentType: 'image/png', bytes: big }))).toBe('PDF_UNREADABLE');
  });

  it('refuses huge images from their header, before decoding', async () => {
    const huge = png(1, 1);
    new DataView(huge.buffer).setUint32(16, 20_000); // IHDR width
    expect(await refusal(inspect({ contentType: 'image/png', bytes: huge }))).toBe(
      'PDF_UNREADABLE',
    );
  });

  it('shows a phone photo upright (EXIF orientation)', async () => {
    expect(await inspect({ contentType: 'image/jpeg', bytes: JPG_4X2_EXIF_90 })).toEqual({
      pageCount: 1,
      pageSizes: [{ width: 396, height: 792 }],
    });
  });

  it('refuses more than 100 pages', async () => {
    const bytes = await pdf(Array.from({ length: 101 }, () => [200, 200] as [number, number]));
    expect(await refusal(inspect({ contentType: PDF, bytes }))).toBe('TOO_MANY_PAGES');
  });

  it('makes one Letter-fitted page of an image', async () => {
    expect(await inspect({ contentType: 'image/png', bytes: png(300, 100) })).toEqual({
      pageCount: 1,
      pageSizes: [{ width: 792, height: 264 }],
    });
    expect(await inspect({ contentType: 'image/jpeg', bytes: JPG_4X2 })).toEqual({
      pageCount: 1,
      pageSizes: [{ width: 792, height: 396 }],
    });
    expect(imagePageSize(1000, 3000)).toEqual({ width: 264, height: 792 });
  });
});

describe('compose', () => {
  const file = async (sizes: [number, number][], rotate: number[] = []): Promise<SourceFile> => ({
    documentId: randomUUID(),
    contentType: PDF,
    bytes: await pdf(sizes, { rotate }),
  });

  it('follows the plan: order, left-out pages, several files, rotation', async () => {
    const a = await file([
      [100, 200],
      [110, 210],
      [120, 220],
    ]);
    const b = await file([[300, 400]], [90]);
    const out = await PDFDocument.load(
      await compose(
        [a, b],
        [
          { documentId: a.documentId, page: 2, rotation: 0 },
          { documentId: b.documentId, page: 0, rotation: 90 },
          { documentId: a.documentId, page: 0, rotation: 270 },
        ],
      ),
    );
    const pages = out.getPages().map((p) => ({
      ...p.getSize(),
      rotation: p.getRotation().angle,
    }));
    expect(pages).toEqual([
      { width: 120, height: 220, rotation: 0 },
      // Its own 90 plus the plan's 90.
      { width: 300, height: 400, rotation: 180 },
      { width: 100, height: 200, rotation: 270 },
    ]);
  });

  it('takes the same page twice when the plan says so', async () => {
    const a = await file([[100, 100]]);
    const page = { documentId: a.documentId, page: 0, rotation: 0 } as const;
    const out = await PDFDocument.load(await compose([a], [page, page]));
    expect(out.getPageCount()).toBe(2);
    // Each copy has its own content, so a stamp on one never shows on the other.
    const [one, two] = out.getPages().map((p) => p.node.get(PDFName.of('Contents')));
    expect(String(one)).not.toBe(String(two));
  });

  it('turns JPG and PNG files into pages of their inspected size', async () => {
    const jpg: SourceFile = { documentId: randomUUID(), contentType: 'image/jpeg', bytes: JPG_4X2 };
    const pic: SourceFile = {
      documentId: randomUUID(),
      contentType: 'image/png',
      bytes: png(100, 300),
    };
    const out = await PDFDocument.load(
      await compose(
        [jpg, pic],
        [
          { documentId: pic.documentId, page: 0, rotation: 90 },
          { documentId: jpg.documentId, page: 0, rotation: 0 },
        ],
      ),
    );
    expect(out.getPages().map((p) => [p.getSize(), p.getRotation().angle])).toEqual([
      [{ width: 264, height: 792 }, 90],
      [{ width: 792, height: 396 }, 0],
    ]);
  });

  it('turns a phone photo by its EXIF orientation, then by the plan', async () => {
    const photo: SourceFile = {
      documentId: randomUUID(),
      contentType: 'image/jpeg',
      bytes: JPG_4X2_EXIF_90,
    };
    const out = await PDFDocument.load(
      await compose([photo], [{ documentId: photo.documentId, page: 0, rotation: 90 }]),
    );
    const page = out.getPage(0);
    // Stored landscape (792x396), shown upright after EXIF's 90, then the plan's 90.
    expect([page.getSize(), page.getRotation().angle]).toEqual([{ width: 792, height: 396 }, 180]);
  });

  it('refuses a plan over 100 pages and an encrypted file', async () => {
    const a = await file([[100, 100]]);
    const page = { documentId: a.documentId, page: 0, rotation: 0 } as const;
    expect(
      await refusal(
        compose(
          [a],
          Array.from({ length: 101 }, () => page),
        ),
      ),
    ).toBe('TOO_MANY_PAGES');
    const locked: SourceFile = {
      documentId: randomUUID(),
      contentType: PDF,
      bytes: await encryptedPdf(),
    };
    expect(
      await refusal(compose([locked], [{ documentId: locked.documentId, page: 0, rotation: 0 }])),
    ).toBe('PDF_ENCRYPTED');
  });

  it('throws on a plan that names a missing file or page', async () => {
    const a = await file([[100, 100]]);
    await expect(
      compose([a], [{ documentId: randomUUID(), page: 0, rotation: 0 }]),
    ).rejects.toThrow();
    await expect(
      compose([a], [{ documentId: a.documentId, page: 3, rotation: 0 }]),
    ).rejects.toThrow();
  });
});

describe('PNG checks', () => {
  const rgba = (w: number, h: number) => Buffer.alloc((w * 4 + 1) * h);

  it('accepts real PNGs, interlaced ones too', () => {
    expect(parsePng(png(30, 10))).toEqual({ width: 30, height: 10 });
    // Adam7 rows for 3x3 RGBA: passes 1, 4, 5, 6 (two rows) and 7; passes 2 and 3 are empty.
    const laced = Buffer.alloc(5 + 5 + 9 + 2 * 5 + 13);
    expect(
      parsePng(rawPng({ width: 3, height: 3, depth: 8, colour: 6, lace: 1 }, deflateSync(laced))),
    ).toBeDefined();
  });

  it('refuses image data that does not inflate to the expected length, quickly', async () => {
    const garbage = rawPng(
      { width: 1, height: 1, depth: 8, colour: 6 },
      Buffer.from('not zlib data'),
    );
    expect(parsePng(garbage)).toBeUndefined();
    const short = rawPng({ width: 10, height: 10, depth: 8, colour: 6 }, deflateSync(rgba(10, 9)));
    expect(parsePng(short)).toBeUndefined();
    const long = rawPng({ width: 10, height: 10, depth: 8, colour: 6 }, deflateSync(rgba(10, 11)));
    expect(parsePng(long)).toBeUndefined();
    const started = Date.now();
    expect(await refusal(inspect({ contentType: 'image/png', bytes: garbage }))).toBe(
      'PDF_UNREADABLE',
    );
    const files = [{ documentId: 'a', contentType: 'image/png' as const, bytes: garbage }];
    expect(await refusal(compose(files, [{ documentId: 'a', page: 0, rotation: 0 }]))).toBe(
      'PDF_UNREADABLE',
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses IHDR fields the spec does not allow, a bad filter byte and a missing palette', () => {
    const ok = deflateSync(rgba(2, 2));
    expect(parsePng(rawPng({ width: 2, height: 2, depth: 3, colour: 9 }, ok))).toBeUndefined();
    expect(parsePng(rawPng({ width: 2, height: 2, depth: 4, colour: 6 }, ok))).toBeUndefined();
    const badFilter = rgba(2, 2);
    badFilter[0] = 9;
    expect(
      parsePng(rawPng({ width: 2, height: 2, depth: 8, colour: 6 }, deflateSync(badFilter))),
    ).toBeUndefined();
    expect(
      parsePng(rawPng({ width: 2, height: 2, depth: 8, colour: 3 }, deflateSync(Buffer.alloc(6)))),
    ).toBeUndefined();
  });

  it('refuses a bad CRC and a huge pixel count from the header alone', () => {
    const bytes = png(4, 4);
    bytes[bytes.length - 20]! ^= 0xff; // inside IDAT
    expect(parsePng(bytes)).toBeUndefined();
    const huge = rawPng({ width: 16000, height: 16000, depth: 8, colour: 6 }, Buffer.alloc(10));
    expect(parsePng(huge)).toBeUndefined();
  });
});

describe('page boxes and the page tree', () => {
  it('normalises a reversed MediaBox and clips the CropBox to the MediaBox', async () => {
    const doc = await PDFDocument.create();
    const reversed = doc.addPage([600, 800]);
    reversed.setMediaBox(600, 800, -600, -800);
    const big = doc.addPage([600, 800]);
    big.setCropBox(-200, -150, 1000, 1100);
    const offset = doc.addPage([600, 800]);
    offset.setMediaBox(100, 50, 600, 800);
    const { pageSizes } = await inspect({ contentType: PDF, bytes: await doc.save() });
    expect(pageSizes).toEqual([
      { width: 600, height: 800 },
      { width: 600, height: 800 },
      { width: 600, height: 800 },
    ]);
  });

  it('refuses a /Rotate that is not a multiple of 90', async () => {
    const doc = await PDFDocument.load(await pdf([[600, 800]]));
    doc.getPage(0).node.set(PDFName.of('Rotate'), doc.context.obj(45));
    expect(await refusal(inspect({ contentType: PDF, bytes: await doc.save() }))).toBe(
      'PDF_UNREADABLE',
    );
  });

  it('refuses a page tree that lists the same node twice, quickly', async () => {
    const doc = await PDFDocument.load(await pdf([[600, 800]]));
    const ctx = doc.context;
    let node = doc.getPage(0).ref;
    for (let depth = 0; depth < 22; depth++) {
      node = ctx.register(ctx.obj({ Type: 'Pages', Kids: [node, node], Count: 2 ** (depth + 1) }));
    }
    doc.catalog.set(PDFName.of('Pages'), node);
    const started = Date.now();
    const code = await refusal(inspect({ contentType: PDF, bytes: await doc.save() }));
    expect(['PDF_UNREADABLE', 'TOO_MANY_PAGES']).toContain(code);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('left-out pages', () => {
  it('never reach the packet through a link or a shared form field', async () => {
    const src = await PDFDocument.load(
      await pdf([
        [600, 800],
        [600, 800],
      ]),
    );
    const ctx = src.context;
    const [kept, dropped] = src.getPages();
    // A link on the kept page to the dropped page, and one field with a widget on each page.
    const link = ctx.register(
      ctx.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [0, 0, 10, 10],
        Dest: [dropped!.ref, 'Fit'],
      }),
    );
    const field = ctx.register(
      ctx.obj({ FT: 'Tx', T: PDFString.of('name'), V: PDFString.of('x') }),
    );
    const widget = (page: typeof kept) =>
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Widget',
          Rect: [0, 0, 10, 10],
          Parent: field,
          P: page!.ref,
        }),
      );
    const w1 = widget(kept);
    const w2 = widget(dropped);
    ctx.lookup(field, PDFDict).set(PDFName.of('Kids'), ctx.obj([w1, w2]));
    kept!.node.set(PDFName.of('Annots'), ctx.obj([link, w1]));
    dropped!.node.set(PDFName.of('Annots'), ctx.obj([w2]));
    const files = [{ documentId: 'a', contentType: PDF, bytes: await src.save() }];
    const doc = await PDFDocument.load(
      await compose(files, [{ documentId: 'a', page: 0, rotation: 0 }]),
    );
    const objects = [...doc.context.enumerateIndirectObjects()].map(([, o]) => o);
    const pages = objects.filter(
      (o) => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Page'),
    );
    expect(pages).toHaveLength(1);
    const widgets = objects.filter(
      (o) => o instanceof PDFDict && o.get(PDFName.of('Subtype')) === PDFName.of('Widget'),
    );
    expect(widgets).toHaveLength(1);
    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(2);
    const kept1 = doc.context.lookup(annots.get(1), PDFDict);
    const parent = kept1.lookup(PDFName.of('Parent'), PDFDict);
    expect(parent.lookup(PDFName.of('Kids'), PDFArray).size()).toBe(1);
  });
});
