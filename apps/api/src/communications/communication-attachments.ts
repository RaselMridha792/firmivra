import type { ScanStatus, SendCheck } from '@firmivra/types';

/**
 * One file of a communication, as `communications.attachments` keeps it (JSON, by reference).
 * `scanStatus` is the virus check's verdict (the scan gap, Nov 19): PENDING until GuardDuty answers
 * (CLEAN at once locally); a file attached before the check existed has none and counts as
 * PENDING.
 */
export interface StoredAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
  scanStatus?: ScanStatus;
}

/** The stored list, keeping only well-formed entries. */
export function storedAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is StoredAttachment =>
      typeof a === 'object' &&
      a !== null &&
      typeof (a as StoredAttachment).s3Key === 'string' &&
      typeof (a as StoredAttachment).id === 'string',
  );
}

/** A file's verdict as the screens and the checks read it. */
export const scanOf = (a: StoredAttachment): ScanStatus => a.scanStatus ?? 'PENDING';

/**
 * The send checks for a communication's files: nothing goes out (Send, Schedule, nor a scheduled
 * start) until every file is CLEAN. Delivery therefore only ever meets clean files.
 */
export function attachmentChecks(files: readonly StoredAttachment[]): SendCheck[] {
  if (files.some((f) => scanOf(f) === 'INFECTED' || scanOf(f) === 'FAILED')) {
    return [
      {
        code: 'ATTACHMENT_BLOCKED',
        severity: 'BLOCK',
        message:
          'An attachment did not pass the virus check or could not be checked. Remove it to send.',
      },
    ];
  }
  if (files.some((f) => scanOf(f) !== 'CLEAN')) {
    return [
      {
        code: 'ATTACHMENT_SCAN_PENDING',
        severity: 'BLOCK',
        message: 'An attachment is still being checked for viruses. Try again in a moment.',
      },
    ];
  }
  return [];
}
