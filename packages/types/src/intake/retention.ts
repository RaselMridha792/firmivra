// Intake Forms Review Two 14b: when a record of one of the six retention categories may be
// removed. The API's RetentionGuard and the Security panel both use these, so the date a screen
// shows is the date the server keeps to. Nothing here deletes anything: a minimum only holds a
// record, and there is no automatic removal anywhere.

/** 409 for a removal a category's minimum still holds (RetentionGuard). */
export const RETENTION_MINIMUM = 'RETENTION_MINIMUM' as const;

/**
 * What holds a record:
 * - NONE: its category has no minimum (none set on its own, no Apply to all).
 * - OPEN: its job (service) or task isn't completed, or it has none. Kept: until Octavia decides
 *   when such a record's minimum starts, it is held for good.
 * - UNTIL: kept until this calendar date (YYYY-MM-DD, UTC), the completion date plus the years.
 */
export type RetentionHold = { kind: 'NONE' } | { kind: 'OPEN' } | { kind: 'UNTIL'; until: string };

/**
 * `years` after `from`, as a calendar date (UTC), the way documents' retention_until is counted:
 * the time of day is dropped, and a leap day moves to March 1 in a year without one.
 */
export function retentionYearsAfter(from: Date, years: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * The hold on a record: `years` is its category's effective minimum (effectiveRetentionYears),
 * `completedAt` when its job or task was completed (null: not completed, or no job or task).
 */
export function retentionHold(
  years: number | null,
  completedAt: Date | string | null,
): RetentionHold {
  if (years === null) return { kind: 'NONE' };
  if (completedAt === null) return { kind: 'OPEN' };
  const at = typeof completedAt === 'string' ? new Date(completedAt) : completedAt;
  if (Number.isNaN(at.getTime())) return { kind: 'OPEN' };
  return { kind: 'UNTIL', until: retentionYearsAfter(at, years) };
}

/** Whether a hold lets the record go on `today` (YYYY-MM-DD, UTC): from its until date on. */
export function retentionAllowsRemoval(hold: RetentionHold, today: string): boolean {
  if (hold.kind === 'NONE') return true;
  if (hold.kind === 'OPEN') return false;
  return today >= hold.until;
}

/** "Nov 15, 2033": a hold's date in words. */
export function retentionDateWords(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The refusal's words: why the record is kept. Null when nothing holds it. */
export function retentionHoldMessage(hold: RetentionHold): string | null {
  if (hold.kind === 'OPEN') return 'Kept: its job isn’t completed yet';
  if (hold.kind === 'UNTIL')
    return `Kept until ${retentionDateWords(hold.until)} under your retention policy`;
  return null;
}
