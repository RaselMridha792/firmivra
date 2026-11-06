import type { TxClient } from '@firmivra/db';
import { liveClient } from '../tasks/task-common.js';
import { AUDIT_EVENTS, clientTypes, loadAuditEvent } from './audit-events.js';
import { CONFIRMABLE_EVENTS } from './catalog.js';
import type { FieldValue } from './logic.js';

// The records an event can start a rule for. Each event reads the firm's own tables (the
// transaction's scope is the firm), puts what a condition can test into `fields`, and gives the
// date the timing is measured from (`at`) and the occurrence the run is keyed by, so the same
// event for the same record never starts a second run.

export interface Candidate {
  recordKind: string;
  recordId: string;
  clientId: string | null;
  label: string;
  /** The date a before or after timing is measured from. */
  at: Date | null;
  /** What makes this occurrence of the event: a due date, a start time. */
  occurrence: string;
  fields: Record<string, FieldValue>;
}

export interface Timing {
  timing: 'IMMEDIATE' | 'BEFORE' | 'AFTER' | 'SCHEDULED';
  offsetValue: number | null;
  offsetUnit: 'MINUTE' | 'HOUR' | 'DAY' | null;
}

export interface Scope {
  businessId: string;
  now: Date;
  /** The firm's day today (YYYY-MM-DD). */
  today: string;
  /** Records created before this are not new (an immediate event for new records). */
  since: Date;
  recordId?: string;
  limit?: number;
  /** AU-F30: a confirmable event's source (Manual confirmation when left out). */
  source?: 'INTEGRATION_VERIFIED' | 'MANUAL' | 'EITHER';
}

const UNIT_MS = { MINUTE: 60_000, HOUR: 3_600_000, DAY: 86_400_000 } as const;
const DAY = 86_400_000;
const LIMIT = 2_000;

/** Has the timing's moment come for a record whose reference date is `at`? */
export function timingHolds(t: Timing, at: Date | null, now: Date): boolean {
  if (t.timing === 'IMMEDIATE') return true;
  if (t.timing === 'SCHEDULED' || at === null || t.offsetValue === null || t.offsetUnit === null)
    return false;
  const offset = t.offsetValue * UNIT_MS[t.offsetUnit];
  return t.timing === 'BEFORE'
    ? now.getTime() >= at.getTime() - offset && now.getTime() <= at.getTime() + DAY
    : now.getTime() >= at.getTime() + offset;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const todayDate = (today: string) => new Date(`${today}T00:00:00.000Z`);
const daysBetween = (today: string, d: Date) =>
  Math.floor((Date.parse(`${today}T00:00:00Z`) - d.getTime()) / DAY);

const clientSelect = { id: true, accountType: true, displayName: true } as const;
/** A lead still being worked (R37's pipeline): not a draft and not closed. */
const OPEN_LEAD = [
  'SUBMITTED',
  'IN_REVIEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
] as const;

type Loader = (tx: TxClient, scope: Scope) => Promise<Candidate[]>;

const LOADERS: Record<string, Loader> = {
  'client.created': async (tx, s) => {
    const rows = await tx.client.findMany({
      where: {
        businessId: s.businessId,
        archivedAt: null,
        createdAt: { gte: s.since, lte: s.now },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        accountType: true,
        displayName: true,
        status: true,
        source: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: s.limit ?? LIMIT,
    });
    return rows.map((c) => ({
      recordKind: 'client',
      recordId: c.id,
      clientId: c.id,
      label: c.displayName,
      at: c.createdAt,
      occurrence: 'created',
      fields: { clientType: c.accountType, status: c.status, source: c.source },
    }));
  },
  'invoice.overdue': async (tx, s) => {
    const rows = await tx.invoice.findMany({
      where: {
        businessId: s.businessId,
        status: 'OPEN',
        dueOn: { lt: todayDate(s.today) },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        number: true,
        dueOn: true,
        totalCents: true,
        client: { select: clientSelect },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((i) => ({
      recordKind: 'invoice',
      recordId: i.id,
      clientId: i.client.id,
      label: i.number,
      at: i.dueOn,
      occurrence: i.dueOn ? dayOf(i.dueOn) : 'undated',
      fields: {
        clientType: i.client.accountType,
        totalCents: i.totalCents,
        daysOverdue: i.dueOn ? daysBetween(s.today, i.dueOn) : null,
      },
    }));
  },
  'deadline.approaching': async (tx, s) => {
    const rows = await tx.complianceDeadline.findMany({
      where: {
        businessId: s.businessId,
        archivedAt: null,
        status: { in: ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] },
        dueOn: { gte: todayDate(s.today) },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        name: true,
        dueOn: true,
        type: true,
        priority: true,
        client: { select: clientSelect },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((d) => ({
      recordKind: 'deadline',
      recordId: d.id,
      clientId: d.client.id,
      label: d.name,
      at: d.dueOn,
      occurrence: dayOf(d.dueOn),
      fields: { clientType: d.client.accountType, deadlineType: d.type, priority: d.priority },
    }));
  },
  'task.overdue': async (tx, s) => {
    const rows = await tx.task.findMany({
      where: {
        businessId: s.businessId,
        status: 'OPEN',
        archivedAt: null,
        dueOn: { lt: todayDate(s.today) },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        title: true,
        dueOn: true,
        priority: true,
        client: { select: clientSelect },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((t) => {
      // An OPEN task is never a draft, so it has its client.
      const client = liveClient(t.client);
      return {
        recordKind: 'task',
        recordId: t.id,
        clientId: client.id,
        label: t.title,
        at: t.dueOn,
        occurrence: t.dueOn ? dayOf(t.dueOn) : 'undated',
        fields: {
          clientType: client.accountType,
          priority: t.priority,
          daysOverdue: t.dueOn ? daysBetween(s.today, t.dueOn) : null,
        },
      };
    });
  },
  'appointment.upcoming': async (tx, s) => {
    const rows = await tx.appointment.findMany({
      where: {
        businessId: s.businessId,
        status: 'SCHEDULED',
        startsAt: { gte: s.now },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: { id: true, startsAt: true, locationKind: true, client: { select: clientSelect } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((a) => ({
      recordKind: 'appointment',
      recordId: a.id,
      clientId: a.client.id,
      label: 'Appointment',
      at: a.startsAt,
      occurrence: a.startsAt.toISOString(),
      fields: { clientType: a.client.accountType, locationKind: a.locationKind },
    }));
  },
  // AU-F09: an open lead's next follow-up (its type and time), before or after it.
  'lead.follow_up_due': async (tx, s) => {
    const rows = await tx.lead.findMany({
      where: {
        businessId: s.businessId,
        status: { in: [...OPEN_LEAD] },
        archivedAt: null,
        nextActionAt: { not: null },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        status: true,
        source: true,
        clientId: true,
        nextActionAt: true,
        nextActionType: true,
      },
      orderBy: [{ nextActionAt: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((l) => ({
      recordKind: 'lead',
      recordId: l.id,
      clientId: l.clientId,
      label: `${l.firstName} ${l.lastName}`.trim(),
      at: l.nextActionAt,
      occurrence: l.nextActionAt!.toISOString(),
      fields: { stage: l.status, source: l.source, followUpType: l.nextActionType },
    }));
  },
  // AU-F10: a form the client hasn't finished, by its due date.
  'intake.due': async (tx, s) => {
    const rows = await tx.intake.findMany({
      where: {
        businessId: s.businessId,
        status: { in: ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'] },
        dueOn: { not: null },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        status: true,
        dueOn: true,
        form: { select: { title: true } },
        engagement: { select: { clientId: true, client: { select: { accountType: true } } } },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((i) => ({
      recordKind: 'intake',
      recordId: i.id,
      clientId: i.engagement?.clientId ?? null,
      label: i.form.title,
      at: i.dueOn,
      occurrence: dayOf(i.dueOn!),
      fields: { clientType: i.engagement?.client.accountType ?? null, status: i.status },
    }));
  },
  // AU-F11: a document request still open (not submitted or completed), by its due date.
  'document.request_due': async (tx, s) => {
    const rows = await tx.documentRequestPacket.findMany({
      where: {
        businessId: s.businessId,
        status: 'OPEN',
        dueOn: { not: null },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: { id: true, title: true, dueOn: true, clientId: true },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    const types = await clientTypes(
      tx,
      s.businessId,
      rows.map((p) => p.clientId),
    );
    return rows.map((p) => ({
      recordKind: 'document_request',
      recordId: p.id,
      clientId: p.clientId,
      label: p.title,
      at: p.dueOn,
      occurrence: dayOf(p.dueOn!),
      fields: { clientType: types.get(p.clientId) ?? null },
    }));
  },
  // AU-F12: a return not yet transmitted, by its filing due date.
  'tax_return.due': async (tx, s) => {
    const rows = await tx.taxReturn.findMany({
      where: {
        businessId: s.businessId,
        archivedAt: null,
        dueOn: { not: null },
        workflowStatus: {
          in: [
            'IN_PREPARATION',
            'WAITING_ON_CLIENT',
            'READY_FOR_REVIEW',
            'READY_FOR_SIGNATURE',
            'READY_TO_FILE',
          ],
        },
        ...(s.recordId ? { id: s.recordId } : {}),
      },
      select: {
        id: true,
        clientId: true,
        taxYear: true,
        formType: true,
        workflowStatus: true,
        dueOn: true,
        client: { select: { accountType: true } },
      },
      orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
      take: s.limit ?? LIMIT,
    });
    return rows.map((r) => ({
      recordKind: 'tax_return',
      recordId: r.id,
      clientId: r.clientId,
      label: `${r.formType ?? 'Tax return'} ${r.taxYear}`,
      at: r.dueOn,
      occurrence: dayOf(r.dueOn!),
      fields: {
        clientType: r.client.accountType,
        workflowStatus: r.workflowStatus,
        taxYear: r.taxYear,
      },
    }));
  },
  // AU-F30 to F32: the external outcomes members confirmed (automation_event_confirmations).
  ...Object.fromEntries(
    CONFIRMABLE_EVENTS.map((e) => [
      e.code,
      (tx: TxClient, s: Scope) => loadConfirmed(tx, e.code, s),
    ]),
  ),
  // AU-F08 to F14: the changes the source modules record in their audit log.
  ...Object.fromEntries(
    Object.entries(AUDIT_EVENTS).map(([code, spec]) => [
      code,
      (tx: TxClient, s: Scope) => loadAuditEvent(tx, spec, s),
    ]),
  ),
};

/**
 * The occurrences members confirmed for a confirmable event. Each row is one occurrence, keyed as
 * the engine keys runs, so provider evidence added to it later (AU-F32) never starts a second run.
 * Integration verified counts only rows with provider evidence, from when it arrived.
 */
async function loadConfirmed(tx: TxClient, event: string, s: Scope): Promise<Candidate[]> {
  const verifiedOnly = s.source === 'INTEGRATION_VERIFIED';
  const rows = await tx.automationEventConfirmation.findMany({
    where: {
      businessId: s.businessId,
      eventCode: event,
      ...(s.recordId ? { recordId: s.recordId } : {}),
      ...(verifiedOnly
        ? { providerVerifiedAt: { gte: s.since, lte: s.now } }
        : { confirmedAt: { gte: s.since, lte: s.now } }),
    },
    select: {
      recordKind: true,
      recordId: true,
      occurrenceKey: true,
      clientId: true,
      confirmedAt: true,
      providerVerifiedAt: true,
      client: { select: { displayName: true, accountType: true } },
    },
    orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
    take: s.limit ?? LIMIT,
  });
  return rows.map((r) => ({
    recordKind: r.recordKind,
    recordId: r.recordId,
    clientId: r.clientId,
    label: r.client?.displayName ?? r.recordKind,
    at: verifiedOnly ? r.providerVerifiedAt : r.confirmedAt,
    occurrence: r.occurrenceKey.slice(`${event}:${r.recordId}:`.length),
    fields: { clientType: r.client?.accountType ?? null },
  }));
}

/** The events that have a loader: every event in the catalog must be one (no event without a source). */
export const LOADED_EVENTS: ReadonlySet<string> = new Set(Object.keys(LOADERS));

/** The candidates an event has now whose timing has come (conditions are tested by the caller). */
export async function loadCandidates(
  tx: TxClient,
  event: string,
  timing: Timing,
  scope: Scope,
): Promise<Candidate[]> {
  const load = LOADERS[event];
  if (!load) return [];
  const rows = await load(tx, scope);
  return rows.filter((c) => timingHolds(timing, c.at, scope.now));
}

/** What an action needs to write its words: the client's name and the record's label. */
export async function loadRecordContext(
  tx: TxClient,
  businessId: string,
  clientId: string | null,
): Promise<{ clientName: string; clientFirstName: string; accountType: string | null } | null> {
  if (!clientId) return null;
  const c = await tx.client.findFirst({
    where: { businessId, id: clientId },
    select: { displayName: true, accountType: true, profile: { select: { firstName: true } } },
  });
  if (!c) return null;
  return {
    clientName: c.displayName,
    clientFirstName: c.profile?.firstName ?? c.displayName.split(' ')[0] ?? c.displayName,
    accountType: c.accountType,
  };
}
