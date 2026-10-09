import { degrees, PDFDict, PDFDocument, PDFName, type PDFPage } from 'pdf-lib';
import { ESIGN_MAX_PAGES, type EsignPage, UPLOAD_LIMITS } from '@firmivra/types';
import {
  EsignEngineError,
  type InspectedFile,
  type PageSize,
  type SourceFile,
} from './engine.types.js';

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

/** A page's own /Rotate, normalised to 0, 90, 180 or 270. */
export function ownRotation(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

/**
 * A page's size as a viewer shows it at plan rotation 0: its CropBox, turned by the page's own
 * /Rotate. Fields are placed on this view, so pageSizes describe it.
 */
export function shownSize(page: PDFPage): PageSize {
  const { width, height } = page.getCropBox();
  const turned = ownRotation(page) % 180 !== 0;
  return turned
    ? { width: round(height), height: round(width) }
    : { width: round(width), height: round(height) };
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
    const count = doc.getPageCount();
    if (count < 1) throw new EsignEngineError('PDF_UNREADABLE');
    if (count > ESIGN_MAX_PAGES) throw new EsignEngineError('TOO_MANY_PAGES');
    // Every page must have a readable box: the sizes are needed later anyway.
    doc.getPages().forEach(shownSize);
    return doc;
  });
}

/** Embeds a JPG or PNG; a broken image is PDF_UNREADABLE. */
async function embedImage(doc: PDFDocument, file: Pick<SourceFile, 'contentType' | 'bytes'>) {
  if (file.bytes.byteLength > UPLOAD_LIMITS.maxBytes) throw new EsignEngineError('PDF_UNREADABLE');
  return unreadable(() =>
    file.contentType === 'image/png' ? doc.embedPng(file.bytes) : doc.embedJpg(file.bytes),
  );
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
  const image = await embedImage(await PDFDocument.create(), file);
  return { pageCount: 1, pageSizes: [imagePageSize(image.width, image.height)] };
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

  // Copy each PDF's planned pages in one call (once per plan entry, duplicates included).
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
    copied.set(file.documentId, await unreadable(() => out.copyPages(src, wanted)));
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
      const image = images.get(file.documentId) ?? (await embedImage(out, file));
      images.set(file.documentId, image);
      const { width, height } = imagePageSize(image.width, image.height);
      page = out.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });
    }
    page.setRotation(degrees((ownRotation(page) + entry.rotation) % 360));
  }
  return out.save({ useObjectStreams: false });
}
