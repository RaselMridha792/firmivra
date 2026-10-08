import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UPLOAD_LIMITS } from '@firmivra/types';
import type { DocumentsConfig } from './config.js';

/** A presigned PUT works for 4 minutes: the browser starts its upload within that time. */
export const PUT_URL_SECONDS = 240;
/** A download link works for 5 minutes. */
export const GET_URL_SECONDS = 300;

/**
 * Timeouts of every S3 call, in the style of notify's AWS_CLIENT (#113): 3 s to connect, 5 s for
 * the answer's headers, 2 attempts. `requestTimeout` stops at the headers, so a GET's body has a
 * deadline of its own (`readMs`, for up to 10 MB).
 */
export const S3_TIMEOUTS = {
  connectionTimeout: 3_000,
  requestTimeout: 5_000,
  maxAttempts: 2,
  readMs: 30_000,
} as const;

/**
 * What storage holds at a key: its size, the SHA-256 (hex) storage checked on the PUT (only when
 * asked for: null otherwise) and its Content-Encoding (null when none is set).
 */
export interface StoredObject {
  sizeBytes: number;
  sha256: string | null;
  contentEncoding: string | null;
}

export interface FileFacts {
  key: string;
  contentType: string;
  sizeBytes: number;
  /** Hex. */
  sha256: string;
}

/**
 * The documents bucket. Keys are always chosen by the API (tenant/{businessId}/documents/{uuid});
 * the API never streams a file to a browser: browsers PUT to and GET from storage with presigned
 * URLs. Objects take the bucket's default encryption (SSE-KMS, the documents key).
 */
export interface DocumentStorage {
  /**
   * A PUT for exactly this file: Content-Type, Content-Length and x-amz-checksum-sha256 are
   * signed, so storage refuses other bytes. `headers` is what the browser sends (never
   * Content-Length: the browser sets it).
   */
  presignUpload(file: FileFacts): Promise<{ url: string; headers: Record<string, string> }>;
  /**
   * HEAD: the object's size and Content-Encoding, or null when there is none. With `checksum`
   * (downloads) also S3's SHA-256, which on an SSE-KMS object needs kms:Decrypt: a 403 then
   * throws unless a plain HEAD finds no object. Confirm never asks for it (it hashes the bytes
   * itself), so a missing kms:Decrypt can't make a good upload look missing.
   */
  head(key: string, options?: { checksum?: boolean }): Promise<StoredObject | null>;
  /**
   * GET: the whole object, in memory (confirm reads at most UPLOAD_LIMITS.maxBytes); null only
   * when S3 says there is no such key (404). Any other failure throws: confirm reads after a HEAD
   * found the object, so a 403 here is access (kms:Decrypt on an SSE-KMS object), never a
   * missing file, and must not end in deleting a good upload.
   */
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** A GET that saves the object as an attachment named `fileName`. */
  presignDownload(file: { key: string; fileName: string; contentType: string }): Promise<string>;
}

/** Nest token for the DocumentStorage (tests replace it). */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');

/**
 * RFC 6266 attachment with the name in UTF-8 (RFC 5987 `filename*`) and an ASCII fallback for
 * old browsers. Names are already free of control characters, / and \ (the contract).
 */
export function attachment(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** The stored type when it is one the API accepts, else a type browsers never render. */
export function downloadType(contentType: string): string {
  return Object.hasOwn(UPLOAD_LIMITS.types, contentType) ? contentType : 'application/octet-stream';
}

/** The HTTP status of an S3 error, if it has one. */
export const statusOf = (error: unknown) =>
  (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;

export function createS3Client(config: DocumentsConfig): S3Client {
  const { connectionTimeout, requestTimeout, maxAttempts } = S3_TIMEOUTS;
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
    // Checksums only when we ask: a presigned PUT carries the file's own SHA-256, never one the
    // SDK computes for an empty body.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // A stalled S3 never holds a request (or the upload lock) for long: without
    // throwOnRequestTimeout the handler only logs a warning when requestTimeout passes.
    maxAttempts,
    requestHandler: { connectionTimeout, requestTimeout, throwOnRequestTimeout: true },
  });
}

/** DocumentStorage on S3 (s3mock locally, path-style). */
export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    /** The deadline of a whole GET, its body included (tests shorten it). */
    private readonly readMs: number = S3_TIMEOUTS.readMs,
  ) {}

  async presignUpload(file: FileFacts) {
    const checksum = Buffer.from(file.sha256, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: file.key,
      ContentType: file.contentType,
      ContentLength: file.sizeBytes,
      ChecksumSHA256: checksum,
    });
    const url = await getSignedUrl(this.s3, command, {
      expiresIn: PUT_URL_SECONDS,
      // The presigner leaves Content-Type unsigned and moves x-amz-* headers into the query
      // string unless told otherwise; all three must be headers the signature covers.
      signableHeaders: new Set(['content-type', 'content-length']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return {
      url,
      headers: { 'content-type': file.contentType, 'x-amz-checksum-sha256': checksum },
    };
  }

  async head(key: string, { checksum = false } = {}): Promise<StoredObject | null> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(checksum ? { ChecksumMode: 'ENABLED' as const } : {}),
    });
    try {
      const head = await this.s3.send(command);
      const sha = head.ChecksumSHA256;
      return {
        sizeBytes: head.ContentLength ?? -1,
        sha256: sha ? Buffer.from(sha, 'base64').toString('hex') : null,
        contentEncoding: head.ContentEncoding || null,
      };
    } catch (error) {
      const status = statusOf(error);
      if (status === 404) return null;
      if (status !== 403) throw error;
      // Without s3:ListBucket (the API's IAM policy has only object actions) S3 answers 403 for
      // a key that does not exist. With the checksum a 403 can also be KMS (kms:Decrypt), so a
      // plain HEAD decides: no object is null, an object we can't decrypt throws.
      if (!checksum || (await this.head(key)) === null) return null;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    const deadline = AbortSignal.timeout(this.readMs);
    let body: { destroy?: (error: Error) => void } | undefined;
    const stop = () =>
      body?.destroy?.(Object.assign(new Error('The read took too long'), { name: 'TimeoutError' }));
    deadline.addEventListener('abort', stop, { once: true });
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const object = await this.s3.send(command, { abortSignal: deadline });
      if (!object.Body) return new Uint8Array();
      body = object.Body as typeof body;
      if (deadline.aborted) stop();
      return await object.Body.transformToByteArray();
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw error;
    } finally {
      deadline.removeEventListener('abort', stop);
    }
  }

  async remove(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  presignDownload(file: { key: string; fileName: string; contentType: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: file.key,
      ResponseContentDisposition: attachment(file.fileName),
      ResponseContentType: downloadType(file.contentType),
    });
    return getSignedUrl(this.s3, command, { expiresIn: GET_URL_SECONDS });
  }
}
