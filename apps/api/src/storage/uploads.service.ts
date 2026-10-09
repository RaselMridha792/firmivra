import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { DownloadLink, UploadTicket } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from './config.js';
import {
  type DocumentRow,
  findTarget,
  holdEngagement,
  refusal,
  storageUnavailable,
} from './document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
  statusOf,
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

/**
 * Confirms that read a stored file at once, in this process: each holds up to 10 MB in memory
 * (the API task has 512 MiB). One more answers 503 with Retry-After and deletes nothing.
 */
export const CHECKS_AT_ONCE = 4;
let checking = 0;

/**
 * How far back confirm looks for an earlier refusal of its key: a ticket lives 15 minutes
 * (UPLOAD_TOKEN_SECONDS), so any refusal of it is younger than that plus a confirm's own time.
 * Generous on purpose. A scan result looks further back (SCAN_REFUSALS_SINCE_MS).
 */
export const REFUSALS_SINCE_MS = 30 * 60_000;

/** The part of an upload's key after tenant/{businessId}/documents/: an id, safe for the audit. */
const uploadIdOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

/** A date `years` after `from`, as a calendar date (UTC). */
function yearsAfter(from: Date, years: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Whether a refusal of this upload was audited (the mark `refuse` leaves before it deletes), in
 * the last `sinceMs`: the time bound keeps the search on the (business_id, created_at) index.
 * With `clientId`, only a refusal for that client (confirm knows it; a scan result not).
 */
export async function refusedUpload(
  tx: TxClient,
  businessId: string,
  uploadId: string,
  { clientId, sinceMs = REFUSALS_SINCE_MS }: { clientId?: string; sinceMs?: number } = {},
): Promise<boolean> {
  const row = await tx.auditLog.findFirst({
    where: {
      businessId,
      createdAt: { gte: new Date(Date.now() - sinceMs) },
      action: 'document.upload_refused',
      entityType: 'client',
      ...(clientId && { entityId: clientId }),
      metadata: { path: ['uploadId'], equals: uploadId },
    },
    select: { id: true },
  });
  return row !== null;
}

/** One confirm or refusal of a key at a time, until the transaction ends. */
async function lockUpload(tx: TxClient, key: string): Promise<void> {
  const lockKey = `document-upload:${key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

/**
 * The three steps of an upload, for both sides (R5 steps 2 and 3), and the download link (step 4):
 * 1. `ticket`: the API picks the key (tenant/{businessId}/documents/{uuid}), presigns a PUT for
 *    exactly the described file and seals everything it decided into the uploadToken.
 * 2. The browser PUTs the file to storage; the API never streams it to a browser.
 * 3. `confirm`: the token must open for this caller; the stored object must have the size,
 *    checksum and bytes of its type and no Content-Encoding (else it is deleted: 409); the unique
 *    s3_key makes it single use (410 UPLOAD_EXPIRED). The document starts PENDING;
 *    SCAN_MODE=local marks it CLEAN.
 * Storage that fails, times out or is busy is 503 SERVICE_UNAVAILABLE with Retry-After, and
 * deletes nothing. No S3 call runs inside a transaction that holds a client, service or category.
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
    private readonly notifier: Notifier,
  ) {}

  /** Step 1, once the caller's checks passed: where and how to PUT, and the sealed token. */
  async ticket(claim: Omit<UploadClaim, 'key'>): Promise<UploadTicket> {
    const key = `tenant/${claim.businessId}/documents/${randomUUID()}`;
    const put = await this.s3('presign PUT', () => this.storage.presignUpload({ ...claim, key }));
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
        clientAccountId: claim.clientAccountId,
        ...(claim.intakeId && { intakeId: claim.intakeId, intakeSlot: claim.intakeSlot }),
      },
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * Step 3: saves the document once the stored file is the one described. The file is checked
   * before the transaction. In the transaction, under the key's advisory lock: no document has
   * the key yet (else 410) and no refusal of it was audited (else 409 UPLOAD_MISMATCH: its file
   * was deleted); then `recheck` locks the client (FOR SHARE) and the caller must still reach it.
   * An upload for a request locks it FOR UPDATE last (client, engagement, category, request),
   * must find it open (409 REQUEST_CLOSED) and makes it SUBMITTED in the same transaction.
   * Every refusal (the byte checks, 403, 404, NO_OPEN_SERVICE, REQUEST_CLOSED,
   * CATEGORY_ARCHIVED) goes through `refuse`: audited, then the object deleted, never while a
   * document has the key. Once a portal upload commits, the firm is told (`tellFirm`). Returns
   * the new document's id.
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
    if (refused) return this.refuse(claim, refusal(refused));

    const { businessId } = claim;
    const { scanMode } = this.config;
    let id: string;
    try {
      id = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await lockUpload(tx, claim.key);
        const saved = await tx.document.findFirst({
          where: { s3Key: claim.key },
          select: { id: true },
        });
        if (saved) throw refusal('UPLOAD_EXPIRED');
        // Another confirm of this key refused it while this one checked the file: its file is
        // deleted (or being deleted), so nothing is saved for it.
        if (
          await refusedUpload(tx, businessId, uploadIdOf(claim.key), { clientId: claim.clientId })
        ) {
          throw refusal('UPLOAD_MISMATCH');
        }
        // Lock order: the client (in recheck), the engagement, the category, the request.
        const { archived } = await recheck(tx, claim);
        // The service stays as checked until the document is saved.
        await holdEngagement(tx, businessId, claim.engagementId);
        const target = await findTarget(tx, businessId, claim.clientId, {
          serviceId: claim.engagementId,
          categoryId: claim.categoryId,
          requestId: claim.requestId,
          clientArchived: archived,
        });
        const now = new Date();
        const years = target.category?.retentionYears ?? null;
        const doc = await tx.document.create({
          data: {
            businessId,
            clientId: claim.clientId,
            engagementId: claim.engagementId,
            requestId: claim.requestId,
            categoryId: claim.categoryId,
            direction: claim.direction,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            taxYear: claim.taxYear,
            intakeId: claim.intakeId ?? null,
            intakeSlot: claim.intakeSlot ?? null,
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
        await this.audit.logIn(
          tx,
          'document.uploaded',
          { type: 'document', id: doc.id },
          {
            clientId: claim.clientId,
            serviceId: claim.engagementId,
            categoryId: claim.categoryId,
            direction: claim.direction,
            uploadId: uploadIdOf(claim.key),
            clientAccountId: claim.clientAccountId,
            scanMode,
            ...(claim.intakeId && { intakeId: claim.intakeId, intakeSlot: claim.intakeSlot }),
          },
          { businessId },
        );
        if (target.request) {
          // Answered: the client's own note or the firm's reason no longer applies.
          await tx.documentRequest.update({
            where: { id: target.request.id },
            data: { status: 'SUBMITTED', statusNote: null },
          });
          await this.audit.logIn(
            tx,
            'document_request.submitted',
            { type: 'document_request', id: target.request.id },
            {
              clientId: claim.clientId,
              documentId: doc.id,
              from: target.request.status,
              clientAccountId: claim.clientAccountId,
            },
            { businessId },
          );
        }
        return doc.id;
      });
    } catch (error) {
      // A backstop: the unique s3_key lets one confirm through.
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      // A refusal (4xx) from the transaction; 410 means another confirm saved it.
      if (error instanceof HttpException && error.getStatus() < 500) {
        if (codeOf(error) !== 'UPLOAD_EXPIRED') return this.refuse(claim, error);
      }
      throw error;
    }
    await this.tellFirm(claim, id);
    return id;
  }

  /**
   * The firm's bell for a portal upload that committed (R6's Notifier; staff uploads tell nobody):
   * `document-request.submitted` when it answers a request, else `document.uploaded`. The
   * Notifier resolves on a database failure; anything else is logged with ids only and never
   * undoes the upload.
   */
  private async tellFirm(claim: UploadClaim, documentId: string): Promise<void> {
    if (claim.pool !== 'CLIENT') return;
    const [event, recordId] = claim.requestId
      ? (['document-request.submitted', claim.requestId] as const)
      : (['document.uploaded', documentId] as const);
    try {
      await this.notifier.notify({
        businessId: claim.businessId,
        event,
        recordId,
        actorUserId: claim.userId,
      });
    } catch (error) {
      const kind = claim.requestId ? 'document request' : 'document';
      this.logger.warn(`${event} for ${kind} ${recordId} not written (${errorName(error)})`);
    }
  }

  /**
   * A 5-minute link for a CLEAN file (409 SCAN_PENDING or FILE_BLOCKED otherwise). No version id
   * is kept yet, so the stored object must still have the confirmed size and checksum and no
   * Content-Encoding: anything else is FILE_BLOCKED. The portal passes its own FILE_BLOCKED
   * words (PORTAL_BLOCKED_TEXT) and the login, for the audit.
   */
  async downloadLink(
    doc: DocumentRow,
    portal?: { blocked: string; clientAccountId: string },
  ): Promise<DownloadLink> {
    const blocked = () => refusal('FILE_BLOCKED', portal?.blocked);
    if (doc.scanStatus === 'PENDING') throw refusal('SCAN_PENDING');
    if (doc.scanStatus !== 'CLEAN') throw blocked();
    const stored = await this.s3('HEAD', () => this.storage.head(doc.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== doc.sizeBytes ||
      stored.sha256 !== doc.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Document ${doc.id}: the stored file is not the confirmed one`); // ids only
      throw blocked();
    }
    const url = await this.s3('presign GET', () =>
      this.storage.presignDownload({
        key: doc.s3Key,
        fileName: doc.fileName,
        contentType: doc.contentType,
      }),
    );
    const expiresAt = new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString();
    await this.audit.log(
      'document.download_link_issued',
      { type: 'document', id: doc.id },
      {
        clientId: doc.clientId,
        expiresAt,
        ...(portal && { clientAccountId: portal.clientAccountId }),
      },
    );
    return { url, expiresAt };
  }

  /**
   * Why the stored object is not the described file, or null when it is. At most CHECKS_AT_ONCE
   * at a time; one more is 503 (nothing deleted).
   */
  private async checkStored(claim: UploadClaim): Promise<FileRefusal | null> {
    if (checking >= CHECKS_AT_ONCE) {
      this.logger.warn(`Confirm refused: ${CHECKS_AT_ONCE} file checks already running; 503`);
      throw storageUnavailable();
    }
    checking += 1;
    try {
      const head = await this.s3('HEAD', () => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      // The PUT signs no Content-Encoding: a set one (a repeated PUT) would change the download.
      if (head.contentEncoding !== null) return 'UPLOAD_MISMATCH';
      const bytes = await this.s3('GET', () => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== claim.sha256) return 'UPLOAD_MISMATCH';
      return checkFile(claim.contentType, bytes);
    } finally {
      checking -= 1;
    }
  }

  /**
   * Refuses an upload: under the key's lock, unless a document has the key by now (then 410, and
   * nothing is deleted or audited), the refusal is audited (ids and the code only) and commits;
   * then the object is deleted, outside any lock. A confirm that comes later finds the refusal
   * under the lock and saves nothing. Throws `error`.
   */
  private async refuse(claim: UploadClaim, error: HttpException): Promise<never> {
    const { businessId } = claim;
    const saved = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await lockUpload(tx, claim.key);
      const doc = await tx.document.findFirst({
        where: { s3Key: claim.key },
        select: { id: true },
      });
      if (doc) return true;
      await this.audit.logIn(
        tx,
        'document.upload_refused',
        { type: 'client', id: claim.clientId },
        { uploadId: uploadIdOf(claim.key), code: codeOf(error), serviceId: claim.engagementId },
        { businessId },
      );
      return false;
    });
    if (saved) throw refusal('UPLOAD_EXPIRED');
    await this.remove(claim.key);
    throw error;
  }

  /**
   * Deletes a refused upload. Should the delete fail, the object stays until it is found by hand:
   * no lifecycle rule tells unconfirmed uploads apart yet (R5 file, "Needs from others").
   */
  private async remove(key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      // ids, the error's name and status only
      this.logger.warn(
        `Could not delete the refused upload ${uploadIdOf(key)}: ${nameOf(error)} (HTTP ${statusOf(error) ?? 'none'})`,
      );
    });
  }

  /**
   * A storage call. A failure that is not ours to explain (S3 503 SlowDown, a timeout, a 403
   * from KMS) is 503 SERVICE_UNAVAILABLE with Retry-After; the log names the operation, the
   * error's name and its HTTP status only.
   */
  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `Storage ${operation} failed: ${nameOf(error)} (HTTP ${statusOf(error) ?? 'none'}); 503`,
      );
      throw storageUnavailable();
    }
  }
}

/** An error's name (S3's error code, such as SlowDown or AccessDenied), never its message. */
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/** The contract code of an HttpException this module throws (NOT_FOUND, NO_OPEN_SERVICE, ...). */
function codeOf(error: HttpException): string {
  const body = error.getResponse();
  const code = typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : `HTTP_${error.getStatus()}`;
}
