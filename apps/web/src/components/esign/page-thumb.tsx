'use client';

import { useEffect, useRef, useState } from 'react';
import { type PdfDocument, type PdfLoadingTask, startPdf } from './open-pdf';

/** Open files by address, shared by every thumbnail of the same file. */
const pdfs = new Map<string, Promise<PdfLoadingTask>>();
/** Decoded images by address: turning a page draws it again without downloading it again. */
const images = new Map<string, Promise<HTMLImageElement>>();

function openPdf(url: string): Promise<PdfDocument> {
  let task = pdfs.get(url);
  if (!task) {
    task = startPdf(url);
    pdfs.set(url, task);
  }
  const mine = task;
  return mine
    .then((t) => t.promise)
    .catch((error: unknown) => {
      // A failed load is tried again by the next thumbnail, unless one already started that.
      if (pdfs.get(url) === mine) pdfs.delete(url);
      throw error;
    });
}

function openImage(url: string): Promise<HTMLImageElement> {
  let img = images.get(url);
  if (!img) {
    img = new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const mine = img;
    img.catch(() => {
      if (images.get(url) === mine) images.delete(url);
    });
    images.set(url, img);
  }
  return img;
}

/** Closes one file's thumbnails' data (the file left the request). */
export function closeThumbFile(url: string) {
  void pdfs
    .get(url)
    ?.then((t) => t.destroy())
    .catch(() => undefined);
  pdfs.delete(url);
  images.delete(url);
}

/** Closes every file the thumbnails opened (the page list went away). */
export function closeThumbFiles() {
  for (const url of [...pdfs.keys(), ...images.keys()]) closeThumbFile(url);
}

/** Draws the image `width` CSS pixels wide, turned clockwise by `rotation`. */
function drawImage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  rotation: number,
  width: number,
) {
  const turned = rotation % 180 !== 0;
  const w = Math.round(width * (window.devicePixelRatio || 1));
  const scale = w / (turned ? img.naturalHeight : img.naturalWidth);
  canvas.width = w;
  canvas.height = Math.round((turned ? img.naturalWidth : img.naturalHeight) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
}

/**
 * A small picture of one page of a request's file: a PDF page or an image, turned by the page
 * plan's rotation. `size` is the page's size before that rotation (EsignDocument.pageSizes).
 * Like PdfPages, it draws only near the screen and frees its canvas when far, so a 100-page
 * packet stays within a phone's canvas budget.
 */
export function PageThumb({
  url,
  isPdf,
  page,
  rotation,
  size,
  label,
  width = 160,
}: {
  url: string;
  isPdf: boolean;
  page: number;
  rotation: number;
  size: { width: number; height: number };
  label: string;
  /** In CSS pixels. */
  width?: number;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  // Which drawing failed: a new page, file or rotation tries again.
  const drawing = `${url}|${page}|${rotation}|${width}`;
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const turned = rotation % 180 !== 0;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      rootMargin: '400px 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!near || !el) return;
    let active = true;
    let task: { cancel: () => void } | undefined;
    let pdfPage: Awaited<ReturnType<PdfDocument['getPage']>> | undefined;
    (async () => {
      if (!isPdf) {
        const img = await openImage(url);
        if (active) drawImage(el, img, rotation, width);
        return;
      }
      const doc = await openPdf(url);
      pdfPage = await doc.getPage(page + 1);
      if (!active) return;
      const turn = (pdfPage.rotate + rotation) % 360;
      const base = pdfPage.getViewport({ scale: 1, rotation: turn });
      const viewport = pdfPage.getViewport({
        scale: (width * (window.devicePixelRatio || 1)) / base.width,
        rotation: turn,
      });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      const render = pdfPage.render({ canvas: el, viewport });
      task = render;
      await render.promise;
    })().catch(() => {
      // A cancelled render rejects too; only a failure while still shown counts.
      if (active) setFailedAt(drawing);
    });
    return () => {
      active = false;
      task?.cancel();
      // Free the bitmap and pdf.js's page data.
      el.width = 0;
      el.height = 0;
      pdfPage?.cleanup();
    };
  }, [near, url, isPdf, page, rotation, width, drawing]);

  return (
    <div
      ref={frameRef}
      role="img"
      aria-label={label}
      data-testid="page-thumb"
      data-rotation={rotation}
      className="relative overflow-hidden rounded-control border border-border bg-surface"
      // The page's own proportions (data, not a design value), so the frame holds its place.
      style={{
        width,
        aspectRatio: turned ? `${size.height} / ${size.width}` : `${size.width} / ${size.height}`,
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {failedAt === drawing && (
        <span className="absolute inset-0 flex items-center justify-center bg-surface p-2 text-center text-xs text-muted">
          No preview
        </span>
      )}
    </div>
  );
}
