// Unit tests for R18 step 6, finalize: values and signature images land at their field box in
// every page rotation and on a page whose MediaBox doesn't start at 0,0; form fields are
// flattened (also after compose); one signature page per signer; Noto Sans prints non-Latin names.
// Hardening: looping field trees, fields pdf-lib can't flatten, hidden widgets, action chains.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  type PDFPage,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { FieldBox } from '../../src/esign/engine/engine.types.js';
import { compose } from '../../src/esign/engine/pdf-compose.js';
import {
  embedNoto,
  finalize,
  notoSans,
  placeBox,
  printableWith,
} from '../../src/esign/engine/pdf-finalize.js';
import { formPdf, pdf, png } from './esign-engine-fixtures.js';

/** What a viewer does: a point of the page's own space to shown fractions, top-left origin. */
function toShown(page: PDFPage, x: number, y: number) {
  const r = page.getRotation().angle % 360;
  const c = page.getCropBox();
  const [u, v] = [x - c.x, y - c.y];
  const [w, h] = [c.width, c.height];
  const [sx, sy, sw, sh] =
    r === 90
      ? [v, u, h, w]
      : r === 180
        ? [w - u, v, w, h]
        : r === 270
          ? [h - v, w - u, h, w]
          : [u, h - v, w, h];
  return { fx: sx / sw, fy: sy / sh };
}

const decode = (s: PDFRawStream) =>
  s.dict.get(PDFName.of('Filter'))
    ? inflateSync(s.contents).toString('latin1')
    : Buffer.from(s.contents).toString('latin1');

/** The page's decoded content, all streams joined. */
function content(page: PDFPage): string {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
  return streams.map((ref) => decode(page.doc.context.lookup(ref!) as PDFRawStream)).join('\n');
}

/** Every stream of the document, decoded and joined (appearance streams included). */
const allStreams = (doc: PDFDocument) =>
  doc.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) => (o instanceof PDFRawStream ? [decode(o)] : []))
    .join('\n');

/** `text` as finalize draws it in Noto Sans: the glyph ids, as a hex string. */
async function notoHex(text: string): Promise<string> {
  const font = await embedNoto(await PDFDocument.create());
  return font.encodeText(text).toString();
}

const widgetsLeft = (doc: PDFDocument) =>
  doc
    .getPages()
    .flatMap((p) => p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray() ?? [])
    .map((ref) => doc.context.lookup(ref, PDFDict))
    .filter((a) => a.get(PDFName.of('Subtype')) === PDFName.of('Widget'));

const noStamps = { stamps: [], signaturePages: [], timeZone: 'UTC' };

const box: FieldBox = { pageIndex: 0, x: 0.2, y: 0.3, w: 0.4, h: 0.1 };

describe.each([0, 90, 180, 270])('a page turned %i degrees', (rotation) => {
  it.each([
    ['at 0,0', [0, 0] as [number, number]],
    ['with a MediaBox at 50,100', [50, 100] as [number, number]],
  ])('places the box %s', async (_label, mediaOrigin) => {
    const doc = await PDFDocument.load(
      await pdf([[400, 600]], { rotate: [rotation], mediaOrigin }),
    );
    const page = doc.getPage(0);
    const placed = placeBox(page, box);
    const bottomLeft = placed.at(0, 0);
    const topRight = placed.at(placed.w, placed.h);
    const a = toShown(page, bottomLeft.x, bottomLeft.y);
    const b = toShown(page, topRight.x, topRight.y);
    expect(a.fx).toBeCloseTo(box.x, 6);
    expect(a.fy).toBeCloseTo(box.y + box.h, 6);
    expect(b.fx).toBeCloseTo(box.x + box.w, 6);
    expect(b.fy).toBeCloseTo(box.y, 6);
    expect(placed.rotate.angle).toBe(rotation);
  });

  it('stamps the signature image inside its box, turned with the page', async () => {
    const packet = await pdf([[400, 600]], { rotate: [rotation], mediaOrigin: [50, 100] });
    // A 4:1 image in a box that is 4:1 as shown fills the box exactly.
    const shownW = rotation % 180 ? 600 : 400;
    const shownH = rotation % 180 ? 400 : 600;
    const field = { ...box, h: (box.w * shownW) / 4 / shownH };
    const out = await PDFDocument.load(
      await finalize(packet, {
        stamps: [{ ...field, kind: 'IMAGE', png: png(400, 100) }],
        signaturePages: [],
        timeZone: 'America/New_York',
      }),
    );
    const page = out.getPage(0);
    const ops = content(page);
    // drawImage: q, translate (the image's bottom-left), rotate, scale, Do.
    const match =
      /1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm\s+(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) 0 0 cm[\s\S]*?\/Image[-\w]* Do/.exec(
        ops,
      );
    expect(match).not.toBeNull();
    const at = toShown(page, Number(match![1]), Number(match![2]));
    expect(at.fx).toBeCloseTo(field.x, 3);
    expect(at.fy).toBeCloseTo(field.y + field.h, 3);
    const angle = Math.round((Math.atan2(Number(match![4]), Number(match![3])) * 180) / Math.PI);
    expect((angle + 360) % 360).toBe(rotation);
  });
});

describe('finalize', () => {
  it('prints text and checks', async () => {
    const out = await PDFDocument.load(
      await finalize(await pdf([[612, 792]]), {
        stamps: [
          { ...box, kind: 'TEXT', text: 'Fake Name\nLine' },
          { ...box, y: 0.5, kind: 'CHECK', checked: true },
          { ...box, y: 0.7, kind: 'CHECK', checked: false },
        ],
        signaturePages: [],
        timeZone: 'UTC',
      }),
    );
    const ops = content(out.getPage(0));
    expect(ops.match(/ Tj/g)?.length).toBe(3); // the fixture label, the name, the X
  });

  it('flattens form fields, also after compose', async () => {
    const form = await formPdf();
    const id = randomUUID();
    const packet = await compose(
      [{ documentId: id, contentType: 'application/pdf', bytes: form }],
      [{ documentId: id, page: 0, rotation: 90 }],
    );
    for (const input of [form, packet]) {
      const out = await PDFDocument.load(
        await finalize(input, { stamps: [], signaturePages: [], timeZone: 'UTC' }),
      );
      expect(out.getForm().getFields()).toHaveLength(0);
      const annots = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      expect(annots?.size() ?? 0).toBe(0);
      expect(content(out.getPage(0))).toMatch(/FlatWidget[-\w]* Do/);
    }
  });

  it('adds one signature page per signer, names in any script', async () => {
    const signedAt = new Date('2026-10-09T02:30:00Z');
    const signers = [
      { name: 'Fake Person', signaturePng: png(300, 100), signedAt },
      { name: 'Ёлка Ψηφίο Nguyễn', signaturePng: png(300, 100), signedAt },
    ];
    const out = await PDFDocument.load(
      await finalize(await pdf([[612, 792]]), {
        stamps: [],
        signaturePages: signers,
        timeZone: 'America/New_York',
      }),
    );
    expect(out.getPageCount()).toBe(3);
    const page = content(out.getPage(2));
    expect(page).toMatch(/\/Image[-\w]* Do/);
    // Noto Sans is embedded (a Type0 font), so every character has a glyph.
    const fonts = out.getPage(2).node.Resources()!.lookup(PDFName.of('Font'));
    expect(String(fonts)).toMatch(/NotoSans/);
    expect(
      String(
        out.context
          .enumerateIndirectObjects()
          .map(([, o]) => String(o))
          .join(),
      ),
    ).toMatch(/\/Subtype \/Type0/);
  });

  it('dates the signature page in the firm time zone', async () => {
    const { printable } = await import('../../src/esign/engine/pdf-finalize.js');
    expect(printable(' a\tb\nc ')).toBe('a b c');
    const signedAt = new Date('2026-10-09T02:30:00Z'); // still October 8 in New York
    const out = await PDFDocument.load(
      await finalize(await pdf([[612, 792]]), {
        stamps: [],
        signaturePages: [{ name: 'Fake Person', signaturePng: png(300, 100), signedAt }],
        timeZone: 'America/New_York',
      }),
    );
    expect(out.getPageCount()).toBe(2);
    const page = content(out.getPage(1));
    expect(page).toContain(`${await notoHex('October 8, 2026')} Tj`);
    expect(page).not.toContain(await notoHex('October 9, 2026'));
  });

  it("prints '?' for each character Noto Sans has no glyph for", async () => {
    const font = await embedNoto(await PDFDocument.create());
    expect(printableWith(font, '王小明 Ёлка\tNguyễn')).toBe('??? Ёлка Nguyễn');
    expect(printableWith(font, 'محمد')).toBe('????');
    const out = await PDFDocument.load(
      await finalize(await pdf([[612, 792]]), {
        stamps: [{ ...box, kind: 'TEXT', text: '王小明' }],
        signaturePages: [
          { name: '王小明', signaturePng: png(300, 100), signedAt: new Date('2026-10-09') },
        ],
        timeZone: 'UTC',
      }),
    );
    const marks = `${await notoHex('???')} Tj`;
    expect(content(out.getPage(0))).toContain(marks);
    expect(content(out.getPage(1))).toContain(marks);
  });
});

describe('flatten, hardened', () => {
  /** A one-page PDF; `build` adds fields to it. Saved without pdf-lib drawing appearances. */
  async function formWith(build: (doc: PDFDocument, page: PDFPage) => void) {
    const doc = await PDFDocument.create();
    build(doc, doc.addPage([612, 792]));
    return doc.save({ updateFieldAppearances: false });
  }
  /** A raw widget dict on `page`, registered and listed in its /Annots. */
  function rawWidget(doc: PDFDocument, page: PDFPage, extra: Record<string, unknown>) {
    const ref = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, 50, 150, 70], ...extra }),
    );
    page.node.addAnnot(ref);
    return ref;
  }
  /** A filled text field whose widget has no appearance (/AP), as some PDF writers leave it. */
  function textField(doc: PDFDocument, page: PDFPage, name: string, value: string, y = 700) {
    const field = doc.getForm().createTextField(name);
    field.addToPage(page, { x: 50, y, width: 300, height: 20 });
    field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(value));
    const widget = field.acroField.getWidgets()[0]!.dict;
    widget.delete(PDFName.of('AP'));
    return widget;
  }

  it.each([
    ['loops', 2],
    ['is too deep', 40],
  ])('refuses a widget whose /Parent chain %s', async (_label, levels) => {
    const packet = await formWith((doc, page) => {
      const parents = Array.from({ length: levels }, () => doc.context.nextRef());
      parents.forEach((ref, i) => {
        // The last parent points back at the first (a loop) only for the short chain.
        const next = i + 1 < levels ? parents[i + 1] : levels === 2 ? parents[0] : undefined;
        doc.context.assign(ref, doc.context.obj(next ? { T: `f${i}`, Parent: next } : {}));
      });
      rawWidget(doc, page, { FT: 'Tx', Parent: parents[0] });
    });
    const started = Date.now();
    await expect(finalize(packet, noStamps)).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it.each([
    ['before', true],
    ['after', false],
  ])(
    'locks the fields when a /Sig field with no appearance comes %s a text field',
    async (_l, sigFirst) => {
      const packet = await formWith((doc, page) => {
        const addSig = () => rawWidget(doc, page, { FT: 'Sig', T: PDFString.of('fake.sig') });
        if (sigFirst) addSig();
        textField(doc, page, 'fakename', 'Fake Person');
        if (!sigFirst) addSig();
      });
      const out = await PDFDocument.load(await finalize(packet, noStamps));
      expect(out.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
      const left = widgetsLeft(out);
      expect(left.length).toBeGreaterThan(0);
      for (const widget of left) {
        expect(widget.lookup(PDFName.of('F'), PDFNumber).asNumber() & 196).toBe(196);
      }
    },
  );

  it.each(['Ёлка Фейкова', 'Nguyễn Giả'])(
    'draws a value with no appearance in Noto Sans: %s',
    async (value) => {
      const packet = await formWith((doc, page) => void textField(doc, page, 'fake.name', value));
      const out = await PDFDocument.load(await finalize(packet, noStamps));
      expect(widgetsLeft(out)).toHaveLength(0);
      expect(content(out.getPage(0))).toMatch(/FlatWidget[-\w]* Do/);
      expect(allStreams(out)).toContain(`${await notoHex(value)} Tj`);
    },
  );

  it('drops Hidden and NoView widgets instead of drawing them', async () => {
    const packet = await formWith((doc, page) => {
      [
        ['shown', 4],
        ['hidden', 2 | 4],
        ['noview', 32 | 4],
      ].forEach(([name, flag], i) => {
        const widget = textField(doc, page, `fake.${name}`, `Fake ${name}`, 700 - i * 40);
        widget.set(PDFName.of('F'), PDFNumber.of(flag as number));
      });
    });
    const out = await PDFDocument.load(await finalize(packet, noStamps));
    expect(widgetsLeft(out)).toHaveLength(0);
    expect(content(out.getPage(0)).match(/FlatWidget[-\w]* Do/g)).toHaveLength(1);
    const streams = allStreams(out);
    expect(streams).toContain(await notoHex('Fake shown'));
    expect(streams).not.toContain(await notoHex('Fake hidden'));
    expect(streams).not.toContain(await notoHex('Fake noview'));
  });
});

describe('the font', () => {
  it('loads next to the code, and nest build ships it to dist', async () => {
    expect((await notoSans()).byteLength).toBeGreaterThan(100_000);
    const nest = JSON.parse(
      readFileSync(new URL('../../nest-cli.json', import.meta.url), 'utf8'),
    ) as {
      sourceRoot: string;
      compilerOptions: { assets?: { include: string; outDir: string }[] };
    };
    expect(nest.sourceRoot).toBe('src');
    expect(nest.compilerOptions.assets).toContainEqual({
      include: 'esign/engine/fonts/*',
      outDir: 'dist',
    });
  });
});

describe('active content', () => {
  it('is removed from the signed PDF; plain links stay', async () => {
    const doc = await PDFDocument.load(await pdf([[612, 792]]));
    const ctx = doc.context;
    const js = ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    doc.catalog.set(PDFName.of('OpenAction'), js);
    doc.catalog.set(
      PDFName.of('Names'),
      ctx.obj({ JavaScript: ctx.obj({}), EmbeddedFiles: ctx.obj({}) }),
    );
    const page = doc.getPage(0);
    page.node.set(PDFName.of('AA'), ctx.obj({ O: js }));
    const annot = (extra: Record<string, unknown>) =>
      ctx.register(ctx.obj({ Type: 'Annot', Rect: [0, 0, 10, 10], ...extra } as never));
    const uri = annot({
      Subtype: 'Link',
      A: { S: 'URI', URI: PDFString.of('https://example.test') },
    });
    page.node.set(
      PDFName.of('Annots'),
      ctx.obj([
        annot({ Subtype: 'FileAttachment' }),
        annot({ Subtype: 'Link', A: { S: 'JavaScript', JS: PDFString.of('x') } }),
        annot({ Subtype: 'Link', A: { S: 'Launch' } }),
        uri,
      ]),
    );
    const out = await PDFDocument.load(
      await finalize(await doc.save(), { stamps: [], signaturePages: [], timeZone: 'UTC' }),
    );
    expect(out.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
    const names = out.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    expect(names?.has(PDFName.of('JavaScript'))).toBe(false);
    expect(names?.has(PDFName.of('EmbeddedFiles'))).toBe(false);
    expect(out.getPage(0).node.get(PDFName.of('AA'))).toBeUndefined();
    const left = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(left.size()).toBe(1);
    expect(String(out.context.lookup(left.get(0)))).toContain('/URI');
  });

  it('removes a link whose /Next chain runs anything but a web address or a page', async () => {
    const doc = await PDFDocument.load(await pdf([[612, 792]]));
    const ctx = doc.context;
    const uri = (next?: unknown) =>
      ctx.obj({
        S: 'URI',
        URI: PDFString.of('https://example.test'),
        ...(next ? { Next: next } : {}),
      } as never);
    const js = ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') });
    const goTo = ctx.obj({ S: 'GoTo', D: [doc.getPage(0).ref, 'Fit'] } as never);
    const looped = ctx.register(uri());
    ctx.lookup(looped, PDFDict).set(PDFName.of('Next'), looped);
    const link = (action: unknown) =>
      ctx.register(
        ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: action } as never),
      );
    doc.getPage(0).node.set(
      PDFName.of('Annots'),
      ctx.obj([
        link(uri(js)), // URI, then JavaScript
        link(uri([goTo, uri(ctx.register(js))])), // the JavaScript two steps down, by reference
        link(looped),
        link(uri([goTo, uri()])), // URI and GoTo only: kept
      ]),
    );
    const out = await PDFDocument.load(await finalize(await doc.save(), noStamps));
    const left = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(left.size()).toBe(1);
    expect(String(out.context.lookup(left.get(0)))).toContain('/GoTo');
  });
});
