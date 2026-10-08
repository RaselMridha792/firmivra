'use client';

import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { loadPdfjs } from './load-pdfjs';

type PdfDocument = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['pdfjs']['getDocument']>['promise']
>;

/** One page's size in PDF points (1/72 inch) at rotation 0. */
export interface PageSize {
  width: number;
  height: number;
}

interface PdfPagesProps {
  /** The PDF's bytes, or a same-origin URL (the API's download route). */
  source: Uint8Array | string;
  /** Accessible name of the document, e.g. its file name. */
  label: string;
  /** Called once with every page's size, before the pages draw. */
  onLoad?: (pages: PageSize[]) => void;
  /** Drawn above each page at the page's on-screen size (FieldOverlay). */
  overlay?: (pageIndex: number, scale: number) => ReactNode;
}

/**
 * Every page of a PDF, as wide as its container. Pages draw when they scroll near the screen, so a
 * 100-page document opens fast. pdf.js runs in its worker (load-pdfjs.ts).
 */
export function PdfPages({ source, label, onLoad, overlay }: PdfPagesProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Tagged with its source, so a new source shows "Loading" without resetting state in an effect.
  const [loaded, setLoaded] = useState<
    | { source: PdfPagesProps['source']; doc: PdfDocument; sizes: PageSize[] }
    | { source: PdfPagesProps['source']; failed: true }
    | null
  >(null);
  const [width, setWidth] = useState(0);
  const loadedEvent = useEffectEvent((sizes: PageSize[]) => onLoad?.(sizes));

  useEffect(() => {
    let active = true;
    let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['pdfjs']['getDocument']> | undefined;
    (async () => {
      const { pdfjs } = await loadPdfjs();
      if (!active) return;
      // pdf.js takes ownership of the bytes it is given, so it gets a copy.
      task = pdfjs.getDocument(
        typeof source === 'string'
          ? { url: source, withCredentials: true }
          : { data: source.slice() },
      );
      const doc = await task.promise;
      const sizes = await Promise.all(
        Array.from({ length: doc.numPages }, async (_, i) => {
          const { width: w, height: h } = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
          return { width: w, height: h };
        }),
      );
      if (!active) return;
      setLoaded({ source, doc, sizes });
      loadedEvent(sizes);
    })().catch(() => {
      if (active) setLoaded({ source, failed: true });
    });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [source]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const current = loaded?.source === source ? loaded : null;
  const doc = current && 'doc' in current ? current : null;
  const failed = !!current && 'failed' in current;
  return (
    <div ref={boxRef} role="document" aria-label={label} aria-busy={!doc && !failed}>
      {failed ? (
        <p data-testid="pdf-error" role="alert" className="p-4 text-sm text-danger">
          We couldn&apos;t open this document.
        </p>
      ) : !doc ? (
        <p className="p-4 text-sm text-muted">Loading document…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {width > 0 &&
            doc.sizes.map((size, i) => (
              <PdfPage
                key={`page-${i + 1}`}
                doc={doc.doc}
                index={i}
                count={doc.sizes.length}
                scale={width / size.width}
                size={size}
                overlay={overlay}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  index,
  count,
  scale,
  size,
  overlay,
}: {
  doc: PdfDocument;
  index: number;
  count: number;
  scale: number;
  size: PageSize;
  overlay: PdfPagesProps['overlay'];
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      rootMargin: '600px 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!near || !el) return;
    let task: { cancel: () => void; promise: Promise<void> } | undefined;
    let active = true;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (!active) return;
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = page.render({ canvas: el, viewport });
      await task.promise;
      if (active) setDrawn(true);
    })().catch(() => {
      // A cancelled render (scrolled away or resized) rejects; the next one draws the page.
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [doc, index, near, scale]);

  return (
    <div
      ref={frameRef}
      data-testid="pdf-page"
      data-page={index + 1}
      data-drawn={drawn || undefined}
      aria-label={`Page ${index + 1} of ${count}`}
      role="group"
      className="relative w-full bg-surface shadow-card"
      // The page's own proportions (data, not a design value), so the frame holds its place
      // before the page draws.
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {overlay && <div className="absolute inset-0">{overlay(index, scale)}</div>}
    </div>
  );
}
