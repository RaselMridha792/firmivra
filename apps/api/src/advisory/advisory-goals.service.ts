import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { AdvisoryGoalDetail, AdvisoryGoalPage, AdvisoryMilestone } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { checkAssignee, memberNames, notFound, sentFields, toDay } from '../workspaces/common.js';
import { type AdvisoryCtx, AdvisoryReadService } from './advisory-read.service.js';
import type {
  CreateGoalBody,
  CreateMilestoneBody,
  GoalsQuery,
  ReorderMilestonesBody,
  UpdateGoalBody,
  UpdateMilestoneBody,
} from './advisory-input.js';
import {
  advErrors,
  clientRefSelect,
  iso,
  OPEN_GOAL_STATUSES,
  settleProgress,
  slug,
} from './advisory.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const goalInclude = {
  advisoryClient: { select: { client: { select: clientRefSelect } } },
  milestones: { select: { status: true } },
} satisfies Prisma.AdvisoryGoalInclude;

/** Goals and their milestones. */
@Injectable()
export class AdvisoryGoalsService {
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

  /**
   * A plan or workstream named for a client: this client's own. One of another advisory client
   * the caller reaches is 409 NOT_THIS_CLIENT; any other id is 404.
   */
  async link(
    ctx: AdvisoryCtx,
    kind: 'plan' | 'workstream' | 'goal' | 'milestone',
    id: string | null | undefined,
    advisoryClientId: string,
  ): Promise<void> {
    if (!id) return;
    const { tx, businessId } = ctx;
    const reach = this.read.reach(ctx);
    let owner: string | undefined;
    if (kind === 'plan')
      owner = (
        await tx.advisoryPlan.findFirst({
          where: { businessId, id, advisoryClient: reach },
          select: { advisoryClientId: true },
        })
      )?.advisoryClientId;
    else if (kind === 'workstream')
      owner = (
        await tx.advisoryWorkstream.findFirst({
          where: { businessId, id, advisoryClient: reach },
          select: { advisoryClientId: true },
        })
      )?.advisoryClientId;
    else if (kind === 'goal')
      owner = (
        await tx.advisoryGoal.findFirst({
          where: { businessId, id, advisoryClient: reach },
          select: { advisoryClientId: true },
        })
      )?.advisoryClientId;
    else
      owner = (
        await tx.advisoryMilestone.findFirst({
          where: { businessId, id, goal: { advisoryClient: reach } },
          select: { goal: { select: { advisoryClientId: true } } },
        })
      )?.goal.advisoryClientId;
    if (!owner) throw notFound();
    if (owner !== advisoryClientId) throw advErrors.notThisClient(kind);
  }

  private async owner(
    ctx: AdvisoryCtx,
    userId: string | null | undefined,
    client: {
      assignedUserId: string | null;
    },
  ) {
    if (userId) await checkAssignee(ctx.tx, ctx.businessId, userId, client);
  }

  private async load(ctx: AdvisoryCtx, id: string) {
    const g = await ctx.tx.advisoryGoal.findFirst({
      where: { businessId: ctx.businessId, id, advisoryClient: this.read.reach(ctx) },
      include: {
        ...goalInclude,
        advisoryClient: { select: { archivedAt: true, client: { select: clientRefSelect } } },
      },
    });
    if (!g) throw notFound();
    return g;
  }

  async detail(ctx: AdvisoryCtx, id: string): Promise<AdvisoryGoalDetail> {
    const { tx, businessId } = ctx;
    const g = await this.load(ctx, id);
    const [milestones, recs, actions] = await Promise.all([
      tx.advisoryMilestone.findMany({
        where: { businessId, goalId: id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
      tx.advisoryRecommendation.findMany({
        where: { businessId, goalId: id },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      tx.advisoryActionItem.findMany({
        where: { businessId, goalId: id },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const names = await memberNames(
      tx,
      businessId,
      milestones.map((m) => m.ownerUserId),
    );
    const [row] = await this.read.goalRows(ctx, [g]);
    return {
      ...(row as NonNullable<typeof row>),
      description: g.description,
      milestones: milestones.map((m) => this.read.milestone(ctx, m, names)),
      recommendationIds: recs.map((r) => r.id),
      actionItemIds: actions.map((a) => a.id),
      completedAt: iso(g.completedAt),
      etag: g.updatedAt.toISOString(),
    };
  }

  // ---------- List and read ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof GoalsQuery>,
  ): Promise<AdvisoryGoalPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const area = q.area ? slug(q.area, 'area') : undefined;
      const todayDate = new Date(`${ctx.today}T00:00:00.000Z`);
      const overdue: Prisma.AdvisoryGoalWhereInput = {
        status: { in: [...OPEN_GOAL_STATUSES] },
        targetDate: { lt: todayDate },
      };
      const statusFilter: Prisma.AdvisoryGoalWhereInput =
        q.status === undefined
          ? {}
          : q.status === 'OVERDUE'
            ? { OR: [{ status: 'OVERDUE' }, overdue] }
            : (OPEN_GOAL_STATUSES as readonly string[]).includes(q.status)
              ? { status: q.status, NOT: overdue }
              : { status: q.status };
      const where: Prisma.AdvisoryGoalWhereInput = {
        businessId,
        advisoryClient: this.read.reach(ctx),
        ...(q.advisoryClientId ? { advisoryClientId: q.advisoryClientId } : {}),
        ...(q.planId ? { planId: q.planId } : {}),
        ...(area ? { area } : {}),
        ...(q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}),
        ...(q.dueBefore ? { targetDate: { lte: toDay(q.dueBefore) } } : {}),
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
        AND: [statusFilter],
      };
      const dir = q.direction;
      const orderBy: Prisma.AdvisoryGoalOrderByWithRelationInput[] =
        q.sort === 'title'
          ? [{ title: dir }, { id: 'asc' }]
          : q.sort === 'status'
            ? [{ status: dir }, { id: 'asc' }]
            : q.sort === 'progress'
              ? [{ progressPercent: dir }, { id: 'asc' }]
              : q.sort === 'updated'
                ? [{ updatedAt: dir }, { id: 'asc' }]
                : [{ targetDate: { sort: dir, nulls: 'last' } }, { id: 'asc' }];
      const [total, rows] = await Promise.all([
        ctx.tx.advisoryGoal.count({ where }),
        ctx.tx.advisoryGoal.findMany({
          where,
          include: goalInclude,
          orderBy,
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.read.goalRows(ctx, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AdvisoryGoalDetail> {
    const detail = await this.run(businessId, tenant, userId, (ctx) => this.detail(ctx, id));
    await this.audit.log(
      'advisory_goal.viewed',
      { type: 'advisory_goal', id },
      { advisoryClientId: detail.advisoryClientId },
    );
    return detail;
  }

  // ---------- Create and change ----------

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateGoalBody>,
  ): Promise<AdvisoryGoalDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, body.advisoryClientId);
      if (c.archivedAt) throw advErrors.clientArchived();
      await this.link(ctx, 'plan', body.planId, c.id);
      await this.link(ctx, 'workstream', body.workstreamId, c.id);
      await this.owner(ctx, body.ownerUserId, c.client);
      for (const m of body.milestones) await this.owner(ctx, m.ownerUserId, c.client);
      const settled = settleProgress(
        { status: 'NOT_STARTED', progressPercent: 0, completedAt: null },
        { status: body.status, progressPercent: body.progressPercent },
      );
      const goal = await tx.advisoryGoal.create({
        data: {
          businessId,
          advisoryClientId: c.id,
          planId: body.planId ?? null,
          workstreamId: body.workstreamId ?? null,
          title: body.title,
          description: body.description ?? null,
          area: slug(body.area, 'area') ?? null,
          targetDate: body.targetDate ? toDay(body.targetDate) : null,
          ownerUserId: body.ownerUserId ?? null,
          ...settled,
        },
        select: { id: true },
      });
      for (const [i, m] of body.milestones.entries()) {
        await tx.advisoryMilestone.create({
          data: {
            businessId,
            goalId: goal.id,
            title: m.title,
            targetDate: m.targetDate ? toDay(m.targetDate) : null,
            ownerUserId: m.ownerUserId ?? null,
            sortOrder: i,
          },
        });
      }
      await this.audit.logIn(
        tx,
        'advisory_goal.created',
        { type: 'advisory_goal', id: goal.id },
        { advisoryClientId: c.id, milestones: body.milestones.length },
      );
      await this.read.recomputeHealth(ctx, c.id);
      return this.detail(ctx, goal.id);
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateGoalBody>,
  ): Promise<AdvisoryGoalDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const found = await this.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM advisory_goals WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const g = await this.load(ctx, id);
      if (g.advisoryClient.archivedAt) throw advErrors.clientArchived();
      if (g.archivedAt) throw advErrors.invalidStatus('Restore the goal before changing it');
      if (body.etag !== g.updatedAt.toISOString()) throw advErrors.saveConflict();
      await this.link(ctx, 'plan', body.planId, found.advisoryClientId);
      await this.link(ctx, 'workstream', body.workstreamId, found.advisoryClientId);
      if (body.ownerUserId && body.ownerUserId !== g.ownerUserId) {
        const c = await tx.client.findFirstOrThrow({
          where: { businessId, id: await this.clientIdOf(ctx, g.advisoryClientId) },
          select: { assignedUserId: true },
        });
        await this.owner(ctx, body.ownerUserId, c);
      }
      const settled = settleProgress(g, {
        status: body.status,
        progressPercent: body.progressPercent,
      });
      await tx.advisoryGoal.update({
        where: { businessId_id: { businessId, id } },
        data: {
          ...settled,
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
          ...(body.workstreamId !== undefined ? { workstreamId: body.workstreamId } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.area !== undefined ? { area: slug(body.area, 'area') } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? toDay(body.targetDate) : null }
            : {}),
          ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_goal.updated',
        { type: 'advisory_goal', id },
        {
          advisoryClientId: g.advisoryClientId,
          fields: sentFields(body, [
            'planId',
            'workstreamId',
            'title',
            'description',
            'area',
            'targetDate',
            'ownerUserId',
            'status',
            'progressPercent',
          ]),
        },
      );
      await this.read.recomputeHealth(ctx, g.advisoryClientId);
      return this.detail(ctx, id);
    });
  }

  private async clientIdOf(ctx: AdvisoryCtx, advisoryClientId: string): Promise<string> {
    const c = await ctx.tx.advisoryClient.findFirstOrThrow({
      where: { businessId: ctx.businessId, id: advisoryClientId },
      select: { clientId: true },
    });
    return c.clientId;
  }

  setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<AdvisoryGoalDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const g = await this.load(ctx, id);
      if (archive === (g.archivedAt === null)) {
        await tx.advisoryGoal.update({
          where: { businessId_id: { businessId, id } },
          data: { archivedAt: archive ? new Date() : null },
        });
        await this.audit.logIn(
          tx,
          archive ? 'advisory_goal.archived' : 'advisory_goal.restored',
          { type: 'advisory_goal', id },
          { advisoryClientId: g.advisoryClientId },
        );
        await this.read.recomputeHealth(ctx, g.advisoryClientId);
      }
      return this.detail(ctx, id);
    });
  }

  // ---------- Milestones ----------

  addMilestone(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    goalId: string,
    body: Out<typeof CreateMilestoneBody>,
  ): Promise<AdvisoryMilestone> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const g = await this.load(ctx, goalId);
      if (g.advisoryClient.archivedAt) throw advErrors.clientArchived();
      if (g.archivedAt) throw advErrors.invalidStatus('Restore the goal before changing it');
      if (body.ownerUserId) {
        const c = await tx.client.findFirstOrThrow({
          where: { businessId, id: await this.clientIdOf(ctx, g.advisoryClientId) },
          select: { assignedUserId: true },
        });
        await this.owner(ctx, body.ownerUserId, c);
      }
      const settled = settleProgress(
        { status: 'NOT_STARTED', progressPercent: 0, completedAt: null },
        { status: body.status, progressPercent: body.progressPercent },
      );
      const last = await tx.advisoryMilestone.findFirst({
        where: { businessId, goalId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const m = await tx.advisoryMilestone.create({
        data: {
          businessId,
          goalId,
          title: body.title,
          targetDate: body.targetDate ? toDay(body.targetDate) : null,
          ownerUserId: body.ownerUserId ?? null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          ...settled,
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_milestone.added',
        { type: 'advisory_goal', id: goalId },
        { advisoryClientId: g.advisoryClientId, milestoneId: m.id },
      );
      const names = await memberNames(tx, businessId, [m.ownerUserId]);
      return this.read.milestone(ctx, m, names);
    });
  }

  updateMilestone(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateMilestoneBody>,
  ): Promise<AdvisoryMilestone> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const m = await tx.advisoryMilestone.findFirst({
        where: { businessId, id, goal: { advisoryClient: this.read.reach(ctx) } },
        include: {
          goal: {
            select: {
              advisoryClientId: true,
              archivedAt: true,
              advisoryClient: { select: { archivedAt: true, clientId: true } },
            },
          },
        },
      });
      if (!m) throw notFound();
      if (m.goal.advisoryClient.archivedAt) throw advErrors.clientArchived();
      if (m.goal.archivedAt) throw advErrors.invalidStatus('Restore the goal before changing it');
      if (body.ownerUserId && body.ownerUserId !== m.ownerUserId) {
        const c = await tx.client.findFirstOrThrow({
          where: { businessId, id: m.goal.advisoryClient.clientId },
          select: { assignedUserId: true },
        });
        await this.owner(ctx, body.ownerUserId, c);
      }
      const settled = settleProgress(m, {
        status: body.status,
        progressPercent: body.progressPercent,
      });
      const updated = await tx.advisoryMilestone.update({
        where: { businessId_id: { businessId, id } },
        data: {
          ...settled,
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? toDay(body.targetDate) : null }
            : {}),
          ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_milestone.updated',
        { type: 'advisory_goal', id: m.goalId },
        {
          advisoryClientId: m.goal.advisoryClientId,
          milestoneId: id,
          fields: sentFields(body, [
            'title',
            'targetDate',
            'ownerUserId',
            'status',
            'progressPercent',
          ]),
        },
      );
      const names = await memberNames(tx, businessId, [updated.ownerUserId]);
      return this.read.milestone(ctx, updated, names);
    });
  }

  reorderMilestones(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    goalId: string,
    body: Out<typeof ReorderMilestonesBody>,
  ): Promise<AdvisoryGoalDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const g = await this.load(ctx, goalId);
      if (g.advisoryClient.archivedAt) throw advErrors.clientArchived();
      const current = await tx.advisoryMilestone.findMany({
        where: { businessId, goalId },
        select: { id: true },
      });
      const have = new Set(current.map((m) => m.id));
      if (
        body.ids.length !== have.size ||
        new Set(body.ids).size !== have.size ||
        body.ids.some((x) => !have.has(x))
      )
        throw advErrors.invalid('ids', 'Send every milestone of the goal once');
      for (const [sortOrder, mid] of body.ids.entries()) {
        await tx.advisoryMilestone.update({
          where: { businessId_id: { businessId, id: mid } },
          data: { sortOrder },
        });
      }
      await this.audit.logIn(
        tx,
        'advisory_milestone.updated',
        { type: 'advisory_goal', id: goalId },
        { advisoryClientId: g.advisoryClientId, fields: ['order'] },
      );
      return this.detail(ctx, goalId);
    });
  }
}
