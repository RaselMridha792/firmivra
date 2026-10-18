import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AdvisoryActionItemPage,
  AdvisoryActionItemRow,
  AdvisoryRecommendationPage,
  AdvisoryRecommendationRow,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { checkAssignee, notFound, sentFields, toDay } from '../workspaces/common.js';
import { type AdvisoryCtx, AdvisoryReadService } from './advisory-read.service.js';
import { AdvisoryGoalsService } from './advisory-goals.service.js';
import type {
  ActionItemsQuery,
  CreateActionItemBody,
  CreateRecommendationBody,
  RecommendationsQuery,
  UpdateActionItemBody,
  UpdateRecommendationBody,
} from './advisory-input.js';
import { advErrors, clientRefSelect, slug } from './advisory.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const actionInclude = {
  advisoryClient: { select: { client: { select: clientRefSelect } } },
} satisfies Prisma.AdvisoryActionItemInclude;
const OPEN_ACTION = ['NOT_STARTED', 'IN_PROGRESS'] as const;

/** Recommendations and action items (Action Plans). */
@Injectable()
export class AdvisoryActionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AdvisoryReadService,
    private readonly links: AdvisoryGoalsService,
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

  // ---------- Recommendations ----------

  listRecommendations(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof RecommendationsQuery>,
  ): Promise<AdvisoryRecommendationPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.AdvisoryRecommendationWhereInput = {
        businessId,
        advisoryClient: this.read.reach(ctx),
        ...(q.advisoryClientId ? { advisoryClientId: q.advisoryClientId } : {}),
        ...(q.planId ? { planId: q.planId } : {}),
        ...(q.goalId ? { goalId: q.goalId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.clientVisible !== undefined ? { clientVisible: q.clientVisible } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.advisoryRecommendation.count({ where }),
        ctx.tx.advisoryRecommendation.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.read.recRows(ctx, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  createRecommendation(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateRecommendationBody>,
  ): Promise<AdvisoryRecommendationRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageRecs) throw advErrors.forbidden();
      const { tx } = ctx;
      if (body.impactCents != null && body.impactCents < 0)
        throw advErrors.invalid('impactCents', 'Enter an amount of zero or more');
      const c = await this.read.lockClient(ctx, body.advisoryClientId);
      if (c.archivedAt) throw advErrors.clientArchived();
      await this.links.link(ctx, 'plan', body.planId, c.id);
      await this.links.link(ctx, 'goal', body.goalId, c.id);
      const row = await tx.advisoryRecommendation.create({
        data: {
          businessId,
          advisoryClientId: c.id,
          planId: body.planId ?? null,
          goalId: body.goalId ?? null,
          title: body.title,
          category: slug(body.category, 'category') ?? null,
          rationale: body.rationale ?? null,
          impactLabel: body.impactLabel ?? null,
          impactCents: body.impactCents ?? null,
          clientVisible: body.clientVisible,
          createdByUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_recommendation.created',
        { type: 'advisory_recommendation', id: row.id },
        { advisoryClientId: c.id, clientVisible: body.clientVisible },
      );
      return (await this.read.recRows(ctx, [row]))[0] as AdvisoryRecommendationRow;
    });
  }

  updateRecommendation(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateRecommendationBody>,
  ): Promise<AdvisoryRecommendationRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageRecs) throw advErrors.forbidden();
      const { tx } = ctx;
      if (body.impactCents != null && body.impactCents < 0)
        throw advErrors.invalid('impactCents', 'Enter an amount of zero or more');
      const cur = await tx.advisoryRecommendation.findFirst({
        where: { businessId, id, advisoryClient: this.read.reach(ctx) },
        include: { advisoryClient: { select: { archivedAt: true } } },
      });
      if (!cur) throw notFound();
      if (cur.advisoryClient.archivedAt) throw advErrors.clientArchived();
      await this.links.link(ctx, 'plan', body.planId, cur.advisoryClientId);
      await this.links.link(ctx, 'goal', body.goalId, cur.advisoryClientId);
      const status = body.status ?? cur.status;
      const decidedAt =
        status === 'PROPOSED'
          ? null
          : body.status !== undefined && cur.status === 'PROPOSED'
            ? new Date()
            : (cur.decidedAt ?? new Date());
      const row = await tx.advisoryRecommendation.update({
        where: { id },
        data: {
          status,
          decidedAt,
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
          ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.category !== undefined ? { category: slug(body.category, 'category') } : {}),
          ...(body.rationale !== undefined ? { rationale: body.rationale } : {}),
          ...(body.impactLabel !== undefined ? { impactLabel: body.impactLabel } : {}),
          ...(body.impactCents !== undefined ? { impactCents: body.impactCents } : {}),
          ...(body.clientVisible !== undefined ? { clientVisible: body.clientVisible } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_recommendation.updated',
        { type: 'advisory_recommendation', id },
        {
          advisoryClientId: cur.advisoryClientId,
          fields: sentFields(body, [
            'planId',
            'goalId',
            'title',
            'category',
            'rationale',
            'impactLabel',
            'impactCents',
            'status',
            'clientVisible',
          ]),
        },
      );
      return (await this.read.recRows(ctx, [row]))[0] as AdvisoryRecommendationRow;
    });
  }

  // ---------- Action items ----------

  listActionItems(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ActionItemsQuery>,
  ): Promise<AdvisoryActionItemPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const today = new Date(`${ctx.today}T00:00:00.000Z`);
      const overdue: Prisma.AdvisoryActionItemWhereInput = {
        status: { in: [...OPEN_ACTION] },
        dueOn: { lt: today },
      };
      const where: Prisma.AdvisoryActionItemWhereInput = {
        businessId,
        advisoryClient: this.read.reach(ctx),
        ...(q.advisoryClientId ? { advisoryClientId: q.advisoryClientId } : {}),
        ...(q.planId ? { planId: q.planId } : {}),
        ...(q.goalId ? { goalId: q.goalId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.assigneeKind ? { assigneeKind: q.assigneeKind } : {}),
        ...(q.assigneeUserId ? { assigneeUserId: q.assigneeUserId } : {}),
        ...(q.dueBefore ? { dueOn: { lte: toDay(q.dueBefore) } } : {}),
        ...(q.overdue === true ? overdue : q.overdue === false ? { NOT: overdue } : {}),
        ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.advisoryActionItem.count({ where }),
        ctx.tx.advisoryActionItem.findMany({
          where,
          include: actionInclude,
          orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.read.actionRows(ctx, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  private async loadAction(ctx: AdvisoryCtx, id: string) {
    const a = await ctx.tx.advisoryActionItem.findFirst({
      where: { businessId: ctx.businessId, id, advisoryClient: this.read.reach(ctx) },
      include: actionInclude,
    });
    if (!a) throw notFound();
    return a;
  }

  createActionItem(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateActionItemBody>,
  ): Promise<AdvisoryActionItemRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, body.advisoryClientId);
      if (c.archivedAt) throw advErrors.clientArchived();
      // A staff action item with no one named is the author's own.
      const assigneeUserId = body.assigneeKind === 'STAFF' ? (body.assigneeUserId ?? userId) : null;
      await this.links.link(ctx, 'plan', body.planId, c.id);
      await this.links.link(ctx, 'goal', body.goalId, c.id);
      await this.links.link(ctx, 'milestone', body.milestoneId, c.id);
      if (assigneeUserId) await checkAssignee(tx, businessId, assigneeUserId, c.client);
      const row = await tx.advisoryActionItem.create({
        data: {
          businessId,
          advisoryClientId: c.id,
          planId: body.planId ?? null,
          goalId: body.goalId ?? null,
          milestoneId: body.milestoneId ?? null,
          title: body.title,
          details: body.details ?? null,
          assigneeKind: body.assigneeKind,
          assigneeUserId,
          dueOn: body.dueOn ? toDay(body.dueOn) : null,
          priority: body.priority,
          clientVisible: body.clientVisible,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'advisory_action_item.created',
        { type: 'advisory_action_item', id: row.id },
        { advisoryClientId: c.id, assigneeKind: body.assigneeKind },
      );
      await this.read.recomputeHealth(ctx, c.id);
      return (
        await this.read.actionRows(ctx, [await this.loadAction(ctx, row.id)])
      )[0] as AdvisoryActionItemRow;
    });
  }

  updateActionItem(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateActionItemBody>,
  ): Promise<AdvisoryActionItemRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manageGoals) throw advErrors.forbidden();
      const { tx } = ctx;
      const cur = await this.loadAction(ctx, id);
      const owner = await tx.advisoryClient.findFirstOrThrow({
        where: { businessId, id: cur.advisoryClientId },
        select: { archivedAt: true, client: { select: { assignedUserId: true } } },
      });
      if (owner.archivedAt) throw advErrors.clientArchived();
      await this.links.link(ctx, 'plan', body.planId, cur.advisoryClientId);
      await this.links.link(ctx, 'goal', body.goalId, cur.advisoryClientId);
      await this.links.link(ctx, 'milestone', body.milestoneId, cur.advisoryClientId);
      const kind = body.assigneeKind ?? cur.assigneeKind;
      let assigneeUserId =
        body.assigneeUserId !== undefined ? body.assigneeUserId : cur.assigneeUserId;
      if (kind !== 'STAFF') {
        if (body.assigneeUserId)
          throw advErrors.invalid('assigneeUserId', 'Only a staff action item names a person');
        assigneeUserId = null;
      } else if (!assigneeUserId) throw advErrors.invalid('assigneeUserId', 'Choose who it is for');
      if (assigneeUserId && assigneeUserId !== cur.assigneeUserId)
        await checkAssignee(tx, businessId, assigneeUserId, owner.client);
      const status = body.status ?? cur.status;
      await tx.advisoryActionItem.update({
        where: { id },
        data: {
          assigneeKind: kind,
          assigneeUserId,
          status,
          completedAt: status === 'DONE' ? (cur.completedAt ?? new Date()) : null,
          ...(body.planId !== undefined ? { planId: body.planId } : {}),
          ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
          ...(body.milestoneId !== undefined ? { milestoneId: body.milestoneId } : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.details !== undefined ? { details: body.details } : {}),
          ...(body.dueOn !== undefined ? { dueOn: body.dueOn ? toDay(body.dueOn) : null } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.clientVisible !== undefined ? { clientVisible: body.clientVisible } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_action_item.updated',
        { type: 'advisory_action_item', id },
        {
          advisoryClientId: cur.advisoryClientId,
          fields: sentFields(body, [
            'planId',
            'goalId',
            'milestoneId',
            'title',
            'details',
            'assigneeKind',
            'assigneeUserId',
            'dueOn',
            'priority',
            'status',
            'clientVisible',
          ]),
        },
      );
      await this.read.recomputeHealth(ctx, cur.advisoryClientId);
      return (
        await this.read.actionRows(ctx, [await this.loadAction(ctx, id)])
      )[0] as AdvisoryActionItemRow;
    });
  }
}
