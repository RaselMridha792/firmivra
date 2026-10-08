'use client';

type Pdfjs = typeof import('pdfjs-dist');

export type PdfjsMode = 'worker' | 'no-worker';

let loaded: Promise<{ pdfjs: Pdfjs; mode: PdfjsMode }> | undefined;

/** Loads pdf.js (legacy build) once in the browser: in a module worker, else on the main thread. */
export function loadPdfjs(force?: PdfjsMode) {
  loaded ??= (async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as Pdfjs;
    if (force !== 'no-worker') {
      try {
        const worker = new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' });
        pdfjs.GlobalWorkerOptions.workerPort = worker;
        return { pdfjs, mode: 'worker' as const };
      } catch (error) {
        console.warn('pdf.js worker failed, running it on the main thread', error);
      }
    }
    // Loading the worker module here sets globalThis.pdfjsWorker, which pdf.js then runs
    // in-thread (its "fake worker").
    // @ts-expect-error pdf.js ships no types for its worker module.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    return { pdfjs, mode: 'no-worker' as const };
  })();
  return loaded;
}
