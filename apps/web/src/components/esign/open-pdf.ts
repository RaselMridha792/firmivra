import { loadPdfjs } from './load-pdfjs';
import { BundledDataFactory } from './pdf-assets';

export type PdfLoadingTask = ReturnType<
  Awaited<ReturnType<typeof loadPdfjs>>['pdfjs']['getDocument']
>;
export type PdfDocument = Awaited<PdfLoadingTask['promise']>;

/** Starts loading a PDF with the settings every Firm Sign view uses (the viewer, thumbnails). */
export async function startPdf(source: Uint8Array | string): Promise<PdfLoadingTask> {
  const { pdfjs, worker } = await loadPdfjs();
  return pdfjs.getDocument({
    // pdf.js takes ownership of the bytes it is given, so it gets a copy.
    ...(typeof source === 'string'
      ? { url: source, withCredentials: true }
      : { data: source.slice() }),
    worker,
    // Scanned pages and unembedded fonts: their files come from the bundle (pdf-assets.ts).
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
  });
}
