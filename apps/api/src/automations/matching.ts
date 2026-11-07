import { zonedDate } from '../appointments/calendar.js';
import type { TxClient } from '@firmivra/db';
import { liveClient } from '../tasks/task-common.js';
import { AUDIT_EVENTS, clientTypes, loadAuditEvent, providerName } from './audit-events.js';
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
  /** The firm's time zone: a moment's day (a client added, an appointment) is the firm's day. */
  timezone?: string;
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
/** A moment's day in the firm's time zone (UTC when the scope has none). */
const dayIn = (s: Scope, d: Date | null) =>
  d ? (s.timezone ? zonedDate(s.timezone, d.getTime()) : dayOf(d)) : null;
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
        assignedUserId: true,
        tags: { select: { tagId: true } },
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
      fields: {
        clientType: c.accountType,
        status: c.status,
        source: c.source,
        tags: c.tags.map((t) => t.tagId),
        assignedUserId: c.assignedUserId,
      },
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
    // What was paid (online and offline), as Invoices counts it (app_invoice_paid_cents).
    const paid = new Map(
      rows.length === 0
        ? []
        : (
            await tx.$queryRaw<{ id: string; paid: bigint | number }[]>`
              SELECT id::text AS id, app_invoice_paid_cents(id) AS paid FROM invoices
              WHERE business_id = ${s.businessId}::uuid
                AND id = ANY(${rows.map((i) => i.id)}::uuid[])`
          ).map((p) => [p.id, Number(p.paid)]),
    );
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
        balanceCents: Math.max(i.totalCents - (paid.get(i.id) ?? 0), 0),
        paymentStatus: (paid.get(i.id) ?? 0) > 0 ? 'PARTLY_PAID' : 'UNPAID',
        daysOverdue: i.dueOn ? daysBetween(s.today, i.dueOn) : null,
        dueOn: i.dueOn ? dayOf(i.dueOn) : null,
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
        status: true,
        jurisdiction: true,
        taxYear: true,
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
      fields: {
        clientType: d.client.accountType,
        deadlineType: d.type,
        priority: d.priority,
        deadlineStatus: d.status,
        jurisdiction: d.jurisdiction,
        taxYear: d.taxYear,
        dueOn: dayOf(d.dueOn),
      },
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
        progress: true,
        assignedUserId: true,
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
          taskProgress: t.progress,
          taskAssignedUserId: t.assignedUserId,
          dueOn: t.dueOn ? dayOf(t.dueOn) : null,
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
      select: {
        id: true,
        startsAt: true,
        locationKind: true,
        typeId: true,
        confirmedAt: true,
        service: { select: { kind: true } },
        client: { select: clientSelect },
      },
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
      fields: {
        clientType: a.client.accountType,
        locationKind: a.locationKind,
        appointmentTypeId: a.typeId,
        confirmation: a.confirmedAt ? 'CONFIRMED' : 'PENDING',
        serviceKind: a.service?.kind ?? null,
        startsOn: dayIn(s, a.startsAt),
      },
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
        assignedUserId: true,
        tags: { select: { tagId: true } },
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
      fields: {
        stage: l.status,
        source: l.source,
        followUpType: l.nextActionType,
        tags: l.tags.map((t) => t.tagId),
        assignedUserId: l.assignedUserId,
      },
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
        engagement: {
          select: {
            clientId: true,
            client: { select: { accountType: true } },
            service: { select: { kind: true } },
          },
        },
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
      fields: {
        clientType: i.engagement?.client.accountType ?? null,
        status: i.status,
        serviceKind: i.engagement?.service.kind ?? null,
        dueOn: dayOf(i.dueOn!),
      },
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
      select: {
        id: true,
        title: true,
        dueOn: true,
        clientId: true,
        engagement: { select: { service: { select: { kind: true } } } },
      },
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
      fields: {
        clientType: types.get(p.clientId) ?? null,
        serviceKind: p.engagement.service.kind,
        dueOn: dayOf(p.dueOn!),
      },
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
        dueOn: dayOf(r.dueOn!),
      },
    }));
  },
  // AU-F20: the firm's syncs with a provider that finished, one occurrence per sync run.
  'integration.sync_completed': (tx, s) => syncRuns(tx, s, ['SUCCEEDED', 'PARTIAL']),
  'integration.sync_failed': (tx, s) => syncRuns(tx, s, ['FAILED']),
  'integration.reauthorization_needed': (tx, s) => syncRuns(tx, s, ['FAILED'], REAUTHORIZE),
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
  return withClientContext(
    tx,
    scope,
    rows.filter((c) => timingHolds(timing, c.at, scope.now)),
  );
}

/**
 * AU-F22: each candidate's client, in one read of the firm's clients: its status, tags, assigned
 * member, state, the day it was added and its last recorded activity. The event's own fields win
 * (a client's own event already has its status, tags and assignee under their usual names).
 */
async function withClientContext(tx: TxClient, s: Scope, rows: Candidate[]): Promise<Candidate[]> {
  const ids = [...new Set(rows.flatMap((c) => (c.clientId ? [c.clientId] : [])))];
  if (ids.length === 0) return rows;
  const clients = await tx.client.findMany({
    where: { businessId: s.businessId, id: { in: ids } },
    select: {
      id: true,
      status: true,
      assignedUserId: true,
      createdAt: true,
      lastActivityAt: true,
      tags: { select: { tagId: true } },
      profile: { select: { state: true } },
    },
  });
  const byId = new Map(clients.map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = r.clientId ? byId.get(r.clientId) : undefined;
    if (!c) return r;
    return {
      ...r,
      fields: {
        clientStatus: c.status,
        clientTags: c.tags.map((t) => t.tagId),
        clientAssignedUserId: c.assignedUserId,
        clientState: c.profile?.state?.toUpperCase() ?? null,
        clientCreatedOn: dayIn(s, c.createdAt),
        clientLastActivityOn: dayIn(s, c.lastActivityAt),
        ...r.fields,
      },
    };
  });
}

/** The sync errors only a new authorization fixes (integrations.service.ts marks them too). */
const REAUTHORIZE = ['authorization_expired', 'authorization_revoked', 'permission_missing'];

/**
 * Sync runs that finished (Integrations' own worker sets the status and the time), not a connection
 * test or a webhook delivery, which are runs of their own kind.
 */
async function syncRuns(
  tx: TxClient,
  s: Scope,
  statuses: ('SUCCEEDED' | 'PARTIAL' | 'FAILED')[],
  errorCodes?: string[],
): Promise<Candidate[]> {
  const rows = await tx.integrationSyncRun.findMany({
    where: {
      businessId: s.businessId,
      status: { in: statuses },
      entity: { notIn: ['test', 'webhook'] },
      finishedAt: { gte: s.since, lte: s.now },
      ...(errorCodes ? { errorCode: { in: errorCodes } } : {}),
      ...(s.recordId ? { connectionId: s.recordId } : {}),
    },
    select: {
      id: true,
      connectionId: true,
      status: true,
      finishedAt: true,
      connection: { select: { provider: true } },
    },
    orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
    take: s.limit ?? LIMIT,
  });
  return rows.map((r) => ({
    recordKind: 'integration_connection',
    recordId: r.connectionId,
    clientId: null,
    label: providerName(r.connection.provider),
    at: r.finishedAt,
    occurrence: r.id,
    fields: { provider: r.connection.provider, syncStatus: r.status },
  }));
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
