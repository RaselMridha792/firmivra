'use client';

type Pdfjs = typeof import('pdfjs-dist');
type PdfWorker = InstanceType<Pdfjs['PDFWorker']>;

export type PdfjsMode = 'worker' | 'no-worker';

/** How long the worker may take to say it is ready before pdf.js runs on the main thread. */
const WORKER_READY_MS = 10_000;

/**
 * pdf.js plus one PDFWorker that every document shares. Passed to getDocument as `worker`, so
 * closing one document never tears the worker down under the next one.
 */
export interface LoadedPdfjs {
  pdfjs: Pdfjs;
  worker: PdfWorker;
  mode: PdfjsMode;
}

let loaded: Promise<LoadedPdfjs> | undefined;

/**
 * Starts the module worker and waits for its first message (pdf.js sends "ready"). A worker can
 * fail after it is created (its chunk does not load, a CSP blocks it, no module workers), which
 * pdf.js would never notice when given a port, so that case resolves null here.
 */
function startWorker(): Promise<Worker | null> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const fail = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(null);
    };
    const timer = setTimeout(fail, WORKER_READY_MS);
    worker.addEventListener('error', fail, { once: true });
    worker.addEventListener(
      'message',
      () => {
        clearTimeout(timer);
        worker.removeEventListener('error', fail);
        resolve(worker);
      },
      { once: true },
    );
  });
}

/**
 * Loads pdf.js (legacy build: the modern one needs browser features some signers lack) once per
 * page: in a module worker, else on the main thread. A failed load is retried on the next call.
 */
export function loadPdfjs(): Promise<LoadedPdfjs> {
  loaded ??= (async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as Pdfjs;
    const worker = await startWorker();
    if (worker) {
      // The types say `port?: null`, but pdf.js takes a Worker here.
      const port = worker as unknown as null;
      return { pdfjs, worker: new pdfjs.PDFWorker({ port }), mode: 'worker' as const };
    }
    console.warn('pdf.js worker did not start; running it on the main thread');
    // Loading the worker module here sets globalThis.pdfjsWorker, which pdf.js then runs
    // in-thread (its "fake worker").
    // @ts-expect-error pdf.js ships no types for its worker module.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return { pdfjs, worker: new pdfjs.PDFWorker(), mode: 'no-worker' as const };
  })().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}
