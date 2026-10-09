import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {
  degrees,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFName,
  PDFNumber,
  type PDFPage,
  PDFRef,
  rgb,
} from 'pdf-lib';
import {
  EsignEngineError,
  type FieldBox,
  type FinalizeInput,
  type SignaturePageSigner,
  type Stamp,
} from './engine.types.js';
import { ownRotation } from './pdf-compose.js';

// Stamp, flatten and signature pages (R18 step 6).

const FONT_URL = new URL('./fonts/NotoSans-Regular.ttf', import.meta.url);
let fontBytes: Promise<Buffer> | undefined;
/** Noto Sans (OFL), so names in Latin, Greek and Cyrillic scripts print. Read once. */
export function notoSans(): Promise<Buffer> {
  // A failed read is not cached: the next call tries again.
  fontBytes ??= readFile(FONT_URL).catch((error: unknown) => {
    fontBytes = undefined;
    throw error;
  });
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

const charSets = new WeakMap<PDFFont, Set<number>>();
/** printable(), with '?' for each character the font has no glyph for (CJK, Arabic, Bengali). */
export function printableWith(font: PDFFont, text: string): string {
  let chars = charSets.get(font);
  if (!chars) charSets.set(font, (chars = new Set(font.getCharacterSet())));
  const known = chars;
  return [...printable(text).normalize('NFC')]
    .map((c) => (known.has(c.codePointAt(0)!) ? c : '?'))
    .join('');
}

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
  const text = item.kind === 'CHECK' ? (item.checked ? 'X' : '') : printableWith(font, item.text);
  if (!text) return;
  const size = Math.max(4, Math.min(h * 0.7, 14, (w * 0.95) / font.widthOfTextAtSize(text, 1)));
  const dx = item.kind === 'CHECK' ? (w - font.widthOfTextAtSize(text, size)) / 2 : w * 0.025;
  page.drawText(text, { ...at(dx, (h - size * 0.72) / 2), size, font, color: INK, rotate });
}
type PDFImage = Awaited<ReturnType<PDFDocument['embedPng']>>;

/** Read-only flags: Print | ReadOnly | Locked on a widget, ReadOnly on a field. */
const WIDGET_LOCKED = 4 | 64 | 128;
/** Hidden | NoView: a widget never shown, so never drawn into the signed page. */
const WIDGET_UNSEEN = 2 | 32;
/** How deep a field tree or an action chain may go. */
const MAX_DEPTH = 32;

const flags = (dict: PDFDict, key: string) =>
  dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber() ?? 0;

/** The top field of a widget; a looping or very deep /Parent chain is refused. */
function fieldRoot(doc: PDFDocument, ref: PDFRef, widget: PDFDict): PDFRef {
  const seen = new Set([ref]);
  let root = ref;
  for (let parent = widget.get(PDFName.of('Parent')); parent instanceof PDFRef;) {
    if (seen.has(parent) || seen.size > MAX_DEPTH) throw new EsignEngineError('PDF_UNREADABLE');
    seen.add(parent);
    root = parent;
    const field = doc.context.lookupMaybe(parent, PDFDict);
    if (!field) throw new EsignEngineError('PDF_UNREADABLE');
    parent = field.get(PDFName.of('Parent'));
  }
  return root;
}

/**
 * Flattens every form field into the page, with appearances drawn in `font` where a field has
 * none (or the form asks for new ones). Compose copies widgets without the source's AcroForm, so
 * the form is rebuilt from the pages' widgets first; hidden widgets are dropped. A form pdf-lib
 * can't flatten keeps its appearance, locked read-only, and loses the AcroForm.
 */
export function flatten(doc: PDFDocument, font: PDFFont): void {
  const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const redraw = acroForm?.lookupMaybe(PDFName.of('NeedAppearances'), PDFBool)?.asBoolean();
  const roots = new Set<PDFRef>();
  const widgets: PDFDict[] = [];
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const ref = annots!.get(i);
      const annot = doc.context.lookupMaybe(ref, PDFDict);
      if (!(ref instanceof PDFRef) || annot?.get(PDFName.of('Subtype')) !== PDFName.of('Widget')) {
        continue;
      }
      if (flags(annot, 'F') & WIDGET_UNSEEN) {
        annots!.remove(i);
        const parent = doc.context.lookupMaybe(annot.get(PDFName.of('Parent')), PDFDict);
        const kids = parent?.lookupMaybe(PDFName.of('Kids'), PDFArray);
        const at = kids?.asArray().indexOf(ref) ?? -1;
        if (at >= 0) kids!.remove(at);
        continue;
      }
      widgets.push(annot);
      roots.add(fieldRoot(doc, ref, annot));
    }
  }
  if (roots.size === 0) {
    doc.catalog.delete(PDFName.of('AcroForm'));
    return;
  }
  // Collected last to first; fields are drawn in page order.
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [...roots].reverse() }));
  let flattened = true;
  try {
    const form = doc.getForm();
    if (redraw) for (const field of form.getFields()) form.markFieldAsDirty(field.ref);
    // Noto, not pdf-lib's Helvetica: a value in Cyrillic or Vietnamese can't be WinAnsi-encoded.
    form.updateFieldAppearances(font);
    form.flatten({ updateFieldAppearances: false });
  } catch {
    flattened = false;
    for (const widget of widgets) {
      const f = (flags(widget, 'F') & WIDGET_UNSEEN) | WIDGET_LOCKED;
      widget.set(PDFName.of('F'), PDFNumber.of(f));
    }
    // pdf-lib may have flattened (and deleted) some fields before it gave up.
    for (const root of roots) {
      const field = doc.context.lookupMaybe(root, PDFDict);
      field?.set(PDFName.of('Ff'), PDFNumber.of(flags(field, 'Ff') | 1));
    }
  }
  // pdf-lib draws and deletes widgets but can leave their references on the page.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const annot = doc.context.lookupMaybe(annots!.get(i), PDFDict);
      const widget = annot?.get(PDFName.of('Subtype')) === PDFName.of('Widget');
      if (!annot || (flattened && widget)) annots!.remove(i);
    }
  }
  doc.catalog.delete(PDFName.of('AcroForm'));
}

/** Annotations that carry files, media or 3D content: never kept in a signed PDF. */
const ACTIVE_ANNOTS = ['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D'];
/** The only link actions a signed PDF keeps: a web address or a place in the document. */
const SAFE_ACTIONS = ['URI', 'GoTo'];

/** True when the action and every action in its /Next chain is safe; a loop is not. */
function safeAction(doc: PDFDocument, action: PDFDict): boolean {
  const seen = new Set<PDFDict>();
  const queue = [action];
  for (let a = queue.pop(); a; a = queue.pop()) {
    if (seen.has(a) || seen.size >= MAX_DEPTH) return false;
    seen.add(a);
    if (!SAFE_ACTIONS.includes(a.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() ?? '')) {
      return false;
    }
    const next = doc.context.lookup(a.get(PDFName.of('Next')));
    const items =
      next instanceof PDFArray ? next.asArray().map((o) => doc.context.lookup(o)) : [next];
    for (const item of items) {
      if (item instanceof PDFDict) queue.push(item);
      else if (item !== undefined) return false;
    }
  }
  return true;
}

/**
 * Removes what can run or hide content: document and page actions, JavaScript, embedded files,
 * file and media annotations, and links whose action is not a web address or a page.
 */
export function stripActiveContent(doc: PDFDocument): void {
  const name = (n: string) => PDFName.of(n);
  doc.catalog.delete(name('OpenAction'));
  doc.catalog.delete(name('AA'));
  const names = doc.catalog.lookupMaybe(name('Names'), PDFDict);
  names?.delete(name('JavaScript'));
  names?.delete(name('EmbeddedFiles'));
  for (const page of doc.getPages()) {
    page.node.delete(name('AA'));
    const annots = page.node.lookupMaybe(name('Annots'), PDFArray);
    for (let i = (annots?.size() ?? 0) - 1; i >= 0; i--) {
      const annot = doc.context.lookupMaybe(annots!.get(i), PDFDict);
      if (!annot) continue;
      const subtype = annot.lookupMaybe(name('Subtype'), PDFName)?.decodeText() ?? '';
      if (ACTIVE_ANNOTS.includes(subtype)) {
        annots!.remove(i);
        continue;
      }
      annot.delete(name('AA'));
      const action = annot.lookupMaybe(name('A'), PDFDict);
      if (action && !safeAction(doc, action)) annots!.remove(i);
    }
  }
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
    page.drawText(printableWith(font, value), { x, y, size, font, color: INK });
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
  const font = await embedNoto(doc);
  flatten(doc, font);
  stripActiveContent(doc);
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
  // Appearances were drawn in flatten; pdf-lib's own pass would use Helvetica again.
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
