import type { AssignedFormRecord } from '@firmivra/types';

export interface NudgeNotice {
  message: string;
  tone: 'success' | 'error';
}

/**
 * Intake Forms Review Two 19b: the true result of a Resend or Remind, in the member's words. SENT
 * says `done`; RETRYING and FAILED say why (the API's `reason`), FAILED as an error. History keeps
 * the same result.
 */
export function nudgeNotice(
  record: Pick<AssignedFormRecord, 'delivery'>,
  done: string,
): NudgeNotice {
  const d = record.delivery;
  if (!d || d.status === 'SENT') return { message: done, tone: 'success' };
  if (d.status === 'RETRYING') {
    return { message: d.reason ?? `${done} The email is being tried again.`, tone: 'success' };
  }
  return { message: d.reason ?? 'Nothing reached the recipient. Please try again.', tone: 'error' };
}
