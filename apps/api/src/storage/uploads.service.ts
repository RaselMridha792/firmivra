import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { DownloadLink, UploadTicket } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from './config.js';
import { type DocumentRow, findTarget, holdEngagement, refusal } from './document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
} from './document-storage.js';
import { checkFile, type FileRefusal } from './file-checks.js';
import { type UploadClaim, UPLOAD_TOKEN_SECONDS, UploadTokens } from './upload-token.js';

/** Who confirms: the same person, side and firm the ticket was made for. */
export interface Uploader {
  pool: UploadClaim['pool'];
  businessId: string;
  userId: string;
  clientAccountId: string | null;
}

/** The part of an upload's key after tenant/{businessId}/documents/: an id, safe for the audit. */
const uploadIdOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** A date `years` after `from`, as a calendar date (UTC). */
function yearsAfter(from: Date, years: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * The three steps of an upload, for both sides (R5 steps 2 and 3), and the download link (step 4):
 * 1. `ticket`: the API picks the key (tenant/{businessId}/documents/{uuid}), presigns a PUT for
 *    exactly the described file and seals everything it decided into the uploadToken.
 * 2. The browser PUTs the file to storage; the API never streams it to a browser.
 * 3. `confirm`: the token must open for this caller; the stored object must have the size,
 *    checksum and bytes of its type (else it is deleted: 409); the unique s3_key makes it single
 *    use (410 UPLOAD_EXPIRED). The document starts PENDING; SCAN_MODE=local marks it CLEAN.
 * Only ids reach the audit log: never a file name, its content or a storage URL.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: UploadTokens,
    private readonly audit: AuditService,
  ) {}

  /** Step 1, once the caller's checks passed: where and how to PUT, and the sealed token. */
  async ticket(claim: Omit<UploadClaim, 'key'>): Promise<UploadTicket> {
    const key = `tenant/${claim.businessId}/documents/${randomUUID()}`;
    const put = await this.storage.presignUpload({ ...claim, key });
    const uploadToken = await this.tokens.seal({ ...claim, key }, UPLOAD_TOKEN_SECONDS);
    await this.audit.log(
      'document.upload_started',
      { type: 'client', id: claim.clientId },
      {
        uploadId: uploadIdOf(key),
        serviceId: claim.engagementId,
        categoryId: claim.categoryId,
        direction: claim.direction,
      },
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * Step 3: saves the document once the stored file is the one described. `recheck` runs first in
   * the transaction: it locks the client (FOR SHARE) and the caller must still reach it. A refusal
   * from the transaction (404, NO_OPEN_SERVICE, CATEGORY_ARCHIVED) deletes the object and is
   * audited like the byte checks' refusals, so no file stays in storage without a document.
   * Returns the new document's id.
   */
  async confirm(
    uploader: Uploader,
    uploadToken: string,
    recheck: (tx: TxClient, claim: UploadClaim) => Promise<{ archived: boolean }>,
  ): Promise<string> {
    const claim = (await this.tokens.open(uploadToken, uploader.pool))?.value;
    const mine =
      claim?.businessId === uploader.businessId &&
      claim.userId === uploader.userId &&
      claim.clientAccountId === uploader.clientAccountId;
    if (!claim || !mine) throw refusal('UPLOAD_EXPIRED');
    // A confirmed key is never checked or deleted again.
    const confirmed = await this.database
      .forBusiness(claim.businessId)
      .document.findFirst({ where: { s3Key: claim.key }, select: { id: true } });
    if (confirmed) throw refusal('UPLOAD_EXPIRED');
    const refused = await this.checkStored(claim);
    if (refused) await this.refuse(claim, refused);

    const { businessId } = claim;
    const { scanMode } = this.config;
    let refusedCode = null as string | null;
    let id: string;
    try {
      id = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        // One confirm of a key at a time. A second one waits here, then finds the document (410)
        // or, after a refusal below deleted the object, no object (409 UPLOAD_MISMATCH, as for
        // any missing file): it never saves a document without its file, and a refusal never
        // deletes a saved document's file.
        const lockKey = `document-upload:${claim.key}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const saved = await tx.document.findFirst({
          where: { s3Key: claim.key },
          select: { id: true },
        });
        if (saved) throw refusal('UPLOAD_EXPIRED');
        if (!(await this.storage.head(claim.key))) throw refusal('UPLOAD_MISMATCH');
        let target: Awaited<ReturnType<typeof findTarget>>;
        try {
          // Lock order: the client (in recheck), then the engagement.
          const { archived } = await recheck(tx, claim);
          // The service stays as checked until the document is saved.
          await holdEngagement(tx, businessId, claim.engagementId);
          target = await findTarget(tx, businessId, claim.clientId, {
            serviceId: claim.engagementId,
            categoryId: claim.categoryId,
            clientArchived: archived,
          });
        } catch (error) {
          if (error instanceof HttpException) {
            refusedCode = codeOf(error);
            await this.remove(claim.key);
          }
          throw error;
        }
        const now = new Date();
        const years = target.category?.retentionYears ?? null;
        const doc = await tx.document.create({
          data: {
            businessId,
            clientId: claim.clientId,
            engagementId: claim.engagementId,
            categoryId: claim.categoryId,
            direction: claim.direction,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            taxYear: claim.taxYear,
            // The category's retention from today; no category or no retention keeps it for good.
            retentionUntil: years === null ? null : yearsAfter(now, years),
            uploadedByUserId: claim.userId,
          },
          select: { id: true },
        });
        // A new document starts PENDING (the database insists); local mode scans it at once.
        if (scanMode === 'local') {
          await tx.document.update({
            where: { id: doc.id },
            data: { scanStatus: 'CLEAN', scannedAt: now },
          });
        }
        return doc.id;
      });
    } catch (error) {
      if (refusedCode) await this.auditRefusal(claim, refusedCode);
      // A backstop: the unique s3_key lets one confirm through.
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      throw error;
    }

    await this.audit.log(
      'document.uploaded',
      { type: 'document', id },
      {
        clientId: claim.clientId,
        serviceId: claim.engagementId,
        categoryId: claim.categoryId,
        direction: claim.direction,
        uploadId: uploadIdOf(claim.key),
        clientAccountId: claim.clientAccountId,
        scanMode,
      },
    );
    return id;
  }

  /**
   * A 5-minute link for a CLEAN file (409 SCAN_PENDING or FILE_BLOCKED otherwise). No version id
   * is kept yet, so the stored object must still have the confirmed size and checksum: anything
   * else is FILE_BLOCKED.
   */
  async downloadLink(doc: DocumentRow): Promise<DownloadLink> {
    if (doc.scanStatus === 'PENDING') throw refusal('SCAN_PENDING');
    if (doc.scanStatus !== 'CLEAN') throw refusal('FILE_BLOCKED');
    const stored = await this.storage.head(doc.s3Key);
    if (stored?.sizeBytes !== doc.sizeBytes || stored.sha256 !== doc.sha256) {
      this.logger.warn(`Document ${doc.id}: the stored file is not the confirmed one`); // ids only
      throw refusal('FILE_BLOCKED');
    }
    const url = await this.storage.presignDownload({
      key: doc.s3Key,
      fileName: doc.fileName,
      contentType: doc.contentType,
    });
    const expiresAt = new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString();
    await this.audit.log(
      'document.download_link_issued',
      { type: 'document', id: doc.id },
      { clientId: doc.clientId, expiresAt },
    );
    return { url, expiresAt };
  }

  /** Why the stored object is not the described file, or null when it is. */
  private async checkStored(claim: UploadClaim): Promise<FileRefusal | null> {
    const head = await this.storage.head(claim.key);
    if (head?.sizeBytes !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
    const bytes = await this.storage.read(claim.key);
    if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== claim.sha256) return 'UPLOAD_MISMATCH';
    return checkFile(claim.contentType, bytes);
  }

  /** Deletes the refused object, audits the refusal (ids and the code only) and throws it. */
  private async refuse(claim: UploadClaim, code: FileRefusal): Promise<never> {
    await this.remove(claim.key);
    await this.auditRefusal(claim, code);
    throw refusal(code);
  }

  /**
   * Deletes a refused upload. Should the delete fail, the object stays until it is found by hand:
   * no lifecycle rule tells unconfirmed uploads apart yet (R5 file, "Needs from others").
   */
  private async remove(key: string): Promise<void> {
    await this.storage.remove(key).catch(() => {
      this.logger.warn(`Could not delete the refused upload ${uploadIdOf(key)}`); // ids only
    });
  }

  private auditRefusal(claim: UploadClaim, code: string): Promise<void> {
    return this.audit.log(
      'document.upload_refused',
      { type: 'client', id: claim.clientId },
      { uploadId: uploadIdOf(claim.key), code, serviceId: claim.engagementId },
    );
  }
}

/** The contract code of an HttpException this module throws (NOT_FOUND, NO_OPEN_SERVICE, ...). */
function codeOf(error: HttpException): string {
  const body = error.getResponse();
  const code = typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : `HTTP_${error.getStatus()}`;
}
