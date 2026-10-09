import { createHash } from 'node:crypto';
import type { PdfEngine } from './engine.types.js';
import { certificate } from './certificate.js';
import { compose, inspect } from './pdf-compose.js';
import { finalize } from './pdf-finalize.js';

/** The PDF engine behind PDF_ENGINE (pdf-lib). */
export const pdfEngine: PdfEngine = { inspect, compose, finalize, certificate };

/** Hex SHA-256 of a file: originalSha256 and finalSha256 are taken with this. */
export const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
