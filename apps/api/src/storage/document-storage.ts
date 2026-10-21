import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  type Part,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UPLOAD_LIMITS, type UploadPart, type UploadTicket } from '@firmivra/types';
import type { DocumentsConfig } from './config.js';

/** A presigned PUT works for 4 minutes: the browser starts its upload within that time. */
export const PUT_URL_SECONDS = 240;
/**
 * A multipart upload's part URLs work for an hour: 100 MB on a slow line. The upload token lives
 * 10 minutes longer (MULTIPART_TOKEN_SECONDS), so a part started at the end can still finish.
 */
export const MULTIPART_URL_SECONDS = 3_600;
/** A download link works for 5 minutes. */
export const GET_URL_SECONDS = 300;

/**
 * Timeouts of every S3 call, in the style of notify's AWS_CLIENT (#113): 3 s to connect, 5 s for
 * the answer's headers, 2 attempts. `requestTimeout` stops at the headers, so a GET's body has a
 * deadline of its own (`readMs`): a 100 MB GET fits, and a confirm that also completes the upload
 * and checks the bytes still answers inside CloudFront's 60 s.
 */
export const S3_TIMEOUTS = {
  connectionTimeout: 3_000,
  requestTimeout: 5_000,
  maxAttempts: 2,
  readMs: 40_000,
} as const;

/**
 * What storage holds at a key: its size, its SHA-256 (hex; S3 gives its checksum only when asked
 * for, the multipart upload's metadata always; null when there is neither) and its
 * Content-Encoding (null when none is set).
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

/** One PUT for the whole file (`UploadPutTicket`). */
export interface PresignedPut {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
}

/** A multipart upload storage has begun (`UploadMultipartTicket`); confirm completes it. */
export interface PresignedMultipart {
  method: 'MULTIPART';
  /** Storage's id of the upload: sealed into the upload token, never trusted from a browser. */
  uploadId: string;
  partSizeBytes: number;
  parts: UploadPart[];
}

export type PresignedUpload = PresignedPut | PresignedMultipart;

/**
 * What completing a multipart upload found. COMPLETE: the object is stored (also when an earlier
 * confirm of the same upload completed it). MISMATCH: a part is missing, extra or of another size
 * (nothing is stored; the caller aborts the upload). MISSING: storage has neither the upload nor
 * the object (aborted, or never begun): the upload has expired.
 */
export type CompletedUpload = 'COMPLETE' | 'MISMATCH' | 'MISSING';

/**
 * The documents bucket. Keys are always chosen by the API (tenant/{businessId}/documents/{uuid});
 * the API never streams a file to a browser: browsers PUT to and GET from storage with presigned
 * URLs. Objects take the bucket's default encryption (SSE-KMS, the documents key).
 */
export interface DocumentStorage {
  /**
   * How the browser sends exactly this file. Up to UPLOAD_LIMITS.multipartThresholdBytes, one
   * PUT: Content-Type, Content-Length and x-amz-checksum-sha256 are signed, so storage refuses
   * other bytes; `headers` is what the browser sends (never Content-Length: the browser sets
   * it). A larger file, a multipart upload begun here with the type and, as metadata, the claimed
   * SHA-256 (the browser can't change either): a PUT URL per part of UPLOAD_LIMITS.partSizeBytes
   * (the last one the rest) with that part's Content-Length signed. Confirm hashes the bytes.
   */
  presignUpload(file: FileFacts): Promise<PresignedUpload>;
  /**
   * Completes a multipart upload once storage holds exactly parts 1 to N of the sizes
   * `presignUpload` gave for `sizeBytes`; anything else is MISMATCH and nothing is stored.
   */
  completeUpload(key: string, uploadId: string, sizeBytes: number): Promise<CompletedUpload>;
  /** Drops a multipart upload and its parts; one storage no longer has is fine. */
  abortUpload(key: string, uploadId: string): Promise<void>;
  /**
   * HEAD: the object's size and Content-Encoding, or null when there is none. With `checksum`
   * (downloads) also its SHA-256: S3's own when it checked the whole object (a PUT), else the
   * SHA-256 the API set as metadata when it began the multipart upload (confirm hashed the bytes
   * against it). On an SSE-KMS object the checksum needs kms:Decrypt: a 403 then throws unless a
   * plain HEAD finds no object. Confirm never asks for it (it hashes the bytes itself), so a
   * missing kms:Decrypt can't make a good upload look missing.
   */
  head(key: string, options?: { checksum?: boolean }): Promise<StoredObject | null>;
  /**
   * GET: the whole object, in memory (confirm reads at most UPLOAD_LIMITS.maxBytes, under the
   * read budget, read-budget.ts); null only when S3 says there is no such key (404). Any other
   * failure throws: confirm reads after a HEAD found the object, so a 403 here is access
   * (kms:Decrypt on an SSE-KMS object), never a missing file, and must not end in deleting a
   * good upload.
   */
  read(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
  /** A GET that saves the object as an attachment named `fileName`. */
  presignDownload(file: { key: string; fileName: string; contentType: string }): Promise<string>;
}

/** The size of each part of a multipart upload of `sizeBytes`: all partSizeBytes but the last. */
export function partSizes(sizeBytes: number): number[] {
  const size = UPLOAD_LIMITS.partSizeBytes;
  const count = Math.ceil(sizeBytes / size);
  return Array.from({ length: count }, (_, i) => Math.min(size, sizeBytes - i * size));
}

/** The multipart upload's id, or null for a PUT: what the upload token carries. */
export const multipartIdOf = (presigned: PresignedUpload): string | null =>
  presigned.method === 'MULTIPART' ? presigned.uploadId : null;

/**
 * Step 1's answer for a presigned upload. `expiresAt` is when the browser must have started: the
 * PUT (4 minutes), or every part (an hour).
 */
export function uploadTicket(uploadToken: string, presigned: PresignedUpload): UploadTicket {
  const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  if (presigned.method === 'PUT') {
    const { url, headers } = presigned;
    return { uploadToken, method: 'PUT', url, headers, expiresAt: at(PUT_URL_SECONDS) };
  }
  const { partSizeBytes, parts } = presigned;
  return {
    uploadToken,
    method: 'MULTIPART',
    partSizeBytes,
    parts,
    expiresAt: at(MULTIPART_URL_SECONDS),
  };
}

/**
 * The PUT of a flow whose files never pass UPLOAD_LIMITS.multipartThresholdBytes (support,
 * communications and template attachments, logos, brand images): those get no multipart upload.
 */
export function onlyPut(presigned: PresignedUpload): PresignedPut {
  if (presigned.method !== 'PUT') throw new Error('A small file was given a multipart upload');
  return presigned;
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

/** S3's answer for an upload id it does not have (aborted, completed, or never begun). */
const isNoSuchUpload = (error: unknown) =>
  (error as { name?: unknown } | null)?.name === 'NoSuchUpload' || statusOf(error) === 404;

/** The metadata key (x-amz-meta-sha256) of the SHA-256 the API claims for a multipart upload. */
export const SHA256_METADATA = 'sha256';
/** S3's most parts in one upload. */
const MAX_PARTS = 10_000;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The object's SHA-256 (hex): S3's checksum when it is one of the whole object (a PUT signed
 * x-amz-checksum-sha256; a composite one of parts ends in -N and is not), else the SHA-256 the API
 * set as metadata when it began the multipart upload; null when neither is there.
 */
function sha256Of(head: {
  ChecksumSHA256?: string | undefined;
  ChecksumType?: string | undefined;
  Metadata?: Record<string, string> | undefined;
}): string | null {
  const sha = head.ChecksumSHA256;
  if (sha && head.ChecksumType !== 'COMPOSITE' && !sha.includes('-')) {
    const hex = Buffer.from(sha, 'base64').toString('hex');
    if (HEX64.test(hex)) return hex;
  }
  const claimed = head.Metadata?.[SHA256_METADATA]?.toLowerCase();
  return claimed && HEX64.test(claimed) ? claimed : null;
}

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

  async presignUpload(file: FileFacts): Promise<PresignedUpload> {
    if (file.sizeBytes > UPLOAD_LIMITS.multipartThresholdBytes) return this.presignParts(file);
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
      method: 'PUT',
      url,
      headers: { 'content-type': file.contentType, 'x-amz-checksum-sha256': checksum },
    };
  }

  /**
   * Begins the multipart upload here, so its Content-Type and the claimed SHA-256 (metadata, read
   * back by `head` for downloads) are the API's. No per-part checksum: confirm hashes the whole
   * file. Each part URL signs that part's exact Content-Length.
   */
  private async presignParts(file: FileFacts): Promise<PresignedMultipart> {
    const created = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: file.key,
        ContentType: file.contentType,
        Metadata: { [SHA256_METADATA]: file.sha256 },
      }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('Storage began a multipart upload without an id');
    const parts = await Promise.all(
      partSizes(file.sizeBytes).map(async (size, i) => {
        const command = new UploadPartCommand({
          Bucket: this.bucket,
          Key: file.key,
          UploadId: uploadId,
          PartNumber: i + 1,
          ContentLength: size,
        });
        const url = await getSignedUrl(this.s3, command, {
          expiresIn: MULTIPART_URL_SECONDS,
          signableHeaders: new Set(['content-length']),
        });
        return { partNumber: i + 1, url, headers: {} };
      }),
    );
    return { method: 'MULTIPART', uploadId, partSizeBytes: UPLOAD_LIMITS.partSizeBytes, parts };
  }

  async completeUpload(key: string, uploadId: string, sizeBytes: number): Promise<CompletedUpload> {
    let stored: Part[];
    try {
      stored = await this.listParts(key, uploadId);
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
      // Completed by an earlier confirm of this upload (the object is there), or gone.
      return (await this.head(key)) ? 'COMPLETE' : 'MISSING';
    }
    const sizes = partSizes(sizeBytes);
    const exact =
      stored.length === sizes.length &&
      stored.every((p, i) => p.PartNumber === i + 1 && p.Size === sizes[i] && !!p.ETag);
    if (!exact) return 'MISMATCH';
    try {
      await this.s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: stored.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
          },
        }),
      );
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
      return (await this.head(key)) ? 'COMPLETE' : 'MISSING';
    }
    return 'COMPLETE';
  }

  /** Every part storage holds for the upload, in part order (ListParts gives 1,000 a page). */
  private async listParts(key: string, uploadId: string): Promise<Part[]> {
    const parts: Part[] = [];
    let marker: string | undefined;
    for (;;) {
      const page = await this.s3.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          ...(marker ? { PartNumberMarker: marker } : {}),
        }),
      );
      parts.push(...(page.Parts ?? []));
      const next = page.NextPartNumberMarker;
      // A marker that does not move on, or more parts than S3 allows, ends the walk.
      if (!page.IsTruncated || !next || next === marker || parts.length > MAX_PARTS) break;
      marker = next;
    }
    return parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
  }

  async abortUpload(key: string, uploadId: string): Promise<void> {
    try {
      await this.s3.send(
        new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }),
      );
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
    }
  }

  async head(key: string, { checksum = false } = {}): Promise<StoredObject | null> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(checksum ? { ChecksumMode: 'ENABLED' as const } : {}),
    });
    try {
      const head = await this.s3.send(command);
      return {
        sizeBytes: head.ContentLength ?? -1,
        sha256: sha256Of(head),
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
      // Pinned by the signature, whatever a repeated PUT stores after the HEAD check: the
      // browser saves the bytes as they are, and nothing keeps a copy.
      ResponseContentEncoding: 'identity',
      ResponseCacheControl: 'private, no-store',
    });
    return getSignedUrl(this.s3, command, { expiresIn: GET_URL_SECONDS });
  }
}
