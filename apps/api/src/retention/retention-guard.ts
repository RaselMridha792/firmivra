import { ConflictException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  effectiveRetentionYears,
  type IntakeRetentionCategory,
  RETENTION_MINIMUM,
  type RetentionHold,
  retentionAllowsRemoval,
  retentionHold,
  retentionHoldMessage,
} from '@firmivra/types';

/**
 * The job (service) or task a record of a retention category belongs to. Several may be given (a
 * message about a task of a service): the record is held until the last of them is completed.
 */
export interface RetentionRef {
  engagementId?: string | null;
  taskId?: string | null;
}

/** Today as a calendar date (UTC), as the holds are counted. */
const utcToday = (now: Date) => now.toISOString().slice(0, 10);

/**
 * When the record's job or task was completed: the latest completion of the ones given, or null
 * when any of them is not completed (a reopened service is not), is not the firm's, or none is
 * given. Read in the caller's transaction, in the firm's scope.
 */
async function completedAt(
  tx: TxClient,
  businessId: string,
  ref: RetentionRef,
): Promise<Date | null> {
  const dates: Date[] = [];
  if (ref.engagementId) {
    const job = await tx.engagement.findFirst({
      where: { businessId, id: ref.engagementId },
      select: { status: true, completedAt: true },
    });
    if (job?.status !== 'COMPLETED' || !job.completedAt) return null;
    dates.push(job.completedAt);
  }
  if (ref.taskId) {
    const task = await tx.task.findFirst({
      where: { businessId, id: ref.taskId },
      select: { status: true, completedAt: true },
    });
    if (task?.status !== 'DONE' || !task.completedAt) return null;
    dates.push(task.completedAt);
  }
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

/**
 * Intake Forms Review Two 14b: the minimum-retention guard. A record of one of the six categories
 * is kept until its job or task was completed plus its category's effective years (its own, else
 * Apply to all); one whose job or task isn't completed, or that has none, is kept (the default
 * until Octavia decides when its minimum starts). A category with no minimum holds nothing.
 *
 * Today nothing in the six categories can be removed (documents go to a Trash they come back
 * from; intakes, messages and emails are never deleted; see apps/api/test/unit/retention-paths
 * .test.ts): any new removal of such a record, by a person or a job, calls `assertRemovable` in
 * its own transaction first. Nothing here deletes, and nothing is removed when a minimum ends.
 */
export const RetentionGuard = {
  /** The hold on one record. */
  async hold(
    tx: TxClient,
    businessId: string,
    category: IntakeRetentionCategory,
    ref: RetentionRef,
  ): Promise<RetentionHold> {
    const s = await tx.intakeSettings.findUnique({
      where: { businessId },
      select: {
        dataRetentionYears: true,
        retentionYearsClientDocuments: true,
        retentionYearsFirmDocuments: true,
        retentionYearsIntakeSubmissions: true,
        retentionYearsPortalMessages: true,
        retentionYearsSystemEmails: true,
        retentionYearsTaxReturnDocuments: true,
      },
    });
    // No settings row yet: no minimum is set.
    const years = s
      ? effectiveRetentionYears(
          {
            dataRetentionYears: s.dataRetentionYears,
            retention: {
              clientDocuments: s.retentionYearsClientDocuments,
              firmDocuments: s.retentionYearsFirmDocuments,
              intakeSubmissions: s.retentionYearsIntakeSubmissions,
              portalMessages: s.retentionYearsPortalMessages,
              systemEmails: s.retentionYearsSystemEmails,
              taxReturnDocuments: s.retentionYearsTaxReturnDocuments,
            },
          },
          category,
        )
      : null;
    return retentionHold(years, await completedAt(tx, businessId, ref));
  },

  /**
   * 409 RETENTION_MINIMUM ("Kept until Nov 15, 2033 under your retention policy", or "Kept: its
   * job isn't completed yet") while the record's minimum holds it; nothing otherwise.
   */
  async assertRemovable(
    tx: TxClient,
    businessId: string,
    category: IntakeRetentionCategory,
    ref: RetentionRef,
    now: Date = new Date(),
  ): Promise<void> {
    const hold = await RetentionGuard.hold(tx, businessId, category, ref);
    if (retentionAllowsRemoval(hold, utcToday(now))) return;
    throw new ConflictException({
      code: RETENTION_MINIMUM,
      message: retentionHoldMessage(hold) ?? 'Kept under your retention policy',
    });
  },
};
