/**
 * Intake Forms Review Two 10c: a form's two reminders in order. The first counts from sending, the
 * final back from the expiry, so with short windows they can cross. No unordered schedule goes
 * out: a first at or after the final (or after the expiry) is skipped, and a final before or
 * within 5 minutes of sending is skipped. The send screen previews this and the schedule job
 * follows it; a skip is written to the form's History, never recorded as sent.
 */
export const INTAKE_REMINDER_MIN_GAP_MINUTES = 5;

export type IntakeReminderSkip = 'AFTER_FINAL' | 'AFTER_EXPIRY' | 'TOO_SOON';

export interface IntakeReminderPlan {
  /** When the first reminder goes; null when it is off or skipped. */
  firstAt: Date | null;
  /** When the final reminder goes; null when it is off, the form never expires, or skipped. */
  finalAt: Date | null;
  firstSkipped: IntakeReminderSkip | null;
  finalSkipped: IntakeReminderSkip | null;
}

const MIN = 60_000;

export function intakeReminderPlan(input: {
  sentAt: Date;
  expiresAt: Date | null;
  firstMinutes: number | null;
  finalMinutes: number | null;
}): IntakeReminderPlan {
  const sent = input.sentAt.getTime();
  const expires = input.expiresAt?.getTime() ?? null;
  const finalTime =
    expires !== null && input.finalMinutes !== null ? expires - input.finalMinutes * MIN : null;
  const finalSkipped =
    finalTime !== null && finalTime <= sent + INTAKE_REMINDER_MIN_GAP_MINUTES * MIN
      ? 'TOO_SOON'
      : null;
  const finalAt = finalTime === null || finalSkipped ? null : finalTime;
  const firstTime = input.firstMinutes === null ? null : sent + input.firstMinutes * MIN;
  const firstSkipped =
    firstTime === null
      ? null
      : finalAt !== null && firstTime >= finalAt
        ? 'AFTER_FINAL'
        : expires !== null && firstTime >= expires
          ? 'AFTER_EXPIRY'
          : null;
  return {
    firstAt: firstTime === null || firstSkipped ? null : new Date(firstTime),
    finalAt: finalAt === null ? null : new Date(finalAt),
    firstSkipped,
    finalSkipped,
  };
}

/** What a skipped reminder says, on the send screen and in the form's History. */
export function intakeReminderSkipWords(
  kind: 'FIRST' | 'FINAL',
  reason: IntakeReminderSkip,
): string {
  const which = kind === 'FIRST' ? 'First' : 'Final';
  if (reason === 'AFTER_FINAL')
    return `${which} reminder skipped: it would come after the final reminder`;
  if (reason === 'AFTER_EXPIRY') return `${which} reminder skipped: the form expires first`;
  return `${which} reminder skipped: it would come within ${INTAKE_REMINDER_MIN_GAP_MINUTES} minutes of sending`;
}
