import {
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  type PDFObject,
  type PDFPage,
  PDFRef,
} from 'pdf-lib';
import { ESIGN_MAX_PAGES, type EsignPage, UPLOAD_LIMITS } from '@firmivra/types';
import {
  EsignEngineError,
  type InspectedFile,
  type PageSize,
  type SourceFile,
} from './engine.types.js';
import { type ImageHeader, readImageHeader } from './images.js';

// Inspect and compose (R18 step 3). Everything runs in memory on files of at most 10 MB.

/** More indirect objects than this is not a document a person sends for signature. */
const MAX_OBJECTS = 200_000;

/** An image page fits a US Letter page, portrait or landscape like the image. */
const LETTER = { short: 612, long: 792 } as const;

/** The page an image of `width` x `height` pixels becomes: scaled to fit Letter, aspect kept. */
export function imagePageSize(width: number, height: number): PageSize {
  const landscape = width > height;
  const box = landscape
    ? { width: LETTER.long, height: LETTER.short }
    : { width: LETTER.short, height: LETTER.long };
  const scale = Math.min(box.width / width, box.height / height);
  return { width: round(width * scale), height: round(height * scale) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A page's own /Rotate, normalised to 0, 90, 180 or 270; any other angle is refused. */
export function ownRotation(page: PDFPage): number {
  const angle = page.getRotation().angle;
  if (!Number.isInteger(angle) || angle % 90 !== 0) throw new EsignEngineError('PDF_UNREADABLE');
  return ((angle % 360) + 360) % 360;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A PDF rectangle with its corners in either order, as [x0, y0, x1, y1] lower-left first. */
function normalised({ x, y, width, height }: Box): [number, number, number, number] {
  return [
    Math.min(x, x + width),
    Math.min(y, y + height),
    Math.max(x, x + width),
    Math.max(y, y + height),
  ];
}

/**
 * The part of the page a viewer shows, as pdf.js does: the CropBox (or the MediaBox) with its
 * corners normalised and clipped to the MediaBox. An empty box is unreadable.
 */
export function visibleBox(page: PDFPage): Box {
  const [mx0, my0, mx1, my1] = normalised(page.getMediaBox());
  const [cx0, cy0, cx1, cy1] = normalised(page.getCropBox());
  const x0 = Math.max(mx0, cx0);
  const y0 = Math.max(my0, cy0);
  const x1 = Math.min(mx1, cx1);
  const y1 = Math.min(my1, cy1);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 - x0 < 1 || y1 - y0 < 1) {
    throw new EsignEngineError('PDF_UNREADABLE');
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * A page's size as a viewer shows it at plan rotation 0: its visible box, turned by the page's
 * own /Rotate. Fields are placed on this view, so pageSizes describe it.
 */
export function shownSize(page: PDFPage): PageSize {
  const { width, height } = visibleBox(page);
  const turned = ownRotation(page) % 180 !== 0;
  return turned
    ? { width: round(height), height: round(width) }
    : { width: round(width), height: round(height) };
}

/**
 * Counts the leaf pages without pdf-lib's walk, which follows a node listed twice every time
 * (a few KB can then take minutes). A node met twice is unreadable; past the limit it stops.
 */
function countPages(doc: PDFDocument): number {
  const seen = new Set<PDFObject>();
  let count = 0;
  const walk = (ref: PDFObject | undefined, depth: number): void => {
    if (!(ref instanceof PDFRef) || seen.has(ref) || depth > 64) {
      throw new EsignEngineError('PDF_UNREADABLE');
    }
    seen.add(ref);
    const node = doc.context.lookup(ref, PDFDict);
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (node.get(PDFName.of('Type')) === PDFName.of('Page') || !kids) {
      if (++count > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
      return;
    }
    for (let i = 0; i < kids.size(); i++) walk(kids.get(i), depth + 1);
  };
  walk(doc.catalog.get(PDFName.of('Pages')), 0);
  return count;
}

/** Anything but our own refusal becomes PDF_UNREADABLE: a broken file throws all sorts. */
async function unreadable<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof EsignEngineError) throw error;
    throw new EsignEngineError('PDF_UNREADABLE');
  }
}

/** Loads a PDF, refusing what Firm Sign can't sign: encrypted, unreadable or XFA files. */
function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return unreadable(async () => {
    // Uploads are at most 10 MB; a bigger file here never came through an upload.
    if (bytes.byteLength > UPLOAD_LIMITS.maxBytes) throw new EsignEngineError('PDF_UNREADABLE');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (doc.isEncrypted) throw new EsignEngineError('PDF_ENCRYPTED');
    if (doc.context.largestObjectNumber > MAX_OBJECTS) {
      throw new EsignEngineError('PDF_UNREADABLE');
    }
    // XFA forms render differently in every viewer and can't be flattened: refuse them.
    const acroForm = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (acroForm?.has(PDFName.of('XFA'))) throw new EsignEngineError('PDF_UNREADABLE');
    const count = countPages(doc);
    if (count < 1 || doc.getPageCount() !== count) throw new EsignEngineError('PDF_UNREADABLE');
    // Every page must have a readable box and rotation: the sizes are needed later anyway.
    doc.getPages().forEach(shownSize);
    return doc;
  });
}

/** Embeds a JPG or PNG; a broken image is PDF_UNREADABLE. */
async function embedImage(doc: PDFDocument, file: Pick<SourceFile, 'contentType' | 'bytes'>) {
  const header = imageHeader(file);
  const image = await unreadable(() =>
    file.contentType === 'image/png' ? doc.embedPng(file.bytes) : doc.embedJpg(file.bytes),
  );
  return { image, header };
}

/** Size and EXIF turn from the header, before decoding; huge or broken images are refused. */
function imageHeader(file: Pick<SourceFile, 'contentType' | 'bytes'>): ImageHeader {
  if (file.bytes.byteLength > UPLOAD_LIMITS.maxBytes) throw new EsignEngineError('PDF_UNREADABLE');
  if (file.contentType === 'application/pdf') throw new Error('Not an image');
  return readImageHeader(file.contentType, file.bytes);
}

/** An image's page as shown: upright after its EXIF turn, fitted to Letter. */
function imageShownSize(header: ImageHeader): PageSize {
  const turned = header.turn % 180 !== 0;
  return turned
    ? imagePageSize(header.height, header.width)
    : imagePageSize(header.width, header.height);
}

/** Pages and their shown sizes; an image is one page. */
export async function inspect(
  file: Pick<SourceFile, 'contentType' | 'bytes'>,
): Promise<InspectedFile> {
  if (file.contentType === 'application/pdf') {
    const doc = await loadPdf(file.bytes);
    const pageSizes = doc.getPages().map(shownSize);
    return { pageCount: pageSizes.length, pageSizes };
  }
  // The header is enough: nothing is decoded to inspect an image.
  return { pageCount: 1, pageSizes: [imageShownSize(imageHeader(file))] };
}

/**
 * The packet: the plan's pages in order. Each page keeps its own /Rotate plus the plan's
 * rotation (clockwise), so nothing is redrawn. An image becomes a page of imagePageSize().
 * A plan naming a file or page that doesn't exist is the caller's bug and throws a plain Error.
 */
export async function compose(files: SourceFile[], plan: EsignPage[]): Promise<Uint8Array> {
  if (plan.length < 1) throw new Error('The page plan is empty');
  if (plan.length > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
  const byId = new Map(files.map((f) => [f.documentId, f]));
  const out = await PDFDocument.create({ updateMetadata: false });

  // Copy each PDF's planned pages, once per plan entry.
  const copied = new Map<string, PDFPage[]>();
  const images = new Map<string, Awaited<ReturnType<typeof embedImage>>>();
  for (const file of files) {
    if (file.contentType !== 'application/pdf') continue;
    const wanted = plan.filter((p) => p.documentId === file.documentId).map((p) => p.page);
    if (wanted.length === 0) continue;
    const src = await loadPdf(file.bytes);
    for (const index of wanted) {
      if (index >= src.getPageCount()) throw new Error(`Page ${index} is not in the file`);
    }
    // One copyPages call shares objects between copies of the same page, so a stamp on one
    // would show on the other: each repeat of a page is copied in a later call of its own.
    const rounds: number[][] = [];
    const seen = new Map<number, number>();
    for (const index of wanted) {
      const round = seen.get(index) ?? 0;
      seen.set(index, round + 1);
      (rounds[round] ??= []).push(index);
    }
    const copies: PDFPage[][] = [];
    for (const round of rounds) copies.push(await unreadable(() => out.copyPages(src, round)));
    seen.clear();
    const pages = wanted.map((index) => {
      const round = seen.get(index) ?? 0;
      seen.set(index, round + 1);
      return copies[round]![rounds[round]!.indexOf(index)]!;
    });
    copied.set(file.documentId, pages);
  }

  for (const entry of plan) {
    const file = byId.get(entry.documentId);
    if (!file) throw new Error('The page plan names a file the request does not have');
    let page: PDFPage;
    if (file.contentType === 'application/pdf') {
      const next = copied.get(entry.documentId)?.shift();
      if (!next) throw new Error('The page plan and the copied pages differ');
      page = out.addPage(next);
    } else {
      if (entry.page !== 0) throw new Error('An image has only page 0');
      const embedded = images.get(file.documentId) ?? (await embedImage(out, file));
      images.set(file.documentId, embedded);
      // The page holds the image as stored; its /Rotate shows it upright (EXIF), then the plan.
      const shown = imageShownSize(embedded.header);
      const turned = embedded.header.turn % 180 !== 0;
      const [width, height] = turned ? [shown.height, shown.width] : [shown.width, shown.height];
      page = out.addPage([width, height]);
      page.drawImage(embedded.image, { x: 0, y: 0, width, height });
      page.setRotation(degrees(embedded.header.turn));
    }
    page.setRotation(degrees((ownRotation(page) + entry.rotation) % 360));
  }
  dropLeftOutPages(out);
  return out.save({ useObjectStreams: false });
}

/**
 * copyPages follows every reference, so a link's destination or a form field shared with another
 * page brings pages the plan left out (content and all) into the packet. This cuts every
 * reference to a page outside the packet, or to a widget not on a packet page, and deletes every
 * object the packet no longer reaches, so what a signer receives holds only the planned pages.
 */
export function dropLeftOutPages(doc: PDFDocument): void {
  const { context } = doc;
  const pages = new Set<PDFObject>(doc.getPages().map((p) => p.ref));
  const widgets = new Set<PDFObject>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) widgets.add(annots!.get(i));
  }
  const leftOut = (ref: PDFRef) => {
    const dict = context.lookup(ref);
    if (!(dict instanceof PDFDict)) return false;
    if (dict.get(PDFName.of('Type')) === PDFName.of('Page')) return !pages.has(ref);
    return dict.get(PDFName.of('Subtype')) === PDFName.of('Widget') && !widgets.has(ref);
  };
  const reached = new Set<PDFRef>();
  const queue: PDFObject[] = [context.trailerInfo.Root!];
  if (context.trailerInfo.Info) queue.push(context.trailerInfo.Info);
  const visit = (value: PDFObject) => {
    if (value instanceof PDFRef) {
      if (reached.has(value)) return;
      reached.add(value);
      const target = context.lookup(value);
      if (target) queue.push(target);
      return;
    }
    if (value instanceof PDFArray || value instanceof PDFDict) queue.push(value);
    else if ('dict' in value && value.dict instanceof PDFDict) queue.push(value.dict);
  };
  for (let item = queue.pop(); item; item = queue.pop()) {
    if (item instanceof PDFArray) {
      for (let i = item.size() - 1; i >= 0; i--) {
        const value = item.get(i);
        if (value instanceof PDFRef && leftOut(value)) item.set(i, PDFNull);
        else visit(value);
      }
    } else if (item instanceof PDFDict) {
      // A field's /Kids keeps only widgets still in the packet.
      const kids = item.lookupMaybe(PDFName.of('Kids'), PDFArray);
      if (kids && item.get(PDFName.of('Type')) !== PDFName.of('Pages')) {
        for (let i = kids.size() - 1; i >= 0; i--) {
          const kid = kids.get(i);
          if (kid instanceof PDFRef && leftOut(kid)) kids.remove(i);
        }
      }
      for (const [key, value] of item.entries()) {
        if (value instanceof PDFRef && leftOut(value)) item.delete(key);
        else visit(value);
      }
    } else {
      visit(item);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) context.delete(ref);
  }
}
