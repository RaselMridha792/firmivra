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
