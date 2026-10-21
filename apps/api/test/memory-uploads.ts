// The upload half of the e2e tests' in-memory DocumentStorage fakes (CI has no s3mock): a PUT
// for a file of at most UPLOAD_LIMITS.multipartThresholdBytes (memory:<key>), else a multipart
// upload whose parts go to memory:<key>?uploadId=..&partNumber=N. `send` is the browser; `complete`
// and `abort` are storage's, with S3's rules (exactly parts 1 to N of their sizes). The S3
// adapter itself is tested in test/unit/documents.test.ts. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { UPLOAD_LIMITS, type UploadTicket } from '@firmivra/types';
import {
  type CompletedUpload,
  partSizes,
  type PresignedUpload,
} from '../src/storage/document-storage.js';

export class MemoryUploads {
  /** Multipart uploads begun and neither completed nor dropped, by upload id. */
  readonly open = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  /** Every multipart upload dropped (`abort`), by upload id. */
  readonly aborted = new Set<string>();
  /** Every multipart upload completed, by upload id. */
  readonly completed = new Set<string>();

  /** `objects`: the fake's stored objects, by key (a PUT and a completed upload land there). */
  constructor(private readonly objects: Map<string, Buffer>) {}

  presign(file: { key: string; contentType: string; sizeBytes: number }): Promise<PresignedUpload> {
    const url = `memory:${file.key}`;
    if (file.sizeBytes <= UPLOAD_LIMITS.multipartThresholdBytes) {
      return Promise.resolve({ method: 'PUT', url, headers: { 'content-type': file.contentType } });
    }
    const uploadId = randomUUID();
    this.open.set(uploadId, { key: file.key, parts: new Map() });
    const parts = partSizes(file.sizeBytes).map((_, i) => ({
      partNumber: i + 1,
      url: `${url}?uploadId=${uploadId}&partNumber=${i + 1}`,
      headers: {},
    }));
    const partSizeBytes = UPLOAD_LIMITS.partSizeBytes;
    return Promise.resolve({ method: 'MULTIPART', uploadId, partSizeBytes, parts });
  }

  /** The browser: the PUT of `bytes`, or each of its parts in turn. */
  send(ticket: UploadTicket, bytes: Buffer): void {
    if (ticket.method === 'PUT') {
      this.objects.set(ticketKey(ticket), bytes);
      return;
    }
    for (const part of ticket.parts) {
      const start = (part.partNumber - 1) * ticket.partSizeBytes;
      this.putPart(part.url, bytes.subarray(start, start + ticket.partSizeBytes));
    }
  }

  /** The browser's PUT of one part to its URL; the last one sent counts. */
  putPart(url: string, bytes: Buffer): void {
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const upload = this.open.get(query.get('uploadId') ?? '');
    if (!upload) throw new Error('NoSuchUpload');
    upload.parts.set(Number(query.get('partNumber')), Buffer.from(bytes));
  }

  complete(key: string, uploadId: string, sizeBytes: number): Promise<CompletedUpload> {
    const upload = this.open.get(uploadId);
    if (upload?.key !== key) {
      return Promise.resolve(this.objects.has(key) ? 'COMPLETE' : 'MISSING');
    }
    const sizes = partSizes(sizeBytes);
    const parts = [...upload.parts.entries()].sort(([a], [b]) => a - b);
    const exact =
      parts.length === sizes.length &&
      parts.every(([n, bytes], i) => n === i + 1 && bytes.length === sizes[i]);
    if (!exact) return Promise.resolve('MISMATCH');
    this.open.delete(uploadId);
    this.completed.add(uploadId);
    this.objects.set(key, Buffer.concat(parts.map(([, bytes]) => bytes)));
    return Promise.resolve('COMPLETE');
  }

  abort(key: string, uploadId: string): Promise<void> {
    if (this.open.get(uploadId)?.key === key) {
      this.open.delete(uploadId);
      this.aborted.add(uploadId);
    }
    return Promise.resolve();
  }
}

/** The key a ticket uploads to: its PUT URL, or a part's without the query. */
export function ticketKey(ticket: UploadTicket): string {
  const url = ticket.method === 'PUT' ? ticket.url : ticket.parts[0]!.url;
  const query = url.indexOf('?');
  return (query < 0 ? url : url.slice(0, query)).slice('memory:'.length);
}

/** The multipart upload id of a ticket's part URLs, or null for a PUT. */
export function ticketUploadId(ticket: UploadTicket): string | null {
  if (ticket.method === 'PUT') return null;
  const url = ticket.parts[0]!.url;
  return new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('uploadId');
}

/**
 * `size` bytes that pass as a PDF (%PDF- then filler): over UPLOAD_LIMITS.multipartThresholdBytes
 * it goes up as a multipart upload.
 */
export function bigPdf(size: number = UPLOAD_LIMITS.multipartThresholdBytes + 1): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write('%PDF-1.7\n', 0, 'latin1');
  bytes.write(`${randomUUID()}\n`, 9, 'latin1');
  return bytes;
}
