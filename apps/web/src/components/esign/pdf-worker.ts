// Module worker entry: turbopack bundles pdf.js's worker as its own chunk from this file. The
// legacy build, because the modern one needs Map.getOrInsertComputed (Chrome 141 lacks it).
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
