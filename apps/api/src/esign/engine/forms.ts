import {
  concatTransformationMatrix,
  drawObject,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFObject,
} from 'pdf-lib';

// Form fields and active content: what flattening draws into the page and what it removes.

const N = (name: string) => PDFName.of(name);
const HIDDEN = 2;
const NO_VIEW = 32;
/** Link actions a signed copy keeps; any other action (scripts, launch, submit) is removed. */
const SAFE_ACTIONS = [N('URI'), N('GoTo')];
/** Annotations that carry files or media. */
const ACTIVE_ANNOTS = ['FileAttachment', 'Screen', 'Movie', 'Sound', 'RichMedia', '3D'].map(N);

/**
 * Makes an appearance for each filled field that has none (every field when the form asks
 * viewers to with NeedAppearances), so flattening keeps its value. Helvetica first; values it
 * cannot write use Noto Sans.
 */
export async function fillAppearances(doc: PDFDocument, noto: () => Promise<PDFFont>) {
  const acroForm = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict);
  if (!acroForm) return;
  const form = doc.getForm();
  const regenerate = acroForm.lookup(N('NeedAppearances')) === PDFBool.True;
  let helvetica: PDFFont | undefined;
  for (const field of form.getFields()) {
    if (regenerate) form.markFieldAsDirty(field.ref);
    if (!field.needsAppearancesUpdate()) continue;
    try {
      field.defaultUpdateAppearances((helvetica ??= await doc.embedFont(StandardFonts.Helvetica)));
    } catch {
      field.defaultUpdateAppearances(await noto());
    }
  }
}

/** Draws each shown widget's appearance into its page (PDF 32000 12.5.5), then drops the widgets. */
export function flattenWidgets(doc: PDFDocument) {
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
      const flags = annot.lookupMaybe(N('F'), PDFNumber)?.asNumber() ?? 0;
      const ref = widgetAppearance(annot);
      const rect = numbers(annot.lookupMaybe(N('Rect'), PDFArray), 4);
      if (!ref || !rect || flags & (HIDDEN | NO_VIEW)) continue;
      const placement = placeAppearance(doc.context.lookup(ref, PDFStream).dict, rect);
      if (!placement) continue;
      const key = page.node.newXObject('FlatWidget', ref);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(...placement),
        drawObject(key),
        popGraphicsState(),
      );
    }
    page.node.set(N('Annots'), doc.context.obj(kept));
  }
}

/** Removes the form, scripts, automatic actions, embedded files and media from every page. */
export function makeInert(doc: PDFDocument) {
  for (const key of ['AcroForm', 'OpenAction', 'AA']) doc.catalog.delete(N(key));
  const names = doc.catalog.lookupMaybe(N('Names'), PDFDict);
  for (const key of ['JavaScript', 'EmbeddedFiles']) names?.delete(N(key));
  for (const page of doc.getPages()) {
    page.node.delete(N('AA'));
    const annots = page.node.Annots();
    if (!annots) continue;
    const kept: PDFObject[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const subtype = annot?.lookup(N('Subtype'));
      const action = annot?.lookupMaybe(N('A'), PDFDict);
      if (!annot || ACTIVE_ANNOTS.some((name) => name === subtype)) continue;
      const safe = SAFE_ACTIONS.some((name) => name === action?.lookup(N('S')));
      if (action && (!safe || action.has(N('Next')))) continue;
      annot.delete(N('AA'));
      kept.push(annots.get(i));
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

function numbers(array: PDFArray | undefined, count: number) {
  if (array?.size() !== count) return undefined;
  const values = Array.from({ length: count }, (_, i) => array.lookup(i));
  if (!values.every((v) => v instanceof PDFNumber)) return undefined;
  return values.map((v) => (v as PDFNumber).asNumber());
}

type Matrix = [number, number, number, number, number, number];

/**
 * The matrix that maps the appearance's BBox, transformed by its own Matrix, onto the widget's
 * Rect (corners in any order). The XObject applies its Matrix itself when drawn.
 */
export function placeAppearance(appearance: PDFDict, rect: number[]): Matrix | undefined {
  const box = numbers(appearance.lookupMaybe(N('BBox'), PDFArray), 4);
  const matrix = numbers(appearance.lookupMaybe(N('Matrix'), PDFArray), 6) ?? [1, 0, 0, 1, 0, 0];
  if (!box) return undefined;
  const [a, b, c, d, e, f] = matrix as Matrix;
  const [bx1, by1, bx2, by2] = box as [number, number, number, number];
  const corners = [bx1, bx2].flatMap((x) => [by1, by2].map((y) => [x, y] as const));
  const xs = corners.map(([x, y]) => a * x + c * y + e);
  const ys = corners.map(([x, y]) => b * x + d * y + f);
  const [left, bottom] = [Math.min(...xs), Math.min(...ys)];
  const [width, height] = [Math.max(...xs) - left, Math.max(...ys) - bottom];
  if (!(width > 0 && height > 0)) return undefined;
  const [x1, y1, x2, y2] = rect as [number, number, number, number];
  const sx = Math.abs(x2 - x1) / width;
  const sy = Math.abs(y2 - y1) / height;
  return [sx, 0, 0, sy, Math.min(x1, x2) - left * sx, Math.min(y1, y2) - bottom * sy];
}
