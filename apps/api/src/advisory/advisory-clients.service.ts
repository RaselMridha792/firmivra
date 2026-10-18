import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AdvisoryActivityPage,
  AdvisoryClientDetail,
  AdvisoryClientPage,
  AdvisoryClientRow,
  AdvisoryMetric,
  AdvisoryWorkstream,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import {
  checkAssignee,
  conflict,
  day,
  isUniqueViolation,
  memberNames,
  memberRef,
  notFound,
  sentFields,
  toDay,
} from '../workspaces/common.js';
import {
  type AdvisoryCtx,
  AdvisoryReadService,
  advisoryAppointment,
  type ClientShape,
  clientInclude,
} from './advisory-read.service.js';
import type {
  ActivityQuery,
  AddWorkstreamBody,
  ClientsQuery,
  CreateClientBody,
  UpdateClientBody,
  UpdateWorkstreamBody,
} from './advisory-input.js';
import { advErrors, DISCLAIMER, effectiveGoalStatus, iso } from './advisory.common.js';
import { formulaVersion } from './health.js';

type Out<S extends z.ZodType> = z.output<S>;

const OPEN_ACTION = ['NOT_STARTED', 'IN_PROGRESS'] as const;

/** Sentences for the activity feed: only what happened, never a figure or a note. */
const ACTIVITY: Record<string, string> = {
  'advisory_client.added': 'Added to the advisory program',
  'advisory_client.updated': 'Advisory details changed',
  'advisory_client.archived': 'Archived from the advisory program',
  'advisory_client.restored': 'Restored to the advisory program',
  'advisory_workstream.added': 'Service added',
  'advisory_workstream.updated': 'Service changed',
  'advisory_plan.created': 'Business plan created',
  'advisory_plan.updated': 'Business plan changed',
  'advisory_plan.status_changed': 'Plan status changed',
  'advisory_plan.finalized': 'Plan finalized',
  'advisory_plan.sent': 'Plan sent',
  'advisory_plan.archived': 'Plan archived',
  'advisory_plan.restored': 'Plan restored',
  'advisory_financial.added': 'Financial figures added',
  'advisory_goal.created': 'Goal added',
  'advisory_goal.updated': 'Goal changed',
  'advisory_goal.archived': 'Goal archived',
  'advisory_goal.restored': 'Goal restored',
  'advisory_milestone.added': 'Milestone added',
  'advisory_milestone.updated': 'Milestone changed',
  'advisory_recommendation.created': 'Recommendation added',
  'advisory_recommendation.updated': 'Recommendation changed',
  'advisory_action_item.created': 'Action item added',
  'advisory_action_item.updated': 'Action item changed',
  'advisory_resource.sent': 'Resource sent',
};

const pctChange = (value: number | null, previous: number | null): number | null =>
  value !== null && previous !== null && previous !== 0
    ? Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10
    : null;

/** Advisory clients: the tab, the detail with its health score, services and activity. */
@Injectable()
export class AdvisoryClientsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AdvisoryReadService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: AdvisoryCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  // ---------- The detail ----------

  async detail(ctx: AdvisoryCtx, c: ClientShape): Promise<AdvisoryClientDetail> {
    const { tx, businessId } = ctx;
    const id = c.id;
    const [row] = await this.read.clientRows(ctx, [c]);
    const [
      plans,
      currentPlan,
      latestPlan,
      goals,
      actions,
      recCount,
      meetings,
      snapshots,
      openByWs,
    ] = await Promise.all([
      tx.advisoryPlan.count({ where: { businessId, advisoryClientId: id, archivedAt: null } }),
      tx.advisoryPlan.findFirst({
        where: { businessId, advisoryClientId: id, archivedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { id: true, name: true, status: true, updatedAt: true, profile: true },
      }),
      tx.advisoryPlan.findFirst({
        where: { businessId, advisoryClientId: id, archivedAt: null },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: { profile: true },
      }),
      tx.advisoryGoal.findMany({
        where: { businessId, advisoryClientId: id, archivedAt: null },
        select: { status: true, targetDate: true },
      }),
      tx.advisoryActionItem.findMany({
        where: { businessId, advisoryClientId: id },
        select: { status: true, dueOn: true },
      }),
      tx.advisoryRecommendation.count({ where: { businessId, advisoryClientId: id } }),
      tx.appointment.count({
        where: {
          businessId,
          clientId: c.clientId,
          status: { not: 'CANCELLED' },
          ...advisoryAppointment,
        },
      }),
      this.read.latestSnapshots(ctx, id, 12),
      tx.advisoryGoal.groupBy({
        by: ['workstreamId'],
        where: {
          businessId,
          advisoryClientId: id,
          archivedAt: null,
          workstreamId: { not: null },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        _count: { _all: true },
      }),
    ]);
    const profile = (latestPlan?.profile ?? {}) as Record<string, unknown>;
    const p = c.client.profile;
    const open = new Map(openByWs.map((g) => [g.workstreamId, g._count._all]));
    const workstreams: AdvisoryWorkstream[] = c.workstreams.map((w) =>
      this.read.workstream(w, open.get(w.id) ?? 0),
    );

    const view = ctx.perms.viewFinancials;
    const withRevenue = snapshots.filter((s) => s.revenueCents !== null);
    const withProfit = snapshots.filter((s) => s.netProfitCents !== null);
    const metric = (
      rows: typeof snapshots,
      pick: (s: (typeof snapshots)[number]) => number | null,
    ): AdvisoryMetric | null => {
      if (!view) return null;
      const [latest, before] = rows;
      return {
        value: latest ? pick(latest) : null,
        previous: before ? pick(before) : null,
        deltaPercent: latest && before ? pctChange(pick(latest), pick(before)) : null,
        periodLabel: latest ? `${day(latest.periodStart)} to ${day(latest.periodEnd)}` : null,
        source: latest?.source ?? null,
        asOf: latest ? day(latest.asOf) : null,
      };
    };
    const headcounts = view ? snapshots.filter((s) => s.headcount !== null) : [];
    const employees: AdvisoryMetric = (() => {
      const [latest, before] = headcounts;
      if (latest)
        return {
          value: latest.headcount,
          previous: before?.headcount ?? null,
          deltaPercent: pctChange(latest.headcount, before?.headcount ?? null),
          periodLabel: `${day(latest.periodStart)} to ${day(latest.periodEnd)}`,
          source: latest.source,
          asOf: day(latest.asOf),
        };
      const fromPlan = typeof profile.employeeCount === 'number' ? profile.employeeCount : null;
      return {
        value: fromPlan,
        previous: null,
        deltaPercent: null,
        periodLabel: null,
        source: null,
        asOf: null,
      };
    })();

    const live = goals.filter((g) => g.status !== 'COMPLETED' && g.status !== 'CANCELLED');
    const effective = live.map((g) => effectiveGoalStatus(g.status, g.targetDate, ctx.today));
    const openActions = actions.filter((a) =>
      (OPEN_ACTION as readonly string[]).includes(a.status),
    );

    const stored = (Array.isArray(c.healthFactors) ? c.healthFactors : []) as {
      factor: string;
      label: string;
      weight: number;
      value: number | null;
      explanation: string | null;
    }[];
    const newest = snapshots[0];
    const ageDays = newest
      ? (Date.parse(`${ctx.today}T00:00:00Z`) - newest.asOf.getTime()) / 86_400_000
      : null;
    return {
      ...(row as AdvisoryClientRow),
      businessProfile: {
        entityType:
          p?.entityType ?? (typeof profile.entityType === 'string' ? profile.entityType : null),
        yearsInBusiness:
          typeof profile.yearsInBusiness === 'number' ? profile.yearsInBusiness : null,
        address: p
          ? {
              line1: p.addressLine1,
              line2: p.addressLine2,
              city: p.city,
              state: p.state,
              postalCode: p.postalCode,
              country: p.country,
            }
          : null,
        website: typeof profile.website === 'string' ? profile.website : null,
        einMasked: p?.einLast4 && (ctx.perms.admin || view) ? `XX-XXX${p.einLast4}` : null,
      },
      currentPlan: currentPlan
        ? {
            id: currentPlan.id,
            name: currentPlan.name,
            status: currentPlan.status,
            updatedAt: currentPlan.updatedAt.toISOString(),
          }
        : null,
      workstreams,
      kpis: {
        annualRevenueCents: metric(withRevenue, (s) => s.revenueCents),
        netProfitCents: metric(withProfit, (s) => s.netProfitCents),
        employees,
        activeGoals: {
          count: live.length,
          onTrack: effective.filter((s) => s === 'ON_TRACK').length,
          atRisk: effective.filter((s) => s === 'AT_RISK' || s === 'OVERDUE').length,
        },
        openTasks: {
          open: openActions.length,
          overdue: openActions.filter((a) => a.dueOn !== null && day(a.dueOn)! < ctx.today).length,
        },
      },
      health: {
        score: c.healthScore,
        factors: stored,
        computedAt: iso(c.healthComputedAt),
        stale: ageDays === null || ageDays > ctx.settings.staleFinancialsDays,
        formulaVersion: stored.length > 0 ? formulaVersion(stored) : null,
      },
      counts: {
        plans,
        goals: goals.length,
        recommendations: recCount,
        actionItems: actions.length,
        meetings,
      },
      engagementId: c.engagementId,
      disclaimer: DISCLAIMER,
      canEdit: ctx.perms.editPlans || ctx.perms.manageServices,
      canViewFinancials: view,
      etag: c.updatedAt.toISOString(),
    };
  }

  // ---------- The tab ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ClientsQuery>,
  ): Promise<AdvisoryClientPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.AdvisoryClientWhereInput = {
        businessId,
        ...this.read.reach(ctx),
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(q.status ? { status: q.status } : {}),
        ...(q.advisorUserId ? { advisorUserId: q.advisorUserId } : {}),
        ...(q.serviceId ? { workstreams: { some: { serviceId: q.serviceId } } } : {}),
        ...(q.businessStage
          ? { businessStage: { equals: q.businessStage, mode: 'insensitive' } }
          : {}),
        ...(search
          ? {
              OR: [
                { client: { displayName: { contains: search, mode: 'insensitive' } } },
                {
                  client: { profile: { businessName: { contains: search, mode: 'insensitive' } } },
                },
              ],
            }
          : {}),
      };
      const dir = q.direction;
      const orderBy: Prisma.AdvisoryClientOrderByWithRelationInput[] =
        q.sort === 'status'
          ? [{ status: dir }, { id: 'asc' }]
          : q.sort === 'health'
            ? [{ healthScore: { sort: dir, nulls: 'last' } }, { id: 'asc' }]
            : [{ client: { displayName: dir } }, { id: 'asc' }];
      const [total, rows] = await Promise.all([
        ctx.tx.advisoryClient.count({ where }),
        q.sort === 'nextMeeting'
          ? ctx.tx.advisoryClient.findMany({ where, include: clientInclude, take: 5_000 })
          : ctx.tx.advisoryClient.findMany({
              where,
              include: clientInclude,
              orderBy,
              skip: (q.page - 1) * q.pageSize,
              take: q.pageSize,
            }),
      ]);
      let items = await this.read.clientRows(ctx, rows);
      if (q.sort === 'nextMeeting') {
        const sign = dir === 'desc' ? -1 : 1;
        items.sort((a, b) => {
          if (a.nextMeetingAt === null && b.nextMeetingAt === null) return a.id.localeCompare(b.id);
          if (a.nextMeetingAt === null) return 1;
          if (b.nextMeetingAt === null) return -1;
          return a.nextMeetingAt < b.nextMeetingAt
            ? -sign
            : a.nextMeetingAt > b.nextMeetingAt
              ? sign
              : 0;
        });
        items = items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      }
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AdvisoryClientDetail> {
    const detail = await this.run(businessId, tenant, userId, async (ctx) =>
      this.detail(ctx, await this.read.loadClient(ctx, id)),
    );
    await this.audit.log(
      'advisory_client.viewed',
      { type: 'advisory_client', id },
      { advisoryClientId: id, clientId: detail.client.id },
    );
    return detail;
  }

  // ---------- Add, change, archive ----------

  add(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateClientBody>,
  ): Promise<AdvisoryClientDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageServices) throw advErrors.forbidden();
      const { tx } = ctx;
      const client = await tx.client.findFirst({
        where: {
          businessId,
          id: body.clientId,
          ...(ctx.reachOnly ? { assignedUserId: userId } : {}),
        },
        select: { id: true, archivedAt: true, assignedUserId: true },
      });
      if (!client) throw notFound();
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      const additional = [...new Set(body.additionalServiceIds)];
      if (additional.includes(body.primaryServiceId))
        throw advErrors.invalid(
          'additionalServiceIds',
          'The primary service is not an additional one',
        );
      const wanted = [body.primaryServiceId, ...additional];
      const services = await tx.service.findMany({
        where: {
          businessId,
          id: { in: wanted },
          kind: 'BUSINESS_DEVELOPMENT',
          archivedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (services.length !== wanted.length) throw notFound();
      const existing = await tx.advisoryClient.findFirst({
        where: { businessId, clientId: body.clientId },
        select: { id: true },
      });
      if (existing) throw advErrors.alreadyAdvisoryClient();
      const advisorUserId = body.advisorUserId ?? ctx.settings.defaultAdvisorId;
      if (advisorUserId) await checkAssignee(tx, businessId, advisorUserId, client);
      const engagement = await tx.engagement.findFirst({
        where: { businessId, clientId: body.clientId, service: { kind: 'BUSINESS_DEVELOPMENT' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      let created: { id: string };
      try {
        created = await tx.advisoryClient.create({
          data: {
            businessId,
            clientId: body.clientId,
            engagementId: engagement?.id ?? null,
            advisorUserId: advisorUserId ?? null,
            industry: body.industry ?? null,
            businessStage: body.businessStage ?? null,
            since: toDay(body.since ?? ctx.today),
          },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw advErrors.alreadyAdvisoryClient();
        throw error;
      }
      await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: created.id,
          serviceId: body.primaryServiceId,
          role: 'PRIMARY',
          status: 'ACCEPTED',
          packageName: body.packageName ?? null,
        },
      });
      for (const serviceId of additional) {
        await tx.advisoryWorkstream.create({
          data: { businessId, advisoryClientId: created.id, serviceId, role: 'ADDITIONAL' },
        });
      }
      await this.audit.logIn(
        tx,
        'advisory_client.added',
        { type: 'advisory_client', id: created.id },
        { advisoryClientId: created.id, clientId: body.clientId, services: wanted.length },
      );
      return this.detail(ctx, await this.read.loadClient(ctx, created.id));
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateClientBody>,
  ): Promise<AdvisoryClientDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!(ctx.perms.editPlans || ctx.perms.manageServices)) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, id);
      if (c.archivedAt) throw advErrors.clientArchived();
      if (body.etag !== c.updatedAt.toISOString()) throw advErrors.saveConflict();
      if (body.status === 'ARCHIVED')
        throw advErrors.invalid('status', 'Archive the client from the archive action');
      if (body.advisorUserId && body.advisorUserId !== c.advisorUserId)
        await checkAssignee(tx, businessId, body.advisorUserId, c.client);
      await tx.advisoryClient.update({
        where: { businessId_id: { businessId, id } },
        data: {
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.advisorUserId !== undefined ? { advisorUserId: body.advisorUserId } : {}),
          ...(body.industry !== undefined ? { industry: body.industry } : {}),
          ...(body.businessStage !== undefined ? { businessStage: body.businessStage } : {}),
          ...(body.since !== undefined ? { since: body.since ? toDay(body.since) : null } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_client.updated',
        { type: 'advisory_client', id },
        {
          advisoryClientId: id,
          fields: sentFields(body, [
            'status',
            'advisorUserId',
            'industry',
            'businessStage',
            'since',
          ]),
        },
      );
      return this.detail(ctx, await this.read.loadClient(ctx, id));
    });
  }

  setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<AdvisoryClientRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!(ctx.perms.editPlans || ctx.perms.manageServices)) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, id);
      if (archive !== (c.archivedAt === null)) {
        const [same] = await this.read.clientRows(ctx, [c]);
        return same as AdvisoryClientRow;
      }
      await tx.advisoryClient.update({
        where: { businessId_id: { businessId, id } },
        data: archive
          ? { status: 'ARCHIVED', archivedAt: new Date() }
          : { status: 'IN_PROGRESS', archivedAt: null },
      });
      await this.audit.logIn(
        tx,
        archive ? 'advisory_client.archived' : 'advisory_client.restored',
        { type: 'advisory_client', id },
        { advisoryClientId: id, clientId: c.clientId },
      );
      const [row] = await this.read.clientRows(ctx, [await this.read.loadClient(ctx, id)]);
      return row as AdvisoryClientRow;
    });
  }

  // ---------- Services ----------

  private async advisoryService(ctx: AdvisoryCtx, serviceId: string) {
    const s = await ctx.tx.service.findFirst({
      where: {
        businessId: ctx.businessId,
        id: serviceId,
        kind: 'BUSINESS_DEVELOPMENT',
        archivedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!s) throw notFound();
  }

  addWorkstream(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof AddWorkstreamBody>,
  ): Promise<AdvisoryWorkstream> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageServices) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, id);
      if (c.archivedAt) throw advErrors.clientArchived();
      await this.advisoryService(ctx, body.serviceId);
      if (c.workstreams.some((w) => w.serviceId === body.serviceId))
        throw advErrors.duplicateService();
      if (body.role === 'PRIMARY') {
        await tx.advisoryWorkstream.updateMany({
          where: { businessId, advisoryClientId: id, role: 'PRIMARY' },
          data: { role: 'ADDITIONAL' },
        });
      }
      const created = await tx.advisoryWorkstream.create({
        data: {
          businessId,
          advisoryClientId: id,
          serviceId: body.serviceId,
          role: body.role,
          status: body.status,
          packageName: body.packageName ?? null,
        },
        include: { service: { select: { name: true } } },
      });
      await this.audit.logIn(
        tx,
        'advisory_workstream.added',
        { type: 'advisory_client', id },
        { advisoryClientId: id, workstreamId: created.id, serviceId: body.serviceId },
      );
      return this.read.workstream(created);
    });
  }

  updateWorkstream(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    workstreamId: string,
    body: Out<typeof UpdateWorkstreamBody>,
  ): Promise<AdvisoryWorkstream> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageServices) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, id);
      if (c.archivedAt) throw advErrors.clientArchived();
      const w = c.workstreams.find((x) => x.id === workstreamId);
      if (!w) throw notFound();
      const startedOn =
        body.startedOn !== undefined
          ? body.startedOn
          : body.status === 'IN_PROGRESS' && !w.startedOn
            ? ctx.today
            : day(w.startedOn);
      const completedOn =
        body.completedOn !== undefined
          ? body.completedOn
          : body.status === 'COMPLETED' && !w.completedOn
            ? ctx.today
            : day(w.completedOn);
      if (startedOn && completedOn && completedOn < startedOn)
        throw advErrors.invalid('completedOn', 'The service cannot finish before it starts');
      if (body.role === 'PRIMARY' && w.role !== 'PRIMARY') {
        await tx.advisoryWorkstream.updateMany({
          where: { businessId, advisoryClientId: id, role: 'PRIMARY' },
          data: { role: 'ADDITIONAL' },
        });
      }
      const updated = await tx.advisoryWorkstream.update({
        where: { businessId_id: { businessId, id: workstreamId } },
        data: {
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.packageName !== undefined ? { packageName: body.packageName } : {}),
          startedOn: startedOn ? toDay(startedOn) : null,
          completedOn: completedOn ? toDay(completedOn) : null,
        },
        include: { service: { select: { name: true } } },
      });
      await this.audit.logIn(
        tx,
        'advisory_workstream.updated',
        { type: 'advisory_client', id },
        {
          advisoryClientId: id,
          workstreamId,
          fields: sentFields(body, ['role', 'status', 'packageName', 'startedOn', 'completedOn']),
        },
      );
      return this.read.workstream(updated);
    });
  }

  // ---------- Activity ----------

  activity(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    q: Out<typeof ActivityQuery>,
  ): Promise<AdvisoryActivityPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.loadClient(ctx, id);
      const where: Prisma.AuditLogWhereInput = {
        businessId,
        action: { startsWith: 'advisory_', not: { endsWith: '.viewed' } },
        metadata: { path: ['advisoryClientId'], equals: id },
      };
      const [total, rows] = await Promise.all([
        ctx.tx.auditLog.count({ where }),
        ctx.tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: { id: true, action: true, actorUserId: true, createdAt: true },
        }),
      ]);
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.actorUserId),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          message: ACTIVITY[r.action] ?? r.action.replace(/^advisory_/, '').replace(/[._]/g, ' '),
          action: r.action,
          actor: memberRef(names, r.actorUserId),
          at: r.createdAt.toISOString(),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
}
