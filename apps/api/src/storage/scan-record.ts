import type { Logger } from '@nestjs/common';
import type { ScanStatus, TxClient } from '@firmivra/db';
import type { AuditService } from '../audit/audit.service.js';
import { ORPHAN_AFTER_MS } from './document-scan-handler.js';
import type { RoutedScanResult } from './scan-queue/scan-router.js';
import { type ScanOutcome, scanVerdict } from './scan-results.service.js';

/**
 * A result for a key that has no row yet is UNKNOWN: the confirm that saves the row can come after
 * the scan, so the message waits for redelivery. Once the confirm window has passed no row will
 * come: the message is acknowledged (IGNORED) and logged, never left to reach the dead-letter
 * queue. Any other outcome passes through. The log names the kind and the upload's id only.
 */
export function ignoreOrphan(
  outcome: ScanOutcome,
  result: Pick<RoutedScanResult, 'eventTime' | 'prefix'>,
  logger: Logger,
  uploadId: string,
): ScanOutcome {
  if (outcome !== 'UNKNOWN' || Date.now() - result.eventTime.getTime() <= ORPHAN_AFTER_MS) {
    return outcome;
  }
  logger.log(
    `Scan result for ${result.prefix} upload ${uploadId}: no record after the confirm window, an orphan upload; ignored`,
  );
  return 'IGNORED';
}

/** The tables that hold a scanned file's `scan_status` and are found by their `s3_key`. */
export type ScannedTable = 'lead_uploads' | 'esign_documents' | 'esign_attachments';

interface RecordScan {
  table: ScannedTable;
  /** Audit entity type, and the prefix of `<auditAction>.scanned` and `.scan_unfinished`. */
  entityType: string;
  /** Writes the result on the row (and on rows that share its key), inside the same transaction. */
  write(
    tx: TxClient,
    row: { id: string },
    next: { scan: ScanStatus; scannedAt: Date },
  ): Promise<void>;
  /** Ids only, for the audit row; the result and reasons are added. */
  metadata(row: { id: string; contentType: string }): Record<string, unknown>;
}

/**
 * Records one GuardDuty result on the row that holds the key, in the caller's firm scope
 * (`inFirm`), with the documents rules (ScanResultsService): the row is locked and only a PENDING
 * one takes a result (the database refuses to change one once set); `scanVerdict` maps the result;
 * null means our side, so the row stays PENDING and `<entity>.scan_unfinished` is audited (the
 * alarm and a rescan). No row is UNKNOWN. Audited with ids and codes only: never a file name, its
 * bytes or a threat name.
 */
export async function recordScan(
  tx: TxClient,
  audit: AuditService,
  logger: Logger,
  result: RoutedScanResult,
  spec: RecordScan,
): Promise<ScanOutcome> {
  const { businessId } = result;
  // The table name is one of the literals of ScannedTable, never input.
  const [row] = await tx.$queryRawUnsafe<
    { id: string; scan_status: ScanStatus; content_type: string }[]
  >(
    `SELECT id, scan_status::text AS scan_status, content_type FROM ${spec.table}
     WHERE business_id = $1::uuid AND s3_key = $2 FOR UPDATE`,
    businessId,
    result.key,
  );
  if (!row) return 'UNKNOWN';
  if (row.scan_status !== 'PENDING') return 'IGNORED';
  const entity = { type: spec.entityType, id: row.id };
  const found = { id: row.id, contentType: row.content_type };
  const next = scanVerdict(
    { key: result.key, status: result.status, reasons: result.reasons },
    row.content_type,
  );
  if (!next) {
    logger.warn(`Scan of ${spec.entityType} ${row.id} did not finish: ${result.status}; PENDING`);
    await audit.logIn(
      tx,
      `${spec.entityType}.scan_unfinished`,
      entity,
      { ...spec.metadata(found), result: result.status, reasons: result.reasons },
      { businessId },
    );
    return 'PENDING';
  }
  await spec.write(tx, found, { scan: next.scan, scannedAt: new Date() });
  await audit.logIn(
    tx,
    `${spec.entityType}.scanned`,
    entity,
    {
      ...spec.metadata(found),
      scanStatus: next.scan,
      result: result.status,
      reasons: next.reasons,
      ...(next.unscanned && { unscanned: true }),
    },
    { businessId },
  );
  return next.unscanned ? 'UNSCANNED' : next.scan;
}
