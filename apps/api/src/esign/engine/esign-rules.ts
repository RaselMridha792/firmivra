import { z } from 'zod';
import type {
  EsignReadiness,
  EsignReminders,
  EsignRequestStatus,
  EsignRouting,
} from '@firmivra/types';
import type { EsignRules, ReadinessInput, RuleRecipient } from './engine.types.js';

// Firm Sign's pure rules (R18 step 7): readiness, routing and timing. No clock and no database:
// `now` and every date come from the caller, so tests use a fake clock.

const DAY_MS = 24 * 60 * 60_000;
/** Remind Now waits this long after the last reminder to the same recipient. */
export const REMIND_GAP_MS = 60 * 60_000;
/** The open statuses, in the order a request moves through them. */
const OPEN: readonly string[] = ['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'];
const Email = z.email();

type Problem = EsignReadiness['problems'][number];
const problem = (code: Problem['code'], ids: Partial<Omit<Problem, 'code'>> = {}): Problem => ({
  code,
  recipientId: null,
  fieldId: null,
  documentId: null,
  mergeKey: null,
  ...ids,
});

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** True when the last automatic reminder would fall on or after the expiry day. */
export function remindersRunPastExpiry(reminders: EsignReminders, expiryDays: number): boolean {
  if (reminders.max === 0) return false;
  return reminders.firstAfterDays + (reminders.max - 1) * reminders.everyDays >= expiryDays;
}

/** The spec's readiness check (section 10) plus ours, in the order the review screen lists. */
export function readiness(input: ReadinessInput): EsignReadiness {
  const problems: Problem[] = [];
  const signers = input.recipients.filter((r) => r.kind === 'SIGNER');
  const signerIds = new Set(signers.map((s) => s.id));

  if (input.documents.length === 0) problems.push(problem('NO_DOCUMENTS'));
  for (const doc of input.documents) {
    if (doc.scanStatus === 'PENDING')
      problems.push(problem('SCAN_PENDING', { documentId: doc.id }));
    else if (doc.scanStatus !== 'CLEAN') {
      problems.push(problem('SCAN_BLOCKED', { documentId: doc.id }));
    }
  }
  if (!input.clientId) problems.push(problem('NO_CLIENT'));
  if (!input.engagementId) problems.push(problem('NO_ENGAGEMENT'));
  if (signers.length === 0) problems.push(problem('NO_SIGNERS'));

  if (input.approvalRequired && !input.recipients.some((r) => r.kind === 'APPROVER')) {
    problems.push(problem('APPROVER_MISSING'));
  }
  for (const r of input.recipients) {
    if (r.delivery === 'EMAIL' && !(r.email && Email.safeParse(r.email).success)) {
      problems.push(problem('RECIPIENT_NO_CONTACT', { recipientId: r.id }));
    }
    // IN_PERSON recipients sign on the firm's device: no email and no access code needed.
    const inPerson = r.delivery === 'IN_PERSON';
    if (!inPerson && r.kind !== 'CC' && r.authMethod === 'ACCESS_CODE' && !r.hasAccessCode) {
      problems.push(problem('ACCESS_CODE_MISSING', { recipientId: r.id }));
    }
    if (r.kind === 'APPROVER' && r.status !== 'APPROVED') {
      problems.push(problem('APPROVAL_PENDING', { recipientId: r.id }));
    }
  }

  // Any required field (signature, initials, date, attachment...) whose signer is gone or who
  // was never a signer could never be filled; the code says signature, the fieldId says which.
  for (const field of input.fields) {
    const unassigned = !field.recipientId || !signerIds.has(field.recipientId);
    if (field.required && unassigned) {
      problems.push(problem('SIGNATURE_UNASSIGNED', { fieldId: field.id }));
    }
  }
  if (input.fields.length > 0) {
    const withFields = new Set(input.fields.map((f) => f.recipientId));
    for (const s of signers) {
      if (!withFields.has(s.id)) problems.push(problem('SIGNER_NO_FIELDS', { recipientId: s.id }));
    }
  }

  const used = new Set(input.fields.map((f) => f.mergeKey).filter((k) => k !== null));
  for (const key of new Set(input.missingMergeKeys)) {
    if (key && used.has(key)) problems.push(problem('MERGE_MISSING', { mergeKey: key }));
  }
  if (remindersRunPastExpiry(input.reminders, input.expiryDays)) {
    problems.push(problem('REMINDER_AFTER_EXPIRY'));
  }
  if (!input.consentPublished) problems.push(problem('NO_CONSENT'));

  return { ready: problems.length === 0, problems, autoSignaturePage: input.fields.length === 0 };
}

const done = (r: RuleRecipient) => r.status === 'SIGNED' || r.status === 'DECLINED';

/**
 * The signers whose turn it is. PARALLEL: every signer not done. SEQUENTIAL: the signers not
 * done with the lowest routing order (equal orders sign together). Nobody once one declined.
 * Approvers act before sending (NEEDS_APPROVAL) and CCs never sign, so neither is included.
 */
export function currentTurn(routing: EsignRouting, recipients: RuleRecipient[]): string[] {
  const signers = recipients.filter((r) => r.kind === 'SIGNER');
  if (signers.some((s) => s.status === 'DECLINED')) return [];
  const open = signers.filter((s) => !done(s));
  if (routing === 'PARALLEL' || open.length === 0) return open.map((s) => s.id);
  const first = Math.min(...open.map((s) => s.routingOrder));
  return open.filter((s) => s.routingOrder === first).map((s) => s.id);
}

/**
 * The request's status after a recipient changed. Only open requests move: DECLINED when a
 * signer declined, COMPLETED when every signer signed, PARTIALLY_SIGNED when some did, else the
 * furthest any signer got (VIEWED, DELIVERED, SENT), never behind the current status. Any other
 * status stays as it is.
 */
export function statusAfter(
  recipients: RuleRecipient[],
  current: EsignRequestStatus,
): EsignRequestStatus {
  if (!OPEN.includes(current)) return current;
  const next = furthest(recipients);
  // Terminal outcomes always apply; otherwise an open request never moves backwards.
  if (next === 'NONE') return current;
  if (!OPEN.includes(next) || OPEN.indexOf(next) > OPEN.indexOf(current)) return next;
  return current;
}

function furthest(recipients: RuleRecipient[]): EsignRequestStatus | 'NONE' {
  const signers = recipients.filter((r) => r.kind === 'SIGNER');
  if (signers.length === 0) return 'NONE';
  if (signers.some((s) => s.status === 'DECLINED')) return 'DECLINED';
  const signed = signers.filter((s) => s.status === 'SIGNED').length;
  if (signed === signers.length) return 'COMPLETED';
  if (signed > 0) return 'PARTIALLY_SIGNED';
  if (signers.some((s) => s.status === 'VIEWED')) return 'VIEWED';
  if (signers.some((s) => s.status === 'DELIVERED')) return 'DELIVERED';
  return 'SENT';
}

/** The next automatic reminder: first after firstAfterDays, then every everyDays, at most max. */
export function nextReminderAt(input: {
  sentAt: Date;
  reminders: EsignReminders;
  sentCount: number;
  expiresAt: Date;
}): Date | null {
  const { sentAt, reminders, sentCount, expiresAt } = input;
  if (sentCount >= reminders.max) return null;
  const at = addDays(sentAt, reminders.firstAfterDays + sentCount * reminders.everyDays);
  return at < expiresAt ? at : null;
}

/** warningDays before expiry; none for 0 or when that falls at or before sending. */
export function expiryWarningAt(input: {
  sentAt: Date;
  expiresAt: Date;
  warningDays: number;
}): Date | null {
  if (input.warningDays === 0) return null;
  const at = addDays(input.expiresAt, -input.warningDays);
  return at > input.sentAt ? at : null;
}

export function canRemindNow(lastRemindedAt: Date | null, now: Date): boolean {
  return !lastRemindedAt || now.getTime() - lastRemindedAt.getTime() >= REMIND_GAP_MS;
}

/** The rules behind ESIGN_RULES. */
export const esignRules: EsignRules = {
  readiness,
  currentTurn,
  statusAfter,
  nextReminderAt,
  expiryWarningAt,
  canRemindNow,
};
