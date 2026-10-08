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

/** What storage holds at a key: its size and the SHA-256 (hex) storage checked on the PUT. */
export interface StoredObject {
  sizeBytes: number;
  sha256: string | null;
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
  /** HEAD: the object's size and checksum, or null when there is none. */
  head(key: string): Promise<StoredObject | null>;
  /** GET: the whole object, in memory (confirm reads at most UPLOAD_LIMITS.maxBytes). */
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

/**
 * A missing object. Without s3:ListBucket (the API's IAM policy has only object actions) S3
 * answers 403 for a key that does not exist, so 403 counts as missing too.
 */
function isMissing(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return status === 404 || status === 403;
}

const orMissing = <T>(error: unknown): T | null => {
  if (isMissing(error)) return null;
  throw error;
};

export function createS3Client(config: DocumentsConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
    // Checksums only when we ask: a presigned PUT carries the file's own SHA-256, never one the
    // SDK computes for an empty body.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/** DocumentStorage on S3 (s3mock locally, path-style). */
export class S3DocumentStorage implements DocumentStorage {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
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

  async head(key: string): Promise<StoredObject | null> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ChecksumMode: 'ENABLED',
    });
    try {
      const head = await this.s3.send(command);
      const sha = head.ChecksumSHA256;
      return {
        sizeBytes: head.ContentLength ?? -1,
        sha256: sha ? Buffer.from(sha, 'base64').toString('hex') : null,
      };
    } catch (error) {
      return orMissing(error);
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
    } catch (error) {
      return orMissing(error);
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
