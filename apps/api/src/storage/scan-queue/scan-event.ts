import { z } from 'zod';
import type { ScanResult } from '../scan-results.service.js';

/**
 * GuardDuty Malware Protection for S3's result event, as EventBridge delivers it (the whole event
 * is the SQS message body, no input transformer). Shape from AWS's guide, "Monitoring S3 object
 * scans with Amazon EventBridge" (monitor-with-eventbridge-s3-malware-protection.html) and "S3
 * object potential scan status and result status" (monitoring-malware-protection-s3-scans-gdu):
 * `detail.scanResultDetails.statusReasons` is a list when the scan was SKIPPED (UNSUPPORTED,
 * ACCESS_DENIED; for example ["PASSWORD_PROTECTED"]) and null otherwise. Only these fields are
 * read; others pass through unread, and `threats` is never read or logged.
 */
export const SCAN_RESULT_DETAIL_TYPE = 'GuardDuty Malware Protection Object Scan Result';
export const SCAN_RESULT_STATUSES = [
  'NO_THREATS_FOUND',
  'THREATS_FOUND',
  'UNSUPPORTED',
  'ACCESS_DENIED',
  'FAILED',
] as const satisfies readonly ScanResult['status'][];

const ScanEvent = z.looseObject({
  // EventBridge's event id (a UUID): logs only.
  id: z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
  source: z.literal('aws.guardduty'),
  'detail-type': z.literal(SCAN_RESULT_DETAIL_TYPE),
  account: z.string().regex(/^\d{12}$/),
  region: z.string().min(1).max(30),
  // When GuardDuty sent the result: the orphan rule's clock (document-scan-handler.ts).
  time: z.iso.datetime({ offset: true }),
  detail: z.looseObject({
    resourceType: z.literal('S3_OBJECT'),
    scanStatus: z.string().max(30).nullish(),
    s3ObjectDetails: z.looseObject({
      bucketName: z.string().min(3).max(63),
      // Used as given: every key the API writes is [0-9a-f/-] (and esign's names [A-Za-z0-9._-]).
      objectKey: z.string().min(1).max(1024),
      versionId: z.string().max(1024).nullish(),
    }),
    scanResultDetails: z.looseObject({
      // Checked against the five below after the shape, so a new status has its own reason.
      scanResultStatus: z.string().max(50),
      statusReasons: z.array(z.string().max(100)).max(20).nullish(),
    }),
  }),
});

export interface ParsedScanEvent {
  id: string;
  time: Date;
  key: string;
  status: ScanResult['status'];
  /** `statusReasons`, [] when null. */
  reasons: string[];
  versionId: string | null;
}

/** Why a queue message is not a result the API takes (SCAN_REJECTED, then deleted). */
export type ScanEventRejection =
  | 'NOT_JSON'
  | 'NOT_A_SCAN_RESULT'
  | 'UNKNOWN_RESULT_STATUS'
  | 'WRONG_ACCOUNT'
  | 'WRONG_REGION'
  | 'WRONG_BUCKET';

/** What a result must name: the queue's account and region, the documents bucket. */
export interface ExpectedScanSource {
  account: string;
  region: string;
  bucket: string;
}

const isStatus = (s: string): s is ScanResult['status'] =>
  (SCAN_RESULT_STATUSES as readonly string[]).includes(s);

/** Reads one SQS message body; never throws. */
export function parseScanEvent(
  body: string,
  expected: ExpectedScanSource,
): { ok: true; event: ParsedScanEvent } | { ok: false; why: ScanEventRejection } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, why: 'NOT_JSON' };
  }
  const parsed = ScanEvent.safeParse(json);
  if (!parsed.success) return { ok: false, why: 'NOT_A_SCAN_RESULT' };
  const e = parsed.data;
  const { s3ObjectDetails: object, scanResultDetails: result } = e.detail;
  const status = result.scanResultStatus;
  if (!isStatus(status)) return { ok: false, why: 'UNKNOWN_RESULT_STATUS' };
  if (e.account !== expected.account) return { ok: false, why: 'WRONG_ACCOUNT' };
  if (e.region !== expected.region) return { ok: false, why: 'WRONG_REGION' };
  if (object.bucketName !== expected.bucket) return { ok: false, why: 'WRONG_BUCKET' };
  return {
    ok: true,
    event: {
      id: e.id,
      time: new Date(e.time),
      key: object.objectKey,
      status,
      reasons: result.statusReasons ?? [],
      versionId: object.versionId ?? null,
    },
  };
}
