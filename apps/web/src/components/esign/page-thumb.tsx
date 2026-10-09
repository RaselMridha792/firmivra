'use client';

import { useEffect, useRef, useState } from 'react';
import { loadPdfjs } from './load-pdfjs';
import { BundledDataFactory } from './pdf-assets';

type PdfDocument = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['pdfjs']['getDocument']>['promise']
>;

type LoadingTask = ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['pdfjs']['getDocument']>;

/** Open files by address, shared by every thumbnail of the same file. */
const open = new Map<string, Promise<LoadingTask>>();

function openPdf(url: string): Promise<PdfDocument> {
  let task = open.get(url);
  if (!task) {
    task = loadPdfjs().then(({ pdfjs, worker }) =>
      pdfjs.getDocument({
        url,
        withCredentials: true,
        worker,
        BinaryDataFactory: BundledDataFactory,
        useWorkerFetch: false,
      }),
    );
    open.set(url, task);
  }
  return task
    .then((t) => t.promise)
    .catch((error: unknown) => {
      // A failed load is tried again by the next thumbnail that needs it.
      open.delete(url);
      throw error;
    });
}

/** Closes every file the thumbnails opened (when the page list goes away). */
export function closeThumbFiles() {
  for (const task of open.values()) void task.then((t) => t.destroy()).catch(() => undefined);
  open.clear();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Draws `source` onto the canvas `width` CSS pixels wide, turned clockwise by `rotation`. */
async function drawImage(canvas: HTMLCanvasElement, url: string, rotation: number, width: number) {
  const img = await loadImage(url);
  const turned = rotation % 180 !== 0;
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(width * ratio);
  const scale = w / (turned ? img.naturalHeight : img.naturalWidth);
  canvas.width = w;
  canvas.height = Math.round((turned ? img.naturalWidth : img.naturalHeight) * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    img,
    (-img.naturalWidth * scale) / 2,
    (-img.naturalHeight * scale) / 2,
    img.naturalWidth * scale,
    img.naturalHeight * scale,
  );
}

/**
 * A small picture of one page of a request's file: a PDF page or an image, turned by the page
 * plan's rotation. `size` is the page's size before that rotation (EsignDocument.pageSizes).
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const turned = rotation % 180 !== 0;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let active = true;
    let task: { cancel: () => void; promise: Promise<void> } | undefined;
    (async () => {
      if (!isPdf) {
        await drawImage(el, url, rotation, width);
        return;
      }
      const doc = await openPdf(url);
      const p = await doc.getPage(page + 1);
      if (!active) return;
      const base = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      const viewport = p.getViewport({
        scale: (width * (window.devicePixelRatio || 1)) / base.width,
        rotation: (p.rotate + rotation) % 360,
      });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = p.render({ canvas: el, viewport });
      await task.promise;
    })().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [url, isPdf, page, rotation, width]);

  return (
    <div
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
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center p-2 text-center text-xs text-muted">
          No preview
        </span>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      )}
    </div>
  );
}
