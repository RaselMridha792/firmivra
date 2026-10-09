import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ESIGN_MAX_PAGES,
  type EsignContentType,
  type EsignErrorCode,
  type EsignPage,
} from '@firmivra/types';
import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import {
  concatTransformationMatrix,
  degrees,
  drawObject,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  translate,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';

// Firm Sign's PDF engine (R13): read uploads, build the packet from the page plan, stamp the
// signers' values on it and flatten the signed copy. Pure functions over bytes; nothing here
// logs, and errors carry only a code, never a file's content or a field's value.

export type EsignEngineErrorCode = Extract<
  EsignErrorCode,
  'PDF_ENCRYPTED' | 'PDF_UNREADABLE' | 'TOO_MANY_PAGES'
>;

/** A file the engine refuses. The API answers it as 409 with the same code. */
export class EsignEngineError extends Error {
  constructor(readonly code: EsignEngineErrorCode) {
    super(code);
    this.name = 'EsignEngineError';
  }
}

export interface PageSize {
  width: number;
  height: number;
}
export interface PdfInfo {
  pageCount: number;
  /** In PDF points, as a viewer shows the page (its own /Rotate applied). */
  pageSizes: PageSize[];
}
export interface EngineFile {
  documentId: string;
  contentType: EsignContentType;
  bytes: Uint8Array;
}
export interface ComposedPacket extends PdfInfo {
  bytes: Uint8Array;
  sha256: string;
}
/** Fractions (0 to 1) of the page as shown, after its rotation, from the top-left corner. */
interface Box {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Stamp = Box &
  (
    | { kind: 'text'; text: string }
    | { kind: 'check' }
    /** A signature or initials: a PNG, fitted into the box. */
    | { kind: 'image'; png: Uint8Array }
  );

/** An image becomes a US Letter page, turned to the image's shape, with this margin. */
const LETTER: PageSize = { width: 612, height: 792 };
const IMAGE_MARGIN = 36;
const FONT_SIZE = { min: 4, max: 24 };
const PRODUCER = 'Firmivra Firm Sign';
// No object streams and no default page: the same input gives the same bytes.
const SAVE = { useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false };
const N = (name: string) => PDFName.of(name);

// Noto Sans (OFL, fonts/OFL.txt): Latin, Greek and Cyrillic names. Read once, when first used.
let notoSans: Buffer | undefined;
const notoSansBytes = () =>
  (notoSans ??= readFileSync(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url)));

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Page count and sizes of an upload. Refuses encrypted, unreadable and over-long PDFs. */
export async function inspect(bytes: Uint8Array, contentType: EsignContentType): Promise<PdfInfo> {
  if (contentType !== 'application/pdf') {
    const image = await embedImage(await PDFDocument.create(), contentType, bytes);
    return { pageCount: 1, pageSizes: [imagePageSize(image)] };
  }
  const doc = await loadPdf(bytes);
  return { pageCount: doc.getPageCount(), pageSizes: doc.getPages().map(shownSize) };
}

/** One packet in plan order: each plan page copied from its file and turned by its rotation. */
export async function compose(
  files: readonly EngineFile[],
  plan: readonly EsignPage[],
): Promise<ComposedPacket> {
  if (plan.length > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
  const out = await PDFDocument.create({ updateMetadata: false });
  const slots: (PDFPage | undefined)[] = plan.map(() => undefined);
  for (const file of files) {
    const wanted = plan.flatMap((p, i) => (p.documentId === file.documentId ? [i] : []));
    if (wanted.length === 0) continue;
    if (file.contentType === 'application/pdf') {
      const src = await loadPdf(file.bytes);
      const copies = await out.copyPages(
        src,
        wanted.map((i) => pageInRange(plan[i]!.page, src.getPageCount())),
      );
      wanted.forEach((slot, k) => (slots[slot] = copies[k]));
    } else {
      const image = await embedImage(out, file.contentType, file.bytes);
      for (const slot of wanted) slots[slot] = imagePage(out, image, plan[slot]!.page);
    }
  }
  plan.forEach((p, i) => {
    const page = slots[i];
    if (!page) throw new RangeError('The page plan names a file that was not given');
    page.setRotation(degrees((rotationOf(page) + p.rotation) % 360));
    out.addPage(page);
  });
  flattenWidgets(out);
  out.setProducer(PRODUCER);
  out.setCreator(PRODUCER);
  const bytes = await out.save(SAVE);
  return {
    bytes,
    sha256: sha256(bytes),
    pageCount: plan.length,
    pageSizes: out.getPages().map(shownSize),
  };
}

/** Draws the signers' values on the packet. */
export async function stamp(packet: Uint8Array, stamps: readonly Stamp[]): Promise<Uint8Array> {
  const doc = await loadPdf(packet);
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const images = new Map<Uint8Array, PDFImage>();
  let font: PDFFont | undefined;
  for (const s of stamps) {
    const page = pages[s.pageIndex];
    if (!page) throw new RangeError('A stamp is on a page the packet does not have');
    const box = enterShownSpace(page, s);
    if (s.kind === 'text') {
      // Embedded whole (about 300 KB): @pdf-lib/fontkit's subsets of it map the wrong glyphs.
      font ??= await doc.embedFont(notoSansBytes(), { subset: false });
      drawFittedText(page, font, s.text, box);
    } else if (s.kind === 'check') {
      drawCheck(page, box);
    } else {
      let image = images.get(s.png);
      if (!image) images.set(s.png, (image = await embedImage(doc, 'image/png', s.png)));
      const scale = Math.min(box.width / image.width, box.height / image.height);
      const [width, height] = [image.width * scale, image.height * scale];
      page.drawImage(image, {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
      });
    }
    page.pushOperators(popGraphicsState());
  }
  return doc.save(SAVE);
}

/**
 * The read-only copy: form fields drawn into the page content, the form and document scripts
 * removed. `at` fixes the dates, so the same input always gives the same bytes and hash.
 */
export async function flatten(bytes: Uint8Array, at: Date): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  flattenWidgets(doc);
  for (const key of ['AcroForm', 'OpenAction', 'AA']) doc.catalog.delete(N(key));
  doc.catalog.lookupMaybe(N('Names'), PDFDict)?.delete(N('JavaScript'));
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(at);
  doc.setModificationDate(at);
  return doc.save(SAVE);
}

@Injectable()
export class PdfService {
  inspect(bytes: Uint8Array, contentType: EsignContentType) {
    return inspect(bytes, contentType);
  }
  compose(files: readonly EngineFile[], plan: readonly EsignPage[]) {
    return compose(files, plan);
  }
  stamp(packet: Uint8Array, stamps: readonly Stamp[]) {
    return stamp(packet, stamps);
  }
  flatten(bytes: Uint8Array, at: Date) {
    return flatten(bytes, at);
  }
  sha256(bytes: Uint8Array) {
    return sha256(bytes);
  }
}

// ---------- Reading ----------
async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  let pageCount: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    pageCount = doc.getPages().length;
  } catch {
    throw new EsignEngineError('PDF_UNREADABLE');
  }
  if (doc.isEncrypted) throw new EsignEngineError('PDF_ENCRYPTED');
  if (pageCount === 0) throw new EsignEngineError('PDF_UNREADABLE');
  if (pageCount > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
  return doc;
}

function pageInRange(page: number, pageCount: number) {
  if (page >= pageCount) throw new RangeError('The page plan names a page the file does not have');
  return page;
}

/** The page's own /Rotate, as 0, 90, 180 or 270. */
const rotationOf = (page: PDFPage) =>
  ((((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;

function shownSize(page: PDFPage): PageSize {
  const { width, height } = page.getCropBox();
  return rotationOf(page) % 180 ? { width: height, height: width } : { width, height };
}

// ---------- Images ----------
async function embedImage(doc: PDFDocument, contentType: EsignContentType, bytes: Uint8Array) {
  try {
    const image =
      contentType === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    if (image.width > 0 && image.height > 0) return image;
  } catch {
    // Falls through: not a readable image.
  }
  throw new EsignEngineError('PDF_UNREADABLE');
}

const imagePageSize = (image: PDFImage): PageSize =>
  image.width > image.height ? { width: LETTER.height, height: LETTER.width } : LETTER;

function imagePage(doc: PDFDocument, image: PDFImage, page: number) {
  pageInRange(page, 1);
  const size = imagePageSize(image);
  const scale = Math.min(
    (size.width - 2 * IMAGE_MARGIN) / image.width,
    (size.height - 2 * IMAGE_MARGIN) / image.height,
  );
  const [width, height] = [image.width * scale, image.height * scale];
  const result = PDFPage.create(doc);
  result.setSize(size.width, size.height);
  result.drawImage(image, {
    x: (size.width - width) / 2,
    y: (size.height - height) / 2,
    width,
    height,
  });
  return result;
}

// ---------- Stamping ----------
/**
 * Opens a graphics state whose coordinates are the page as shown (bottom-left origin, points),
 * whatever its /Rotate, and returns the box there. The caller closes it with popGraphicsState().
 */
function enterShownSpace(page: PDFPage, box: Box) {
  const { x, y, width: w, height: h } = page.getCropBox();
  const turn = rotationOf(page);
  const matrix = {
    0: [1, 0, 0, 1, x, y],
    90: [0, 1, -1, 0, x + w, y],
    180: [-1, 0, 0, -1, x + w, y + h],
    270: [0, -1, 1, 0, x, y + h],
  }[turn] as [number, number, number, number, number, number];
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
  const shown = shownSize(page);
  return {
    x: box.x * shown.width,
    y: (1 - box.y - box.h) * shown.height,
    width: box.w * shown.width,
    height: box.h * shown.height,
  };
}

type Rect = ReturnType<typeof enterShownSpace>;

/** One line, as large as fits the box (between 4 and 24 pt), centred vertically. */
function drawFittedText(page: PDFPage, font: PDFFont, value: string, box: Rect) {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const pad = Math.min(2, box.width * 0.05);
  const fit = (box.width - 2 * pad) / (font.widthOfTextAtSize(text, 1) || 1);
  const size = Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, box.height * 0.7, fit));
  const height = font.heightAtSize(size);
  const descent = height - font.heightAtSize(size, { descender: false });
  page.drawText(text, {
    x: box.x + pad,
    y: box.y + (box.height - height) / 2 + descent,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawCheck(page: PDFPage, box: Rect) {
  const at = (fx: number, fy: number) => ({
    x: box.x + fx * box.width,
    y: box.y + fy * box.height,
  });
  const thickness = Math.max(1, Math.min(box.width, box.height) * 0.1);
  const color = rgb(0, 0, 0);
  page.drawLine({ start: at(0.2, 0.5), end: at(0.42, 0.25), thickness, color });
  page.drawLine({ start: at(0.42, 0.25), end: at(0.8, 0.8), thickness, color });
}

// ---------- Flattening ----------
/** Draws each visible form widget's appearance into its page, then removes the widgets. */
function flattenWidgets(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const kept: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      if (annot?.lookup(N('Subtype')) !== N('Widget')) {
        kept.push(annots.get(i));
        continue;
      }
      const appearance = widgetAppearance(annot);
      const rect = annot.lookupMaybe(N('Rect'), PDFArray)?.asRectangle();
      const hidden = ((annot.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0) & 2) !== 0;
      if (!appearance || !rect || hidden) continue;
      const key = page.node.newXObject('FlatWidget', appearance);
      page.pushOperators(
        pushGraphicsState(),
        translate(rect.x, rect.y),
        drawObject(key),
        popGraphicsState(),
      );
    }
    page.node.set(N('Annots'), doc.context.obj(kept));
  }
}

/** The widget's normal appearance stream, for its current state when it has several. */
function widgetAppearance(annot: PDFDict): PDFRef | undefined {
  const normal = annot.lookupMaybe(N('AP'), PDFDict)?.get(N('N'));
  const states = normal && annot.context.lookup(normal);
  const ref =
    states instanceof PDFDict
      ? states.get(annot.lookupMaybe(N('AS'), PDFName) ?? N('Off'))
      : normal;
  return ref instanceof PDFRef && annot.context.lookup(ref) instanceof PDFStream ? ref : undefined;
}
