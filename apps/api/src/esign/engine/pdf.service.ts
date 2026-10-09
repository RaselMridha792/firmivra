import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ESIGN_MAX_PAGES,
  UPLOAD_LIMITS,
  type EsignContentType,
  type EsignPage,
} from '@firmivra/types';
import { Injectable } from '@nestjs/common';
import fontkit from '@pdf-lib/fontkit';
import {
  clip,
  concatTransformationMatrix,
  degrees,
  endPath,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
} from 'pdf-lib';
import { EsignEngineError, EsignPlanError } from './errors.js';
import { fillAppearances, flattenWidgets, makeInert } from './forms.js';
import { readImageHeader, type Turn } from './images.js';

export { EsignEngineError, EsignPlanError, type EsignEngineErrorCode } from './errors.js';

// Firm Sign's PDF engine (R13): read uploads, build the packet from the page plan, stamp the
// signers' values on it and flatten the signed copy. Pure functions over bytes; nothing here
// logs, and errors carry only a code, never a file's content or a field's value. Any failure
// inside pdf-lib is PDF_UNREADABLE; EsignPlanError is a caller's bug.

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
/** More indirect objects than this is not a document a person sends for signature. */
const MAX_OBJECTS = 200_000;
const PRODUCER = 'Firmivra Firm Sign';
/** Marks a stamped packet: stamp() takes only the unstamped one. */
const STAMPED = PDFName.of('FirmivraStamped');
// No object streams and no default page: the same input gives the same bytes.
const SAVE = { useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false };
const N = (name: string) => PDFName.of(name);

// Noto Sans (OFL, fonts/OFL.txt) covers Latin, Greek and Cyrillic, the scripts for Oct 18.
// Bengali, CJK and other scripts show as empty boxes until their Noto fonts are added.
let notoSans: Buffer | undefined;
const notoSansBytes = () =>
  (notoSans ??= readFileSync(new URL('./fonts/NotoSans-Regular.ttf', import.meta.url)));
/** Embedded whole (about 300 KB): @pdf-lib/fontkit's subsets of it map the wrong glyphs. */
function embedNoto(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  return doc.embedFont(notoSansBytes(), { subset: false });
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/**
 * Page count and sizes of an upload. It builds the file's packet the way compose() will, so a
 * file that would fail when sent fails here. Refuses encrypted, unreadable and long files.
 */
export async function inspect(bytes: Uint8Array, contentType: EsignContentType): Promise<PdfInfo> {
  if (bytes.length > UPLOAD_LIMITS.maxBytes) throw new EsignEngineError('PDF_UNREADABLE');
  const documentId = 'upload';
  const pageCount =
    contentType === 'application/pdf' ? (await readable(() => loadPdf(bytes))).getPageCount() : 1;
  const plan = Array.from({ length: pageCount }, (_, page) => ({
    documentId,
    page,
    rotation: 0 as const,
  }));
  const { pageSizes } = await compose([{ documentId, contentType, bytes }], plan);
  return { pageCount, pageSizes };
}

/**
 * One packet in plan order: each plan page copied from its file and turned by its rotation.
 * Form fields of the files are drawn into their pages.
 */
export function compose(
  files: readonly EngineFile[],
  plan: readonly EsignPage[],
): Promise<ComposedPacket> {
  return readable(async () => {
    if (plan.length > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
    const out = await PDFDocument.create({ updateMetadata: false });
    const slots: (PDFPage | undefined)[] = plan.map(() => undefined);
    for (const file of files) {
      const wanted = plan.flatMap((p, i) => (p.documentId === file.documentId ? [i] : []));
      if (wanted.length === 0) continue;
      if (file.bytes.length > UPLOAD_LIMITS.maxBytes) throw new EsignEngineError('PDF_UNREADABLE');
      if (file.contentType === 'application/pdf') {
        const src = await loadPdf(file.bytes);
        await fillAppearances(src, () => embedNoto(src));
        const pages = wanted.map((i) => pageInRange(plan[i]!.page, src.getPageCount()));
        const copies = await out.copyPages(src, pages);
        wanted.forEach((slot, k) => (slots[slot] = copies[k]));
      } else {
        const { image, turn } = await embedImage(out, file.contentType, file.bytes);
        for (const slot of wanted) {
          pageInRange(plan[slot]!.page, 1);
          slots[slot] = imagePage(out, image, turn);
        }
      }
    }
    plan.forEach((p, i) => {
      const page = slots[i];
      if (!page) throw new EsignPlanError('The page plan names a file that was not given');
      ownContents(page);
      page.setRotation(degrees((rotationOf(page) + p.rotation) % 360));
      out.addPage(page);
    });
    flattenWidgets(out);
    out.setProducer(PRODUCER);
    out.setCreator(PRODUCER);
    const bytes = await out.save(SAVE);
    const pageSizes = out.getPages().map(shownSize);
    return { bytes, sha256: sha256(bytes), pageCount: plan.length, pageSizes };
  });
}

/**
 * Draws the signers' values on the packet from compose(). Call it once per output, always on
 * the unstamped packet with every value so far: the font is embedded once per call, so a
 * stamped packet is refused rather than stamped again.
 */
export function stamp(packet: Uint8Array, stamps: readonly Stamp[]): Promise<Uint8Array> {
  return readable(async () => {
    const doc = await loadPdf(packet);
    if (doc.catalog.has(STAMPED)) throw new EsignPlanError('Stamp the unstamped packet');
    doc.catalog.set(STAMPED, doc.context.obj(true));
    const pages = doc.getPages();
    const images = new Map<string, PDFImage>();
    let font: PDFFont | undefined;
    for (const s of stamps) {
      const page = pages[s.pageIndex];
      if (!page) throw new EsignPlanError('A stamp is on a page the packet does not have');
      const box = enterShownSpace(page, s);
      if (s.kind === 'text') {
        font ??= await embedNoto(doc);
        drawFittedText(page, font, s.text, box);
      } else if (s.kind === 'check') {
        drawCheck(page, box);
      } else {
        const key = sha256(s.png);
        let image = images.get(key);
        if (!image) images.set(key, (image = (await embedImage(doc, 'image/png', s.png)).image));
        const scale = Math.min(box.width / image.width, box.height / image.height);
        const [width, height] = [image.width * scale, image.height * scale];
        const x = box.x + (box.width - width) / 2;
        page.drawImage(image, { x, y: box.y + (box.height - height) / 2, width, height });
      }
      page.pushOperators(popGraphicsState());
    }
    return doc.save(SAVE);
  });
}

/**
 * The read-only copy: form fields drawn into the page content; the form, scripts, actions,
 * embedded files and media removed. `at` fixes the dates, so the same input gives the same bytes.
 */
export function flatten(bytes: Uint8Array, at: Date): Promise<Uint8Array> {
  return readable(async () => {
    const doc = await loadPdf(bytes);
    await fillAppearances(doc, () => embedNoto(doc));
    flattenWidgets(doc);
    makeInert(doc);
    doc.catalog.delete(STAMPED);
    doc.setProducer(PRODUCER);
    doc.setCreator(PRODUCER);
    doc.setCreationDate(at);
    doc.setModificationDate(at);
    return doc.save(SAVE);
  });
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
/** Our refusals and plan errors as they are; anything pdf-lib throws is PDF_UNREADABLE. */
async function readable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EsignEngineError || error instanceof EsignPlanError) throw error;
    throw new EsignEngineError('PDF_UNREADABLE');
  }
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) throw new EsignEngineError('PDF_ENCRYPTED');
  if (doc.context.largestObjectNumber > MAX_OBJECTS) throw new EsignEngineError('PDF_UNREADABLE');
  const pageCount = doc.getPages().length;
  if (pageCount === 0) throw new EsignEngineError('PDF_UNREADABLE');
  if (pageCount > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
  return doc;
}

function pageInRange(page: number, pageCount: number) {
  if (page >= pageCount) throw new EsignPlanError('The plan names a page the file does not have');
  return page;
}

/** The page's own /Rotate, as 0, 90, 180 or 270. */
const rotationOf = (page: PDFPage) =>
  ((((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360) as Turn;

function shownSize(page: PDFPage): PageSize {
  const { width, height } = page.getCropBox();
  return rotationOf(page) % 180 ? { width: height, height: width } : { width, height };
}

/**
 * Gives a copied page its own /Contents array and resource dictionaries, so a page used twice in
 * the plan shares nothing that stamping changes.
 */
function ownContents(page: PDFPage) {
  const { node } = page;
  const contents = node.get(N('Contents'));
  const resolved = contents && node.context.lookup(contents);
  const streams = resolved instanceof PDFArray ? resolved.asArray() : contents ? [contents] : [];
  node.set(N('Contents'), node.context.obj(streams));
  const resources = node.context.lookupMaybe(node.get(N('Resources')), PDFDict);
  if (!resources) return;
  const own = resources.clone(node.context);
  for (const key of ['Font', 'XObject', 'ExtGState'].map(N)) {
    const dict = own.lookupMaybe(key, PDFDict);
    if (dict) own.set(key, dict.clone(node.context));
  }
  node.set(N('Resources'), own);
}

// ---------- Images ----------
/** Checks the header (size limits, EXIF turn) before pdf-lib decodes anything. */
async function embedImage(doc: PDFDocument, type: 'image/png' | 'image/jpeg', bytes: Uint8Array) {
  const { turn } = readImageHeader(type, bytes);
  const image = type === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  return { image, turn };
}

/** The image upright on a Letter page of its stored shape, turned by /Rotate as EXIF says. */
function imagePage(doc: PDFDocument, image: PDFImage, turn: Turn) {
  const size = image.width > image.height ? { width: LETTER.height, height: LETTER.width } : LETTER;
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
  result.setRotation(degrees(turn));
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

/**
 * One line, as large as fits (4 to 24 pt). What does not fit at 4 pt is cut with an ellipsis.
 * Undefined when there is nothing to write.
 */
export function fitText(font: PDFFont, value: string, width: number, height: number) {
  let text = value.replace(/\s+/g, ' ').trim();
  const fit = width / (font.widthOfTextAtSize(text, 1) || 1);
  const size = Math.max(FONT_SIZE.min, Math.min(FONT_SIZE.max, height * 0.7, fit));
  if (font.widthOfTextAtSize(text, size) > width) {
    const chars = Array.from(text);
    while (chars.length && font.widthOfTextAtSize(`${chars.join('')}…`, size) > width) chars.pop();
    text = chars.length ? `${chars.join('').trimEnd()}…` : '';
  }
  return text ? { text, size } : undefined;
}

/** The text, centred vertically and clipped to the box. */
function drawFittedText(page: PDFPage, font: PDFFont, value: string, box: Rect) {
  const pad = Math.min(2, box.width * 0.05);
  const fitted = fitText(font, value, box.width - 2 * pad, box.height);
  if (!fitted) return;
  const height = font.heightAtSize(fitted.size);
  const descent = height - font.heightAtSize(fitted.size, { descender: false });
  page.pushOperators(rectangle(box.x, box.y, box.width, box.height), clip(), endPath());
  page.drawText(fitted.text, {
    x: box.x + pad,
    y: box.y + (box.height - height) / 2 + descent,
    size: fitted.size,
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
