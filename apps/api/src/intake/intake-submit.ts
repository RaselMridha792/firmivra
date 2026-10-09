import { BadRequestException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  checkIntakeAnswers,
  hiddenSlotUploads,
  type IntakeFormDefinition,
  intakeUploadCounts,
  type ScanStatus,
} from '@firmivra/types';
import type { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { maskStoredNumbers, sealIntakeNumbers } from './intake-numbers.js';

type Values = Record<string, unknown>;

/** A file in one of the form's upload slots, as submit counts and detaches it. */
export interface SlotFile {
  id: string;
  slot: string;
  status: ScanStatus;
}

/** Who signed the version, stored on it (R14's signing service records the agreements). */
export interface SubmitSigner {
  name: string;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Checks the whole form for submit, before any transaction (sealing may call KMS). Returns the
 * answers to lock (cleaned, hidden ones left out, numbers kept sealed) and the files in slots the
 * answers hide, which leave the form before it is marked submitted (R0's rule: a file leaves an
 * intake only while it is open). 400 VALIDATION_FAILED with `details.issues` otherwise.
 */
export async function prepareSubmit(
  fe: FieldEncryption,
  where: { businessId: string; intakeId: string },
  definition: IntakeFormDefinition,
  stored: Readonly<Values>,
  files: readonly SlotFile[],
): Promise<{ answers: Values; hidden: SlotFile[] }> {
  const masked = await maskStoredNumbers(definition, stored);
  const hidden = hiddenSlotUploads(definition, masked, files);
  const kept = files.filter((f) => !hidden.includes(f));
  const checked = checkIntakeAnswers(definition, masked, {
    mode: 'submit',
    uploads: intakeUploadCounts(kept),
  });
  if (checked.issues.length > 0) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some answers need attention',
      details: { issues: checked.issues },
    });
  }
  const answers = await sealIntakeNumbers(fe, where, definition, checked.answers, stored);
  return { answers, hidden };
}

/**
 * Locks the draft version in the caller's transaction, which holds the intake row and checked
 * that the draft is still the open one: the answers as prepared, who signed and when. Clears the
 * correction note with the status change (the database keeps both in step).
 */
export async function lockVersion(
  tx: TxClient,
  ids: { businessId: string; intakeId: string; submissionId: string },
  answers: Values,
  signer: SubmitSigner,
): Promise<Date> {
  const now = new Date();
  await tx.intakeSubmission.update({
    where: { id: ids.submissionId },
    data: {
      answers: answers as Prisma.InputJsonValue,
      submittedAt: now,
      submittedByUserId: signer.userId,
      signerName: signer.name,
      signedAt: now,
      signerIp: signer.ip,
      signerUserAgent: signer.userAgent,
    },
  });
  await tx.intake.update({
    where: { id: ids.intakeId },
    data: { status: 'SUBMITTED', correctionNote: null },
  });
  return now;
}
