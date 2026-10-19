import { BadRequestException, Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  ADMIN_REPORT_EXPORT_MAX,
  ADMIN_REPORT_FEATURES,
  type AdminReportCatalog,
  type AdminReportDateRange,
  type AdminReportExportRequest,
  type AdminReportField,
  type AdminReportFile,
  type AdminReportResult,
  type AdminReportRunRequest,
  type AdminReportType,
  type AdminSavedReport,
  type AdminSavedReportList,
  type SaveAdminReportRequest,
  type UpdateAdminReportRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { conflict, writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { csvRow } from '../bookkeeping/bookkeeping.shared.js';
import { PlatformPrisma } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import {
  collectedByFirm,
  contactsByFirm,
  dayEnd,
  dayStart,
  isoDay,
  latestMetrics,
  plansByFirm,
} from './reports.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Type = z.infer<typeof AdminReportType>;
type Cell = string | number | null;
type Row = Record<string, Cell>;
type Filters = Record<string, string>;

const f = (
  key: string,
  label: string,
  type: AdminReportField['type'],
  sensitive = false,
): AdminReportField => ({
  key,
  label,
  type,
  sensitive,
  sortable: true,
});

/** The fields and filters of each report type (the builder's catalogue). */
const CATALOG: Record<Type, { fields: AdminReportField[]; filters: string[]; defaults: string[] }> =
  {
    FIRMS: {
      fields: [
        f('firm.name', 'Firm Name', 'text'),
        f('firm.plan', 'Plan Type', 'text'),
        f('firm.status', 'Status', 'status'),
        f('firm.joined', 'Date Joined', 'date'),
        f('firm.contact_name', 'Primary Contact', 'text'),
        f('firm.contact_email', 'Contact Email', 'text', true),
        f('firm.contact_phone', 'Contact Phone', 'text', true),
        f('firm.total_users', 'Total Users', 'number'),
        f('firm.monthly_revenue', 'Revenue (period)', 'money'),
        f('firm.next_billing_date', 'Next Billing Date', 'date'),
        f('firm.last_login', 'Last Login', 'datetime'),
        f('firm.active_documents', 'Active Documents', 'number'),
        f('firm.open_tickets', 'Open Support Tickets', 'number'),
        f('firm.cancellation_date', 'Cancellation Date', 'date'),
      ],
      filters: ['status', 'plan', 'joinedFrom', 'joinedTo', 'search'],
      defaults: [
        'firm.name',
        'firm.plan',
        'firm.status',
        'firm.joined',
        'firm.total_users',
        'firm.monthly_revenue',
      ],
    },
    USERS: {
      fields: [
        f('firm.name', 'Firm Name', 'text'),
        f('users.total', 'Total Users', 'number'),
        f('users.active', 'Active Users', 'number'),
        f('users.new', 'New Users (period)', 'number'),
        f('users.logins', 'Logins (period)', 'number'),
        f('users.last_login', 'Last Login', 'datetime'),
      ],
      filters: ['status', 'search'],
      defaults: ['firm.name', 'users.total', 'users.active', 'users.new', 'users.last_login'],
    },
    SUBSCRIPTIONS_REVENUE: {
      fields: [
        f('firm.name', 'Firm Name', 'text'),
        f('subscription.plan', 'Plan', 'text'),
        f('subscription.status', 'Subscription Status', 'status'),
        f('subscription.cycle', 'Billing Cycle', 'text'),
        f('subscription.seats', 'Seats', 'number'),
        f('subscription.next_billing_date', 'Next Billing Date', 'date'),
        f('revenue.collected', 'Collected (period)', 'money'),
        f('revenue.overdue', 'Overdue Balance', 'money'),
      ],
      filters: ['subscriptionStatus', 'plan', 'search'],
      defaults: [
        'firm.name',
        'subscription.plan',
        'subscription.status',
        'revenue.collected',
        'revenue.overdue',
      ],
    },
    SUPPORT: {
      fields: [
        f('ticket.number', 'Ticket #', 'number'),
        f('ticket.subject', 'Subject', 'text'),
        f('firm.name', 'Firm Name', 'text'),
        f('ticket.priority', 'Priority', 'text'),
        f('ticket.status', 'Status', 'status'),
        f('ticket.created', 'Created', 'datetime'),
        f('ticket.first_response_minutes', 'First Response (min)', 'number'),
        f('ticket.resolved', 'Resolved', 'datetime'),
      ],
      filters: ['ticketStatus', 'search'],
      defaults: [
        'ticket.number',
        'ticket.subject',
        'firm.name',
        'ticket.priority',
        'ticket.status',
        'ticket.created',
      ],
    },
    FEATURE_USAGE: {
      fields: [
        f('firm.name', 'Firm Name', 'text'),
        f('feature.label', 'Feature', 'text'),
        f('usage.events', 'Uses (period)', 'number'),
        f('usage.active_users', 'Active Users (peak day)', 'number'),
      ],
      filters: ['feature', 'search'],
      defaults: ['firm.name', 'feature.label', 'usage.events', 'usage.active_users'],
    },
    ACTIVITY_LOG: {
      fields: [
        f('event.at', 'Date & Time', 'datetime'),
        f('event.action', 'Activity', 'text'),
        f('event.actor', 'User', 'text'),
        f('firm.name', 'Firm Name', 'text'),
        f('event.target', 'Details', 'text'),
      ],
      filters: ['search'],
      defaults: ['event.at', 'event.action', 'event.actor', 'firm.name', 'event.target'],
    },
  };

const FILTER_LABELS: Record<string, string> = {
  status: 'Status',
  plan: 'Plan Type',
  search: 'Search',
  subscriptionStatus: 'Subscription Status',
  ticketStatus: 'Ticket Status',
  feature: 'Feature',
  joinedFrom: 'Joined From',
  joinedTo: 'Joined To',
};
/** Filters that take a day (YYYY-MM-DD). */
const DATE_FILTERS = new Set(['joinedFrom', 'joinedTo']);
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A date range's days (UTC): a preset ends today. */
export function datesOf(
  range: AdminReportDateRange,
  today = new Date(),
): { from: string; to: string } {
  if ('from' in range) return { from: range.from, to: range.to };
  const t = isoDay(today);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const back = (days: number) => isoDay(new Date(dayStart(t).getTime() - (days - 1) * 86_400_000));
  switch (range.preset) {
    case 'LAST_7_DAYS':
      return { from: back(7), to: t };
    case 'LAST_30_DAYS':
      return { from: back(30), to: t };
    case 'THIS_MONTH':
      return { from: isoDay(new Date(Date.UTC(y, m, 1))), to: t };
    case 'LAST_MONTH':
      return {
        from: isoDay(new Date(Date.UTC(y, m - 1, 1))),
        to: isoDay(new Date(Date.UTC(y, m, 0))),
      };
    case 'THIS_QUARTER':
      return { from: isoDay(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: t };
    case 'THIS_YEAR':
      return { from: isoDay(new Date(Date.UTC(y, 0, 1))), to: t };
  }
}

const unknownField = (what: string) =>
  new BadRequestException({ code: 'UNKNOWN_FIELD', message: `This report has no ${what}` });

/**
 * The Custom Report Builder and saved reports (R55). Each type loads its rows from the platform's
 * tables for the range and filters, then picks the asked fields, sorts and pages on the server.
 * Saved reports keep the definition, never the data; a run stamps `last_run_at`. Exports are CSV
 * in the answer (title, time, period and filters on top) and audited.
 */
@Injectable()
export class AdminReportBuilderService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly platform: PlatformPrisma,
  ) {}

  async catalog(type: Type): Promise<AdminReportCatalog> {
    const c = CATALOG[type];
    const plans = await this.admin.db.platformPlan.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { displayOrder: 'asc' },
    });
    const options: Record<string, { value: string; label: string }[]> = {
      status: ['PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'CLOSED'].map((v) => ({
        value: v,
        label: v.charAt(0) + v.slice(1).toLowerCase().replace('_', ' '),
      })),
      plan: plans.map((p) => ({ value: p.code, label: p.name })),
      subscriptionStatus: [
        'TRIAL',
        'ACTIVE',
        'PAST_DUE',
        'SUSPENDED',
        'NON_RENEWING',
        'EXPIRED',
        'CANCELLED',
      ].map((v) => ({ value: v, label: v })),
      ticketStatus: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED'].map(
        (v) => ({ value: v, label: v }),
      ),
      feature: Object.entries(ADMIN_REPORT_FEATURES).map(([value, label]) => ({ value, label })),
      search: [],
    };
    return {
      type,
      fields: c.fields,
      filters: c.filters.map((key) => ({
        key,
        label: FILTER_LABELS[key] ?? key,
        type:
          key === 'search'
            ? ('text' as const)
            : DATE_FILTERS.has(key)
              ? ('date' as const)
              : ('select' as const),
        options: options[key] ?? [],
      })),
      defaultFields: c.defaults,
    };
  }

  private check(type: Type, fields: string[], filters: Filters, sort: { field: string }[]) {
    const c = CATALOG[type];
    for (const k of fields)
      if (!c.fields.some((x) => x.key === k)) throw unknownField(`field ${k}`);
    for (const [k, v] of Object.entries(filters)) {
      if (!c.filters.includes(k)) throw unknownField(`filter ${k}`);
      if (DATE_FILTERS.has(k) && !DAY_PATTERN.test(v)) throw unknownField(`date ${v} for ${k}`);
    }
    for (const s of sort)
      if (!fields.includes(s.field))
        throw unknownField(`sort on ${s.field} (choose it as a field)`);
  }

  /** Every row of a type for the range and filters, with every field. */
  private async rows(
    tx: TxClient,
    type: Type,
    from: string,
    to: string,
    filters: Filters,
  ): Promise<Row[]> {
    const search = filters.search?.toLowerCase();
    const firms = await tx.business.findMany({
      where: {
        ...(filters.status && (type === 'FIRMS' || type === 'USERS')
          ? { status: filters.status as never }
          : {}),
        ...(type === 'FIRMS' && (filters.joinedFrom || filters.joinedTo)
          ? {
              createdAt: {
                ...(filters.joinedFrom ? { gte: dayStart(filters.joinedFrom) } : {}),
                ...(filters.joinedTo ? { lte: dayEnd(filters.joinedTo) } : {}),
              },
            }
          : {}),
      },
      select: { id: true, name: true, status: true, createdAt: true },
    });
    const firmName = new Map(firms.map((x) => [x.id, x.name]));
    const named = (id: string) =>
      !search || (firmName.get(id) ?? '').toLowerCase().includes(search);
    switch (type) {
      case 'FIRMS': {
        const [plans, contacts, collected, metrics, open, subs] = await Promise.all([
          plansByFirm(tx),
          contactsByFirm(tx),
          collectedByFirm(tx, from, to),
          latestMetrics(tx, to),
          tx.supportTicket.groupBy({
            by: ['businessId'],
            where: { deletedAt: null, status: { notIn: ['RESOLVED', 'CLOSED'] } },
            _count: { _all: true },
          }),
          tx.platformFirmSubscription.findMany({
            select: {
              businessId: true,
              nextBillingDate: true,
              closedAt: true,
              cancelRequestedAt: true,
            },
          }),
        ]);
        const openOf = new Map(open.map((o) => [o.businessId, o._count._all]));
        const subOf = new Map(subs.map((s) => [s.businessId, s]));
        return firms
          .filter((x) => named(x.id) && (!filters.plan || plans.get(x.id)?.code === filters.plan))
          .map((x) => ({
            'firm.name': x.name,
            'firm.plan': plans.get(x.id)?.name ?? null,
            'firm.status': x.status,
            'firm.joined': isoDay(x.createdAt),
            'firm.contact_name': contacts.get(x.id)?.name ?? null,
            'firm.contact_email': contacts.get(x.id)?.email ?? null,
            'firm.contact_phone': contacts.get(x.id)?.phone ?? null,
            'firm.total_users': metrics.get(x.id)?.totalUsers ?? null,
            'firm.monthly_revenue': collected.get(x.id) ?? 0,
            'firm.next_billing_date': subOf.get(x.id)?.nextBillingDate
              ? isoDay(subOf.get(x.id)!.nextBillingDate!)
              : null,
            'firm.last_login': metrics.get(x.id)?.lastLoginAt?.toISOString() ?? null,
            'firm.active_documents': metrics.get(x.id)?.activeDocuments ?? null,
            'firm.open_tickets': openOf.get(x.id) ?? 0,
            'firm.cancellation_date': subOf.get(x.id)?.closedAt
              ? isoDay(subOf.get(x.id)!.closedAt!)
              : null,
          }));
      }
      case 'USERS': {
        const [metrics, inRange] = await Promise.all([
          latestMetrics(tx, to),
          tx.platformFirmMetricsDaily.groupBy({
            by: ['businessId'],
            where: { day: { gte: dayStart(from), lte: dayStart(to) } },
            _sum: { newUsers: true, logins: true },
          }),
        ]);
        const sums = new Map(inRange.map((s) => [s.businessId, s._sum]));
        return firms
          .filter((x) => named(x.id))
          .map((x) => ({
            'firm.name': x.name,
            'users.total': metrics.get(x.id)?.totalUsers ?? null,
            'users.active': metrics.get(x.id)?.activeUsers ?? null,
            'users.new': sums.get(x.id)?.newUsers ?? null,
            'users.logins': sums.get(x.id)?.logins ?? null,
            'users.last_login': metrics.get(x.id)?.lastLoginAt?.toISOString() ?? null,
          }));
      }
      case 'SUBSCRIPTIONS_REVENUE': {
        const [subs, collected, overdue] = await Promise.all([
          tx.platformFirmSubscription.findMany({
            where: {
              ...(filters.subscriptionStatus
                ? { status: filters.subscriptionStatus as never }
                : {}),
              ...(filters.plan ? { plan: { code: filters.plan } } : {}),
            },
            select: {
              businessId: true,
              status: true,
              billingCycle: true,
              seatsIncluded: true,
              seatsPurchased: true,
              nextBillingDate: true,
              plan: { select: { name: true } },
            },
          }),
          collectedByFirm(tx, from, to),
          tx.platformInvoice.groupBy({
            by: ['businessId'],
            where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: dayStart(to) } },
            _sum: { totalCents: true, paidCents: true, creditedCents: true },
          }),
        ]);
        const due = new Map(
          overdue.map((o) => [
            o.businessId,
            (o._sum.totalCents ?? 0) - (o._sum.paidCents ?? 0) - (o._sum.creditedCents ?? 0),
          ]),
        );
        return subs
          .filter((s) => named(s.businessId))
          .map((s) => ({
            'firm.name': firmName.get(s.businessId) ?? 'Unknown firm',
            'subscription.plan': s.plan.name,
            'subscription.status': s.status,
            'subscription.cycle': s.billingCycle,
            'subscription.seats': s.seatsIncluded + s.seatsPurchased,
            'subscription.next_billing_date': s.nextBillingDate ? isoDay(s.nextBillingDate) : null,
            'revenue.collected': collected.get(s.businessId) ?? 0,
            'revenue.overdue': Math.max(0, due.get(s.businessId) ?? 0),
          }));
      }
      case 'SUPPORT': {
        const tickets = await tx.supportTicket.findMany({
          where: {
            deletedAt: null,
            createdAt: { gte: dayStart(from), lte: dayEnd(to) },
            ...(filters.ticketStatus ? { status: filters.ticketStatus as never } : {}),
          },
          select: {
            number: true,
            subject: true,
            businessId: true,
            status: true,
            createdAt: true,
            firstRespondedAt: true,
            resolvedAt: true,
            priority: { select: { name: true } },
          },
          take: ADMIN_REPORT_EXPORT_MAX + 1,
        });
        return tickets
          .filter((t) => !search || t.subject.toLowerCase().includes(search) || named(t.businessId))
          .map((t) => ({
            'ticket.number': t.number,
            'ticket.subject': t.subject,
            'firm.name': firmName.get(t.businessId) ?? 'Unknown firm',
            'ticket.priority': t.priority.name,
            'ticket.status': t.status,
            'ticket.created': t.createdAt.toISOString(),
            'ticket.first_response_minutes': t.firstRespondedAt
              ? Math.round((t.firstRespondedAt.getTime() - t.createdAt.getTime()) / 60_000)
              : null,
            'ticket.resolved': t.resolvedAt?.toISOString() ?? null,
          }));
      }
      case 'FEATURE_USAGE': {
        const usage = await tx.platformFeatureUsageDaily.groupBy({
          by: ['businessId', 'feature'],
          where: {
            day: { gte: dayStart(from), lte: dayStart(to) },
            ...(filters.feature ? { feature: filters.feature } : {}),
          },
          _sum: { events: true },
          _max: { activeUsers: true },
        });
        return usage
          .filter((u) => named(u.businessId))
          .map((u) => ({
            'firm.name': firmName.get(u.businessId) ?? 'Unknown firm',
            'feature.label':
              (ADMIN_REPORT_FEATURES as Record<string, string>)[u.feature] ?? u.feature,
            'usage.events': u._sum.events ?? 0,
            'usage.active_users': u._max.activeUsers ?? 0,
          }));
      }
      case 'ACTIVITY_LOG': {
        const events = await tx.auditLog.findMany({
          where: {
            createdAt: { gte: dayStart(from), lte: dayEnd(to) },
            ...(search
              ? {
                  OR: [
                    { action: { contains: search, mode: 'insensitive' } },
                    { actorName: { contains: search, mode: 'insensitive' } },
                    { targetLabel: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          select: {
            createdAt: true,
            action: true,
            actorName: true,
            actorUserId: true,
            businessId: true,
            subjectBusinessId: true,
            targetLabel: true,
            entityType: true,
          },
          orderBy: { createdAt: 'desc' },
          take: ADMIN_REPORT_EXPORT_MAX + 1,
        });
        const users = new Map(
          (
            await this.platform.db.user.findMany({
              where: {
                id: {
                  in: [
                    ...new Set(
                      events
                        .filter((e) => !e.actorName && e.actorUserId)
                        .map((e) => e.actorUserId!),
                    ),
                  ],
                },
              },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name]),
        );
        return events.map((e) => {
          const firm = e.businessId ?? e.subjectBusinessId;
          return {
            'event.at': e.createdAt.toISOString(),
            'event.action': e.action,
            'event.actor':
              e.actorName ?? (e.actorUserId ? (users.get(e.actorUserId) ?? null) : 'System'),
            'firm.name': firm ? (firmName.get(firm) ?? 'Unknown firm') : 'Firmivra',
            'event.target': e.targetLabel ?? e.entityType,
          };
        });
      }
    }
  }

  /** Runs a definition: the asked fields, sorted, one page. */
  async run(
    body: Out<typeof AdminReportRunRequest>,
    all = false,
  ): Promise<AdminReportResult & { rowsAll?: Row[] }> {
    this.check(body.type, body.fields, body.filters, body.sort);
    const { from, to } = datesOf(body.dateRange);
    const rows = await this.admin.transaction((tx) =>
      this.rows(tx, body.type, from, to, body.filters),
    );
    const fields = CATALOG[body.type].fields;
    const columns = body.fields.map((k) => fields.find((x) => x.key === k)!);
    const sorted = [...rows].sort((a, b) => {
      for (const s of body.sort) {
        const x = a[s.field];
        const y = b[s.field];
        if (x === y) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        const c =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
        return s.direction === 'desc' ? -c : c;
      }
      return 0;
    });
    const pick = (r: Row) => Object.fromEntries(body.fields.map((k) => [k, r[k] ?? null]));
    const page = all
      ? sorted
      : sorted.slice((body.page - 1) * body.pageSize, body.page * body.pageSize);
    return {
      columns,
      rows: page.map(pick),
      total: sorted.length,
      page: body.page,
      pageSize: body.pageSize,
      generatedAt: new Date().toISOString(),
    };
  }

  async export(body: Out<typeof AdminReportExportRequest>): Promise<AdminReportFile> {
    const adminUserId = this.admin.adminUserId;
    const result = await this.run({ ...body, page: 1, pageSize: 100 }, true);
    if (result.total > ADMIN_REPORT_EXPORT_MAX)
      throw conflict(
        'EXPORT_TOO_LARGE',
        `That is ${result.total} rows; narrow the filters to at most ${ADMIN_REPORT_EXPORT_MAX}`,
      );
    const { from, to } = datesOf(body.dateRange);
    const title = body.title ?? `${body.type.replace(/_/g, ' ')} report`;
    const head = [
      csvRow([title]),
      csvRow([`Generated ${result.generatedAt}`]),
      csvRow([`Period ${from} to ${to}`]),
      csvRow([
        `Filters ${
          Object.entries(body.filters)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ') || 'none'
        }`,
      ]),
      '',
      csvRow(result.columns.map((c) => c.label)),
    ];
    const lines = result.rows.map((r) => csvRow(result.columns.map((c) => r[c.key] ?? null)));
    await this.admin.transaction((tx) =>
      writeAdminEvent(tx, adminUserId, {
        action: 'reports.exported',
        entityType: 'platform_report',
        category: 'DATA',
        severity: 'MEDIUM',
        targetLabel: title,
        metadata: {
          type: body.type,
          fields: body.fields,
          filters: Object.keys(body.filters),
          rowCount: result.total,
        },
      }),
    );
    return {
      fileName: `firmivra-${body.type.toLowerCase()}-${to}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      content: `${String.fromCharCode(0xfeff)}${[...head, ...lines].join('\r\n')}\r\n`,
      rowCount: result.total,
    };
  }

  // ---------- Saved reports ----------

  private async views(
    rows: {
      id: string;
      ownerUserId: string;
      name: string;
      description: string | null;
      reportType: Type;
      fields: string[];
      filters: unknown;
      dateRange: unknown;
      sort: unknown;
      shared: boolean;
      lastRunAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }[],
  ): Promise<AdminSavedReport[]> {
    const me = this.admin.adminUserId;
    const owners = new Map(
      (
        await this.platform.db.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.ownerUserId))] } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.reportType,
      fields: r.fields,
      filters: (r.filters ?? {}) as Filters,
      dateRange: r.dateRange as AdminReportDateRange,
      sort: (r.sort ?? []) as AdminSavedReport['sort'],
      shared: r.shared,
      owner: { id: r.ownerUserId, name: owners.get(r.ownerUserId) ?? 'Super Admin' },
      isYours: r.ownerUserId === me,
      lastRunAt: r.lastRunAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async saved(): Promise<AdminSavedReportList> {
    const rows = await this.admin.db.platformSavedReport.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return { items: await this.views(rows) };
  }

  private async one(id: string) {
    const row = await this.admin.db.platformSavedReport.findUnique({ where: { id } });
    if (!row) throw notFound();
    return row;
  }

  async save(body: Out<typeof SaveAdminReportRequest>): Promise<AdminSavedReport> {
    const adminUserId = this.admin.adminUserId;
    this.check(body.type, body.fields, body.filters, body.sort);
    const row = await this.admin
      .transaction(async (tx) => {
        const saved = await tx.platformSavedReport.create({
          data: {
            ownerUserId: adminUserId,
            name: body.name,
            description: body.description ?? null,
            reportType: body.type,
            fields: body.fields,
            filters: body.filters,
            dateRange: body.dateRange as object,
            sort: body.sort,
            shared: body.shared,
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'reports.saved',
          entityType: 'platform_saved_report',
          entityId: saved.id,
          category: 'SYSTEM',
          severity: 'INFO',
          metadata: { type: body.type, shared: body.shared },
        });
        return saved;
      })
      .catch((e: unknown) => {
        if (isUniqueViolation(e))
          throw conflict('DUPLICATE_NAME', 'You have a saved report with this name');
        throw e;
      });
    return (await this.views([row]))[0]!;
  }

  async update(id: string, body: Out<typeof UpdateAdminReportRequest>): Promise<AdminSavedReport> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.one(id);
    if (row.ownerUserId !== adminUserId) throw notFound();
    this.check(
      row.reportType,
      body.fields ?? row.fields,
      body.filters ?? ((row.filters ?? {}) as Filters),
      body.sort ?? ((row.sort ?? []) as { field: string }[]),
    );
    const saved = await this.admin
      .transaction(async (tx) => {
        const s = await tx.platformSavedReport.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.shared !== undefined ? { shared: body.shared } : {}),
            ...(body.fields !== undefined ? { fields: body.fields } : {}),
            ...(body.filters !== undefined ? { filters: body.filters } : {}),
            ...(body.dateRange !== undefined ? { dateRange: body.dateRange as object } : {}),
            ...(body.sort !== undefined ? { sort: body.sort } : {}),
          },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: 'reports.saved_updated',
          entityType: 'platform_saved_report',
          entityId: id,
          category: 'SYSTEM',
          severity: 'INFO',
          metadata: {
            fields: Object.keys(body).filter(
              (k) => (body as Record<string, unknown>)[k] !== undefined,
            ),
          },
        });
        return s;
      })
      .catch((e: unknown) => {
        if (isUniqueViolation(e))
          throw conflict('DUPLICATE_NAME', 'You have a saved report with this name');
        throw e;
      });
    return (await this.views([saved]))[0]!;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.one(id);
    if (row.ownerUserId !== adminUserId) throw notFound();
    await this.admin.transaction(async (tx) => {
      await tx.platformSavedReport.delete({ where: { id } });
      await writeAdminEvent(tx, adminUserId, {
        action: 'reports.saved_deleted',
        entityType: 'platform_saved_report',
        entityId: id,
        category: 'SYSTEM',
        severity: 'INFO',
      });
    });
    return { ok: true };
  }

  async runSaved(id: string, page: number, pageSize: number): Promise<AdminReportResult> {
    const row = await this.one(id);
    const result = await this.run({
      type: row.reportType,
      fields: row.fields,
      filters: (row.filters ?? {}) as Filters,
      dateRange: row.dateRange as AdminReportDateRange,
      sort: (row.sort ?? []) as { field: string; direction: 'asc' | 'desc' }[],
      page,
      pageSize,
    });
    // The database stamps the time (a shared report's other users may change only this).
    await this.admin.db.platformSavedReport.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
    return result;
  }

  async duplicate(id: string): Promise<AdminSavedReport> {
    const adminUserId = this.admin.adminUserId;
    const row = await this.one(id);
    const mine = await this.admin.db.platformSavedReport.findMany({
      where: { ownerUserId: adminUserId },
      select: { name: true },
    });
    let name = `${row.name} (copy)`.slice(0, 120);
    for (let n = 2; mine.some((m) => m.name === name); n++)
      name = `${row.name} (copy ${n})`.slice(0, 120);
    const copy = await this.admin.transaction(async (tx) => {
      const c = await tx.platformSavedReport.create({
        data: {
          ownerUserId: adminUserId,
          name,
          description: row.description,
          reportType: row.reportType,
          fields: row.fields,
          filters: row.filters as object,
          dateRange: row.dateRange as object,
          sort: row.sort as object,
          shared: false,
          duplicatedFromId: row.id,
        },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'reports.saved_duplicated',
        entityType: 'platform_saved_report',
        entityId: c.id,
        category: 'SYSTEM',
        severity: 'INFO',
        metadata: { fromId: row.id },
      });
      return c;
    });
    return (await this.views([copy]))[0]!;
  }
}
