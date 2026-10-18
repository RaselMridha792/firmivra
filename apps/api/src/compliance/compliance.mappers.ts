import type { Prisma, ScopedClient, TxClient } from '@firmivra/db';
import type {
  ComplianceAtRisk,
  ComplianceClientRef,
  ComplianceDeadline,
  ComplianceDeadlineRow,
  ComplianceSettings,
  MemberRef,
} from '@firmivra/types';
import type { ClientsActor } from '../clients/clients.service.js';
import { memberNames } from '../workspaces/common.js';
import {
  addDays,
  daysBetween,
  day,
  displayStatusOf,
  effectiveDue,
  errors,
  isoDay,
  OPEN_STATUSES,
} from './compliance.shared.js';

export type ComplianceActor = ClientsActor;
export type Db = TxClient;

/** The firm's request-scoped client, typed as the transaction client the helpers take. */
export const txOf = (db: ScopedClient): TxClient => db as unknown as TxClient;

/** Owner and Admin; Staff and the five newer roles are scoped to their assigned clients. */
export const isManager = (actor: ComplianceActor): boolean => actor.role !== 'STAFF';

/** The extra `where` that limits a Staff member to the deadlines of clients assigned to them. */
export const reachWhere = (actor: ComplianceActor): Prisma.ComplianceDeadlineWhereInput =>
  isManager(actor) ? {} : { client: { assignedUserId: actor.userId.toLowerCase() } };

/** The extra `where` on clients for the same limit. */
export const clientReach = (actor: ComplianceActor): Prisma.ClientWhereInput =>
  isManager(actor) ? {} : { assignedUserId: actor.userId.toLowerCase() };

export const iso = (d: Date | null): string | null => d?.toISOString() ?? null;
export const toTime = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(`1970-01-01T${value}:00.000Z`);
const timeOf = (d: Date | null): string | null => (d ? d.toISOString().slice(11, 16) : null);

export const clientRefSelect = {
  id: true,
  displayName: true,
  clientNumber: true,
  accountType: true,
} satisfies Prisma.ClientSelect;

export const toClientRef = (c: {
  id: string;
  displayName: string;
  clientNumber: number;
  accountType: string;
}): ComplianceClientRef => ({
  id: c.id,
  displayName: c.displayName,
  clientNumber: c.clientNumber,
  accountType: c.accountType === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
});

export const memberRefOf = (names: Map<string, string>, id: string | null): MemberRef | null => {
  const name = id ? names.get(id) : undefined;
  return id && name !== undefined ? { userId: id, name } : null;
};

export const rowSelect = {
  id: true,
  name: true,
  type: true,
  source: true,
  agency: true,
  dueOn: true,
  dueTime: true,
  extendedDueOn: true,
  status: true,
  priority: true,
  taxYear: true,
  filingPeriod: true,
  relatedForm: true,
  state: true,
  recurrenceId: true,
  archivedAt: true,
  client: { select: clientRefSelect },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.ComplianceDeadlineSelect;

export type DeadlineRowData = Prisma.ComplianceDeadlineGetPayload<{ select: typeof rowSelect }>;

export function toRow(d: DeadlineRowData, today: Date, dueSoonDays: number): ComplianceDeadlineRow {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    source: d.source,
    agency: d.agency,
    client: toClientRef(d.client),
    dueOn: day(d.dueOn) as string,
    dueTime: timeOf(d.dueTime),
    extendedDueOn: day(d.extendedDueOn),
    status: d.status,
    displayStatus: displayStatusOf(d, today, dueSoonDays),
    daysUntilDue: daysBetween(today, effectiveDue(d)),
    priority: d.priority,
    assignedTo: d.assignedMember
      ? { userId: d.assignedMember.userId, name: d.assignedMember.user.name }
      : null,
    taxYear: d.taxYear,
    filingPeriod: d.filingPeriod,
    relatedForm: d.relatedForm,
    state: d.state,
    recurring: d.recurrenceId !== null,
    archived: d.archivedAt !== null,
  };
}

export const detailInclude = {
  client: { select: clientRefSelect },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
  calendarEntry: {
    select: {
      id: true,
      name: true,
      calendar: {
        select: {
          id: true,
          name: true,
          authority: true,
          effectiveYear: true,
          version: true,
          sourceUrl: true,
          verifiedAt: true,
        },
      },
    },
  },
  recurrence: { select: { id: true, name: true } },
  reminders: { orderBy: { daysBefore: 'desc' } },
  documents: {
    orderBy: { createdAt: 'asc' },
    select: {
      documentId: true,
      createdAt: true,
      document: { select: { fileName: true } },
    },
  },
  tasks: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      status: true,
      dueOn: true,
      assignedMember: { select: { userId: true, user: { select: { name: true } } } },
    },
  },
  links: {
    select: {
      relatedDeadline: {
        select: { id: true, name: true, dueOn: true, extendedDueOn: true, status: true },
      },
    },
  },
  linkedFrom: {
    select: {
      deadline: {
        select: { id: true, name: true, dueOn: true, extendedDueOn: true, status: true },
      },
    },
  },
} satisfies Prisma.ComplianceDeadlineInclude;

export type DeadlineDetailData = Prisma.ComplianceDeadlineGetPayload<{
  include: typeof detailInclude;
}>;

/** The detail of one deadline (the fields of the row, plus everything Frame 2 shows). */
export async function toDetail(
  db: Db,
  businessId: string,
  d: DeadlineDetailData,
  settings: ComplianceSettings,
  now = new Date(),
): Promise<ComplianceDeadline> {
  const today = new Date(`${isoDay(now)}T00:00:00.000Z`);
  const names = await memberNames(db as TxClient, businessId, [
    d.createdByUserId,
    d.completedByUserId,
  ]);
  const entryCalendar = d.calendarEntry?.calendar;
  const staleBefore = addDays(today, -settings.staleCalendarDays);
  const related = [
    ...d.links.map((l) => l.relatedDeadline),
    ...d.linkedFrom.map((l) => l.deadline),
  ].sort((a, b) => a.dueOn.getTime() - b.dueOn.getTime() || a.name.localeCompare(b.name));
  return {
    ...toRow(d, today, settings.dueSoonDays),
    description: d.description,
    internalNotes: d.internalNotes,
    clientNotes: d.clientNotes,
    engagementId: d.engagementId,
    entityType: d.entityType,
    jurisdiction: d.jurisdiction,
    statutoryDueOn: day(d.statutoryDueOn),
    dueOverridden: d.dueOverridden,
    dueOverrideReason: d.dueOverrideReason,
    extensionFiledOn: day(d.extensionFiledOn),
    paymentDueOn: day(d.paymentDueOn),
    clientVisible: d.clientVisible,
    createTask: d.createTask,
    taskTemplateId: d.taskTemplateId,
    completedAt: iso(d.completedAt),
    completedBy: memberRefOf(names, d.completedByUserId),
    filedOn: day(d.filedOn),
    confirmationNumber: d.confirmationNumber,
    notApplicableReason: d.notApplicableReason,
    calendarEntry:
      d.calendarEntry && entryCalendar
        ? {
            id: d.calendarEntry.id,
            name: d.calendarEntry.name,
            calendarId: entryCalendar.id,
            calendarName: entryCalendar.name,
            authority: entryCalendar.authority,
            effectiveYear: entryCalendar.effectiveYear,
            version: entryCalendar.version,
            sourceUrl: entryCalendar.sourceUrl,
            verifiedAt: iso(entryCalendar.verifiedAt),
          }
        : null,
    applicabilityReason: d.applicabilityReason,
    recurrence: d.recurrence,
    createdBy: memberRefOf(names, d.createdByUserId),
    reminders: d.reminders.map((r) => ({
      daysBefore: r.daysBefore,
      inApp: r.inApp,
      channels: r.channels,
    })),
    documents: d.documents.map((x) => ({
      documentId: x.documentId,
      fileName: x.document.fileName,
      addedAt: x.createdAt.toISOString(),
    })),
    tasks: d.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueOn: day(t.dueOn),
      assignedTo: t.assignedMember
        ? { userId: t.assignedMember.userId, name: t.assignedMember.user.name }
        : null,
    })),
    relatedDeadlines: related.map((r) => ({
      id: r.id,
      name: r.name,
      dueOn: day(r.dueOn) as string,
      displayStatus: displayStatusOf(r, today, settings.dueSoonDays),
    })),
    calendarStale:
      !!entryCalendar && (!entryCalendar.verifiedAt || entryCalendar.verifiedAt < staleBefore),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    archivedAt: iso(d.archivedAt),
  };
}

/** The deadline a request names, when the caller reaches it; 404 otherwise. */
export async function findDeadline(db: Db, businessId: string, actor: ComplianceActor, id: string) {
  const row = await db.complianceDeadline.findFirst({
    where: { AND: [{ businessId, id }, reachWhere(actor)] },
    include: detailInclude,
  });
  if (!row) throw errors.notFound();
  return row;
}

export const DEFAULT_SETTINGS: ComplianceSettings = {
  dueSoonDays: 14,
  atRiskDays: 7,
  staleCalendarDays: 90,
  defaultReminders: [],
  sendPastDueNotice: false,
  escalateToManager: false,
  escalateAfterDays: 3,
  taskTemplates: [],
};

/** The firm's settings, or the defaults while it has never saved any. */
export async function loadSettings(db: Db, businessId: string): Promise<ComplianceSettings> {
  const row = await db.complianceSettings.findUnique({ where: { businessId } });
  if (!row) return DEFAULT_SETTINGS;
  return {
    dueSoonDays: row.dueSoonDays,
    atRiskDays: row.atRiskDays,
    staleCalendarDays: row.staleCalendarDays,
    defaultReminders: remindersOf(row.defaultReminders),
    sendPastDueNotice: row.sendPastDueNotice,
    escalateToManager: row.escalateToManager,
    escalateAfterDays: row.escalateAfterDays,
    taskTemplates: Object.entries((row.taskTemplates ?? {}) as Record<string, string>)
      .map(
        ([type, taskTemplateId]) =>
          ({ type, taskTemplateId }) as ComplianceSettings['taskTemplates'][number],
      )
      .sort((a, b) => a.type.localeCompare(b.type)),
  };
}

/** Reminder rules stored as JSON (settings and recurrences), read defensively. */
export function remindersOf(value: unknown): ComplianceSettings['defaultReminders'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    const x = r as { daysBefore?: unknown; inApp?: unknown; channels?: unknown };
    if (typeof x.daysBefore !== 'number') return [];
    return [
      {
        daysBefore: x.daysBefore,
        inApp: x.inApp !== false,
        channels: Array.isArray(x.channels)
          ? (x.channels.filter((c) => c === 'EMAIL' || c === 'SMS') as ('EMAIL' | 'SMS')[])
          : [],
      },
    ];
  });
}

// ---------- Risk ----------

export interface RiskInput {
  clientId: string;
  client: ComplianceClientRef;
  status: string;
  priority: string;
  dueOn: Date;
  extendedDueOn: Date | null;
}

/**
 * Clients at risk: an open deadline is overdue, or a high-priority one or one waiting on the
 * client is due within the firm's At Risk days. Returns the clients with their reasons, the most
 * overdue first.
 */
export function atRiskClients(
  rows: readonly RiskInput[],
  today: Date,
  atRiskDays: number,
): ComplianceAtRisk[] {
  const byClient = new Map<string, ComplianceAtRisk>();
  for (const r of rows) {
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status)) continue;
    const days = daysBetween(today, effectiveDue(r));
    const entry = byClient.get(r.clientId) ?? {
      client: r.client,
      overdueCount: 0,
      highPriorityUpcomingCount: 0,
      waitingOnClientCount: 0,
      nextDueOn: null,
    };
    if (days < 0) entry.overdueCount += 1;
    else if (days <= atRiskDays) {
      if (r.priority === 'HIGH') entry.highPriorityUpcomingCount += 1;
      if (r.status === 'WAITING_ON_CLIENT') entry.waitingOnClientCount += 1;
    }
    const due = day(effectiveDue(r));
    if (days >= 0 && (entry.nextDueOn === null || due! < entry.nextDueOn)) entry.nextDueOn = due;
    byClient.set(r.clientId, entry);
  }
  return [...byClient.values()]
    .filter(
      (c) => c.overdueCount > 0 || c.highPriorityUpcomingCount > 0 || c.waitingOnClientCount > 0,
    )
    .sort(
      (a, b) =>
        b.overdueCount - a.overdueCount ||
        b.highPriorityUpcomingCount +
          b.waitingOnClientCount -
          (a.highPriorityUpcomingCount + a.waitingOnClientCount) ||
        a.client.displayName.localeCompare(b.client.displayName),
    );
}
