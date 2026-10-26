'use client';

import type { LibraryDocument } from '@firmivra/types';
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  DownloadSimple,
  FrameCorners,
  Minus,
  Plus,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { PdfPages } from '../../../../../../components/esign/pdf-pages';
import { api } from '../../../../../../lib/api';

const ZOOMS = [50, 75, 100, 125, 150, 200] as const;

type Source =
  | { kind: 'loading' }
  | { kind: 'pdf'; bytes: Uint8Array }
  | { kind: 'image'; url: string }
  | { kind: 'none'; reason: string };

const tool =
  'inline-flex size-9 items-center justify-center rounded-control text-heading hover:bg-surface disabled:text-muted disabled:hover:bg-transparent';

/**
 * Frame 2's viewer: the selected document's inline preview (the library API's `preview`, a clean
 * file only), with page navigation, zoom and full screen affecting the viewer only. A PDF draws
 * with Firm Sign's renderer; an image shows as it is; any other type says so and offers the
 * download.
 */
export function DocumentViewer({
  doc,
  onDownload,
}: {
  doc: LibraryDocument;
  onDownload: () => void;
}) {
  const [source, setSource] = useState<Source>({ kind: 'loading' });
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState('1');
  const [zoom, setZoom] = useState<number>(100);
  const [full, setFull] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pdf = doc.contentType === 'application/pdf';
  const image = doc.contentType.startsWith('image/');

  useEffect(() => {
    let live = true;
    (async () => {
      if (doc.scanStatus !== 'CLEAN')
        return setSource({
          kind: 'none',
          reason:
            doc.scanStatus === 'PENDING'
              ? 'The file is still being checked for viruses. Its preview shows once it passes.'
              : 'This file did not pass the virus check, so it cannot be opened.',
        });
      if (!pdf && !image)
        return setSource({
          kind: 'none',
          reason: 'This file type has no preview here. Download it to open it.',
        });
      const link = await api.documentLibrary.preview(doc.id);
      if (image) return live && setSource({ kind: 'image', url: link.url });
      // The bytes are fetched here (no cookies go to the storage link), then drawn by pdf.js.
      const bytes = new Uint8Array(await (await fetch(link.url)).arrayBuffer());
      if (live) setSource({ kind: 'pdf', bytes });
    })().catch(() => {
      if (live) setSource({ kind: 'none', reason: 'The preview could not be loaded right now.' });
    });
    return () => {
      live = false;
    };
  }, [doc.id, doc.scanStatus, pdf, image]);

  // The page most in view, as the toolbar's number.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || source.kind !== 'pdf' || !pages) return;
    const seen = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          seen.set(Number((e.target as HTMLElement).dataset['page']), e.intersectionRatio);
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) {
          setPage(best[0]);
          setTyped(String(best[0]));
        }
      },
      { root: box, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    box.querySelectorAll('[data-page]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [source.kind, pages, zoom]);

  useEffect(() => {
    const off = () => setFull(document.fullscreenElement === frameRef.current);
    document.addEventListener('fullscreenchange', off);
    return () => document.removeEventListener('fullscreenchange', off);
  }, []);

  const go = (n: number) => {
    const to = Math.min(Math.max(1, n), pages || 1);
    scrollRef.current
      ?.querySelector(`[data-page="${to}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setPage(to);
    setTyped(String(to));
  };
  const step = (by: -1 | 1) => {
    const at = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? 2 : at) + by))]!);
  };
  const ready = source.kind === 'pdf' && pages > 0;

  return (
    <div
      ref={frameRef}
      data-testid="document-viewer"
      className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-canvas"
    >
      <div
        role="toolbar"
        aria-label="Viewer"
        className="flex flex-wrap items-center gap-1 border-b border-border bg-canvas px-2 py-1.5"
      >
        <button
          type="button"
          className={tool}
          aria-label="Fit to width"
          disabled={!ready}
          onClick={() => setZoom(100)}
        >
          <FrameCorners aria-hidden weight="bold" className="size-5" />
        </button>
        <form
          className="flex items-center gap-2 px-2 text-sm text-heading"
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(typed) || 1);
          }}
        >
          <input
            aria-label="Page"
            inputMode="numeric"
            value={typed}
            disabled={!ready}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => go(Number(typed) || page)}
            className="h-9 w-12 rounded-control border border-border bg-surface text-center"
          />
          <span aria-hidden>/</span>
          <span data-testid="viewer-pages">{ready ? pages : '–'}</span>
        </form>
        <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
        <button
          type="button"
          className={tool}
          aria-label="Zoom out"
          disabled={!ready || zoom === ZOOMS[0]}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden weight="bold" className="size-5" />
        </button>
        <span
          data-testid="viewer-zoom"
          className="min-w-16 rounded-control border border-border bg-surface px-2 py-1.5 text-center text-sm text-heading"
        >
          {zoom}%
        </span>
        <button
          type="button"
          className={tool}
          aria-label="Zoom in"
          disabled={!ready || zoom === ZOOMS[ZOOMS.length - 1]}
          onClick={() => step(1)}
        >
          <Plus aria-hidden weight="bold" className="size-5" />
        </button>
        <span className="mx-1 h-6 w-px bg-divider" aria-hidden />
        <button
          type="button"
          className={tool}
          aria-label={full ? 'Leave full screen' : 'Full screen'}
          disabled={source.kind === 'none' || source.kind === 'loading'}
          onClick={() =>
            void (full ? document.exitFullscreen() : frameRef.current?.requestFullscreen())?.catch(
              () => undefined,
            )
          }
        >
          {full ? (
            <ArrowsInSimple aria-hidden weight="bold" className="size-5" />
          ) : (
            <ArrowsOutSimple aria-hidden weight="bold" className="size-5" />
          )}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className={tool}
          aria-label="Download"
          disabled={doc.scanStatus !== 'CLEAN'}
          onClick={onDownload}
        >
          <DownloadSimple aria-hidden weight="bold" className="size-5" />
        </button>
      </div>
      <div
        ref={scrollRef}
        className={`overflow-auto bg-disabled p-4 ${full ? 'h-full' : 'h-[34rem]'}`}
      >
        {source.kind === 'loading' ? (
          <p className="p-4 text-sm text-muted">Loading the preview…</p>
        ) : source.kind === 'none' ? (
          <p
            role="status"
            className="mx-auto mt-16 max-w-md rounded-card bg-surface p-6 text-center text-sm text-text"
          >
            {source.reason}
          </p>
        ) : source.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived storage link, not a static asset
          <img
            src={source.url}
            alt={doc.fileName}
            className="mx-auto max-w-full bg-surface shadow-card"
          />
        ) : (
          <div className="mx-auto" style={{ width: `${zoom}%` }}>
            <PdfPages
              source={source.bytes}
              label={doc.fileName}
              onLoad={(sizes) => setPages(sizes.length)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
