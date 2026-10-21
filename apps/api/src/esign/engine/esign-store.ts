import { randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { UPLOAD_LIMITS } from '@firmivra/types';
import {
  type CompletedUpload,
  partSizes,
  type PresignedUpload,
  S3DocumentStorage,
  statusOf,
} from '../../storage/document-storage.js';
import type { EsignStore, EsignStoredObject } from './engine.types.js';

// Firm Sign's objects in the documents bucket (R18 step 4). Every key is chosen by the API and
// checked against the caller's firm: a bug elsewhere can never read or write another firm's file
// through this store (one of the four walls, with RLS, the tenant guard and per-firm KMS keys).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** One or more plain path segments: letters, digits, dot, dash, underscore; never "." or "..". */
const NAME = /^(?!\.{1,2}(\/|$))[A-Za-z0-9_-][A-Za-z0-9._-]*(\/(?!\.{1,2}(\/|$))[A-Za-z0-9._-]+)*$/;

/** Thrown for a key outside the caller's firm or a malformed one: always a bug, never a 4xx. */
export class EsignKeyError extends Error {
  constructor() {
    super('Refused a Firm Sign storage key outside the firm');
    this.name = 'EsignKeyError';
  }
}

function folder(businessId: string, area: 'esign' | 'documents'): string {
  if (!UUID.test(businessId)) throw new EsignKeyError();
  return `tenant/${businessId}/${area}/`;
}

/** The key, when it is a plain key under the firm's `area` folder; else throws. */
export function checkKey(businessId: string, key: string, area: 'esign' | 'documents' = 'esign') {
  const prefix = folder(businessId, area);
  const rest = key.slice(prefix.length);
  if (!key.startsWith(prefix) || !NAME.test(rest)) throw new EsignKeyError();
  // Firm Sign's own files always sit in a request's folder.
  const [request, ...name] = rest.split('/');
  if (area === 'esign' && (!UUID.test(request!) || name.length === 0)) throw new EsignKeyError();
  return key;
}

export function esignKey(businessId: string, requestId: string, name: string): string {
  if (!UUID.test(requestId)) throw new EsignKeyError();
  return checkKey(businessId, `${folder(businessId, 'esign')}${requestId}/${name}`);
}

/** The store on S3: read, head, remove and presign reuse the documents module's S3 code. */
export class S3EsignStore implements EsignStore {
  private readonly objects: S3DocumentStorage;

  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {
    this.objects = new S3DocumentStorage(s3, bucket);
  }

  keyFor(businessId: string, requestId: string, name: string) {
    return esignKey(businessId, requestId, name);
  }

  async put(businessId: string, key: string, bytes: Uint8Array, contentType: string) {
    const Key = checkKey(businessId, key);
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key, Body: bytes, ContentType: contentType }),
    );
  }

  read(businessId: string, key: string) {
    return this.objects.read(checkKey(businessId, key));
  }

  async head(businessId: string, key: string): Promise<EsignStoredObject | null> {
    const Key = checkKey(businessId, key);
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key }));
      return {
        sizeBytes: head.ContentLength ?? -1,
        contentType: head.ContentType || null,
        contentEncoding: head.ContentEncoding || null,
      };
    } catch (error) {
      // Without s3:ListBucket a missing key answers 403 (as in S3DocumentStorage.head).
      const status = statusOf(error);
      if (status === 404 || status === 403) return null;
      throw error;
    }
  }

  presignUpload(
    businessId: string,
    key: string,
    file: { contentType: string; sizeBytes: number; sha256: string },
  ) {
    return this.objects.presignUpload({ ...file, key: checkKey(businessId, key) });
  }

  completeUpload(businessId: string, key: string, uploadId: string, sizeBytes: number) {
    return this.objects.completeUpload(checkKey(businessId, key), uploadId, sizeBytes);
  }

  abortUpload(businessId: string, key: string, uploadId: string) {
    return this.objects.abortUpload(checkKey(businessId, key), uploadId);
  }

  async copyFromVault(businessId: string, sourceKey: string, key: string) {
    const source = checkKey(businessId, sourceKey, 'documents');
    const Key = checkKey(businessId, key);
    // Keys hold only URL-safe characters (NAME), so the copy source needs no encoding.
    await this.s3.send(
      new CopyObjectCommand({ Bucket: this.bucket, Key, CopySource: `${this.bucket}/${source}` }),
    );
  }

  presignDownload(
    businessId: string,
    file: { key: string; fileName: string; contentType: string },
  ) {
    return this.objects.presignDownload({ ...file, key: checkKey(businessId, file.key) });
  }

  remove(businessId: string, key: string) {
    return this.objects.remove(checkKey(businessId, key));
  }
}

/** An in-memory store for tests (cloud threads have no s3mock). Same key rules as S3. */
export class MemoryEsignStore implements EsignStore {
  /** Every object by key; tests may seed vault files here directly. */
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** Multipart uploads not yet completed or dropped, by upload id. */
  readonly uploads = new Map<
    string,
    { key: string; contentType: string; parts: Map<number, Uint8Array> }
  >();

  keyFor(businessId: string, requestId: string, name: string) {
    return esignKey(businessId, requestId, name);
  }

  put(businessId: string, key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(checkKey(businessId, key), { bytes: bytes.slice(), contentType });
    return Promise.resolve();
  }

  read(businessId: string, key: string) {
    return Promise.resolve(this.objects.get(checkKey(businessId, key))?.bytes.slice() ?? null);
  }

  head(businessId: string, key: string): Promise<EsignStoredObject | null> {
    const found = this.objects.get(checkKey(businessId, key));
    return Promise.resolve(
      found
        ? {
            sizeBytes: found.bytes.byteLength,
            contentType: found.contentType,
            contentEncoding: null,
          }
        : null,
    );
  }

  /** A PUT to memory://<key>; a larger file, parts to memory://<key>?uploadId=..&partNumber=N. */
  presignUpload(
    businessId: string,
    key: string,
    file: { contentType: string; sizeBytes: number; sha256: string },
  ): Promise<PresignedUpload> {
    const url = `memory://${checkKey(businessId, key)}`;
    if (file.sizeBytes > UPLOAD_LIMITS.multipartThresholdBytes) {
      const uploadId = randomUUID();
      this.uploads.set(uploadId, { key, contentType: file.contentType, parts: new Map() });
      const parts = partSizes(file.sizeBytes).map((_, i) => ({
        partNumber: i + 1,
        url: `${url}?uploadId=${uploadId}&partNumber=${i + 1}`,
        headers: {},
      }));
      const partSizeBytes = UPLOAD_LIMITS.partSizeBytes;
      return Promise.resolve({ method: 'MULTIPART', uploadId, partSizeBytes, parts });
    }
    const checksum = Buffer.from(file.sha256, 'hex').toString('base64');
    return Promise.resolve({
      method: 'PUT',
      url,
      headers: { 'content-type': file.contentType, 'x-amz-checksum-sha256': checksum },
    });
  }

  /** The browser's PUT of one part (tests): the URL a multipart ticket gave. */
  putPart(url: string, bytes: Uint8Array): void {
    const at = new URL(url.replace('memory://', 'memory://x/'));
    const upload = this.uploads.get(at.searchParams.get('uploadId') ?? '');
    if (!upload) throw new Error('NoSuchUpload');
    upload.parts.set(Number(at.searchParams.get('partNumber')), bytes.slice());
  }

  completeUpload(
    businessId: string,
    key: string,
    uploadId: string,
    sizeBytes: number,
  ): Promise<CompletedUpload> {
    const k = checkKey(businessId, key);
    const upload = this.uploads.get(uploadId);
    if (upload?.key !== k) return Promise.resolve(this.objects.has(k) ? 'COMPLETE' : 'MISSING');
    const sizes = partSizes(sizeBytes);
    const parts = [...upload.parts.entries()].sort(([a], [b]) => a - b);
    const exact =
      parts.length === sizes.length &&
      parts.every(([n, bytes], i) => n === i + 1 && bytes.byteLength === sizes[i]);
    if (!exact) return Promise.resolve('MISMATCH');
    this.uploads.delete(uploadId);
    const bytes = new Uint8Array(Buffer.concat(parts.map(([, b]) => b)));
    this.objects.set(k, { bytes, contentType: upload.contentType });
    return Promise.resolve('COMPLETE');
  }

  abortUpload(businessId: string, key: string, uploadId: string) {
    const k = checkKey(businessId, key);
    if (this.uploads.get(uploadId)?.key === k) this.uploads.delete(uploadId);
    return Promise.resolve();
  }

  copyFromVault(businessId: string, sourceKey: string, key: string) {
    const source = checkKey(businessId, sourceKey, 'documents');
    const target = checkKey(businessId, key);
    const found = this.objects.get(source);
    if (!found) return Promise.reject(new Error('NoSuchKey'));
    this.objects.set(target, { ...found, bytes: found.bytes.slice() });
    return Promise.resolve();
  }

  presignDownload(
    businessId: string,
    file: { key: string; fileName: string; contentType: string },
  ) {
    const key = checkKey(businessId, file.key);
    return Promise.resolve(`memory://${key}?name=${encodeURIComponent(file.fileName)}`);
  }

  remove(businessId: string, key: string) {
    this.objects.delete(checkKey(businessId, key));
    return Promise.resolve();
  }
}
