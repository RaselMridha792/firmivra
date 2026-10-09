import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFName,
  PDFNumber,
  type PDFPage,
  PDFRef,
  rgb,
} from 'pdf-lib';
import type { FieldBox, FinalizeInput, SignaturePageSigner, Stamp } from './engine.types.js';
import { ownRotation } from './pdf-compose.js';

// Stamp, flatten and signature pages (R18 step 6).

const FONT_URL = new URL('./fonts/NotoSans-Regular.ttf', import.meta.url);
let fontBytes: Promise<Buffer> | undefined;
/** Noto Sans (OFL), so names in Latin, Greek and Cyrillic scripts print. Read once. */
export function notoSans(): Promise<Buffer> {
  fontBytes ??= readFile(FONT_URL);
  return fontBytes;
}

/** Embeds Noto Sans whole (about 250 KB): pdf-lib 1.17's subsetter drops Noto's glyphs. */
export async function embedNoto(doc: PDFDocument): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(await notoSans(), { subset: false });
}

const INK = rgb(0.08, 0.1, 0.2);
/** Control characters never print (a value could hold a newline or a tab). */
export const printable = (text: string) => text.replace(/\p{Cc}+/gu, ' ').trim();

/**
 * Where a box lands in the page's own (unrotated) space. Boxes are fractions of the page as
 * shown (after /Rotate, from the top-left); `at(dx, dy)` is the point dx right and dy up from
 * the box's shown bottom-left, and content drawn there turned by `rotate` reads upright.
 */
export function placeBox(page: PDFPage, box: FieldBox) {
  const r = ownRotation(page);
  const crop = page.getCropBox();
  const turned = r % 180 !== 0;
  const shownW = turned ? crop.height : crop.width;
  const shownH = turned ? crop.width : crop.height;
  const w = box.w * shownW;
  const h = box.h * shownH;
  // The shown point (sx, sy), top-left origin, in the page's own space.
  const toPage = (sx: number, sy: number) => {
    const { x, y, width, height } = crop;
    if (r === 90) return { x: x + sy, y: y + sx };
    if (r === 180) return { x: x + width - sx, y: y + sy };
    if (r === 270) return { x: x + width - sy, y: y + height - sx };
    return { x: x + sx, y: y + height - sy };
  };
  const left = box.x * shownW;
  const bottom = (box.y + box.h) * shownH;
  const at = (dx: number, dy: number) => toPage(left + dx, bottom - dy);
  return { w, h, at, rotate: degrees(r) };
}

function stamp(page: PDFPage, item: Stamp, font: PDFFont, images: Map<Uint8Array, PDFImage>) {
  const { w, h, at, rotate } = placeBox(page, item);
  if (item.kind === 'IMAGE') {
    const image = images.get(item.png)!;
    const scale = Math.min(w / image.width, h / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    page.drawImage(image, { ...at((w - iw) / 2, (h - ih) / 2), width: iw, height: ih, rotate });
    return;
  }
  const text = item.kind === 'CHECK' ? (item.checked ? 'X' : '') : printable(item.text);
  if (!text) return;
  const size = Math.max(4, Math.min(h * 0.7, 14, (w * 0.95) / font.widthOfTextAtSize(text, 1)));
  const dx = item.kind === 'CHECK' ? (w - font.widthOfTextAtSize(text, size)) / 2 : w * 0.025;
  page.drawText(text, { ...at(dx, (h - size * 0.72) / 2), size, font, color: INK, rotate });
}
type PDFImage = Awaited<ReturnType<PDFDocument['embedPng']>>;

/** Read-only flags: Print | ReadOnly | Locked on a widget, ReadOnly on a field. */
const WIDGET_LOCKED = 4 | 64 | 128;

/**
 * Flattens every form field into the page. Compose copies widgets without the source's
 * AcroForm, so the form is rebuilt from the pages' widgets first. A form pdf-lib can't flatten
 * keeps its appearance, locked read-only, and loses the AcroForm.
 */
export function flatten(doc: PDFDocument): void {
  const roots = new Set<PDFRef>();
  const widgets: PDFDict[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) {
      const ref = annots!.get(i);
      const annot = doc.context.lookupMaybe(ref, PDFDict);
      if (!(ref instanceof PDFRef) || annot?.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) {
        continue;
      }
      widgets.push(annot);
      let root = ref;
      for (let parent = annot.get(PDFName.of('Parent')); parent instanceof PDFRef;) {
        root = parent;
        parent = doc.context.lookup(parent, PDFDict).get(PDFName.of('Parent'));
      }
      roots.add(root);
    }
  }
  if (roots.size === 0) {
    doc.catalog.delete(PDFName.of('AcroForm'));
    return;
  }
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [...roots] }));
  try {
    doc.getForm().flatten();
    // pdf-lib draws and deletes every widget but can leave its reference on the page.
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
        const annot = doc.context.lookupMaybe(annots!.get(i), PDFDict);
        const widget = annot?.get(PDFName.of('Subtype')) === PDFName.of('Widget');
        if (!annot || widget) annots!.remove(i);
      }
    }
  } catch {
    for (const widget of widgets) widget.set(PDFName.of('F'), PDFNumber.of(WIDGET_LOCKED));
    for (const root of roots) {
      const field = doc.context.lookup(root, PDFDict);
      const flags = field.lookupMaybe(PDFName.of('Ff'), PDFNumber)?.asNumber() ?? 0;
      field.set(PDFName.of('Ff'), PDFNumber.of(flags | 1));
    }
  }
  doc.catalog.delete(PDFName.of('AcroForm'));
}

const SIGNATURE_PAGE = { width: 612, height: 792 } as const;

function signaturePage(
  doc: PDFDocument,
  signer: SignaturePageSigner,
  image: PDFImage,
  font: PDFFont,
  timeZone: string,
) {
  const page = doc.addPage([SIGNATURE_PAGE.width, SIGNATURE_PAGE.height]);
  const text = (value: string, x: number, y: number, size: number) =>
    page.drawText(printable(value), { x, y, size, font, color: INK });
  const date = new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'long' }).format(
    signer.signedAt,
  );
  text('Signature page', 72, 700, 20);
  text('Signed electronically with Firm Sign.', 72, 676, 10);
  const scale = Math.min(300 / image.width, 90 / image.height);
  page.drawImage(image, {
    x: 72,
    y: 560,
    width: image.width * scale,
    height: image.height * scale,
  });
  page.drawLine({ start: { x: 72, y: 552 }, end: { x: 400, y: 552 }, color: INK, thickness: 0.75 });
  text('Signature', 72, 538, 9);
  text(signer.name, 72, 490, 13);
  text('Printed name', 72, 474, 9);
  text(date, 72, 426, 13);
  text('Date', 72, 410, 9);
}

/**
 * The signed PDF: form fields flattened, then every stamp on its page, then one signature page
 * per signer when no fields were placed. Images were checked by SignatureImageCheck already.
 */
export async function finalize(packet: Uint8Array, input: FinalizeInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(packet, { updateMetadata: false });
  flatten(doc);
  const font = await embedNoto(doc);
  const images = new Map<Uint8Array, PDFImage>();
  const pngs = [...input.stamps.flatMap((s) => (s.kind === 'IMAGE' ? [s.png] : []))];
  for (const png of [...pngs, ...input.signaturePages.map((s) => s.signaturePng)]) {
    if (!images.has(png)) images.set(png, await doc.embedPng(png));
  }
  const pages = doc.getPages();
  for (const item of input.stamps) {
    const page = pages[item.pageIndex];
    if (!page) throw new Error(`No packet page ${item.pageIndex}`);
    stamp(page, item, font, images);
  }
  for (const signer of input.signaturePages) {
    signaturePage(doc, signer, images.get(signer.signaturePng)!, font, input.timeZone);
  }
  return doc.save({ useObjectStreams: false });
}
