import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, ScanStatus } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { lockRequest } from './document-records.js';
import { refusedUpload } from './uploads.service.js';

/**
 * One GuardDuty Malware Protection for S3 result, as its EventBridge event gives it
 * (`scanResultDetails.scanResultStatus` and the reasons of an UNSUPPORTED scan).
 */
export interface ScanResult {
  /** The object's key: tenant/{businessId}/documents/{uuid}. */
  key: string;
  status: 'NO_THREATS_FOUND' | 'THREATS_FOUND' | 'UNSUPPORTED' | 'ACCESS_DENIED' | 'FAILED';
  reasons?: readonly string[];
  /**
   * The scanned object's S3 version id: logged by the consumer, not stored (documents has no
   * version column yet; R0's `s3_version_id` will pin it).
   */
  versionId?: string | null;
}

/**
 * What became of the document: its new scan status; UNSCANNED for a password-protected PDF,
 * accepted unscanned (CLEAN, q24); PENDING when the scan broke on our side (the alarm and a
 * rescan); UNKNOWN for a documents key with no document yet (the confirm may still come: the
 * consumer leaves the message for redelivery; DocumentScanHandler makes it IGNORED once the
 * confirm window has passed); IGNORED for a
 * key outside the documents prefixes, a document whose result is already set, or an upload the
 * confirm refused (its object is deleted; delete the message).
 */
export type ScanOutcome =
  'CLEAN' | 'INFECTED' | 'FAILED' | 'UNSCANNED' | 'PENDING' | 'UNKNOWN' | 'IGNORED';

/**
 * How far back a scan result looks for its upload's refusal: wider than confirm's 30 minutes, so
 * a result that GuardDuty or EventBridge delivers late is still IGNORED, not dead-lettered. A
 * refused key never gets a document (confirm finds the refusal under the key's lock).
 */
const SCAN_REFUSALS_SINCE_MS = 24 * 60 * 60_000;

/** UNSUPPORTED because of the file itself (docs/api/documents.yaml, "Scan results"). */
const FILE_REASON =
  /^(PASSWORD_PROTECTED|OBJECT_SIZE_LIMIT_EXCEEDED|EXTRACTED_[A-Z_]+_LIMIT_EXCEEDED|EXTRACTION_RATIO_LIMIT_EXCEEDED)$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** tenant/{businessId}/documents/{uploadId}, as uploads.service.ts names a new object. */
const KEY = new RegExp(`^tenant/(${UUID})/documents/(${UUID})$`);

/**
 * The scan status a result gives a file of this type, or null for "our side, still PENDING". The
 * one mapping for every scanned prefix (the handlers in storage/scan-queue/scan-router.ts):
 * NO_THREATS_FOUND is CLEAN, THREATS_FOUND INFECTED, a file reason FAILED, except q24's PDF that
 * only needs a password (CLEAN, `unscanned`).
 */
export function scanVerdict(
  result: ScanResult,
  contentType: string,
): { scan: ScanStatus; unscanned: boolean; reasons: string[] } | null {
  const reasons = (result.reasons ?? []).filter((r) => FILE_REASON.test(r));
  if (result.status === 'NO_THREATS_FOUND') return { scan: 'CLEAN', unscanned: false, reasons };
  if (result.status === 'THREATS_FOUND') return { scan: 'INFECTED', unscanned: false, reasons };
  if (result.status !== 'UNSUPPORTED' || reasons.length === 0) return null;
  // q24: a PDF that only needs a password to open is accepted unscanned.
  const pdfPassword =
    contentType === 'application/pdf' && reasons.every((r) => r === 'PASSWORD_PROTECTED');
  return pdfPassword
    ? { scan: 'CLEAN', unscanned: true, reasons }
    : { scan: 'FAILED', unscanned: false, reasons };
}

/**
 * Records a malware scan result on its document (R5; the rules in docs/api/documents.yaml "Scan
 * results"). DocumentScanHandler calls this for each GuardDuty result the SQS consumer
 * (storage/scan-queue) routes to the documents prefix; there is no route. The document is found by its S3 key in the firm its prefix names, never by a firm id
 * in the message, and only a PENDING document takes a result (the database refuses to change one
 * once set). q22: a SUBMITTED request whose newest file becomes INFECTED or FAILED goes back to
 * REQUESTED, in the same transaction. q24: UNSUPPORTED with PASSWORD_PROTECTED on a PDF is
 * accepted unscanned (CLEAN, the reason audited); other file reasons are FAILED; everything else
 * is our side and leaves the file PENDING for the alarm and a rescan. A result that comes before
 * the confirm saves its document is UNKNOWN, for redelivery; one for an upload the confirm
 * refused (its `document.upload_refused` audit row) is IGNORED, so it never reaches the alarm.
 * Lock order: the request, then the document. Audited with ids and codes only.
 */
@Injectable()
export class ScanResultsService {
  private readonly logger = new Logger(ScanResultsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async recordScanResult(result: ScanResult): Promise<ScanOutcome> {
    const [, businessId, uploadId] = KEY.exec(result.key) ?? [];
    if (!businessId || !uploadId) return 'IGNORED';
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const doc = await tx.document.findFirst({
        where: { businessId, s3Key: result.key },
        select: { id: true, clientId: true, requestId: true, contentType: true },
      });
      if (!doc) {
        // GuardDuty scanned the PUT of a file the confirm then refused and deleted: nothing to do.
        if (await refusedUpload(tx, businessId, uploadId, { sinceMs: SCAN_REFUSALS_SINCE_MS })) {
          this.logger.log(`Scan result for refused upload ${uploadId}; ignored`);
          return 'IGNORED';
        }
        // GuardDuty scans on the PUT; the confirm that saves the document can come later.
        this.logger.warn(`Scan result for upload ${uploadId} has no document yet; redeliver`);
        return 'UNKNOWN';
      }
      const request = doc.requestId ? await lockRequest(tx, businessId, doc.requestId) : null;
      const [locked] = await tx.$queryRaw<{ scan_status: ScanStatus }[]>`
        SELECT scan_status::text AS scan_status FROM documents
        WHERE business_id = ${businessId}::uuid AND id = ${doc.id}::uuid FOR UPDATE`;
      if (locked?.scan_status !== 'PENDING') return 'IGNORED';
      const next = scanVerdict(result, doc.contentType);
      if (!next) {
        // Our side (UNSUPPORTED_STORAGE_CLASS, ACCESS_DENIED, FAILED): the alarm and a rescan.
        this.logger.warn(`Scan of document ${doc.id} did not finish: ${result.status}; PENDING`);
        await this.audit.logIn(
          tx,
          'document.scan_unfinished',
          { type: 'document', id: doc.id },
          { clientId: doc.clientId, result: result.status, reasons: result.reasons ?? [] },
          { businessId },
        );
        return 'PENDING';
      }
      await tx.document.update({
        where: { id: doc.id },
        data: { scanStatus: next.scan, scannedAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'document.scanned',
        { type: 'document', id: doc.id },
        {
          clientId: doc.clientId,
          scanStatus: next.scan,
          result: result.status,
          reasons: next.reasons,
          ...(next.unscanned && { unscanned: true }),
        },
        { businessId },
      );
      if (next.scan !== 'CLEAN' && doc.requestId && request?.status === 'SUBMITTED') {
        const newest = await tx.document.findFirst({
          where: { businessId, requestId: doc.requestId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (newest?.id === doc.id) {
          await tx.documentRequest.update({
            where: { id: doc.requestId },
            data: { status: 'REQUESTED', statusNote: null },
          });
          await this.audit.logIn(
            tx,
            'document_request.reopened',
            { type: 'document_request', id: doc.requestId },
            { clientId: doc.clientId, documentId: doc.id, scanStatus: next.scan },
            { businessId },
          );
        }
      }
      return next.unscanned ? 'UNSCANNED' : next.scan;
    });
  }
}
