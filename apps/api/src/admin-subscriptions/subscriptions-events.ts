import {
  type PlatformSubscriptionChangeKind,
  type SubscriptionEvent,
  type SubscriptionEventAction,
  type SubscriptionNote,
  SubscriptionStatus,
} from '@firmivra/types';
import { currentNote, splitEventNote } from './subscriptions-math.js';

// The detail panel's events and notes, from the history rows (`platform_subscription_changes`) and
// this module's audit rows with their B4 investigation notes (docs/work/R60-subscriptions.md,
// "Subscriptions API"). Pure: the service reads the rows, this words nothing and decides the shape.

/** The actions no change kind fits: an audit row of this module is the event. */
export const AUDIT_EVENTS = [
  'TRIAL_EXTENDED',
  'LOCATIONS_CHANGED',
  'PRICE_CHANGED',
  'BILLING_DATE_CHANGED',
  'CANCEL_REVERSED',
  'NOTE_ADDED',
  'EXPORTED',
] as const satisfies readonly SubscriptionEventAction[];
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

/** The audit action of each write (`subscription.<verb>`). */
export const ACTIONS = {
  created: 'subscription.created',
  planChanged: 'subscription.plan_changed',
  seatsChanged: 'subscription.seats_changed',
  locationsChanged: 'subscription.locations_changed',
  trialExtended: 'subscription.trial_extended',
  converted: 'subscription.converted',
  autoRenewOff: 'subscription.auto_renew_off',
  cancellationReversed: 'subscription.cancellation_reversed',
  suspended: 'subscription.suspended',
  reactivated: 'subscription.reactivated',
  priceChanged: 'subscription.price_changed',
  billingDateChanged: 'subscription.billing_date_changed',
  closed: 'subscription.closed',
  noteAdded: 'subscription.note_added',
  exported: 'subscription.exported',
} as const;

export interface ChangeRow {
  id: string;
  kind: PlatformSubscriptionChangeKind;
  fromPlanId: string | null;
  toPlanId: string | null;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus | null;
  fromSeats: number | null;
  toSeats: number | null;
  mrrCents: number | null;
  reason: string | null;
  effectiveAt: Date;
  changedByUserId: string | null;
}
export interface AuditRow {
  id: string;
  action: string;
  actorUserId: string | null;
  metadata: unknown;
  createdAt: Date;
}
export interface NoteRow {
  id: string;
  auditLogId: string;
  authorUserId: string;
  body: string;
  supersedesNoteId: string | null;
  retractedAt: Date | null;
  createdAt: Date;
}

const meta = (row: AuditRow): Record<string, unknown> =>
  row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const dayIn = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
const statusIn = (v: unknown) => SubscriptionStatus.safeParse(v).data ?? null;
const auditEventOf = (row: AuditRow): AuditEvent | null => {
  const event = meta(row).event;
  return AUDIT_EVENTS.find((e) => e === event) ?? null;
};
const byAge = (a: NoteRow, b: NoteRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** The current note on each audit row (the first one written on it, as B4 edits left it). */
export function notesByRow(notes: readonly NoteRow[]): Map<string, NoteRow> {
  const grouped = new Map<string, NoteRow[]>();
  for (const n of notes) grouped.set(n.auditLogId, [...(grouped.get(n.auditLogId) ?? []), n]);
  const out = new Map<string, NoteRow>();
  for (const [rowId, list] of grouped) {
    const note = currentNote(list, byAge);
    if (note) out.set(rowId, note);
  }
  return out;
}

/**
 * History and audit events, newest first (at most `limit`). A history row's money is on the audit
 * row of the change that wrote it (`changeIds`, `amountCents`); an audit-only event carries its own
 * fields in its metadata and its reason in its note.
 */
export function eventsOf(input: {
  changes: readonly ChangeRow[];
  audits: readonly AuditRow[];
  notes: ReadonlyMap<string, NoteRow>;
  planName: (planId: string | null) => string | null;
  nameOf: (userId: string | null) => string;
  limit?: number;
}): SubscriptionEvent[] {
  const { changes, audits, notes, planName, nameOf } = input;
  const amountOf = new Map<string, number | null>();
  for (const a of audits) {
    const m = meta(a);
    if (!Array.isArray(m.changeIds)) continue;
    // A change that wrote two rows (a new plan and a new cycle) shows its money once, on the first.
    m.changeIds.forEach((id, i) => {
      if (typeof id === 'string') amountOf.set(id, i === 0 ? int(m.amountCents) : null);
    });
  }
  const actor = (userId: string | null) => ({
    kind: userId ? ('USER' as const) : ('SYSTEM' as const),
    name: nameOf(userId),
  });
  const blank = {
    fromPlan: null,
    toPlan: null,
    fromStatus: null,
    toStatus: null,
    fromSeats: null,
    toSeats: null,
    fromLocations: null,
    toLocations: null,
    fromDay: null,
    toDay: null,
    fromCents: null,
    toCents: null,
    reason: null,
    approvedBy: null,
    amountCents: null,
    mrrCents: null,
  };
  const events: SubscriptionEvent[] = changes.map((c) => ({
    ...blank,
    id: c.id,
    source: 'CHANGE',
    action: c.kind,
    at: c.effectiveAt.toISOString(),
    actor: actor(c.changedByUserId),
    fromPlan: planName(c.fromPlanId),
    toPlan: planName(c.toPlanId),
    fromStatus: c.fromStatus,
    toStatus: c.toStatus,
    fromSeats: c.fromSeats,
    toSeats: c.toSeats,
    reason: c.reason,
    amountCents: amountOf.get(c.id) ?? null,
    mrrCents: c.mrrCents,
  }));
  for (const a of audits) {
    const action = auditEventOf(a);
    if (!action) continue;
    const m = meta(a);
    const note = action === 'NOTE_ADDED' ? null : (notes.get(a.id)?.body ?? null);
    const { reason, approvedBy } = splitEventNote(note);
    events.push({
      ...blank,
      id: a.id,
      source: 'AUDIT',
      action,
      at: a.createdAt.toISOString(),
      actor: actor(a.actorUserId),
      fromStatus: statusIn(m.fromStatus),
      toStatus: statusIn(m.toStatus),
      fromLocations: int(m.fromLocations),
      toLocations: int(m.toLocations),
      fromDay: dayIn(m.fromDay),
      toDay: dayIn(m.toDay),
      fromCents: int(m.fromCents),
      toCents: int(m.toCents),
      reason,
      approvedBy: action === 'PRICE_CHANGED' ? approvedBy : null,
      amountCents: int(m.amountCents),
      mrrCents: int(m.mrrCents),
    });
  }
  return events
    .sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id))
    .slice(0, input.limit ?? 500);
}

/** The internal notes (NOTE_ADDED audit rows with their current note), newest first. */
export function subscriptionNotesOf(
  audits: readonly AuditRow[],
  notes: ReadonlyMap<string, NoteRow>,
  nameOf: (userId: string | null) => string,
): SubscriptionNote[] {
  return audits
    .filter((a) => auditEventOf(a) === 'NOTE_ADDED')
    .flatMap((a) => {
      const note = notes.get(a.id);
      return note
        ? [
            {
              id: note.id,
              body: note.body,
              author: nameOf(note.authorUserId),
              createdAt: note.createdAt.toISOString(),
            },
          ]
        : [];
    })
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id));
}

/** The suspension's kind as its latest `subscription.suspended` audit row kept it, if any. */
export function keptSuspensionKind(audits: readonly AuditRow[]): unknown {
  const latest = [...audits]
    .filter((a) => a.action === ACTIONS.suspended)
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
  return latest ? meta(latest).kind : undefined;
}
