'use client';

/**
 * pdf.js's binary data, bundled as hashed static files: the decoders for scanned pages (JBIG2 and
 * JPEG 2000) and the standard fonts some PDFs name without embedding. pdf.js asks for each file by
 * name; this maps the name to the bundled URL, so nothing has to be served from a fixed folder
 * (the proxy rewrites every other path to a page).
 *
 * Not covered: Adobe CMaps (only CJK text in fonts that don't embed their encoding), ICC colour
 * profiles and the no-wasm decoders (both load from a folder URL inside the worker). Without them
 * pdf.js warns and falls back.
 */
const FILES: Record<'wasmUrl' | 'standardFontDataUrl', Record<string, URL>> = {
  wasmUrl: {
    'jbig2.wasm': new URL('pdfjs-dist/wasm/jbig2.wasm', import.meta.url),
    'openjpeg.wasm': new URL('pdfjs-dist/wasm/openjpeg.wasm', import.meta.url),
  },
  standardFontDataUrl: {
    'FoxitDingbats.pfb': new URL('pdfjs-dist/standard_fonts/FoxitDingbats.pfb', import.meta.url),
    'FoxitFixed.pfb': new URL('pdfjs-dist/standard_fonts/FoxitFixed.pfb', import.meta.url),
    'FoxitFixedBold.pfb': new URL('pdfjs-dist/standard_fonts/FoxitFixedBold.pfb', import.meta.url),
    'FoxitFixedBoldItalic.pfb': new URL(
      'pdfjs-dist/standard_fonts/FoxitFixedBoldItalic.pfb',
      import.meta.url,
    ),
    'FoxitFixedItalic.pfb': new URL(
      'pdfjs-dist/standard_fonts/FoxitFixedItalic.pfb',
      import.meta.url,
    ),
    'FoxitSerif.pfb': new URL('pdfjs-dist/standard_fonts/FoxitSerif.pfb', import.meta.url),
    'FoxitSerifBold.pfb': new URL('pdfjs-dist/standard_fonts/FoxitSerifBold.pfb', import.meta.url),
    'FoxitSerifBoldItalic.pfb': new URL(
      'pdfjs-dist/standard_fonts/FoxitSerifBoldItalic.pfb',
      import.meta.url,
    ),
    'FoxitSerifItalic.pfb': new URL(
      'pdfjs-dist/standard_fonts/FoxitSerifItalic.pfb',
      import.meta.url,
    ),
    'FoxitSymbol.pfb': new URL('pdfjs-dist/standard_fonts/FoxitSymbol.pfb', import.meta.url),
    'LiberationSans-Bold.ttf': new URL(
      'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf',
      import.meta.url,
    ),
    'LiberationSans-BoldItalic.ttf': new URL(
      'pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf',
      import.meta.url,
    ),
    'LiberationSans-Italic.ttf': new URL(
      'pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf',
      import.meta.url,
    ),
    'LiberationSans-Regular.ttf': new URL(
      'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
      import.meta.url,
    ),
  },
};

/**
 * pdf.js's `BinaryDataFactory`: fetched on the main thread and handed to the worker. Passed with
 * `useWorkerFetch: false`.
 */
export class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind in FILES ? FILES[kind as keyof typeof FILES][filename] : undefined;
    if (!url) throw new Error(`pdf.js asked for ${kind} ${filename}, which is not bundled`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pdf.js data ${filename}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}
