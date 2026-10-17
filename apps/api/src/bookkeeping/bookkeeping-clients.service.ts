import { Inject, Injectable } from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  AddBookkeepingClientRequest,
  BookkeepingActivity,
  BookkeepingActivityList,
  BookkeepingAlerts,
  BookkeepingClientPage,
  BookkeepingClientRow,
  BookkeepingClientsQuery,
  BookkeepingClientTab,
  BookkeepingClientWorkspace,
  BookkeepingListQuery,
  BookkeepingOverview,
  BookkeepingOverviewQuery,
  BookkeepingSettings,
  BookkeepingStatusRefreshed,
  BookkeepingStatusRequest,
  BookkeepingSyncQueued,
  CategorizationRule,
  DocumentChecklistItem,
  LogBookkeepingActivityRequest,
  PortalDefaults,
  ReportScheduleItem,
  SaveBookkeepingSettingsRequest,
  UpdateBookkeepingClientRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { checkAssignee, isUniqueViolation, memberNames, sentFields } from '../workspaces/common.js';
import {
  addActivity,
  type BookkeepingActor,
  clientRefSelect,
  findProfile,
  iso,
  isManager,
  lockProfile,
  memberRefOf,
  periodSelect,
  reachEngagement,
  reportMemberIds,
  reportSelect,
  skipTake,
  toAccount,
  toActivity,
  toClientRef,
  toConnection,
  toPeriodSummary,
  toReport,
} from './bookkeeping.mappers.js';
import {
  changePercent,
  csvRow,
  day,
  errors,
  figurePeriodsIn,
  inFirm,
  isoDay,
  addDays,
  nextReportDue,
  periodRange,
  providerLabel,
  syncStatusOf,
  toDay,
  totalsOf,
} from './bookkeeping.shared.js';
import { BookkeepingStatusService, readSettings } from './bookkeeping-status.service.js';

type ClientsQuery = z.output<typeof BookkeepingClientsQuery>;
type ListQuery = z.output<typeof BookkeepingListQuery>;

const EXPORT_LIMIT = 5_000;
const SORTS = {
  clientName: (d: 'asc' | 'desc') => ({ engagement: { client: { displayName: d } } }),
  plan: (d: 'asc' | 'desc') => ({ engagement: { package: { sort: d, nulls: 'last' as const } } }),
  status: (d: 'asc' | 'desc') => ({ status: d }),
  nextReportDueOn: (d: 'asc' | 'desc') => ({
    nextReportDueOn: { sort: d, nulls: 'last' as const },
  }),
};

const liveConnectionsArgs = {
  where: { status: { not: 'DISCONNECTED' as const } },
  orderBy: { connectedAt: 'desc' as const },
  select: {
    id: true,
    provider: true,
    status: true,
    lastSuccessfulSyncAt: true,
    lastSyncAt: true,
  },
};

const listSelect = {
  id: true,
  engagementId: true,
  cadence: true,
  status: true,
  statusSource: true,
  statusReason: true,
  nextReportDueOn: true,
  pausedAt: true,
  engagement: {
    select: {
      package: true,
      assignedUserId: true,
      client: { select: clientRefSelect },
      bookkeepingConnections: liveConnectionsArgs,
    },
  },
} satisfies Prisma.BookkeepingProfileSelect;

type ListRow = Prisma.BookkeepingProfileGetPayload<{ select: typeof listSelect }>;

/** The connection a row shows: a CONNECTED one first, else the newest live one. */
const shownConnection = <T extends { status: string }>(rows: readonly T[]): T | null =>
  rows.find((c) => c.status === 'CONNECTED') ?? rows[0] ?? null;

const todayOf = (now: Date) => isoDay(now);

/**
 * The firm's bookkeeping clients: the overview, the list, the client workspace, its service
 * actions and the firm's settings. Every change writes an activity row and an audit row in the
 * same transaction. Figures come from what preparers entered or an import supplied; nothing is
 * estimated.
 */
@Injectable()
export class BookkeepingClientsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly status: BookkeepingStatusService,
  ) {}

  // ---------- Settings ----------

  async getSettings(businessId: string): Promise<BookkeepingSettings> {
    return inFirm(this.database, businessId, (tx) => readSettings(tx, businessId));
  }

  async saveSettings(
    businessId: string,
    actor: BookkeepingActor,
    body: z.output<typeof SaveBookkeepingSettingsRequest>,
  ): Promise<BookkeepingSettings> {
    return inFirm(this.database, businessId, async (tx) => {
      const data = {
        defaultCadence: body.defaultCadence,
        closeTargetDay: body.closeTargetDay,
        upcomingReportDays: body.upcomingReportDays,
        staleSyncHours: body.staleSyncHours,
        reconToleranceCents: body.reconToleranceCents,
        statusRules: body.statusRules,
        reminderDefaults: body.reminderDefaults,
        reportSchedule: body.reportSchedule,
        documentChecklist: body.documentChecklist,
        closeChecklist: body.closeChecklist,
      } satisfies Prisma.BookkeepingSettingsUncheckedUpdateInput;
      await tx.bookkeepingSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'bookkeeping.settings.saved',
        { type: 'bookkeeping_settings', id: businessId },
        { by: actor.userId },
      );
      return readSettings(tx, businessId);
    });
  }

  // ---------- Overview ----------

  async overview(
    businessId: string,
    actor: BookkeepingActor,
    q: z.output<typeof BookkeepingOverviewQuery>,
  ): Promise<BookkeepingOverview> {
    const now = new Date();
    const today = todayOf(now);
    const range = periodRange(q.period, now);
    const year = Number(range.to.slice(0, 4));
    const earliest = [range.previousFrom, `${year}-01-01`].sort()[0] as string;
    const latest = [range.to, `${year}-12-31`].sort().at(-1) as string;
    const result = await inFirm(this.database, businessId, async (tx) => {
      const settings = await readSettings(tx, businessId);
      const profiles = await tx.bookkeepingProfile.findMany({
        where: { businessId, archivedAt: null, engagement: reachEngagement(actor) },
        select: {
          id: true,
          engagementId: true,
          status: true,
          pausedAt: true,
          nextReportDueOn: true,
          engagement: {
            select: { status: true, bookkeepingConnections: liveConnectionsArgs },
          },
        },
      });
      const active = profiles.filter(
        (p) =>
          p.pausedAt === null &&
          (p.engagement.status === 'ACTIVE' || p.engagement.status === 'PENDING'),
      );
      const ids = active.map((p) => p.engagementId);
      const periods = await tx.bookkeepingPeriod.findMany({
        where: {
          businessId,
          engagementId: { in: ids },
          periodStart: { gte: toDay(earliest) },
          periodEnd: { lte: toDay(latest) },
          incomeCents: { not: null },
          expensesCents: { not: null },
        },
        select: {
          engagementId: true,
          kind: true,
          periodStart: true,
          periodEnd: true,
          incomeCents: true,
          expensesCents: true,
        },
      });
      const upcoming = await tx.bookkeepingReport.findMany({
        where: {
          businessId,
          engagementId: { in: ids },
          status: { not: 'DELIVERED' },
          dueOn: { gte: toDay(today), lte: addDays(toDay(today), settings.upcomingReportDays) },
        },
        select: reportSelect,
        orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
        take: 5,
      });
      const names = await memberNames(tx, businessId, reportMemberIds(upcoming));
      return { settings, profiles, active, periods, upcoming, names };
    });

    const figures = result.periods.map((p) => ({
      engagementId: p.engagementId,
      periodStart: day(p.periodStart) as string,
      periodEnd: day(p.periodEnd) as string,
      kind: p.kind,
      incomeCents: p.incomeCents,
      expensesCents: p.expensesCents,
    }));
    const now_ = figurePeriodsIn(figures, range.from, range.to);
    const before = figurePeriodsIn(figures, range.previousFrom, range.previousTo);
    const totalsNow = totalsOf(now_);
    const totalsBefore = totalsOf(before);
    const kpi = (value: number, previous: number | null) => ({
      value,
      previous,
      changePercent: changePercent(value, previous),
    });
    const hasBefore = before.length > 0;
    const windowEnd = isoDay(addDays(toDay(today), result.settings.upcomingReportDays));
    const upcomingClients = result.active.filter((p) => {
      const d = day(p.nextReportDueOn);
      return d !== null && d >= today && d <= windowEnd;
    });
    const statuses = [
      'ON_TRACK',
      'NEEDS_ATTENTION',
      'MISSING_DOCUMENTS',
      'OVERDUE',
      'NOT_STARTED',
    ] as const;
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const rows = figures.filter(
        (p) =>
          p.kind === 'MONTH' &&
          p.periodStart.startsWith(month) &&
          result.active.some((a) => a.engagementId === p.engagementId),
      );
      return {
        month,
        incomeCents: rows.reduce((n, p) => n + (p.incomeCents ?? 0), 0),
        expensesCents: rows.reduce((n, p) => n + (p.expensesCents ?? 0), 0),
      };
    });
    const groups = new Map<string | null, { count: number; connected: boolean }>();
    for (const p of result.active) {
      const shown = shownConnection(p.engagement.bookkeepingConnections);
      const key = shown?.provider ?? null;
      const g = groups.get(key) ?? { count: 0, connected: false };
      g.count += 1;
      g.connected ||= shown?.status === 'CONNECTED';
      groups.set(key, g);
    }
    const clientNames = await this.clientNames(
      businessId,
      result.upcoming.map((r) => r.engagement.client.id),
    );
    await this.audit.log('bookkeeping.overview.viewed', { type: 'bookkeeping' });
    return {
      period: { key: q.period, from: range.from, to: range.to },
      kpis: {
        activeClients: kpi(result.active.length, null),
        totalIncomeCents: kpi(totalsNow.incomeCents, hasBefore ? totalsBefore.incomeCents : null),
        totalExpensesCents: kpi(
          totalsNow.expensesCents,
          hasBefore ? totalsBefore.expensesCents : null,
        ),
        netProfitCents: kpi(
          totalsNow.netProfitCents,
          hasBefore ? totalsBefore.netProfitCents : null,
        ),
        clientsWithFigures: new Set(now_.map((p) => p.engagementId)).size,
        clientsWithUpcomingReports: kpi(upcomingClients.length, null),
      },
      statusBreakdown: {
        total: result.active.length,
        items: statuses.map((status) => ({
          status,
          count: result.active.filter((p) => p.status === status).length,
        })),
      },
      monthly,
      software: [...groups.entries()]
        .map(([key, g]) => ({
          key,
          label: providerLabel(key),
          clientCount: g.count,
          connected: g.connected,
        }))
        .sort((a, b) => b.clientCount - a.clientCount || a.label.localeCompare(b.label)),
      upcomingReports: result.upcoming.map((r) => {
        const row = toReport(r, result.names, today);
        return {
          reportId: row.id,
          bookkeepingClientId: row.bookkeepingClientId,
          clientName: clientNames.get(r.engagement.client.id) ?? r.engagement.client.displayName,
          reportType: row.reportType,
          reportName: row.name,
          periodLabel: row.periodLabel,
          dueOn: row.dueOn as string,
          status: row.status,
        };
      }),
    };
  }

  private async clientNames(businessId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await inFirm(this.database, businessId, (tx) =>
      tx.client.findMany({
        where: { businessId, id: { in: ids } },
        select: { id: true, displayName: true },
      }),
    );
    return new Map(rows.map((c) => [c.id, c.displayName]));
  }

  // ---------- List ----------

  /** The list's filters; `withTab` false leaves the tab and status out, for the tab counts. */
  private where(
    businessId: string,
    actor: BookkeepingActor,
    q: ClientsQuery,
    now: Date,
    upcomingDays: number,
    withTab: boolean,
  ): Prisma.BookkeepingProfileWhereInput {
    const and: Prisma.BookkeepingProfileWhereInput[] = [
      { businessId, archivedAt: null },
      { engagement: reachEngagement(actor) },
    ];
    const today = toDay(todayOf(now));
    if (withTab) {
      if (q.status) and.push({ status: q.status });
      if (q.tab === 'UPCOMING') {
        and.push({
          nextReportDueOn: { gte: today, lte: addDays(today, upcomingDays) },
          pausedAt: null,
        });
      } else if (q.tab !== 'ALL') {
        and.push({ status: q.tab });
      }
    }
    if (q.clientType) and.push({ engagement: { client: { accountType: q.clientType } } });
    if (q.plan) and.push({ engagement: { package: { equals: q.plan, mode: 'insensitive' } } });
    if (q.software === 'NOT_CONNECTED') {
      and.push({
        engagement: { bookkeepingConnections: { none: { status: { not: 'DISCONNECTED' } } } },
      });
    } else if (q.software) {
      and.push({
        engagement: {
          bookkeepingConnections: {
            some: { provider: q.software, status: { not: 'DISCONNECTED' } },
          },
        },
      });
    }
    if (q.assignedUserId) and.push({ engagement: { assignedUserId: q.assignedUserId } });
    if (q.paused) and.push({ pausedAt: q.paused === 'true' ? { not: null } : null });
    if (q.reportDueFrom) and.push({ nextReportDueOn: { gte: toDay(q.reportDueFrom) } });
    if (q.reportDueTo) and.push({ nextReportDueOn: { lte: toDay(q.reportDueTo) } });
    if (q.search) {
      const number = /^(?:CL-)?(\d{1,9})$/i.exec(q.search)?.[1];
      and.push({
        engagement: {
          client: {
            OR: [
              { displayName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              ...(number ? [{ clientNumber: Number(number) }] : []),
            ],
          },
        },
      });
    }
    return { AND: and };
  }

  private toRow(
    r: ListRow,
    names: Map<string, string>,
    staleHours: number,
    now: Date,
  ): BookkeepingClientRow {
    const shown = shownConnection(r.engagement.bookkeepingConnections);
    return {
      id: r.id,
      client: toClientRef(r.engagement.client),
      engagementId: r.engagementId,
      plan: r.engagement.package,
      assignedTo: memberRefOf(names, r.engagement.assignedUserId),
      software: shown
        ? { key: shown.provider, label: providerLabel(shown.provider), status: shown.status }
        : null,
      status: r.status,
      statusSource: r.statusSource,
      statusReason: r.statusReason,
      cadence: r.cadence,
      syncStatus: syncStatusOf(shown, staleHours, now),
      lastSyncedAt: iso(shown?.lastSuccessfulSyncAt ?? null),
      nextReportDueOn: day(r.nextReportDueOn),
      paused: r.pausedAt !== null,
    };
  }

  async list(
    businessId: string,
    actor: BookkeepingActor,
    q: ClientsQuery,
  ): Promise<BookkeepingClientPage> {
    const now = new Date();
    const { rows, total, names, settings, counts, upcoming } = await inFirm(
      this.database,
      businessId,
      async (tx) => {
        const settings = await readSettings(tx, businessId);
        const where = this.where(businessId, actor, q, now, settings.upcomingReportDays, true);
        const base = this.where(businessId, actor, q, now, settings.upcomingReportDays, false);
        const today = toDay(todayOf(now));
        const [rows, total, counts, upcoming] = await Promise.all([
          tx.bookkeepingProfile.findMany({
            where,
            select: listSelect,
            orderBy: [SORTS[q.sort](q.direction), { id: 'asc' }],
            ...skipTake(q),
          }),
          tx.bookkeepingProfile.count({ where }),
          tx.bookkeepingProfile.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
          tx.bookkeepingProfile.count({
            where: {
              AND: [
                base,
                {
                  nextReportDueOn: { gte: today, lte: addDays(today, settings.upcomingReportDays) },
                  pausedAt: null,
                },
              ],
            },
          }),
        ]);
        const names = await memberNames(
          tx,
          businessId,
          rows.map((r) => r.engagement.assignedUserId),
        );
        return { rows, total, names, settings, counts, upcoming };
      },
    );
    const byStatus = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
    const tabCounts: Record<BookkeepingClientTab, number> = {
      ALL: counts.reduce((n, c) => n + c._count._all, 0),
      ON_TRACK: byStatus('ON_TRACK'),
      NEEDS_ATTENTION: byStatus('NEEDS_ATTENTION'),
      MISSING_DOCUMENTS: byStatus('MISSING_DOCUMENTS'),
      OVERDUE: byStatus('OVERDUE'),
      NOT_STARTED: byStatus('NOT_STARTED'),
      UPCOMING: upcoming,
    };
    await this.audit.log(
      'bookkeeping.clients.listed',
      { type: 'bookkeeping' },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => this.toRow(r, names, settings.staleSyncHours, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      tabCounts,
    };
  }

  /** The list's filters as a CSV (needs the grid's EXPORT). No figures. */
  async exportCsv(businessId: string, actor: BookkeepingActor, q: ClientsQuery): Promise<string> {
    const now = new Date();
    const { rows, settings, names } = await inFirm(this.database, businessId, async (tx) => {
      const settings = await readSettings(tx, businessId);
      const rows = await tx.bookkeepingProfile.findMany({
        where: this.where(businessId, actor, q, now, settings.upcomingReportDays, true),
        select: listSelect,
        orderBy: [SORTS[q.sort](q.direction), { id: 'asc' }],
        take: EXPORT_LIMIT,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.engagement.assignedUserId),
      );
      return { rows, settings, names };
    });
    const lines = [
      csvRow([
        'Client',
        'Client number',
        'Type',
        'Plan',
        'Accounting software',
        'Status',
        'Reason',
        'Sync',
        'Last synced',
        'Next report due',
        'Assigned to',
        'Paused',
      ]),
    ];
    for (const r of rows) {
      const row = this.toRow(r, names, settings.staleSyncHours, now);
      lines.push(
        csvRow([
          row.client.displayName,
          row.client.clientNumber,
          row.client.accountType,
          row.plan,
          row.software?.label ?? 'Not connected',
          row.status,
          row.statusReason,
          row.syncStatus,
          row.lastSyncedAt,
          row.nextReportDueOn,
          row.assignedTo?.name,
          row.paused ? 'Yes' : 'No',
        ]),
      );
    }
    await this.audit.log(
      'bookkeeping.clients.exported',
      { type: 'bookkeeping' },
      { count: rows.length },
    );
    return `${lines.join('\r\n')}\r\n`;
  }

  // ---------- Add ----------

  async add(
    businessId: string,
    actor: BookkeepingActor,
    body: z.output<typeof AddBookkeepingClientRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    const id = await inFirm(this.database, businessId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { businessId, id: body.clientId, archivedAt: null },
        select: { id: true, assignedUserId: true },
      });
      if (!client) throw errors.notFound();
      if (body.assignedUserId) await checkAssignee(tx, businessId, body.assignedUserId, client);
      if (body.reviewerUserId) await this.checkReviewer(tx, businessId, body.reviewerUserId);
      let engagement = await tx.engagement.findFirst({
        where: {
          businessId,
          clientId: client.id,
          status: { in: ['ACTIVE', 'PENDING'] },
          service: { kind: 'BOOKKEEPING' },
        },
        select: { id: true, bookkeepingProfile: { select: { id: true } } },
      });
      if (!engagement) {
        const service = await tx.service.findFirst({
          where: { businessId, kind: 'BOOKKEEPING', status: 'ACTIVE', archivedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!service) throw errors.noBookkeepingService();
        const created = await tx.engagement.create({
          data: {
            businessId,
            clientId: client.id,
            serviceId: service.id,
            title: 'Bookkeeping',
            package: body.plan ?? null,
            assignedUserId: body.assignedUserId ?? client.assignedUserId,
          },
          select: { id: true },
        });
        engagement = { id: created.id, bookkeepingProfile: null };
      }
      if (engagement.bookkeepingProfile) throw errors.alreadyBookkeepingClient();
      const settings = await readSettings(tx, businessId);
      const cadence = body.cadence ?? settings.defaultCadence;
      if (cadence === 'CUSTOM' && !body.cadenceMonths) {
        throw errors.invalid('cadenceMonths', 'Say how many months a custom cadence covers');
      }
      const months = cadence === 'CUSTOM' ? (body.cadenceMonths ?? null) : null;
      const next = nextReportDue({
        cadence,
        cadenceMonths: months,
        closeTargetDay: settings.closeTargetDay,
        lastCompletedEnd: null,
        today: new Date(),
      });
      let created;
      try {
        created = await tx.bookkeepingProfile.create({
          data: {
            businessId,
            engagementId: engagement.id,
            cadence,
            cadenceMonths: months,
            nextReportDueOn: toDay(next.dueOn),
            reviewerUserId: body.reviewerUserId ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.alreadyBookkeepingClient();
        throw e;
      }
      await addActivity(
        tx,
        businessId,
        engagement.id,
        actor.userId,
        'PLAN_CHANGE',
        'Added to Bookkeeping',
        {
          clientId: client.id,
        },
      );
      await this.status.refresh(tx, businessId, engagement.id, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.client.added',
        { type: 'bookkeeping_client', id: created.id },
        { clientId: client.id },
      );
      return created.id;
    });
    return this.get(businessId, actor, id, false);
  }

  /** A reviewer is an active member of this firm (FOR SHARE keeps them so until the change commits). */
  private async checkReviewer(tx: TxClient, businessId: string, userId: string) {
    const [member] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM memberships
      WHERE business_id = ${businessId}::uuid AND user_id = ${userId}::uuid
      FOR SHARE`;
    if (!member || member.status !== 'ACTIVE') {
      throw errors.invalid('reviewerUserId', 'The reviewer is not an active member of the firm');
    }
  }

  // ---------- Workspace ----------

  async get(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    log = true,
  ): Promise<BookkeepingClientWorkspace> {
    const now = new Date();
    const today = todayOf(now);
    const data = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const e = p.engagementId;
      const settings = await readSettings(tx, businessId);
      const [
        connections,
        accounts,
        periods,
        upcoming,
        activity,
        tasksOpen,
        tasksOverdue,
        documents,
        requests,
        notes,
      ] = await Promise.all([
        tx.bookkeepingConnection.findMany({
          where: { businessId, engagementId: e },
          orderBy: [{ connectedAt: 'desc' }, { id: 'asc' }],
        }),
        tx.bookkeepingAccount.findMany({
          where: { businessId, engagementId: e, archivedAt: null },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.bookkeepingPeriod.findMany({
          where: { businessId, engagementId: e },
          select: periodSelect,
          orderBy: [{ periodStart: 'desc' }, { id: 'asc' }],
          take: 60,
        }),
        tx.bookkeepingReport.findMany({
          where: { businessId, engagementId: e, status: { not: 'DELIVERED' } },
          select: reportSelect,
          orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          take: 5,
        }),
        tx.bookkeepingActivity.findMany({
          where: { businessId, engagementId: e },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
        }),
        tx.task.count({ where: { businessId, engagementId: e, status: 'OPEN' } }),
        tx.task.count({
          where: { businessId, engagementId: e, status: 'OPEN', dueOn: { lt: toDay(today) } },
        }),
        tx.document.count({ where: { businessId, engagementId: e, archivedAt: null } }),
        tx.documentRequest.count({
          where: { businessId, engagementId: e, status: { in: ['REQUESTED', 'REJECTED'] } },
        }),
        tx.note.count({ where: { businessId, engagementId: e } }),
      ]);
      const members = [
        p.engagement.assignedUserId,
        p.reviewerUserId,
        ...activity.map((a) => a.actorUserId),
        ...reportMemberIds(upcoming),
      ];
      const names = await memberNames(tx, businessId, members);
      return {
        p,
        settings,
        connections,
        accounts,
        periods,
        upcoming,
        activity,
        names,
        shared: {
          openTasks: tasksOpen,
          overdueTasks: tasksOverdue,
          documents,
          outstandingDocumentRequests: requests,
          notes,
        },
      };
    });
    if (log) {
      await this.audit.log('bookkeeping.client.viewed', { type: 'bookkeeping_client', id });
    }
    const { p, settings, periods } = data;
    const summaries = periods.map((x) => toPeriodSummary(x, today));
    const current = summaries.find((s) => s.status !== 'CLOSED') ?? summaries[0] ?? null;
    const year = now.getUTCFullYear();
    const figures = periods.map((x) => ({
      engagementId: p.engagementId,
      periodStart: day(x.periodStart) as string,
      periodEnd: day(x.periodEnd) as string,
      kind: x.kind,
      label: x.label,
      incomeCents: x.incomeCents,
      expensesCents: x.expensesCents,
    }));
    const ytdPeriods = figurePeriodsIn(figures, `${year}-01-01`, `${year}-12-31`);
    const ytd = totalsOf(ytdPeriods);
    const trend = figures
      .filter((f) => f.kind === 'MONTH' && f.incomeCents !== null && f.expensesCents !== null)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
      .slice(-12);
    return {
      id: p.id,
      client: {
        ...toClientRef(p.engagement.client),
        email: p.engagement.client.email,
        phone: p.engagement.client.phone,
      },
      engagementId: p.engagementId,
      engagementStatus: p.engagement.status,
      plan: p.engagement.package,
      clientSince: p.engagement.createdAt.toISOString(),
      assignedTo: memberRefOf(data.names, p.engagement.assignedUserId),
      reviewer: memberRefOf(data.names, p.reviewerUserId),
      status: p.status,
      statusSource: p.statusSource,
      statusReason: p.statusReason,
      statusChangedAt: p.statusChangedAt.toISOString(),
      cadence: p.cadence,
      cadenceMonths: p.cadenceMonths,
      closeTargetDay: p.closeTargetDay ?? settings.closeTargetDay,
      nextReportDueOn: day(p.nextReportDueOn),
      paused: p.pausedAt !== null,
      pausedAt: iso(p.pausedAt),
      pauseReason: p.pauseReason,
      archived: p.archivedAt !== null,
      portalDefaults: p.portalDefaults as PortalDefaults,
      alerts: p.alerts as BookkeepingAlerts,
      reportSchedule: p.reportSchedule as ReportScheduleItem[] | null,
      documentChecklist: p.documentChecklist as DocumentChecklistItem[] | null,
      categorizationRules: p.categorizationRules as CategorizationRule[],
      connections: data.connections.map((c) => toConnection(c, settings.staleSyncHours, now)),
      accounts: data.accounts.map(toAccount),
      currentPeriod: current,
      kpis: {
        incomeCents: current?.incomeCents ?? null,
        expensesCents: current?.expensesCents ?? null,
        netProfitCents: current?.netProfitCents ?? null,
        uncategorizedCount: current?.uncategorizedCount ?? null,
      },
      yearToDate:
        ytdPeriods.length === 0
          ? null
          : {
              ...ytd,
              expenseRatioPercent:
                ytd.incomeCents === 0
                  ? null
                  : Math.round((ytd.expensesCents / ytd.incomeCents) * 1000) / 10,
            },
      trend: trend.map((t) => ({
        label: t.label,
        month: t.periodStart.slice(0, 7),
        incomeCents: t.incomeCents as number,
        expensesCents: t.expensesCents as number,
      })),
      upcomingReports: data.upcoming.map((r) => toReport(r, data.names, today)),
      shared: data.shared,
      recentActivity: data.activity.map((a) => toActivity(a, data.names)),
    };
  }

  // ---------- Service actions ----------

  private lockFor(tx: TxClient, businessId: string, actor: BookkeepingActor, id: string) {
    return lockProfile(tx, businessId, actor, id);
  }

  async update(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingClientRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    const managerFields = [
      'cadence',
      'cadenceMonths',
      'closeTargetDay',
      'reviewerUserId',
      'nextReportDueOn',
      'reportSchedule',
      'documentChecklist',
    ] as const;
    if (!isManager(actor) && managerFields.some((k) => body[k] !== undefined)) {
      throw errors.forbidden();
    }
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      const settings = await readSettings(tx, businessId);
      const data: Prisma.BookkeepingProfileUncheckedUpdateInput = {};
      let recompute = false;
      if (body.cadence !== undefined || body.cadenceMonths !== undefined) {
        const cadence = body.cadence ?? p.cadence;
        const months = cadence === 'CUSTOM' ? (body.cadenceMonths ?? p.cadenceMonths) : null;
        if (cadence === 'CUSTOM' && !months) {
          throw errors.invalid('cadenceMonths', 'Say how many months a custom cadence covers');
        }
        if (cadence !== 'CUSTOM' && body.cadenceMonths) {
          throw errors.invalid('cadenceMonths', 'Months apply to a custom cadence only');
        }
        data.cadence = cadence;
        data.cadenceMonths = months;
        recompute = true;
      }
      if (body.closeTargetDay !== undefined) {
        data.closeTargetDay = body.closeTargetDay;
        recompute = true;
      }
      if (body.reviewerUserId !== undefined) {
        if (body.reviewerUserId) await this.checkReviewer(tx, businessId, body.reviewerUserId);
        data.reviewerUserId = body.reviewerUserId;
      }
      if (body.portalDefaults !== undefined) {
        data.portalDefaults = { ...(p.portalDefaults as object), ...body.portalDefaults };
      }
      if (body.alerts !== undefined) data.alerts = { ...(p.alerts as object), ...body.alerts };
      if (body.categorizationRules !== undefined)
        data.categorizationRules = body.categorizationRules;
      if (body.reportSchedule !== undefined) {
        data.reportSchedule = body.reportSchedule === null ? Prisma.DbNull : body.reportSchedule;
      }
      if (body.documentChecklist !== undefined) {
        data.documentChecklist =
          body.documentChecklist === null ? Prisma.DbNull : body.documentChecklist;
      }
      if (body.nextReportDueOn !== undefined) {
        data.nextReportDueOn = body.nextReportDueOn ? toDay(body.nextReportDueOn) : null;
      } else if (recompute) {
        const due = nextReportDue({
          cadence: (data.cadence as typeof p.cadence | undefined) ?? p.cadence,
          cadenceMonths:
            data.cadenceMonths !== undefined
              ? (data.cadenceMonths as number | null)
              : p.cadenceMonths,
          closeTargetDay:
            data.closeTargetDay !== undefined
              ? ((data.closeTargetDay as number | null) ?? settings.closeTargetDay)
              : (p.closeTargetDay ?? settings.closeTargetDay),
          lastCompletedEnd: await this.status.lastCompletedEnd(tx, businessId, p.engagementId),
          today: new Date(),
        });
        data.nextReportDueOn = toDay(due.dueOn);
      }
      await tx.bookkeepingProfile.update({ where: { id }, data });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'OTHER',
        'Bookkeeping settings changed',
        {
          fields: sentFields(body, Object.keys(body) as (keyof typeof body & string)[]).join(','),
        },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.client.updated',
        { type: 'bookkeeping_client', id },
        {
          clientId: p.engagement.clientId,
          fields: sentFields(body, Object.keys(body) as (keyof typeof body & string)[]),
        },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async setStatus(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof BookkeepingStatusRequest>,
  ): Promise<BookkeepingClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      if (body.status === 'AUTOMATIC') {
        await tx.bookkeepingProfile.update({ where: { id }, data: { statusSource: 'AUTOMATIC' } });
        await addActivity(
          tx,
          businessId,
          p.engagementId,
          actor.userId,
          'STATUS_CHANGE',
          'Status handed back to the rules',
          {
            from: p.status,
          },
        );
        // Paused clients keep their status until resumed.
        await this.status.refresh(tx, businessId, p.engagementId, actor.userId);
      } else {
        await tx.bookkeepingProfile.update({
          where: { id },
          data: { status: body.status, statusSource: 'MANUAL', statusReason: body.reason ?? null },
        });
        await addActivity(
          tx,
          businessId,
          p.engagementId,
          actor.userId,
          'STATUS_CHANGE',
          `Status changed from ${p.status} to ${body.status}`,
          { from: p.status, to: body.status, source: 'MANUAL' },
        );
      }
      await this.audit.logIn(
        tx,
        'bookkeeping.client.status_changed',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId, from: p.status, to: body.status },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async pause(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    reason: string,
  ): Promise<BookkeepingClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      if (p.pausedAt) throw errors.clientState('This bookkeeping client is already paused');
      await tx.bookkeepingProfile.update({
        where: { id },
        data: { pausedAt: new Date(), pauseReason: reason },
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'PAUSE',
        'Bookkeeping paused',
      );
      await this.audit.logIn(
        tx,
        'bookkeeping.client.paused',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async resume(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      if (!p.pausedAt) throw errors.clientState('This bookkeeping client is not paused');
      await tx.bookkeepingProfile.update({
        where: { id },
        data: { pausedAt: null, pauseReason: null },
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'RESUME',
        'Bookkeeping resumed',
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId);
      await this.audit.logIn(
        tx,
        'bookkeeping.client.resumed',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async archive(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    reason: string | null | undefined,
  ): Promise<BookkeepingClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      await tx.bookkeepingProfile.update({ where: { id }, data: { archivedAt: new Date() } });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'ARCHIVE',
        reason ? `Archived: ${reason}`.slice(0, 300) : 'Archived',
      );
      await this.audit.logIn(
        tx,
        'bookkeeping.client.archived',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async assign(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    assignedUserId: string | null,
  ): Promise<BookkeepingClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      if (assignedUserId) {
        const client = {
          assignedUserId: await this.clientAssignee(tx, businessId, p.engagement.clientId),
        };
        await checkAssignee(tx, businessId, assignedUserId, client);
      }
      if (assignedUserId !== p.engagement.assignedUserId) {
        await tx.engagement.update({
          where: { businessId_id: { businessId, id: p.engagementId } },
          data: { assignedUserId, updatedByUserId: actor.userId },
        });
        await addActivity(
          tx,
          businessId,
          p.engagementId,
          actor.userId,
          'ASSIGNMENT',
          assignedUserId ? 'Bookkeeper assigned' : 'Bookkeeper removed',
        );
      }
      await this.audit.logIn(
        tx,
        'bookkeeping.client.assigned',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  private async clientAssignee(tx: TxClient, businessId: string, clientId: string) {
    const c = await tx.client.findFirst({
      where: { businessId, id: clientId },
      select: { assignedUserId: true },
    });
    return c?.assignedUserId ?? null;
  }

  /** Re-works the status of every client the rules set (Owner and Admin). */
  async refreshStatuses(
    businessId: string,
    actor: BookkeepingActor,
  ): Promise<BookkeepingStatusRefreshed> {
    const result = await inFirm(this.database, businessId, async (tx) => {
      const settings = await readSettings(tx, businessId);
      const profiles = await tx.bookkeepingProfile.findMany({
        where: { businessId, archivedAt: null, pausedAt: null, statusSource: 'AUTOMATIC' },
        select: { engagementId: true },
        take: EXPORT_LIMIT,
      });
      let changed = 0;
      for (const p of profiles) {
        if (await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings))
          changed += 1;
      }
      await this.audit.logIn(
        tx,
        'bookkeeping.statuses.refreshed',
        { type: 'bookkeeping' },
        { checked: profiles.length, changed },
      );
      return { checked: profiles.length, changed };
    });
    return result;
  }

  // ---------- Sync ----------

  /**
   * Records a request to sync the client's CONNECTED accounting connections: a RUNNING sync run
   * for each, finished by the integration worker (never here). A connection that already has a
   * run under way is left alone, so asking twice never doubles the work.
   */
  private async queueSync(
    tx: TxClient,
    businessId: string,
    actor: BookkeepingActor,
    engagementId: string,
    now: Date,
  ): Promise<number> {
    const connections = await tx.bookkeepingConnection.findMany({
      where: { businessId, engagementId, status: 'CONNECTED' },
      select: { id: true },
    });
    let queued = 0;
    for (const c of connections) {
      const running = await tx.bookkeepingSyncRun.count({
        where: {
          businessId,
          connectionId: c.id,
          outcome: 'RUNNING',
          startedAt: { gte: addDays(now, -1) },
        },
      });
      if (running > 0) continue;
      await tx.bookkeepingSyncRun.create({
        data: {
          businessId,
          connectionId: c.id,
          trigger: 'MANUAL',
          requestedByUserId: actor.userId,
          startedAt: now,
        },
      });
      await tx.bookkeepingConnection.update({
        where: { businessId_id: { businessId, id: c.id } },
        data: { lastSyncAt: now },
      });
      queued += 1;
    }
    if (queued > 0) {
      await addActivity(tx, businessId, engagementId, actor.userId, 'SYNC', 'Sync requested', {
        runs: queued,
      });
    }
    return queued;
  }

  async sync(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingSyncQueued> {
    const requestedAt = new Date();
    const queued = await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      const has = await tx.bookkeepingConnection.count({
        where: { businessId, engagementId: p.engagementId, status: 'CONNECTED' },
      });
      if (has === 0) throw errors.notConnected();
      const n = await this.queueSync(tx, businessId, actor, p.engagementId, requestedAt);
      await this.audit.logIn(
        tx,
        'bookkeeping.client.sync_queued',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId, runs: n },
      );
      return n;
    });
    return { queued, requestedAt: requestedAt.toISOString() };
  }

  /** Sync All Clients: every reachable, unpaused client with a CONNECTED connection. */
  async syncAll(businessId: string, actor: BookkeepingActor): Promise<BookkeepingSyncQueued> {
    const requestedAt = new Date();
    const queued = await inFirm(this.database, businessId, async (tx) => {
      const profiles = await tx.bookkeepingProfile.findMany({
        where: {
          businessId,
          archivedAt: null,
          pausedAt: null,
          engagement: {
            AND: [
              reachEngagement(actor),
              { bookkeepingConnections: { some: { status: 'CONNECTED' } } },
            ],
          },
        },
        select: { engagementId: true },
        take: EXPORT_LIMIT,
      });
      let n = 0;
      for (const p of profiles)
        n += await this.queueSync(tx, businessId, actor, p.engagementId, requestedAt);
      await this.audit.logIn(
        tx,
        'bookkeeping.sync_all.queued',
        { type: 'bookkeeping' },
        { runs: n, clients: profiles.length },
      );
      return n;
    });
    return { queued, requestedAt: requestedAt.toISOString() };
  }

  // ---------- Activity ----------

  async activities(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: ListQuery,
  ): Promise<BookkeepingActivityList> {
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const where = { businessId, engagementId: p.engagementId };
      const [rows, total] = await Promise.all([
        tx.bookkeepingActivity.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.bookkeepingActivity.count({ where }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.actorUserId),
      );
      return { rows, total, names };
    });
    await this.audit.log(
      'bookkeeping.activities.listed',
      { type: 'bookkeeping_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toActivity(r, names)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async logActivity(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof LogBookkeepingActivityRequest>,
  ): Promise<BookkeepingActivity> {
    const { row, names } = await inFirm(this.database, businessId, async (tx) => {
      const p = await this.lockFor(tx, businessId, actor, id);
      const row = await tx.bookkeepingActivity.create({
        data: {
          businessId,
          engagementId: p.engagementId,
          kind: body.kind,
          summary: body.summary,
          actorUserId: actor.userId,
        },
      });
      await this.audit.logIn(
        tx,
        'bookkeeping.activity.logged',
        { type: 'bookkeeping_client', id },
        { clientId: p.engagement.clientId, kind: body.kind },
      );
      const names = await memberNames(tx, businessId, [actor.userId]);
      return { row, names };
    });
    return toActivity(row, names);
  }
}
