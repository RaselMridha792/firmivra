import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  OkResponse,
  PlanningClientPage,
  PlanningClientRow,
  PlanningDeadline,
  PlanningKpi,
  PlanningResource,
  TaxPlanningOverview,
  TopOpportunityRow,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MessagesService } from '../messages/messages.service.js';
import { assignee, conflict, notFound, toDay } from '../workspaces/common.js';
import { RESOURCES, resourceOf, toResource } from './catalog.js';
import {
  type PlanShape,
  type TaxCtx,
  TaxPlanReadService,
  categoryOf,
  planInclude,
} from './plan-read.service.js';
import type {
  CalendarQuery,
  PlanningClientsListQuery,
  ResourcesQuery,
  SendResourceBody,
} from './tax-planning-input.js';
import {
  clientRef,
  clientRefSelect,
  DISCLAIMER,
  entityLabel,
  OPEN_OPPORTUNITY_STATUSES,
  planTotals,
  todayIn,
  tpErrors,
} from './tax-planning.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const CAP = 5_000;
const ACTIVE_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'READY_FOR_REVIEW',
] as const;
const TAX_DEADLINE_TYPES = [
  'TAX_FILING',
  'ESTIMATED_TAX',
  'ELECTION',
  'SALES_TAX',
  'STATE_FILING',
] as const;
const DAY = 86_400_000;

const delta = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;
const addDays = (isoDay: string, days: number) =>
  new Date(Date.parse(`${isoDay}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);

type ClientLite = Prisma.ClientGetPayload<{ select: typeof clientLite }>;
const clientLite = {
  ...clientRefSelect,
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.ClientSelect;

/** The overview, the Clients tab, the Tax Calendar and the Resources. */
@Injectable()
export class TaxOverviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: TaxPlanReadService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: TaxCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  /** The row of a client in planning: its current plan, next appointment and open opportunities. */
  private async rows(
    ctx: TaxCtx,
    clients: ClientLite[],
    plans: Map<string, PlanShape | null>,
  ): Promise<PlanningClientRow[]> {
    const { tx, businessId } = ctx;
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) return [];
    const [appts, opps] = await Promise.all([
      tx.appointment.groupBy({
        by: ['clientId'],
        where: {
          businessId,
          clientId: { in: ids },
          status: 'SCHEDULED',
          startsAt: { gte: new Date() },
        },
        _min: { startsAt: true },
      }),
      tx.taxOpportunity.groupBy({
        by: ['clientId'],
        where: {
          businessId,
          clientId: { in: ids },
          status: { in: [...OPEN_OPPORTUNITY_STATUSES] },
        },
        _count: { _all: true },
      }),
    ]);
    const next = new Map(appts.map((a) => [a.clientId, a._min.startsAt]));
    const open = new Map(opps.map((o) => [o.clientId, o._count._all]));
    return clients.map((c) => {
      const plan = plans.get(c.id) ?? null;
      return {
        client: clientRef(c),
        entityLabel: entityLabel(plan?.entityType ?? null, c.accountType),
        planId: plan?.id ?? null,
        planName: plan?.name ?? null,
        planYear: plan?.planYear ?? null,
        status: plan?.status ?? null,
        nextAppointmentAt: next.get(c.id)?.toISOString() ?? null,
        potentialSavingsCents: plan
          ? planTotals(plan.strategies.map((s) => ({ ...s, category: categoryOf(s) }))).cents
          : null,
        assignedTo: assignee(plan?.assignedMember ?? null) ?? assignee(c.assignedMember),
        openOpportunities: open.get(c.id) ?? 0,
      };
    });
  }

  /** The plan that stands for a client: the newest year's, preferring one not closed. */
  private current(plans: PlanShape[]): PlanShape | null {
    const live = plans.filter((p) => p.status !== 'CLOSED');
    const pool = live.length > 0 ? live : plans;
    return (
      [...pool].sort(
        (a, b) => b.planYear - a.planYear || b.updatedAt.getTime() - a.updatedAt.getTime(),
      )[0] ?? null
    );
  }

  // ---------- Overview ----------

  overview(
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<TaxPlanningOverview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      const now = new Date();
      const today = todayIn(ctx.timezone, now);
      const reach = this.read.clientReach(ctx);
      const plans = await tx.taxPlan.findMany({
        where: { businessId, archivedAt: null, status: { not: 'CLOSED' }, client: reach },
        include: planInclude,
        orderBy: { updatedAt: 'desc' },
        take: CAP,
      });
      const active = plans.filter((p) => (ACTIVE_STATUSES as readonly string[]).includes(p.status));
      const clientsNow = new Set(active.map((p) => p.clientId)).size;
      const clientsBefore = new Set(
        active
          .filter((p) => p.createdAt.getTime() <= now.getTime() - 90 * DAY)
          .map((p) => p.clientId),
      ).size;
      const planClientIds = [...new Set(plans.map((p) => p.clientId))];
      const [apptNow, apptBefore] = await Promise.all([
        tx.appointment.count({
          where: {
            businessId,
            clientId: { in: planClientIds },
            status: 'SCHEDULED',
            startsAt: { gte: now, lte: new Date(now.getTime() + 30 * DAY) },
          },
        }),
        tx.appointment.count({
          where: {
            businessId,
            clientId: { in: planClientIds },
            status: { not: 'CANCELLED' },
            startsAt: { gte: new Date(now.getTime() - 30 * DAY), lt: now },
          },
        }),
      ]);
      const inProgress = plans.reduce(
        (n, p) => n + p.strategies.filter((s) => s.selected && s.status === 'IN_PROGRESS').length,
        0,
      );
      const projected = plans.reduce(
        (sum, p) =>
          sum +
          (planTotals(p.strategies.map((s) => ({ ...s, category: categoryOf(s) }))).cents ?? 0),
        0,
      );

      // Recent planning clients: the five clients whose plans changed last.
      const recentIds: string[] = [];
      for (const p of plans) {
        if (!recentIds.includes(p.clientId)) recentIds.push(p.clientId);
        if (recentIds.length === 5) break;
      }
      const recentClients = await tx.client.findMany({
        where: { businessId, id: { in: recentIds } },
        select: clientLite,
      });
      const byClient = new Map<string, PlanShape[]>();
      for (const p of plans) byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), p]);
      const recentRows = await this.rows(
        ctx,
        recentIds
          .map((id) => recentClients.find((c) => c.id === id))
          .filter((c): c is ClientLite => !!c),
        new Map(recentIds.map((id) => [id, this.current(byClient.get(id) ?? [])])),
      );

      // Top planning opportunities: open ones grouped by library strategy.
      const opps = await tx.taxOpportunity.findMany({
        where: {
          businessId,
          strategyId: { not: null },
          status: { in: [...OPEN_OPPORTUNITY_STATUSES] },
          client: reach,
        },
        select: {
          id: true,
          strategyId: true,
          name: true,
          category: true,
          estimatedSavingsCents: true,
        },
        take: CAP,
      });
      const groups = new Map<string, { rows: typeof opps }>();
      for (const o of opps)
        groups.set(o.strategyId as string, {
          rows: [...(groups.get(o.strategyId as string)?.rows ?? []), o],
        });
      const top: TopOpportunityRow[] = [...groups.entries()]
        .map(([strategyId, g]) => {
          const best = [...g.rows].sort(
            (a, b) => (b.estimatedSavingsCents ?? -1) - (a.estimatedSavingsCents ?? -1),
          )[0] as (typeof opps)[number];
          const known = g.rows.filter((r) => r.estimatedSavingsCents !== null);
          return {
            strategyId,
            name: best.name,
            category: best.category,
            clientCount: g.rows.length,
            estimatedSavingsCents: known.length
              ? known.reduce((s, r) => s + (r.estimatedSavingsCents ?? 0), 0)
              : null,
            firstOpportunityId: best.id,
          };
        })
        .sort(
          (a, b) =>
            (b.estimatedSavingsCents ?? -1) - (a.estimatedSavingsCents ?? -1) ||
            b.clientCount - a.clientCount,
        )
        .slice(0, 5);

      const kpi = (value: number, before: number | null, label: string | null): PlanningKpi => ({
        value,
        deltaPercent: before === null ? null : delta(value, before),
        comparedTo: before === null ? null : label,
      });
      return {
        activePlanningClients: kpi(clientsNow, clientsBefore, 'vs last quarter'),
        upcomingAppointments: kpi(apptNow, apptBefore, 'vs the last 30 days'),
        strategiesInProgress: kpi(inProgress, null, null),
        projectedSavings: kpi(projected, null, null),
        recentClients: recentRows,
        topOpportunities: top,
        deadlines: (await this.deadlines(ctx, today, addDays(today, 120))).slice(0, 5),
        resources: RESOURCES.slice(0, 5).map(toResource),
        disclaimer: DISCLAIMER,
        canCreatePlan: ctx.perms.create,
        canSend: ctx.perms.send,
      };
    });
  }

  // ---------- Clients tab ----------

  clients(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof PlanningClientsListQuery>,
  ): Promise<PlanningClientPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      const search = q.search ? likeEscape(q.search) : undefined;
      const clients = await tx.client.findMany({
        where: {
          businessId,
          archivedAt: null,
          ...this.read.clientReach(ctx),
          ...(search ? { displayName: { contains: search, mode: 'insensitive' } } : {}),
        },
        select: clientLite,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: CAP,
      });
      const plans = await tx.taxPlan.findMany({
        where: {
          businessId,
          archivedAt: null,
          clientId: { in: clients.map((c) => c.id) },
          ...(q.planYear ? { planYear: q.planYear } : {}),
        },
        include: planInclude,
      });
      const byClient = new Map<string, PlanShape[]>();
      for (const p of plans) byClient.set(p.clientId, [...(byClient.get(p.clientId) ?? []), p]);
      const current = new Map(clients.map((c) => [c.id, this.current(byClient.get(c.id) ?? [])]));
      let rows = await this.rows(ctx, clients, current);
      if (q.status) rows = rows.filter((r) => r.status === q.status);
      if (q.hasPlan !== undefined) rows = rows.filter((r) => (r.planId !== null) === q.hasPlan);
      if (q.planYear) rows = rows.filter((r) => r.planYear === q.planYear);
      if (q.assignedUserId) rows = rows.filter((r) => r.assignedTo?.userId === q.assignedUserId);
      if (q.entityType)
        rows = rows.filter((r) => r.entityLabel?.toLowerCase() === q.entityType?.toLowerCase());
      const sign = q.direction === 'desc' ? -1 : 1;
      const key = (r: PlanningClientRow): string | number | null =>
        q.sort === 'status'
          ? r.status
          : q.sort === 'nextAppointment'
            ? r.nextAppointmentAt
            : q.sort === 'savings'
              ? r.potentialSavingsCents
              : r.client.name.toLowerCase();
      rows.sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === null && y === null) return a.client.id.localeCompare(b.client.id);
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : x > y ? 1 : a.client.id.localeCompare(b.client.id)) * sign;
      });
      return {
        items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  // ---------- Tax Calendar ----------

  /** Tax deadlines (from Compliance & Deadlines) and planning milestones, in a range of days. */
  private async deadlines(
    ctx: TaxCtx,
    from: string,
    to: string,
    clientId?: string,
  ): Promise<PlanningDeadline[]> {
    const { tx, businessId } = ctx;
    const client = { ...this.read.clientReach(ctx), ...(clientId ? { id: clientId } : {}) };
    const range = { gte: toDay(from), lte: toDay(to) };
    const [due, plans] = await Promise.all([
      tx.complianceDeadline.findMany({
        where: {
          businessId,
          archivedAt: null,
          status: { in: ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] },
          type: { in: [...TAX_DEADLINE_TYPES] },
          dueOn: range,
          client,
        },
        orderBy: [{ dueOn: 'asc' }, { name: 'asc' }],
        take: 2_000,
        select: {
          id: true,
          name: true,
          description: true,
          dueOn: true,
          client: { select: { accountType: true } },
        },
      }),
      tx.taxPlan.findMany({
        where: {
          businessId,
          archivedAt: null,
          status: { notIn: ['CLOSED', 'IMPLEMENTED'] },
          client,
          OR: [{ targetCompletionOn: range }, { nextDiscussionOn: range }],
        },
        select: {
          id: true,
          name: true,
          targetCompletionOn: true,
          nextDiscussionOn: true,
          client: { select: { displayName: true } },
        },
        take: 2_000,
      }),
    ]);
    const grouped = new Map<string, PlanningDeadline & { types: Set<string>; n: number }>();
    for (const d of due) {
      const date = d.dueOn.toISOString().slice(0, 10);
      const k = `${d.name}|${date}`;
      const g = grouped.get(k) ?? {
        id: d.id,
        date,
        title: d.name,
        description: d.description,
        scope: null,
        kind: 'TAX_DEADLINE' as const,
        types: new Set<string>(),
        n: 0,
      };
      g.types.add(d.client.accountType === 'BUSINESS' ? 'Business' : 'Individual');
      g.n += 1;
      grouped.set(k, g);
    }
    const items: PlanningDeadline[] = [...grouped.values()].map(({ types, n, ...g }) => ({
      ...g,
      scope: clientId ? null : `${[...types].sort().join(' & ')} Clients (${n})`,
    }));
    for (const p of plans) {
      const add = (d: Date | null, suffix: string, title: string) => {
        const date = d?.toISOString().slice(0, 10);
        if (date && date >= from && date <= to)
          items.push({
            id: `${p.id}:${suffix}`,
            date,
            title,
            description: p.name,
            scope: p.client.displayName,
            kind: 'PLANNING_MILESTONE',
          });
      };
      add(p.targetCompletionOn, 'target', 'Plan target completion');
      add(p.nextDiscussionOn, 'discussion', 'Client planning discussion');
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }

  calendar(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof CalendarQuery>,
  ): Promise<PlanningDeadline[]> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (q.clientId) {
        const c = await ctx.tx.client.findFirst({
          where: { businessId, id: q.clientId, ...this.read.clientReach(ctx) },
          select: { id: true },
        });
        if (!c) throw notFound();
      }
      return this.deadlines(ctx, q.from, q.to, q.clientId);
    });
  }

  // ---------- Resources ----------

  resources(q: Out<typeof ResourcesQuery>): PlanningResource[] {
    const search = q.search?.toLowerCase();
    return RESOURCES.filter(
      (r) =>
        (!search || r.title.toLowerCase().includes(search)) &&
        (!q.category || r.category.toLowerCase() === q.category.toLowerCase()) &&
        (!q.kind || r.kind === q.kind),
    ).map(toResource);
  }

  sendResource(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Out<typeof SendResourceBody>,
  ): Promise<OkResponse> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.send) throw tpErrors.forbidden();
      const resource = resourceOf(key);
      if (!resource) throw notFound();
      if (!resource.clientFacing)
        throw tpErrors.invalid('key', 'This resource is for staff and cannot be sent to a client');
      const client = await ctx.tx.client.findFirst({
        where: { businessId, id: body.clientId, ...this.read.clientReach(ctx) },
        select: { id: true, archivedAt: true },
      });
      if (!client) throw notFound();
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      await this.messages.create(businessId, ctx.actor, body.clientId, {
        subject: resource.title,
        body: [resource.summary, ...(body.message ? ['', body.message] : [])].join('\n'),
        repliesEnabled: true,
      });
      await this.audit.logIn(
        ctx.tx,
        'tax_resource.sent',
        { type: 'client', id: body.clientId },
        { resourceKey: key, channel: body.channel },
      );
      return { ok: true };
    });
  }
}
