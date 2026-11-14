import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  checkIntakeAnswers,
  INTAKE_ERRORS,
  type IntakeAnswersInput,
  type IntakeFormDefinition,
  type IntakeStatus,
  restoreMaskedNumbers,
} from '@firmivra/types';
import type { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { maskStoredNumbers, sealIntakeNumbers } from './intake-numbers.js';

/** Statuses in which the recipient can change the answers (contract B's INTAKE_EDITABLE_STATUSES). */
export const OPEN_STATUSES: IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];

export const intakeLocked = () =>
  new ConflictException({ code: 'INTAKE_LOCKED', message: INTAKE_ERRORS.INTAKE_LOCKED });
const expired = () =>
  new GoneException({ code: 'INTAKE_EXPIRED', message: INTAKE_ERRORS.INTAKE_EXPIRED });

/** 409 INTAKE_LOCKED, or 410 INTAKE_EXPIRED, unless the intake is open for changes. */
export function requireOpen(status: IntakeStatus): void {
  if (status === 'EXPIRED') throw expired();
  if (!OPEN_STATUSES.includes(status)) throw intakeLocked();
}

const answersOf = (v: unknown) => (v ?? {}) as Record<string, unknown>;

/**
 * Autosave of one step of an intake's open version, for the portal's client and a lead's secure
 * link alike, after the caller's own gate (who may change it, and that it is open). The answers
 * are checked (400 VALIDATION_FAILED), SSN and EIN sealed (sealing may call KMS, so before any
 * transaction), then written under the intake's row lock, merged onto the answers as they are by
 * then: a save of another step that landed meanwhile is kept. 410 INTAKE_EXPIRED or 409
 * INTAKE_LOCKED when it closed in between. A SENT intake becomes IN_PROGRESS. Answers the save
 * time.
 */
export async function saveIntakeStep(
  deps: { database: Database; fe: FieldEncryption },
  businessId: string,
  intakeId: string,
  definition: IntakeFormDefinition,
  draft: { id: string; answers: unknown },
  stepKey: string,
  answers: IntakeAnswersInput,
): Promise<Date> {
  const stored = answersOf(draft.answers);
  const checked = checkIntakeAnswers(definition, answers, { mode: 'save', step: stepKey });
  const restored = restoreMaskedNumbers(
    definition,
    checked.answers,
    await maskStoredNumbers(definition, stored),
  );
  const issues = [...checked.issues, ...restored.issues];
  if (issues.length > 0) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some answers need attention',
      details: { issues },
    });
  }
  const sealed = await sealIntakeNumbers(
    deps.fe,
    { businessId, intakeId },
    definition,
    restored.answers,
    stored,
  );
  const step = definition.steps.find((s) => s.key === stepKey)!;
  const stepKeys = new Set(step.sections.flatMap((s) => s.fields.map((f) => f.key)));
  return deps.database.withScope({ kind: 'business', businessId }, async (tx) => {
    const rows = await tx.$queryRaw<{ status: IntakeStatus }[]>`
      SELECT status::text AS status FROM intakes WHERE id = ${intakeId}::uuid FOR NO KEY UPDATE`;
    const current = await tx.intakeSubmission.findFirst({
      where: { businessId, intakeId },
      orderBy: { version: 'desc' },
      select: { id: true, submittedAt: true, savedSteps: true, answers: true },
    });
    if (!rows[0]) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    requireOpen(rows[0].status);
    if (current?.id !== draft.id || current.submittedAt) throw intakeLocked();
    const merged = Object.fromEntries(
      Object.entries(answersOf(current.answers)).filter(([k]) => !stepKeys.has(k)),
    );
    Object.assign(merged, sealed);
    const updated = await tx.intakeSubmission.update({
      where: { id: draft.id },
      data: {
        answers: merged as Prisma.InputJsonValue,
        savedSteps: current.savedSteps.includes(stepKey)
          ? current.savedSteps
          : [...current.savedSteps, stepKey],
      },
      select: { updatedAt: true },
    });
    if (rows[0].status === 'SENT') {
      await tx.intake.update({ where: { id: intakeId }, data: { status: 'IN_PROGRESS' } });
    }
    return updated.updatedAt;
  });
}
