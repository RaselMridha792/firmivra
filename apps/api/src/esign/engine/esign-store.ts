import { CopyObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { S3DocumentStorage } from '../../storage/document-storage.js';
import type { EsignStore } from './engine.types.js';

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

  async head(businessId: string, key: string) {
    const found = await this.objects.head(checkKey(businessId, key));
    return found && { sizeBytes: found.sizeBytes };
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

  head(businessId: string, key: string) {
    const found = this.objects.get(checkKey(businessId, key));
    return Promise.resolve(found ? { sizeBytes: found.bytes.byteLength } : null);
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
