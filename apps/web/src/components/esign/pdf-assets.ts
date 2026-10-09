'use client';

/**
 * pdf.js's binary data, bundled as hashed static files: the decoders for scanned pages (JBIG2 and
 * JPEG 2000) and the two symbol fonts it always loads itself (other unembedded fonts use the
 * device's fonts). pdf.js asks for each file by name; this maps the name to the bundled URL, so
 * nothing has to be served from a fixed folder (the proxy rewrites every other path to a page).
 *
 * Not covered, because pdf.js loads them from a folder URL: Adobe CMaps (CJK text in fonts that
 * don't embed their encoding), ICC colour profiles and the no-wasm decoders. pdf.js warns and
 * falls back; without WebAssembly, PdfPages warns the signer instead.
 */
const FILES: Record<string, Record<string, URL>> = {
  wasmUrl: {
    'jbig2.wasm': new URL('pdfjs-dist/wasm/jbig2.wasm', import.meta.url),
    'openjpeg.wasm': new URL('pdfjs-dist/wasm/openjpeg.wasm', import.meta.url),
  },
  standardFontDataUrl: {
    'FoxitSymbol.pfb': new URL('pdfjs-dist/standard_fonts/FoxitSymbol.pfb', import.meta.url),
    'FoxitDingbats.pfb': new URL('pdfjs-dist/standard_fonts/FoxitDingbats.pfb', import.meta.url),
  },
};

/** One fetch per file per page load; every document's worker side asks again. */
const fetched = new Map<string, Promise<Uint8Array>>();

async function load(url: URL): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * pdf.js's `BinaryDataFactory`: fetched on the main thread and handed to the worker. Passed with
 * `useWorkerFetch: false`.
 */
export class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const files = Object.hasOwn(FILES, kind) ? FILES[kind] : undefined;
    const url = files && Object.hasOwn(files, filename) ? files[filename] : undefined;
    if (!url) throw new Error(`pdf.js asked for ${kind} ${filename}, which is not bundled`);
    let bytes = fetched.get(url.href);
    if (!bytes) {
      bytes = load(url);
      fetched.set(url.href, bytes);
      // A failed fetch is tried again by the next document.
      bytes.catch(() => fetched.delete(url.href));
    }
    // pdf.js copies what it gets into its message to the worker, so the cached bytes are shared.
    return bytes;
  }
}
