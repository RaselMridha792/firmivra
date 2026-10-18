import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AddPayrollClientRequest,
  LogPayrollActivityRequest,
  PayrollActivity,
  PayrollActivityList,
  PayrollAssignRequest,
  PayrollChangeList,
  PayrollClientPage,
  PayrollClientRow as PayrollClientRowDto,
  PayrollClientsQuery,
  PayrollClientTab,
  PayrollClientWorkspace,
  PayrollFrequencyRequest,
  PayrollListQuery,
  PayrollOverview,
  PayrollOverviewQuery,
  PayrollPlanRequest,
  PayrollReasonRequest,
  PayrollRemoveServiceRequest,
  PayrollSettings,
  PayrollStatusRequest,
  PayrollSyncQueued,
  SavePayrollSettingsRequest,
  UpdatePayrollClientRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { checkAssignee, isUniqueViolation, lockClient, memberNames } from '../workspaces/common.js';
import {
  clientRefSelect,
  findPayrollClient,
  iso,
  isManager,
  memberRefOf,
  type PayrollActor,
  reachWhere,
  skipTake,
  taxesOf,
  toClientRef,
  toRunRow,
  toWorker,
  runRowSelect,
  workerSelect,
} from './payroll.mappers.js';
import {
  changePercent,
  csvRow,
  day,
  errors,
  inFirm,
  periodRange,
  providerLabel,
  providerRef,
  sharePercent,
  syncStatusOf,
  toDay,
} from './payroll.shared.js';

type ClientsQuery = z.output<typeof PayrollClientsQuery>;
type ListQuery = z.output<typeof PayrollListQuery>;

const DEFAULT_REMINDER_DAYS = 3;
const DEFAULT_STALE_HOURS = 48;
const EXPORT_LIMIT = 5_000;
/** The statuses that count as an active payroll client. */
const INACTIVE = ['ON_HOLD', 'ARCHIVED'] as const;
const PROCESSED = ['SUBMITTED', 'PROCESSING', 'COMPLETED'] as const;
const SORTS = {
  clientName: (d: 'asc' | 'desc') => ({ client: { displayName: d } }),
  provider: (d: 'asc' | 'desc') => ({ providerKey: { sort: d, nulls: 'last' as const } }),
  frequency: (d: 'asc' | 'desc') => ({ frequency: { sort: d, nulls: 'last' as const } }),
  employees: (d: 'asc' | 'desc') => ({ employeeCount: { sort: d, nulls: 'last' as const } }),
  status: (d: 'asc' | 'desc') => ({ status: d }),
  nextPayrollOn: (d: 'asc' | 'desc') => ({ nextPayrollOn: { sort: d, nulls: 'last' as const } }),
  lastRunOn: (d: 'asc' | 'desc') => ({ lastRunOn: { sort: d, nulls: 'last' as const } }),
};

const todayUtc = (now: Date) => toDay(now.toISOString().slice(0, 10));
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

const listSelect = {
  id: true,
  engagementId: true,
  providerKey: true,
  frequency: true,
  employeeCount: true,
  status: true,
  nextPayrollOn: true,
  nextPayrollSource: true,
  lastRunOn: true,
  lastSyncedAt: true,
  assignedUserId: true,
  client: { select: clientRefSelect },
  connection: { select: { status: true } },
} satisfies Prisma.PayrollClientSelect;

/**
 * The payroll clients of the firm: the overview, the list and the Client Payroll Workspace with
 * its service actions. Every change writes a payroll_client_changes row and an audit row in the
 * same transaction. Figures come from confirmed runs and provider reports only; nothing is
 * estimated.
 */
@Injectable()
export class PayrollClientsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  // ---------- Overview ----------

  async overview(
    businessId: string,
    actor: PayrollActor,
    q: z.output<typeof PayrollOverviewQuery>,
  ): Promise<PayrollOverview> {
    const now = new Date();
    const range = periodRange(q.period, now);
    const year = Number(range.to.slice(0, 4));
    const earliest = [range.previousFrom, `${year}-01-01`].sort()[0] as string;
    const latest = [range.to, `${year}-12-31`].sort().at(-1) as string;
    const result = await inFirm(this.database, businessId, async (tx) => {
      const reach = reachWhere(actor);
      const clients = await tx.payrollClient.findMany({
        where: { AND: [{ businessId, status: { not: 'ARCHIVED' } }, reach] },
        select: {
          id: true,
          status: true,
          providerKey: true,
          frequency: true,
          employeeCount: true,
          nextPayrollOn: true,
          client: { select: { displayName: true } },
          connection: { select: { status: true } },
        },
      });
      const runs = await tx.payrollRun.findMany({
        where: {
          businessId,
          payDate: { gte: toDay(earliest), lte: toDay(latest) },
          payrollClient: { AND: [{ status: { not: 'ARCHIVED' } }, reach] },
        },
        select: {
          payDate: true,
          status: true,
          figuresConfirmed: true,
          grossCents: true,
          employeeTaxesCents: true,
          employerTaxesCents: true,
          deductionsCents: true,
          payrollClient: { select: { providerKey: true } },
        },
      });
      const attention = await tx.payrollRun.count({
        where: {
          businessId,
          status: 'NEEDS_ATTENTION',
          payrollClient: { AND: [{ status: { not: 'ARCHIVED' } }, reach] },
        },
      });
      return { clients, runs, attention };
    });

    const inRange = (d: Date, from: string, to: string) => {
      const s = day(d) as string;
      return s >= from && s <= to;
    };
    const processed = result.runs.filter(
      (r) =>
        r.figuresConfirmed && (PROCESSED as readonly string[]).includes(r.status) && r.grossCents,
    );
    const gross = (from: string, to: string) =>
      processed
        .filter((r) => inRange(r.payDate, from, to))
        .reduce((n, r) => n + (r.grossCents ?? 0), 0);
    const runCount = (from: string, to: string) =>
      result.runs.filter((r) => inRange(r.payDate, from, to)).length;

    const active = result.clients.filter(
      (c) => !(INACTIVE as readonly string[]).includes(c.status),
    );
    const processedNow = gross(range.from, range.to);
    const processedBefore = gross(range.previousFrom, range.previousTo);
    const runsNow = runCount(range.from, range.to);
    const runsBefore = runCount(range.previousFrom, range.previousTo);
    const needAttention =
      result.clients.filter((c) => c.status === 'ACTION_REQUIRED' || c.status === 'PAST_DUE')
        .length + result.attention;

    const statuses = [
      'ON_TRACK',
      'PROCESSING',
      'ACTION_REQUIRED',
      'PAST_DUE',
      'NOT_STARTED',
      'ON_HOLD',
    ] as const;
    const volume = Array.from({ length: 12 }, (_, i) => {
      const month = `${year}-${String(i + 1).padStart(2, '0')}`;
      const rows = processed.filter((r) => monthKey(r.payDate) === month);
      return {
        month,
        grossCents: rows.reduce((n, r) => n + (r.grossCents ?? 0), 0),
        taxesAndDeductionsCents: rows.reduce(
          (n, r) =>
            n +
            (r.employeeTaxesCents ?? 0) +
            (r.employerTaxesCents ?? 0) +
            (r.deductionsCents ?? 0),
          0,
        ),
      };
    });

    const byKey = new Map<string | null, number>();
    for (const r of processed.filter((r) => inRange(r.payDate, range.from, range.to))) {
      const key = r.payrollClient.providerKey;
      byKey.set(key, (byKey.get(key) ?? 0) + (r.grossCents ?? 0));
    }
    const providerGroups = new Map<string | null, { count: number; connected: boolean }>();
    for (const c of active) {
      const g = providerGroups.get(c.providerKey) ?? { count: 0, connected: false };
      g.count += 1;
      g.connected ||= c.connection?.status === 'CONNECTED';
      providerGroups.set(c.providerKey, g);
    }

    return {
      period: { key: q.period, from: range.from, to: range.to },
      kpis: {
        activeClients: { value: active.length, previous: null, changePercent: null },
        totalProcessedCents: {
          value: processedNow,
          previous: processedBefore,
          changePercent: changePercent(processedNow, processedBefore),
        },
        totalEmployees: {
          value: active.reduce((n, c) => n + (c.employeeCount ?? 0), 0),
          previous: null,
          changePercent: null,
        },
        runs: {
          value: runsNow,
          previous: runsBefore,
          changePercent: changePercent(runsNow, runsBefore),
        },
        needAttention: { value: needAttention, previous: null, changePercent: null },
      },
      statusBreakdown: {
        total: result.clients.length,
        items: statuses.map((status) => ({
          status,
          count: result.clients.filter((c) => c.status === status).length,
        })),
      },
      volume,
      byProvider: {
        totalCents: processedNow,
        items: [...byKey.entries()]
          .map(([key, grossCents]) => ({
            key,
            label: providerLabel(key),
            grossCents,
            sharePercent: sharePercent(grossCents, processedNow),
          }))
          .sort((a, b) => b.grossCents - a.grossCents || a.label.localeCompare(b.label)),
      },
      providers: [...providerGroups.entries()]
        .map(([key, g]) => ({
          key,
          label: providerLabel(key),
          clientCount: g.count,
          connected: g.connected,
        }))
        .sort((a, b) => b.clientCount - a.clientCount || a.label.localeCompare(b.label)),
      upcomingRuns: active
        .filter((c) => c.nextPayrollOn && day(c.nextPayrollOn)! >= day(todayUtc(now))!)
        .sort((a, b) => a.nextPayrollOn!.getTime() - b.nextPayrollOn!.getTime())
        .slice(0, 5)
        .map((c) => ({
          payrollClientId: c.id,
          clientName: c.client.displayName,
          frequency: c.frequency,
          nextPayrollOn: day(c.nextPayrollOn) as string,
        })),
    };
  }

  // ---------- List ----------

  private async staleHours(tx: TxClient, businessId: string): Promise<number> {
    const s = await tx.payrollSettings.findUnique({ where: { businessId } });
    return s?.staleAfterHours ?? DEFAULT_STALE_HOURS;
  }

  /** The list's filters; `withTab` false leaves the tab and status out, for the tab counts. */
  private where(
    businessId: string,
    actor: PayrollActor,
    q: ClientsQuery,
    now: Date,
    staleHours: number,
    withTab: boolean,
  ): Prisma.PayrollClientWhereInput {
    const and: Prisma.PayrollClientWhereInput[] = [{ businessId }, reachWhere(actor)];
    const today = todayUtc(now);
    if (withTab) {
      and.push({ status: q.status ?? { not: 'ARCHIVED' } });
      if (q.tab === 'UPCOMING') {
        and.push({ nextPayrollOn: { gte: today }, status: { notIn: [...INACTIVE] } });
      } else if (q.tab !== 'ALL') {
        and.push({ status: q.tab });
      }
    } else {
      and.push({ status: { not: 'ARCHIVED' } });
    }
    if (q.clientType) and.push({ client: { accountType: q.clientType } });
    if (q.providerKey) and.push({ providerKey: q.providerKey });
    if (q.frequency) and.push({ frequency: q.frequency });
    if (q.assignedUserId) and.push({ assignedUserId: q.assignedUserId });
    if (q.nextFrom) and.push({ nextPayrollOn: { gte: toDay(q.nextFrom) } });
    if (q.nextTo) and.push({ nextPayrollOn: { lte: toDay(q.nextTo) } });
    if (q.syncStatus) {
      const connected: Prisma.PayrollClientWhereInput = { connection: { status: 'CONNECTED' } };
      const cutoff = new Date(now.getTime() - staleHours * 3_600_000);
      and.push(
        q.syncStatus === 'NOT_CONNECTED'
          ? { NOT: connected }
          : q.syncStatus === 'NEVER'
            ? { AND: [connected, { lastSyncedAt: null }] }
            : q.syncStatus === 'STALE'
              ? { AND: [connected, { lastSyncedAt: { lt: cutoff } }] }
              : { AND: [connected, { lastSyncedAt: { gte: cutoff } }] },
      );
    }
    if (q.search) {
      const number = /^(?:CL-)?(\d{1,9})$/i.exec(q.search)?.[1];
      and.push({
        client: {
          OR: [
            { displayName: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
            ...(number ? [{ clientNumber: Number(number) }] : []),
          ],
        },
      });
    }
    return { AND: and };
  }

  private toRow(
    r: Prisma.PayrollClientGetPayload<{ select: typeof listSelect }>,
    names: Map<string, string>,
    staleHours: number,
    now: Date,
  ): PayrollClientRowDto {
    const connected = r.connection?.status === 'CONNECTED';
    return {
      id: r.id,
      client: toClientRef(r.client),
      engagementId: r.engagementId,
      provider: providerRef(r.providerKey, r.connection),
      frequency: r.frequency,
      employeeCount: r.employeeCount,
      status: r.status,
      nextPayrollOn: day(r.nextPayrollOn),
      nextPayrollSource:
        r.nextPayrollSource === 'provider'
          ? 'provider'
          : r.nextPayrollSource === 'schedule'
            ? 'schedule'
            : null,
      lastRunOn: day(r.lastRunOn),
      syncStatus: syncStatusOf({ connected, lastSyncedAt: r.lastSyncedAt }, staleHours, now),
      lastSyncedAt: iso(r.lastSyncedAt),
      assignedTo: memberRefOf(names, r.assignedUserId),
    };
  }

  async list(businessId: string, actor: PayrollActor, q: ClientsQuery): Promise<PayrollClientPage> {
    const now = new Date();
    const { rows, total, names, staleHours, counts, upcoming } = await inFirm(
      this.database,
      businessId,
      async (tx) => {
        const staleHours = await this.staleHours(tx, businessId);
        const where = this.where(businessId, actor, q, now, staleHours, true);
        const base = this.where(businessId, actor, q, now, staleHours, false);
        const [rows, total, counts, upcoming] = await Promise.all([
          tx.payrollClient.findMany({
            where,
            select: listSelect,
            orderBy: [SORTS[q.sort](q.direction), { id: 'asc' }],
            ...skipTake(q),
          }),
          tx.payrollClient.count({ where }),
          tx.payrollClient.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
          tx.payrollClient.count({
            where: {
              AND: [
                base,
                { nextPayrollOn: { gte: todayUtc(now) }, status: { notIn: [...INACTIVE] } },
              ],
            },
          }),
        ]);
        const names = await memberNames(
          tx,
          businessId,
          rows.map((r) => r.assignedUserId),
        );
        return { rows, total, names, staleHours, counts, upcoming };
      },
    );
    const tabCounts = Object.fromEntries(
      (
        [
          'ALL',
          'ON_TRACK',
          'PROCESSING',
          'ACTION_REQUIRED',
          'PAST_DUE',
          'NOT_STARTED',
          'UPCOMING',
        ] as PayrollClientTab[]
      ).map((tab) => [
        tab,
        tab === 'ALL'
          ? counts.reduce((n, c) => n + c._count._all, 0)
          : tab === 'UPCOMING'
            ? upcoming
            : (counts.find((c) => c.status === tab)?._count._all ?? 0),
      ]),
    ) as Record<PayrollClientTab, number>;
    await this.audit.log('payroll.clients.listed', { type: 'payroll' }, { count: rows.length });
    return {
      items: rows.map((r) => this.toRow(r, names, staleHours, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      tabCounts,
    };
  }

  /** The list's filters as a CSV (client, provider, frequency, employees, status, dates). No pay figures. */
  async exportCsv(businessId: string, actor: PayrollActor, q: ClientsQuery): Promise<string> {
    const now = new Date();
    const { rows, staleHours, names } = await inFirm(this.database, businessId, async (tx) => {
      const staleHours = await this.staleHours(tx, businessId);
      const rows = await tx.payrollClient.findMany({
        where: this.where(businessId, actor, q, now, staleHours, true),
        select: listSelect,
        orderBy: [SORTS[q.sort](q.direction), { id: 'asc' }],
        take: EXPORT_LIMIT,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.assignedUserId),
      );
      return { rows, staleHours, names };
    });
    const lines = [
      csvRow([
        'Client',
        'Client number',
        'Provider',
        'Frequency',
        'Employees',
        'Status',
        'Next payroll date',
        'Last run',
        'Sync',
        'Assigned to',
      ]),
      ...rows.map((r) => {
        const row = this.toRow(r, names, staleHours, now);
        return csvRow([
          row.client.displayName,
          `CL-${row.client.clientNumber}`,
          row.provider?.label ?? '',
          row.frequency ?? '',
          row.employeeCount,
          row.status,
          row.nextPayrollOn,
          row.lastRunOn,
          row.syncStatus,
          row.assignedTo?.name ?? '',
        ]);
      }),
    ];
    await this.audit.log('payroll.clients.exported', { type: 'payroll' }, { count: rows.length });
    return `${lines.join('\r\n')}\r\n`;
  }

  // ---------- Add, read, update ----------

  async add(
    businessId: string,
    actor: PayrollActor,
    body: z.output<typeof AddPayrollClientRequest>,
  ): Promise<PayrollClientWorkspace> {
    const id = await inFirm(this.database, businessId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { businessId, id: body.clientId, archivedAt: null },
        select: { id: true, assignedUserId: true },
      });
      if (!client) throw errors.notFound();
      if (body.assignedUserId) await checkAssignee(tx, businessId, body.assignedUserId, client);
      const service = await tx.service.findFirst({
        where: { businessId, kind: 'PAYROLL', status: 'ACTIVE', archivedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      let engagement = await tx.engagement.findFirst({
        where: {
          businessId,
          clientId: client.id,
          status: { in: ['ACTIVE', 'PENDING'] },
          service: { kind: 'PAYROLL' },
        },
        select: { id: true, payrollClient: { select: { id: true } } },
      });
      if (!engagement) {
        if (!service) throw errors.noPayrollService();
        const created = await tx.engagement.create({
          data: {
            businessId,
            clientId: client.id,
            serviceId: service.id,
            title: 'Payroll',
            assignedUserId: body.assignedUserId ?? client.assignedUserId,
          },
          select: { id: true },
        });
        engagement = { id: created.id, payrollClient: null };
      }
      if (engagement.payrollClient) throw errors.alreadyPayrollClient();
      const settings = await tx.payrollSettings.findUnique({ where: { businessId } });
      const connection = body.providerKey
        ? await tx.integrationConnection.findFirst({
            where: { businessId, provider: body.providerKey, status: 'CONNECTED' },
            orderBy: { environment: 'asc' },
            select: { id: true },
          })
        : null;
      let created;
      try {
        created = await tx.payrollClient.create({
          data: {
            businessId,
            clientId: client.id,
            engagementId: engagement.id,
            frequency: body.frequency ?? null,
            providerKey: body.providerKey ?? null,
            connectionId: connection?.id ?? null,
            industry: body.industry ?? null,
            assignedUserId: body.assignedUserId ?? settings?.defaultAssigneeId ?? null,
            serviceSince: body.serviceSince
              ? toDay(body.serviceSince)
              : toDay(new Date().toISOString().slice(0, 10)),
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw errors.alreadyPayrollClient();
        throw e;
      }
      await tx.payrollClientChange.create({
        data: {
          businessId,
          payrollClientId: created.id,
          field: 'service',
          oldValue: null,
          newValue: 'added',
          changedByUserId: actor.userId,
        },
      });
      await this.audit.logIn(
        tx,
        'payroll.client.added',
        { type: 'payroll_client', id: created.id },
        { clientId: client.id },
      );
      return created.id;
    });
    return this.get(businessId, actor, id, false);
  }

  async get(
    businessId: string,
    actor: PayrollActor,
    id: string,
    log = true,
  ): Promise<PayrollClientWorkspace> {
    const now = new Date();
    const data = await inFirm(this.database, businessId, async (tx) => {
      const pc = await tx.payrollClient.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        include: {
          client: { select: clientRefSelect },
          connection: { select: { status: true } },
          engagement: { select: { package: true } },
        },
      });
      if (!pc) throw errors.notFound();
      const staleHours = await this.staleHours(tx, businessId);
      const workers = await tx.payrollWorker.findMany({
        where: { businessId, payrollClientId: id },
        select: { workerType: true, status: true },
      });
      const open = await tx.payrollRun.findMany({
        where: { businessId, payrollClientId: id, status: { not: 'COMPLETED' } },
        orderBy: [{ payDate: 'asc' }, { id: 'asc' }],
        take: 5,
        select: runRowSelect,
      });
      const done = await tx.payrollRun.findMany({
        where: { businessId, payrollClientId: id, status: 'COMPLETED' },
        orderBy: [{ payDate: 'desc' }, { id: 'desc' }],
        take: 2,
        select: {
          ...runRowSelect,
          figuresConfirmed: true,
          regularPayCents: true,
          overtimePayCents: true,
          otherEarningsCents: true,
          employeeTaxesCents: true,
          deductionsCents: true,
          netCents: true,
          employerTaxesCents: true,
          employerBenefitsCents: true,
          employerCostsCents: true,
        },
      });
      const recent = await tx.payrollWorker.findMany({
        where: { businessId, payrollClientId: id },
        orderBy: [
          { lastChangeAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
        take: 5,
        select: workerSelect,
      });
      const openIssues = await tx.payrollRunIssue.count({
        where: {
          businessId,
          resolvedAt: null,
          severity: { in: ['WARNING', 'ERROR'] },
          run: { payrollClientId: id, status: { not: 'COMPLETED' } },
        },
      });
      const names = await memberNames(tx, businessId, [pc.assignedUserId]);
      return { pc, staleHours, workers, open, done, recent, openIssues, names };
    });
    const { pc, workers } = data;
    const name = pc.client.displayName;
    const counted = workers.filter((w) => w.status === 'ACTIVE' || w.status === 'ON_LEAVE');
    const [latest, before] = data.done;
    const connected = pc.connection?.status === 'CONNECTED';
    if (log)
      await this.audit.log(
        'payroll.client.viewed',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    return {
      id: pc.id,
      client: toClientRef(pc.client),
      engagementId: pc.engagementId,
      plan: pc.engagement.package,
      status: pc.status,
      frequency: pc.frequency,
      industry: pc.industry,
      provider: providerRef(pc.providerKey, pc.connection),
      serviceSince: day(pc.serviceSince),
      nextPayrollOn: day(pc.nextPayrollOn),
      nextPayrollSource:
        pc.nextPayrollSource === 'provider'
          ? 'provider'
          : pc.nextPayrollSource === 'schedule'
            ? 'schedule'
            : null,
      lastRunOn: day(pc.lastRunOn),
      lastSyncedAt: iso(pc.lastSyncedAt),
      lastSyncAttemptAt: iso(pc.lastSyncAttemptAt),
      syncStatus: syncStatusOf({ connected, lastSyncedAt: pc.lastSyncedAt }, data.staleHours, now),
      assignedTo: memberRefOf(data.names, pc.assignedUserId),
      pausedAt: iso(pc.pausedAt),
      archivedAt: iso(pc.archivedAt),
      employeeCount: pc.employeeCount,
      employeeCountAt: iso(pc.employeeCountAt),
      workers: {
        fullTime: counted.filter((w) => w.workerType === 'FULL_TIME').length,
        partTime: counted.filter((w) => w.workerType === 'PART_TIME').length,
        contractors: counted.filter((w) => w.workerType === 'CONTRACTOR').length,
        onLeave: workers.filter((w) => w.status === 'ON_LEAVE').length,
      },
      currentRun: data.open[0] ? toRunRow(data.open[0], name) : null,
      latestRun: latest
        ? {
            run: toRunRow(latest, name),
            figures: {
              employeeCount: latest.employeeCount,
              regularPayCents: latest.regularPayCents,
              overtimePayCents: latest.overtimePayCents,
              otherEarningsCents: latest.otherEarningsCents,
              grossCents: latest.grossCents,
              employeeTaxesCents: latest.employeeTaxesCents,
              deductionsCents: latest.deductionsCents,
              netCents: latest.netCents,
              employerTaxesCents: latest.employerTaxesCents,
              employerBenefitsCents: latest.employerBenefitsCents,
              employerCostsCents: latest.employerCostsCents,
              totalCostCents: latest.totalCostCents,
              confirmed: latest.figuresConfirmed,
            },
            changeVsPrevious: {
              grossPercent:
                before?.grossCents == null || latest.grossCents === null
                  ? null
                  : changePercent(latest.grossCents, before.grossCents),
              taxesPercent: (() => {
                const a = taxesOf(latest);
                const b = before ? taxesOf(before) : null;
                return a === null ? null : changePercent(a, b);
              })(),
              netPercent:
                before?.netCents == null || latest.netCents === null
                  ? null
                  : changePercent(latest.netCents, before.netCents),
            },
          }
        : null,
      upcomingRuns: data.open.map((r) => toRunRow(r, name)),
      recentWorkers: data.recent.map(toWorker),
      openRunIssues: data.openIssues,
      createdAt: pc.createdAt.toISOString(),
    };
  }

  /** Reads and locks the payroll client row for a change; the client row is locked FOR SHARE. */
  private async lockFor(tx: TxClient, businessId: string, actor: PayrollActor, id: string) {
    const pc = await findPayrollClient(tx, businessId, actor, id);
    await lockClient(tx, businessId, pc.clientId);
    // FOR NO KEY UPDATE: two changes to one payroll client queue up; the second reads the first's result.
    await tx.$executeRaw`SELECT 1 FROM payroll_clients WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR NO KEY UPDATE`;
    const fresh = await tx.payrollClient.findFirstOrThrow({ where: { businessId, id } });
    if (fresh.status === 'ARCHIVED') {
      throw errors.clientState('This payroll client is archived');
    }
    return { ...pc, ...fresh };
  }

  private async change(
    tx: TxClient,
    businessId: string,
    actor: PayrollActor,
    id: string,
    field: string,
    from: string | null,
    to: string | null,
    reason?: string | null,
  ) {
    if (from === to) return;
    await tx.payrollClientChange.create({
      data: {
        businessId,
        payrollClientId: id,
        field,
        oldValue: from,
        newValue: to,
        reason: reason ?? null,
        changedByUserId: actor.userId,
      },
    });
  }

  async update(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof UpdatePayrollClientRequest>,
  ): Promise<PayrollClientWorkspace> {
    const managerFields = ['providerKey', 'frequency', 'assignedUserId', 'nextPayrollOn'] as const;
    if (!isManager(actor) && managerFields.some((k) => body[k] !== undefined)) {
      throw errors.forbidden();
    }
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      const data: Prisma.PayrollClientUncheckedUpdateInput = {};
      if (body.industry !== undefined) {
        data.industry = body.industry;
        await this.change(
          tx,
          businessId,
          actor,
          id,
          'industry',
          pc.industry,
          body.industry ?? null,
        );
      }
      if (body.frequency !== undefined) {
        data.frequency = body.frequency;
        await this.change(tx, businessId, actor, id, 'frequency', pc.frequency, body.frequency);
      }
      if (body.assignedUserId !== undefined) {
        if (body.assignedUserId)
          await checkAssignee(tx, businessId, body.assignedUserId, pc.client);
        data.assignedUserId = body.assignedUserId;
        await this.change(
          tx,
          businessId,
          actor,
          id,
          'assignee',
          pc.assignedUserId,
          body.assignedUserId,
        );
      }
      if (body.providerKey !== undefined) {
        const connection = body.providerKey
          ? await tx.integrationConnection.findFirst({
              where: { businessId, provider: body.providerKey, status: 'CONNECTED' },
              orderBy: { environment: 'asc' },
              select: { id: true },
            })
          : null;
        data.providerKey = body.providerKey;
        data.connectionId = connection?.id ?? null;
        await this.change(tx, businessId, actor, id, 'provider', pc.providerKey, body.providerKey);
      }
      if (body.nextPayrollOn !== undefined) {
        data.nextPayrollOn = body.nextPayrollOn ? toDay(body.nextPayrollOn) : null;
        data.nextPayrollSource = body.nextPayrollOn ? 'schedule' : null;
      }
      await tx.payrollClient.update({ where: { id }, data });
      await this.audit.logIn(
        tx,
        'payroll.client.updated',
        { type: 'payroll_client', id },
        {
          clientId: pc.clientId,
          fields: Object.keys(body).sort(),
        },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  // ---------- Service actions ----------

  async setStatus(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollStatusRequest>,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      if (pc.status === 'ON_HOLD')
        throw errors.clientState('Resume the service before changing its status');
      await tx.payrollClient.update({ where: { id }, data: { status: body.status } });
      await this.change(tx, businessId, actor, id, 'status', pc.status, body.status, body.reason);
      await this.audit.logIn(
        tx,
        'payroll.client.status_changed',
        { type: 'payroll_client', id },
        {
          clientId: pc.clientId,
          from: pc.status,
          to: body.status,
        },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async pause(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollReasonRequest>,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      if (pc.status === 'ON_HOLD') throw errors.clientState('This service is already paused');
      await tx.payrollClient.update({
        where: { id },
        data: { status: 'ON_HOLD', pausedAt: new Date() },
      });
      await this.change(tx, businessId, actor, id, 'status', pc.status, 'ON_HOLD', body.reason);
      await this.audit.logIn(
        tx,
        'payroll.client.paused',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async resume(
    businessId: string,
    actor: PayrollActor,
    id: string,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      if (pc.status !== 'ON_HOLD') throw errors.clientState('This service is not paused');
      const paused = await tx.payrollClientChange.findFirst({
        where: { businessId, payrollClientId: id, field: 'status', newValue: 'ON_HOLD' },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      });
      const back = [
        'ON_TRACK',
        'PROCESSING',
        'ACTION_REQUIRED',
        'PAST_DUE',
        'NOT_STARTED',
      ].includes(paused?.oldValue ?? '')
        ? (paused?.oldValue as 'ON_TRACK')
        : 'NOT_STARTED';
      await tx.payrollClient.update({ where: { id }, data: { status: back, pausedAt: null } });
      await this.change(tx, businessId, actor, id, 'status', 'ON_HOLD', back);
      await this.audit.logIn(
        tx,
        'payroll.client.resumed',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async archive(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollReasonRequest>,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      await tx.payrollClient.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date(), pausedAt: null },
      });
      await this.change(tx, businessId, actor, id, 'status', pc.status, 'ARCHIVED', body.reason);
      await this.audit.logIn(
        tx,
        'payroll.client.archived',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  /** Ends the payroll service: the payroll client is archived and its engagement cancelled. */
  async removeService(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollRemoveServiceRequest>,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      await tx.payrollClient.update({
        where: { id },
        data: { status: 'ARCHIVED', archivedAt: new Date(), pausedAt: null },
      });
      await tx.engagement.updateMany({
        where: { businessId, id: pc.engagementId, status: { in: ['ACTIVE', 'PENDING'] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: body.reason,
          updatedByUserId: actor.userId,
        },
      });
      await this.change(tx, businessId, actor, id, 'status', pc.status, 'ARCHIVED', body.reason);
      await this.change(tx, businessId, actor, id, 'service', 'active', 'removed', body.reason);
      await this.audit.logIn(
        tx,
        'payroll.client.service_removed',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async assign(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollAssignRequest>,
  ): Promise<PayrollClientWorkspace> {
    await this.update(businessId, actor, id, { assignedUserId: body.assignedUserId });
    return this.get(businessId, actor, id, false);
  }

  async setFrequency(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollFrequencyRequest>,
  ): Promise<PayrollClientWorkspace> {
    return this.update(businessId, actor, id, { frequency: body.frequency });
  }

  /** The payroll plan is the engagement's package name. */
  async setPlan(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof PayrollPlanRequest>,
  ): Promise<PayrollClientWorkspace> {
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      const engagement = await tx.engagement.findFirstOrThrow({
        where: { businessId, id: pc.engagementId },
        select: { package: true },
      });
      await tx.engagement.update({
        where: { id: pc.engagementId },
        data: { package: body.plan, updatedByUserId: actor.userId },
      });
      await this.change(tx, businessId, actor, id, 'plan', engagement.package, body.plan);
      await this.audit.logIn(
        tx,
        'payroll.client.plan_changed',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async changes(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: ListQuery,
  ): Promise<PayrollChangeList> {
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const where = { businessId, payrollClientId: id };
      const [rows, total] = await Promise.all([
        tx.payrollClientChange.findMany({
          where,
          orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.payrollClientChange.count({ where }),
      ]);
      return {
        rows,
        total,
        names: await memberNames(
          tx,
          businessId,
          rows.map((r) => r.changedByUserId),
        ),
      };
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
        changedBy: memberRefOf(names, r.changedByUserId),
        changedAt: r.changedAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Queues a provider sync. The sync itself is the integration worker's; this records the request. */
  async sync(businessId: string, actor: PayrollActor, id: string): Promise<PayrollSyncQueued> {
    const requestedAt = new Date();
    await inFirm(this.database, businessId, async (tx) => {
      const pc = await this.lockFor(tx, businessId, actor, id);
      if (pc.connection?.status !== 'CONNECTED') throw errors.providerNotConnected();
      await tx.payrollClient.update({ where: { id }, data: { lastSyncAttemptAt: requestedAt } });
      await this.audit.logIn(
        tx,
        'payroll.client.sync_queued',
        { type: 'payroll_client', id },
        { clientId: pc.clientId },
      );
    });
    return { queued: true, requestedAt: requestedAt.toISOString() };
  }

  // ---------- Activities ----------

  async activities(
    businessId: string,
    actor: PayrollActor,
    id: string,
    q: ListQuery,
  ): Promise<PayrollActivityList> {
    const { rows, total, names } = await inFirm(this.database, businessId, async (tx) => {
      await findPayrollClient(tx, businessId, actor, id);
      const where = { businessId, payrollClientId: id };
      const [rows, total] = await Promise.all([
        tx.payrollActivity.findMany({
          where,
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          ...skipTake(q),
        }),
        tx.payrollActivity.count({ where }),
      ]);
      return {
        rows,
        total,
        names: await memberNames(
          tx,
          businessId,
          rows.map((r) => r.loggedByUserId),
        ),
      };
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        summary: r.summary,
        occurredAt: r.occurredAt.toISOString(),
        loggedBy: memberRefOf(names, r.loggedByUserId),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async logActivity(
    businessId: string,
    actor: PayrollActor,
    id: string,
    body: z.output<typeof LogPayrollActivityRequest>,
  ): Promise<PayrollActivity> {
    const { row, names } = await inFirm(this.database, businessId, async (tx) => {
      const pc = await findPayrollClient(tx, businessId, actor, id);
      const row = await tx.payrollActivity.create({
        data: {
          businessId,
          payrollClientId: id,
          kind: body.kind,
          summary: body.summary,
          ...(body.occurredAt ? { occurredAt: new Date(body.occurredAt) } : {}),
          loggedByUserId: actor.userId,
        },
      });
      await this.audit.logIn(
        tx,
        'payroll.activity.logged',
        { type: 'payroll_client', id },
        { clientId: pc.clientId, kind: body.kind },
      );
      return { row, names: await memberNames(tx, businessId, [actor.userId]) };
    });
    return {
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      occurredAt: row.occurredAt.toISOString(),
      loggedBy: memberRefOf(names, row.loggedByUserId),
    };
  }

  // ---------- Settings ----------

  async getSettings(businessId: string): Promise<PayrollSettings> {
    return inFirm(this.database, businessId, (tx) => this.readSettings(tx, businessId));
  }

  private async readSettings(tx: TxClient, businessId: string): Promise<PayrollSettings> {
    const s = await tx.payrollSettings.findUnique({ where: { businessId } });
    const names = await memberNames(tx, businessId, [s?.defaultAssigneeId ?? null]);
    return {
      defaultAssignee: memberRefOf(names, s?.defaultAssigneeId ?? null),
      reminderDaysBefore: s?.reminderDaysBefore ?? DEFAULT_REMINDER_DAYS,
      staleAfterHours: s?.staleAfterHours ?? DEFAULT_STALE_HOURS,
      updatedAt: iso(s?.updatedAt ?? null),
    };
  }

  async saveSettings(
    businessId: string,
    actor: PayrollActor,
    body: z.output<typeof SavePayrollSettingsRequest>,
  ): Promise<PayrollSettings> {
    return inFirm(this.database, businessId, async (tx) => {
      if (body.defaultAssigneeId) {
        const member = await tx.membership.findFirst({
          where: { businessId, userId: body.defaultAssigneeId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!member)
          throw errors.invalid('defaultAssigneeId', 'Choose an active member of the firm');
      }
      const data = {
        defaultAssigneeId: body.defaultAssigneeId,
        reminderDaysBefore: body.reminderDaysBefore,
        staleAfterHours: body.staleAfterHours,
        updatedByUserId: actor.userId,
      };
      await tx.payrollSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'payroll.settings.updated',
        { type: 'payroll_settings', id: businessId },
        {
          fields: ['defaultAssigneeId', 'reminderDaysBefore', 'staleAfterHours'],
        },
      );
      return this.readSettings(tx, businessId);
    });
  }
}
