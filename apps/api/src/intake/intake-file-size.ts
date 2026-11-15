import { BadRequestException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { INTAKE_MAX_FILE_SIZE_MB, intakeFileSizeProblem } from '@firmivra/types';

/**
 * The size limit of a firm that has no intake settings yet: the table's default
 * (intake_settings.max_file_size_mb DEFAULT 10), which a reset writes back too.
 */
export const INTAKE_DEFAULT_FILE_SIZE_MB = 10;

/**
 * The firm's largest intake file, in MB (Intake Form Settings > Max file size per file, Octavia's
 * I10): its saved size, or the default while it has no settings row. Never past the platform's
 * own limit (UPLOAD_LIMITS.maxBytes, which the contract checks first). In the firm's scope. The
 * upload screens get it too (`maxFileSizeMb` of MyIntake, BeginOnlineForm and BeginDraft).
 */
export async function intakeFileSizeMb(tx: TxClient, businessId: string): Promise<number> {
  const row = await tx.intakeSettings.findUnique({
    where: { businessId },
    select: { maxFileSizeMb: true },
  });
  return Math.min(row?.maxFileSizeMb ?? INTAKE_DEFAULT_FILE_SIZE_MB, INTAKE_MAX_FILE_SIZE_MB);
}

/**
 * Refuses a file over the firm's limit at the upload ticket, before anything goes to storage: 400
 * VALIDATION_FAILED at `sizeBytes`, as the contract's own size check answers, naming the firm's
 * limit ("Files can be at most 50 MB"). Portal intakes and Begin Online drafts both call it. The
 * confirm takes the size sealed in the ticket, so a limit lowered after a ticket was given does not
 * refuse that upload.
 */
export async function checkIntakeFileSize(
  tx: TxClient,
  businessId: string,
  sizeBytes: number,
): Promise<void> {
  const problem = intakeFileSizeProblem(sizeBytes, await intakeFileSizeMb(tx, businessId));
  if (problem) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path: 'sizeBytes', message: problem }],
    });
  }
}

/** A firm with no intake settings yet: the table's default accepted types. */
export const INTAKE_DEFAULT_FILE_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];
const TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
};

/**
 * Review Two row 23 (P2-6): the firm's accepted file types for intake forms (Intake Form Settings
 * > Security; PDF, JPG and PNG until it sets them) at the upload ticket, after the platform's own
 * list: 400 VALIDATION_FAILED at `contentType` naming what it takes. Portal intakes, lead links
 * and Begin Online drafts all call it, as they do the size check.
 */
export async function checkIntakeFileType(
  tx: TxClient,
  businessId: string,
  contentType: string,
): Promise<void> {
  const row = await tx.intakeSettings.findUnique({
    where: { businessId },
    select: { acceptedFileTypes: true },
  });
  const accepted = row?.acceptedFileTypes.length
    ? row.acceptedFileTypes
    : INTAKE_DEFAULT_FILE_TYPES;
  if (accepted.includes(contentType)) return;
  const names = accepted.map((m) => TYPE_NAMES[m] ?? m);
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : (names[0] ?? '');
  throw new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path: 'contentType', message: `Your firm takes ${list} files here` }],
  });
}
