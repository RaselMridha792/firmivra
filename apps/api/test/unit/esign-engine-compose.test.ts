// Unit tests for R18 step 3, the Firm Sign engine's inspect and compose: page counts and shown
// sizes, refusals (encrypted, malformed, XFA, over 100 pages), the page plan's order and
// rotation, and JPG and PNG files becoming one page each.
import { randomUUID } from 'node:crypto';
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { EsignEngineError, type SourceFile } from '../../src/esign/engine/engine.types.js';
import { compose, imagePageSize, inspect } from '../../src/esign/engine/pdf-compose.js';
import {
  encryptedPdf,
  JPG_4X2,
  JPG_4X2_EXIF_90,
  pdf,
  png,
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
