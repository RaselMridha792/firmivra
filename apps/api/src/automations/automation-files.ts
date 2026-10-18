import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { DocumentStorage } from '../storage/document-storage.js';

// Where a log export is kept: the firm's own prefix (tenant/<business>/automations/), encrypted by
// the bucket's default key, reached only by a short-lived download link the API makes after
// checking the caller. Tests replace it.

export interface AutomationFiles {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** A 5-minute link that saves the file under `fileName` (always an attachment). */
  presignDownload(input: { key: string; fileName: string; contentType: string }): Promise<string>;
}

/** Nest token for the automation file store. */
export const AUTOMATION_FILES = Symbol('AUTOMATION_FILES');

export class S3AutomationFiles implements AutomationFiles {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    private readonly storage: DocumentStorage,
  ) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
  }

  presignDownload(input: { key: string; fileName: string; contentType: string }): Promise<string> {
    return this.storage.presignDownload(input);
  }
}
