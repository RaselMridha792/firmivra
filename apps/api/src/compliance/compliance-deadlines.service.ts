import { Injectable } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  ClientCompliance,
  ComplianceAtRiskList,
  ComplianceByClientPage,
  ComplianceByClientQuery,
  ComplianceCalendarMonth,
  ComplianceCalendarMonthQuery,
  ComplianceClientTotals,
  ComplianceDateRange,
  ComplianceDeadline,
  ComplianceDeadlinePage,
  ComplianceDeadlinesQuery,
  ComplianceSummary,
  ClientComplianceQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { TenantPrisma } from '../database/database.module.js';
import {
  atRiskClients,
  type ComplianceActor,
  clientReach,
  findDeadline,
  loadSettings,
  reachWhere,
  rowSelect,
  toClientRef,
  toDetail,
  toRow,
  txOf,
} from './compliance.mappers.js';
import {
  addDays,
  changePercent,
  CLOSED_STATUSES,
  csvRow,
  day,
  displayStatusOf,
  displayStatusWhere,
  dueBetween,
  effectiveDue,
  errors,
  isoDay,
  OPEN_STATUSES,
  overdueWhere,
  parseDay,
  percent,
  todayOf,
} from './compliance.shared.js';

type ListQuery = z.output<typeof ComplianceDeadlinesQuery>;
type Where = Prisma.ComplianceDeadlineWhereInput;

/** The most deadlines one overview or grouping reads (a firm's open obligations are far fewer). */
const READ_CAP = 20_000;
const EXPORT_CAP = 10_000;
const CALENDAR_CAP = 1_000;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** The `from` and `to` days of a named range (null: no limit on that side). */
function rangeOf(range: ComplianceDateRange, today: Date): { from: Date | null; to: Date | null } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (range) {
    case 'NEXT_7_DAYS':
      return { from: today, to: addDays(today, 7) };
    case 'NEXT_30_DAYS':
      return { from: today, to: addDays(today, 30) };
    case 'NEXT_90_DAYS':
      return { from: today, to: addDays(today, 90) };
    case 'PAST_30_DAYS':
      return { from: addDays(today, -30), to: today };
    case 'THIS_MONTH':
      return { from: utc(y, m, 1), to: utc(y, m + 1, 0) };
    case 'THIS_QUARTER': {
      const q = Math.floor(m / 3) * 3;
      return { from: utc(y, q, 1), to: utc(y, q + 3, 0) };
    }
    case 'THIS_YEAR':
      return { from: utc(y, 0, 1), to: utc(y, 11, 31) };
    default:
      return { from: null, to: null };
  }
}

const tabWhere = (tab: ListQuery['tab']): Where =>
  tab === 'COMPLETED'
    ? { archivedAt: null, status: 'COMPLETED' }
    : tab === 'RECURRING'
      ? { archivedAt: null, recurrenceId: { not: null } }
      : tab === 'ARCHIVED'
        ? { archivedAt: { not: null } }
        : { archivedAt: null };

const sortOf = (
  sort: ListQuery['sort'],
  direction: 'asc' | 'desc',
): Prisma.ComplianceDeadlineOrderByWithRelationInput[] => {
  const by: Prisma.ComplianceDeadlineOrderByWithRelationInput =
    sort === 'name'
      ? { name: direction }
      : sort === 'client'
        ? { client: { displayName: direction } }
        : sort === 'type'
          ? { type: direction }
          : sort === 'agency'
            ? { agency: { sort: direction, nulls: 'last' } }
            : sort === 'status'
              ? { status: direction }
              : sort === 'priority'
                ? { priority: direction }
                : { dueOn: direction };
  return sort === 'dueOn'
    ? [by, { name: 'asc' }, { id: 'asc' }]
    : [by, { dueOn: 'asc' }, { id: 'asc' }];
};

/**
 * The reads of Compliance & Deadlines: the list and its CSV, the overview (KPIs, the type chart
 * and the at-risk clients), the month calendar, the By Client tab, a client's compliance view and
 * one deadline. Staff reach only the deadlines of clients assigned to them. Overdue and Due Soon
 * are derived from the date and the firm's settings; a firm with no deadlines gets empty lists
 * and zeros.
 */
@Injectable()
export class ComplianceDeadlinesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private whereOf(
    businessId: string,
    actor: ComplianceActor,
    q: Pick<
      ListQuery,
      | 'tab'
      | 'range'
      | 'from'
      | 'to'
      | 'type'
      | 'status'
      | 'clientId'
      | 'assignedUserId'
      | 'agency'
      | 'mine'
      | 'search'
    >,
    today: Date,
    dueSoonDays: number,
  ): Where {
    const named = rangeOf(q.range, today);
    const explicit = q.from !== undefined || q.to !== undefined;
    const from = explicit ? (q.from ? parseDay(q.from) : null) : named.from;
    const to = explicit ? (q.to ? parseDay(q.to) : null) : named.to;
    const and: Where[] = [{ businessId }, reachWhere(actor), { client: { archivedAt: null } }];
    and.push(tabWhere(q.tab));
    if (from || to) {
      and.push({ dueOn: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } });
    }
    if (q.type) and.push({ type: q.type });
    if (q.status) and.push(displayStatusWhere(q.status, today, dueSoonDays));
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
    if (q.agency) and.push({ agency: { equals: q.agency, mode: 'insensitive' } });
    if (q.mine) and.push({ assignedUserId: actor.userId.toLowerCase() });
    if (q.search) {
      and.push({
        OR: [
          { name: { contains: q.search, mode: 'insensitive' } },
          { relatedForm: { contains: q.search, mode: 'insensitive' } },
          { agency: { contains: q.search, mode: 'insensitive' } },
          { client: { displayName: { contains: q.search, mode: 'insensitive' } } },
        ],
      });
    }
    return { AND: and };
  }

  async list(
    businessId: string,
    actor: ComplianceActor,
    q: ListQuery,
  ): Promise<ComplianceDeadlinePage> {
    const db = this.tenantPrisma.db;
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const where = this.whereOf(businessId, actor, q, today, settings.dueSoonDays);
    const [rows, total] = await Promise.all([
      db.complianceDeadline.findMany({
        where,
        select: rowSelect,
        orderBy: sortOf(q.sort, q.direction),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceDeadline.count({ where }),
    ]);
    await this.audit.log(
      'compliance.deadlines.listed',
      { type: 'compliance' },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toRow(r, today, settings.dueSoonDays)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** The list's filters as a CSV (the permission grid's EXPORT). No notes, only what the list shows. */
  async exportCsv(businessId: string, actor: ComplianceActor, q: ListQuery): Promise<string> {
    const db = this.tenantPrisma.db;
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const rows = await db.complianceDeadline.findMany({
      where: this.whereOf(businessId, actor, q, today, settings.dueSoonDays),
      select: rowSelect,
      orderBy: sortOf(q.sort, q.direction),
      take: EXPORT_CAP,
    });
    const lines = [
      csvRow([
        'Due date',
        'Deadline',
        'Client',
        'Type',
        'Agency',
        'Form',
        'Tax year',
        'State',
        'Status',
        'Priority',
        'Assigned to',
      ]),
      ...rows.map((r) => {
        const row = toRow(r, today, settings.dueSoonDays);
        return csvRow([
          row.extendedDueOn ?? row.dueOn,
          row.name,
          row.client.displayName,
          row.type,
          row.agency,
          row.relatedForm,
          row.taxYear,
          row.state,
          row.displayStatus,
          row.priority,
          row.assignedTo?.name,
        ]);
      }),
    ];
    await this.audit.log(
      'compliance.deadlines.exported',
      { type: 'compliance' },
      { count: rows.length },
    );
    return `${lines.join('\r\n')}\r\n`;
  }

  /** Open deadlines of the clients the actor reaches, for the risk figures. */
  private async openRows(businessId: string, actor: ComplianceActor, clientId?: string) {
    const rows = await this.tenantPrisma.db.complianceDeadline.findMany({
      where: {
        businessId,
        archivedAt: null,
        status: { in: [...OPEN_STATUSES] },
        client: { archivedAt: null },
        ...(clientId ? { clientId } : {}),
        ...reachWhere(actor),
      },
      select: {
        clientId: true,
        status: true,
        priority: true,
        dueOn: true,
        extendedDueOn: true,
        client: { select: { id: true, displayName: true, clientNumber: true, accountType: true } },
      },
      take: READ_CAP,
    });
    return rows.map((r) => ({ ...r, client: toClientRef(r.client) }));
  }

  async summary(businessId: string, actor: ComplianceActor): Promise<ComplianceSummary> {
    const db = this.tenantPrisma.db;
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const monthStart = utc(today.getUTCFullYear(), today.getUTCMonth(), 1);
    const prevMonthStart = utc(today.getUTCFullYear(), today.getUTCMonth() - 1, 1);
    const base: Where = {
      businessId,
      archivedAt: null,
      client: { archivedAt: null },
      ...reachWhere(actor),
    };
    const counted: Where = { ...base, status: { notIn: ['CANCELLED', 'NOT_APPLICABLE'] } };
    const [
      total,
      totalBefore,
      next30,
      overdue,
      completed,
      completedBefore,
      recurring,
      byType,
      open,
      stale,
    ] = await Promise.all([
      db.complianceDeadline.count({ where: counted }),
      db.complianceDeadline.count({ where: { ...counted, createdAt: { lt: monthStart } } }),
      db.complianceDeadline.count({ where: { ...base, ...dueBetween(today, addDays(today, 30)) } }),
      db.complianceDeadline.count({ where: { ...base, ...overdueWhere(today) } }),
      db.complianceDeadline.count({
        where: { ...base, status: 'COMPLETED', completedAt: { gte: monthStart } },
      }),
      db.complianceDeadline.count({
        where: {
          ...base,
          status: 'COMPLETED',
          completedAt: { gte: prevMonthStart, lt: monthStart },
        },
      }),
      db.complianceRecurrence.count({
        where: { businessId, isTemplate: false, status: 'ACTIVE' },
      }),
      db.complianceDeadline.groupBy({ by: ['type'], where: counted, _count: { _all: true } }),
      this.openRows(businessId, actor),
      db.complianceCalendar.count({
        where: {
          businessId,
          status: 'PUBLISHED',
          OR: [
            { verifiedAt: null },
            { verifiedAt: { lt: addDays(today, -settings.staleCalendarDays) } },
          ],
        },
      }),
    ]);
    const atRisk = atRiskClients(open, today, settings.atRiskDays);
    await this.audit.log('compliance.summary.viewed', { type: 'compliance' });
    return {
      today: isoDay(today),
      kpis: {
        total: {
          value: total,
          previous: totalBefore,
          changePercent: changePercent(total, totalBefore),
        },
        next30Days: next30,
        overdue,
        completedThisMonth: {
          value: completed,
          previous: completedBefore,
          changePercent: changePercent(completed, completedBefore),
        },
        recurring,
        clientsAtRisk: atRisk.length,
      },
      types: byType
        .map((g) => ({
          type: g.type,
          count: g._count._all,
          percent: percent(g._count._all, total),
        }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
      atRiskClients: atRisk.slice(0, 5),
      staleCalendars: stale,
    };
  }

  async atRisk(businessId: string, actor: ComplianceActor): Promise<ComplianceAtRiskList> {
    const settings = await loadSettings(txOf(this.tenantPrisma.db), businessId);
    const open = await this.openRows(businessId, actor);
    const items = atRiskClients(open, todayOf(), settings.atRiskDays).slice(0, 200);
    await this.audit.log(
      'compliance.at-risk.viewed',
      { type: 'compliance' },
      { count: items.length },
    );
    return { items };
  }

  async byClient(
    businessId: string,
    actor: ComplianceActor,
    q: z.output<typeof ComplianceByClientQuery>,
  ): Promise<ComplianceByClientPage> {
    const db = this.tenantPrisma.db;
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const rows = await db.complianceDeadline.findMany({
      where: {
        businessId,
        archivedAt: null,
        status: { notIn: ['CANCELLED', 'NOT_APPLICABLE'] },
        client: {
          archivedAt: null,
          ...(q.search ? { displayName: { contains: q.search, mode: 'insensitive' } } : {}),
        },
        ...reachWhere(actor),
      },
      select: {
        clientId: true,
        status: true,
        priority: true,
        dueOn: true,
        extendedDueOn: true,
        client: { select: { id: true, displayName: true, clientNumber: true, accountType: true } },
      },
      take: READ_CAP,
    });
    const risky = new Set(
      atRiskClients(
        rows.map((r) => ({ ...r, client: toClientRef(r.client) })),
        today,
        settings.atRiskDays,
      ).map((c) => c.client.id),
    );
    const totals = new Map<string, ComplianceClientTotals>();
    for (const r of rows) {
      const t = totals.get(r.clientId) ?? {
        client: toClientRef(r.client),
        total: 0,
        open: 0,
        overdue: 0,
        dueSoon: 0,
        completed: 0,
        nextDueOn: null,
        atRisk: risky.has(r.clientId),
      };
      t.total += 1;
      if (r.status === 'COMPLETED') t.completed += 1;
      else {
        t.open += 1;
        const shown = displayStatusOf(r, today, settings.dueSoonDays);
        if (shown === 'OVERDUE') t.overdue += 1;
        else {
          if (shown === 'DUE_SOON') t.dueSoon += 1;
          const due = day(effectiveDue(r)) as string;
          if (t.nextDueOn === null || due < t.nextDueOn) t.nextDueOn = due;
        }
      }
      totals.set(r.clientId, t);
    }
    const all = [...totals.values()]
      .filter((t) => !q.atRisk || t.atRisk)
      .sort(
        (a, b) =>
          b.overdue - a.overdue ||
          Number(b.atRisk) - Number(a.atRisk) ||
          a.client.displayName.localeCompare(b.client.displayName),
      );
    const items = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    await this.audit.log(
      'compliance.by-client.listed',
      { type: 'compliance' },
      { count: items.length },
    );
    return { items, total: all.length, page: q.page, pageSize: q.pageSize };
  }

  async month(
    businessId: string,
    actor: ComplianceActor,
    q: z.output<typeof ComplianceCalendarMonthQuery>,
  ): Promise<ComplianceCalendarMonth> {
    const db = this.tenantPrisma.db;
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const month = q.month ?? isoDay(today).slice(0, 7);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const rows = await db.complianceDeadline.findMany({
      where: {
        businessId,
        archivedAt: null,
        status: { notIn: ['CANCELLED', 'NOT_APPLICABLE'] },
        client: { archivedAt: null },
        dueOn: { gte: utc(y, m - 1, 1), lte: utc(y, m, 0) },
        ...(q.type ? { type: q.type } : {}),
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
        ...(q.mine ? { assignedUserId: actor.userId.toLowerCase() } : {}),
        ...reachWhere(actor),
      },
      select: rowSelect,
      orderBy: [{ dueOn: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: CALENDAR_CAP + 1,
    });
    const days = new Map<string, ComplianceCalendarMonth['days'][number]>();
    for (const r of rows.slice(0, CALENDAR_CAP)) {
      const row = toRow(r, today, settings.dueSoonDays);
      const entry = days.get(row.dueOn) ?? {
        date: row.dueOn,
        counts: { upcoming: 0, overdue: 0, dueSoon: 0, completed: 0 },
        deadlines: [],
      };
      const s = row.displayStatus;
      if (s === 'OVERDUE') entry.counts.overdue += 1;
      else if (s === 'DUE_SOON') entry.counts.dueSoon += 1;
      else if (s === 'COMPLETED') entry.counts.completed += 1;
      else entry.counts.upcoming += 1;
      entry.deadlines.push({
        id: row.id,
        name: row.name,
        type: row.type,
        displayStatus: s,
        clientName: row.client.displayName,
      });
      days.set(row.dueOn, entry);
    }
    await this.audit.log('compliance.calendar.viewed', { type: 'compliance' }, { month });
    return {
      month,
      days: [...days.values()],
      truncated: rows.length > CALENDAR_CAP,
    };
  }

  /** GET /business/clients/{id}/compliance. */
  async clientView(
    businessId: string,
    actor: ComplianceActor,
    clientId: string,
    q: z.output<typeof ClientComplianceQuery>,
  ): Promise<ClientCompliance> {
    const db = this.tenantPrisma.db;
    const client = await db.client.findFirst({
      where: { AND: [{ businessId, id: clientId }, clientReach(actor)] },
      select: { id: true, displayName: true, clientNumber: true, accountType: true },
    });
    if (!client) throw errors.notFound();
    const today = todayOf();
    const settings = await loadSettings(txOf(db), businessId);
    const [rows, suggestions] = await Promise.all([
      db.complianceDeadline.findMany({
        where: { businessId, clientId, archivedAt: null },
        select: rowSelect,
        orderBy: [{ dueOn: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        take: 500,
      }),
      db.complianceApplicabilityRecord.count({
        where: { businessId, clientId, decision: { in: ['SUGGESTED', 'NEEDS_REVIEW'] } },
      }),
    ]);
    const shown = rows.map((r) => toRow(r, today, settings.dueSoonDays));
    const closed = new Set<string>(CLOSED_STATUSES);
    const open = shown.filter((r) => !closed.has(r.status));
    const risk = atRiskClients(
      rows
        .filter((r) => !closed.has(r.status))
        .map((r) => ({ ...r, clientId, client: toClientRef(r.client) })),
      today,
      settings.atRiskDays,
    )[0];
    await this.audit.log(
      'compliance.client.viewed',
      { type: 'client', id: clientId },
      { count: shown.length },
    );
    return {
      client: toClientRef(client),
      totals: {
        open: open.length,
        overdue: open.filter((r) => r.displayStatus === 'OVERDUE').length,
        dueSoon: open.filter((r) => r.displayStatus === 'DUE_SOON').length,
        completed: shown.filter((r) => r.status === 'COMPLETED').length,
      },
      atRisk: risk ?? null,
      deadlines: q.includeClosed ? shown : open,
      suggestions,
    };
  }

  async get(businessId: string, actor: ComplianceActor, id: string): Promise<ComplianceDeadline> {
    const db = this.tenantPrisma.db;
    const row = await findDeadline(txOf(db), businessId, actor, id);
    const settings = await loadSettings(txOf(db), businessId);
    const detail = await toDetail(txOf(db), businessId, row, settings);
    await this.audit.log(
      'compliance.deadline.viewed',
      { type: 'compliance_deadline', id },
      { clientId: row.clientId },
    );
    return detail;
  }
}
