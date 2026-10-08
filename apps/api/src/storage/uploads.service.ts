import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { DownloadLink, UploadTicket } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from './config.js';
import {
  type DocumentRow,
  findTarget,
  holdEngagement,
  lockRequest,
  refusal,
} from './document-records.js';
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
        requestId: claim.requestId,
        categoryId: claim.categoryId,
        direction: claim.direction,
      },
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * Step 3: saves the document once the stored file is the one described. `recheck` runs first in
   * the transaction: the caller must still reach the client. Returns the new document's id.
   */
  async confirm(
    uploader: Uploader,
    uploadToken: string,
    recheck: (tx: TxClient, claim: UploadClaim) => Promise<void>,
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
    const id = await this.database
      .withScope({ kind: 'business', businessId }, async (tx) => {
        await recheck(tx, claim);
        // The service and the request stay as checked until the document is saved.
        await holdEngagement(tx, businessId, claim.engagementId);
        if (claim.requestId) await lockRequest(tx, businessId, claim.requestId);
        const target = await findTarget(tx, businessId, claim.clientId, {
          serviceId: claim.engagementId,
          requestId: claim.requestId,
          categoryId: claim.categoryId,
        });
        const now = new Date();
        const years = target.category?.retentionYears ?? null;
        const doc = await tx.document.create({
          data: {
            businessId,
            clientId: claim.clientId,
            engagementId: claim.engagementId,
            categoryId: claim.categoryId,
            requestId: claim.requestId,
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
        if (claim.requestId) {
          await tx.documentRequest.update({
            where: { id: claim.requestId },
            data: { status: 'SUBMITTED', statusNote: null },
          });
        }
        // A new document starts PENDING (the database insists); local mode scans it at once.
        if (scanMode === 'local') {
          await tx.document.update({
            where: { id: doc.id },
            data: { scanStatus: 'CLEAN', scannedAt: now },
          });
        }
        return doc.id;
      })
      .catch((error: unknown) => {
        // Two confirms at once: the unique s3_key lets one through.
        if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
        throw error;
      });

    await this.audit.log(
      'document.uploaded',
      { type: 'document', id },
      {
        clientId: claim.clientId,
        serviceId: claim.engagementId,
        requestId: claim.requestId,
        categoryId: claim.categoryId,
        direction: claim.direction,
        uploadId: uploadIdOf(claim.key),
        clientAccountId: claim.clientAccountId,
        scanMode,
      },
    );
    if (claim.requestId) {
      await this.audit.log(
        'document_request.submitted',
        { type: 'document_request', id: claim.requestId },
        { documentId: id },
      );
    }
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
    const uploadId = uploadIdOf(claim.key);
    await this.storage.remove(claim.key).catch(() => {
      // The bucket's lifecycle rule expires objects that are never confirmed.
      this.logger.warn(`Could not delete the refused upload ${uploadId}`);
    });
    await this.audit.log(
      'document.upload_refused',
      { type: 'client', id: claim.clientId },
      { uploadId, code, serviceId: claim.engagementId, requestId: claim.requestId },
    );
    throw refusal(code);
  }
}
