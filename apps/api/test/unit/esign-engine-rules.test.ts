// Unit tests for R18 step 7, Firm Sign's pure rules with a fake clock: each readiness code and
// autoSignaturePage, routing (sequential, parallel, mixed orders) and the status after each
// recipient change, reminders and the expiry warning, a schedule that runs past expiry, and
// Remind Now at most once an hour.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ReadinessInput, RuleRecipient } from '../../src/esign/engine/engine.types.js';
import {
  canRemindNow,
  currentTurn,
  expiryWarningAt,
  nextReminderAt,
  readiness,
  remindersRunPastExpiry,
  statusAfter,
} from '../../src/esign/engine/esign-rules.js';

const signer = (extra: Partial<RuleRecipient> = {}): RuleRecipient => ({
  id: randomUUID(),
  kind: 'SIGNER',
  routingOrder: 1,
  status: 'WAITING',
  delivery: 'EMAIL',
  authMethod: 'EMAIL_CODE',
  email: 'signer@example.test',
  hasAccessCode: false,
  ...extra,
});

const base = (extra: Partial<ReadinessInput> = {}): ReadinessInput => {
  const s = signer();
  return {
    documents: [{ id: randomUUID(), scanStatus: 'CLEAN' }],
    clientId: randomUUID(),
    engagementId: randomUUID(),
    recipients: [s],
    fields: [
      { id: randomUUID(), recipientId: s.id, type: 'SIGNATURE', required: true, mergeKey: null },
    ],
    missingMergeKeys: [],
    expiryDays: 30,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    consentPublished: true,
    ...extra,
  };
};
const codes = (input: ReadinessInput) => readiness(input).problems.map((p) => p.code);

describe('readiness', () => {
  it('is ready when nothing is missing', () => {
    expect(readiness(base())).toEqual({ ready: true, problems: [], autoSignaturePage: false });
  });

  it('flags the request-level problems', () => {
    expect(
      codes(
        base({
          documents: [],
          clientId: null,
          engagementId: null,
          recipients: [],
          fields: [],
          consentPublished: false,
        }),
      ),
    ).toEqual(['NO_DOCUMENTS', 'NO_CLIENT', 'NO_ENGAGEMENT', 'NO_SIGNERS', 'NO_CONSENT']);
  });

  it('flags files still being checked or blocked', () => {
    const pending = { id: randomUUID(), scanStatus: 'PENDING' as const };
    const infected = { id: randomUUID(), scanStatus: 'INFECTED' as const };
    const failed = { id: randomUUID(), scanStatus: 'FAILED' as const };
    const result = readiness(base({ documents: [pending, infected, failed] }));
    expect(result.problems.map((p) => [p.code, p.documentId])).toEqual([
      ['SCAN_PENDING', pending.id],
      ['SCAN_BLOCKED', infected.id],
      ['SCAN_BLOCKED', failed.id],
    ]);
  });

  it('flags recipients without contact, access code or approval', () => {
    const noEmail = signer({ email: null });
    const badEmail = signer({ email: 'not an email' });
    const portal = signer({ email: null, delivery: 'PORTAL' });
    const noCode = signer({ authMethod: 'ACCESS_CODE' });
    const approver = signer({ kind: 'APPROVER', status: 'WAITING' });
    const approved = signer({ kind: 'APPROVER', status: 'APPROVED' });
    const recipients = [noEmail, badEmail, portal, noCode, approver, approved];
    const result = readiness(base({ recipients, fields: [] }));
    expect(result.problems.map((p) => [p.code, p.recipientId])).toEqual([
      ['RECIPIENT_NO_CONTACT', noEmail.id],
      ['RECIPIENT_NO_CONTACT', badEmail.id],
      ['ACCESS_CODE_MISSING', noCode.id],
      ['APPROVAL_PENDING', approver.id],
    ]);
    expect(result.autoSignaturePage).toBe(true);
  });

  it('flags unassigned signatures, signers without fields and missing merge values', () => {
    const a = signer();
    const b = signer();
    const cc = signer({ kind: 'CC' });
    const loose = {
      id: randomUUID(),
      recipientId: null,
      type: 'SIGNATURE' as const,
      required: true,
      mergeKey: null,
    };
    const toCc = { ...loose, id: randomUUID(), recipientId: cc.id };
    const optional = { ...loose, id: randomUUID(), required: false };
    const merged = {
      id: randomUUID(),
      recipientId: null,
      type: 'TEXT' as const,
      required: false,
      mergeKey: 'CLIENT_PHONE' as const,
    };
    const mine = { ...loose, id: randomUUID(), recipientId: a.id };
    const result = readiness(
      base({
        recipients: [a, b, cc],
        fields: [loose, toCc, optional, merged, mine],
        // FIRM_PHONE is missing but no field uses it.
        missingMergeKeys: ['CLIENT_PHONE', 'CLIENT_PHONE', 'FIRM_PHONE'],
      }),
    );
    expect(result.problems.map((p) => [p.code, p.fieldId ?? p.recipientId ?? p.mergeKey])).toEqual([
      ['SIGNATURE_UNASSIGNED', loose.id],
      ['SIGNATURE_UNASSIGNED', toCc.id],
      ['SIGNER_NO_FIELDS', b.id],
      ['MERGE_MISSING', 'CLIENT_PHONE'],
    ]);
  });

  it('flags reminders that run past expiry', () => {
    expect(codes(base({ expiryDays: 9 }))).toEqual(['REMINDER_AFTER_EXPIRY']);
    expect(codes(base({ expiryDays: 10 }))).toEqual([]);
    expect(
      codes(base({ expiryDays: 2, reminders: { firstAfterDays: 3, everyDays: 3, max: 0 } })),
    ).toEqual([]);
    expect(remindersRunPastExpiry({ firstAfterDays: 7, everyDays: 1, max: 1 }, 7)).toBe(true);
  });
});

describe('routing', () => {
  it('sequential: the lowest open order, equal orders together', () => {
    const a = signer({ routingOrder: 1 });
    const b = signer({ routingOrder: 2 });
    const c = signer({ routingOrder: 2 });
    const d = signer({ routingOrder: 3 });
    const cc = signer({ kind: 'CC', routingOrder: 1 });
    expect(currentTurn('SEQUENTIAL', [d, c, b, a, cc])).toEqual([a.id]);
    a.status = 'SIGNED';
    expect(currentTurn('SEQUENTIAL', [a, b, c, d]).sort()).toEqual([b.id, c.id].sort());
    b.status = 'SIGNED';
    expect(currentTurn('SEQUENTIAL', [a, b, c, d])).toEqual([c.id]);
    c.status = 'SIGNED';
    expect(currentTurn('SEQUENTIAL', [a, b, c, d])).toEqual([d.id]);
    d.status = 'SIGNED';
    expect(currentTurn('SEQUENTIAL', [a, b, c, d])).toEqual([]);
  });

  it('parallel: every open signer; nobody once one declined', () => {
    const a = signer({ status: 'SIGNED' });
    const b = signer({ status: 'VIEWED' });
    const c = signer();
    expect(currentTurn('PARALLEL', [a, b, c])).toEqual([b.id, c.id]);
    c.status = 'DECLINED';
    expect(currentTurn('PARALLEL', [a, b, c])).toEqual([]);
    expect(currentTurn('SEQUENTIAL', [a, b, c])).toEqual([]);
  });

  it('flags every required field kind left without a signer', () => {
    const a = signer();
    const field = (type: 'INITIALS' | 'DATE_SIGNED' | 'ATTACHMENT') => ({
      id: randomUUID(),
      recipientId: randomUUID(), // a signer who was removed
      type,
      required: true,
      mergeKey: null,
    });
    const fields = [field('INITIALS'), field('DATE_SIGNED'), field('ATTACHMENT')];
    const mine = { ...fields[0]!, id: randomUUID(), recipientId: a.id };
    const result = readiness(base({ recipients: [a], fields: [...fields, mine] }));
    expect(result.problems.map((p) => [p.code, p.fieldId])).toEqual(
      fields.map((f) => ['SIGNATURE_UNASSIGNED', f.id]),
    );
  });

  it('needs no email or access code for an in-person signer', () => {
    const inPerson = signer({ delivery: 'IN_PERSON', email: null, authMethod: 'ACCESS_CODE' });
    expect(codes(base({ recipients: [inPerson], fields: [] }))).toEqual([]);
  });

  it('never moves an open request backwards', () => {
    const a = signer({ status: 'SENT' });
    const b = signer({ status: 'SENT' });
    expect(statusAfter([a, b], 'VIEWED')).toBe('VIEWED');
    expect(statusAfter([a, b], 'PARTIALLY_SIGNED')).toBe('PARTIALLY_SIGNED');
    a.status = 'DECLINED';
    expect(statusAfter([a, b], 'PARTIALLY_SIGNED')).toBe('DECLINED');
    expect(statusAfter([], 'VIEWED')).toBe('VIEWED');
  });

  it('moves the request status after each recipient change', () => {
    const a = signer({ status: 'SENT' });
    const b = signer({ status: 'WAITING', routingOrder: 2 });
    const approver = signer({ kind: 'APPROVER', status: 'APPROVED' });
    const all = [a, b, approver];
    expect(statusAfter(all, 'SENT')).toBe('SENT');
    a.status = 'DELIVERED';
    expect(statusAfter(all, 'SENT')).toBe('DELIVERED');
    a.status = 'VIEWED';
    expect(statusAfter(all, 'DELIVERED')).toBe('VIEWED');
    a.status = 'SIGNED';
    expect(statusAfter(all, 'VIEWED')).toBe('PARTIALLY_SIGNED');
    b.status = 'SIGNED';
    expect(statusAfter(all, 'PARTIALLY_SIGNED')).toBe('COMPLETED');
    b.status = 'DECLINED';
    expect(statusAfter(all, 'PARTIALLY_SIGNED')).toBe('DECLINED');
    for (const closed of ['DRAFT', 'NEEDS_APPROVAL', 'VOIDED', 'EXPIRED', 'COMPLETED'] as const) {
      expect(statusAfter(all, closed)).toBe(closed);
    }
  });
});

describe('timing', () => {
  const sentAt = new Date('2026-10-01T15:00:00Z');
  const expiresAt = new Date('2026-10-11T15:00:00Z');
  const reminders = { firstAfterDays: 3, everyDays: 2, max: 5 };

  it('schedules reminders until max or expiry', () => {
    const at = (sentCount: number) => nextReminderAt({ sentAt, reminders, sentCount, expiresAt });
    expect(at(0)).toEqual(new Date('2026-10-04T15:00:00Z'));
    expect(at(1)).toEqual(new Date('2026-10-06T15:00:00Z'));
    expect(at(3)).toEqual(new Date('2026-10-10T15:00:00Z'));
    // The fifth would fall on the expiry itself.
    expect(at(4)).toBeNull();
    expect(at(5)).toBeNull();
    expect(
      nextReminderAt({ sentAt, reminders: { ...reminders, max: 0 }, sentCount: 0, expiresAt }),
    ).toBeNull();
  });

  it('warns before expiry, unless that is before sending or off', () => {
    expect(expiryWarningAt({ sentAt, expiresAt, warningDays: 2 })).toEqual(
      new Date('2026-10-09T15:00:00Z'),
    );
    expect(expiryWarningAt({ sentAt, expiresAt, warningDays: 0 })).toBeNull();
    expect(expiryWarningAt({ sentAt, expiresAt, warningDays: 10 })).toBeNull();
  });

  it('allows Remind Now once an hour', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(canRemindNow(null, now)).toBe(true);
    expect(canRemindNow(new Date('2026-10-05T11:00:01Z'), now)).toBe(false);
    expect(canRemindNow(new Date('2026-10-05T11:00:00Z'), now)).toBe(true);
  });
});
