import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AdvisoryPlanDetail,
  AdvisoryPlanPage,
  AdvisoryPlanRow,
  AdvisoryVersionDetail,
  AdvisoryVersionRow,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MessagesService } from '../messages/messages.service.js';
import { day, memberNames, memberRef, notFound, sentFields } from '../workspaces/common.js';
import { type AdvisoryCtx, AdvisoryReadService, clientInclude } from './advisory-read.service.js';
import type {
  CreatePlanBody,
  FinalizeBody,
  PlansQuery,
  SendPlanBody,
  SetPlanStatusBody,
  UpdatePlanBody,
} from './advisory-input.js';
import {
  advErrors,
  clientRefSelect,
  DISCLAIMER,
  effectiveGoalStatus,
  iso,
  mergeDocument,
} from './advisory.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const planInclude = {
  advisoryClient: { include: clientInclude },
} satisfies Prisma.AdvisoryPlanInclude;
type PlanShape = Prisma.AdvisoryPlanGetPayload<{ include: typeof planInclude }>;

const NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['DRAFT'],
  FINALIZED: ['IN_PROGRESS'],
  SENT: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['IN_PROGRESS'],
};

interface Content {
  planName: string;
  targetYear: number;
  profile: Record<string, unknown>;
  assessment: Record<string, unknown>;
  strategy: Record<string, unknown>;
  goals: { title: string; area: string | null; targetDate: string | null; status: string }[];
  recommendations: {
    title: string;
    rationale: string | null;
    impactLabel: string | null;
    status: string;
    clientVisible: boolean;
  }[];
  workstreams: { serviceName: string; status: string; role: string }[];
  financials: unknown[];
  disclaimer: string;
}

/** A value with its object keys in order, so two documents compare equal whatever order they were stored in. */
function canon(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}

/** The plan's own content differs from what a version kept (what a person can edit in stages 1 to 3). */
const changedSince = (p: PlanShape, c: Content) =>
  canon({
    planName: p.name,
    targetYear: p.targetYear,
    profile: p.profile,
    assessment: p.assessment,
    strategy: p.strategy,
  }) !==
  canon({
    planName: c.planName,
    targetYear: c.targetYear,
    profile: c.profile,
    assessment: c.assessment,
    strategy: c.strategy,
  });

/** Business plans: the five-step plan, its status, immutable versions and delivery to the client. */
@Injectable()
export class AdvisoryPlansService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AdvisoryReadService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
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

  private async load(ctx: AdvisoryCtx, id: string): Promise<PlanShape> {
    const p = await ctx.tx.advisoryPlan.findFirst({
      where: { businessId: ctx.businessId, id, advisoryClient: this.read.reach(ctx) },
      include: planInclude,
    });
    if (!p) throw notFound();
    return p;
  }

  /** The plan locked for a change: the caller's own, not archived. */
  private async editable(ctx: AdvisoryCtx, id: string, etag?: string): Promise<PlanShape> {
    await this.load(ctx, id);
    await ctx.tx.$queryRaw`
      SELECT 1 FROM advisory_plans WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    const p = await this.load(ctx, id);
    if (p.archivedAt) throw advErrors.planArchived();
    if (p.advisoryClient.archivedAt) throw advErrors.clientArchived();
    if (etag !== undefined && etag !== p.updatedAt.toISOString()) throw advErrors.saveConflict();
    return p;
  }

  private async row(ctx: AdvisoryCtx, p: PlanShape): Promise<AdvisoryPlanRow> {
    const names = await memberNames(ctx.tx, ctx.businessId, [p.advisoryClient.advisorUserId]);
    return this.read.planRow(p, names);
  }

  async detail(ctx: AdvisoryCtx, p: PlanShape): Promise<AdvisoryPlanDetail> {
    const { tx, businessId } = ctx;
    const [snapshots, goals, recs, actions] = await Promise.all([
      this.read.latestSnapshots(ctx, p.advisoryClientId, 12),
      tx.advisoryGoal.findMany({
        where: { businessId, planId: p.id, archivedAt: null },
        include: {
          advisoryClient: { select: { client: { select: clientRefSelect } } },
          milestones: { select: { status: true } },
        },
        orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
      tx.advisoryRecommendation.findMany({
        where: { businessId, planId: p.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      tx.advisoryActionItem.findMany({
        where: { businessId, planId: p.id },
        include: { advisoryClient: { select: { client: { select: clientRefSelect } } } },
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
    ]);
    const names = await memberNames(tx, businessId, [
      ...snapshots.map((s) => s.overriddenByUserId),
      p.advisoryClient.advisorUserId,
    ]);
    const asOf = snapshots.reduce<Date | null>((m, s) => (!m || s.asOf > m ? s.asOf : m), null);
    const ageDays = asOf
      ? (Date.parse(`${ctx.today}T00:00:00Z`) - asOf.getTime()) / 86_400_000
      : null;
    return {
      ...this.read.planRow(p, names),
      profile: p.profile as AdvisoryPlanDetail['profile'],
      assessment: p.assessment as AdvisoryPlanDetail['assessment'],
      strategy: p.strategy as AdvisoryPlanDetail['strategy'],
      financials: ctx.perms.viewFinancials
        ? snapshots.map((s) => this.read.financialRow(ctx, s, names))
        : null,
      goals: await this.read.goalRows(ctx, goals),
      recommendations: await this.read.recRows(ctx, recs),
      actionItems: await this.read.actionRows(ctx, actions),
      workstreams: p.advisoryClient.workstreams.map((w) => this.read.workstream(w)),
      sourceDataAsOf: day(asOf),
      staleFinancials: ageDays !== null && ageDays > ctx.settings.staleFinancialsDays,
      disclaimer: DISCLAIMER,
      canEdit: ctx.perms.editPlans,
      canOverride: ctx.perms.override,
      canSend: ctx.perms.send,
      createdAt: p.createdAt.toISOString(),
      etag: p.updatedAt.toISOString(),
    };
  }

  private async detailById(ctx: AdvisoryCtx, id: string) {
    return this.detail(ctx, await this.load(ctx, id));
  }

  // ---------- Lists, reads, create, change ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof PlansQuery>,
  ): Promise<AdvisoryPlanPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.AdvisoryPlanWhereInput = {
        businessId,
        advisoryClient: {
          ...this.read.reach(ctx),
          ...(q.advisorUserId ? { advisorUserId: q.advisorUserId } : {}),
        },
        ...(q.advisoryClientId ? { advisoryClientId: q.advisoryClientId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.targetYear ? { targetYear: q.targetYear } : {}),
        ...(q.planType ? { planType: { equals: q.planType, mode: 'insensitive' } } : {}),
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                {
                  advisoryClient: {
                    client: { displayName: { contains: search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.advisoryPlan.count({ where }),
        ctx.tx.advisoryPlan.findMany({
          where,
          include: planInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.advisoryClient.advisorUserId),
      );
      return {
        items: rows.map((r) => this.read.planRow(r, names)),
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
  ): Promise<AdvisoryPlanDetail> {
    const detail = await this.run(businessId, tenant, userId, (ctx) => this.detailById(ctx, id));
    await this.audit.log(
      'advisory_plan.viewed',
      { type: 'advisory_plan', id },
      { advisoryClientId: detail.advisoryClientId },
    );
    return detail;
  }

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreatePlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.createPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, body.advisoryClientId);
      if (c.archivedAt) throw advErrors.clientArchived();
      const plan = await tx.advisoryPlan.create({
        data: {
          businessId,
          advisoryClientId: c.id,
          name: body.name,
          targetYear: body.targetYear,
          planType: body.planType ?? null,
          profile: mergeDocument({}, body.profile) as Prisma.InputJsonObject,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.created',
        { type: 'advisory_plan', id: plan.id },
        { advisoryClientId: c.id, targetYear: body.targetYear },
      );
      return this.detailById(ctx, plan.id);
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdatePlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.editPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      const p = await this.editable(ctx, id, body.etag);
      await tx.advisoryPlan.update({
        where: { businessId_id: { businessId, id } },
        data: {
          updatedByUserId: userId,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.targetYear !== undefined ? { targetYear: body.targetYear } : {}),
          ...(body.planType !== undefined ? { planType: body.planType } : {}),
          ...(body.step !== undefined ? { step: body.step } : {}),
          ...(body.profile !== undefined
            ? { profile: mergeDocument(p.profile, body.profile) as Prisma.InputJsonObject }
            : {}),
          ...(body.assessment !== undefined
            ? { assessment: mergeDocument(p.assessment, body.assessment) as Prisma.InputJsonObject }
            : {}),
          ...(body.strategy !== undefined
            ? { strategy: mergeDocument(p.strategy, body.strategy) as Prisma.InputJsonObject }
            : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.updated',
        { type: 'advisory_plan', id },
        {
          advisoryClientId: p.advisoryClientId,
          fields: sentFields(body, [
            'name',
            'targetYear',
            'planType',
            'step',
            'profile',
            'assessment',
            'strategy',
          ]),
        },
      );
      return this.detailById(ctx, id);
    });
  }

  setStatus(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetPlanStatusBody>,
  ): Promise<AdvisoryPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.editPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      const p = await this.editable(ctx, id, body.etag);
      if (!(NEXT_STATUS[p.status] ?? []).includes(body.status))
        throw advErrors.invalidStatus(`A plan cannot go from ${p.status} to ${body.status}`);
      if (body.status === 'DRAFT' && p.finalizedAt)
        throw advErrors.invalidStatus('A plan that was finalized cannot go back to a draft');
      await tx.advisoryPlan.update({
        where: { businessId_id: { businessId, id } },
        data: { status: body.status, updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.status_changed',
        { type: 'advisory_plan', id },
        { advisoryClientId: p.advisoryClientId, from: p.status, to: body.status },
      );
      return this.detailById(ctx, id);
    });
  }

  setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<AdvisoryPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.editPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      await this.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM advisory_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const p = await this.load(ctx, id);
      if (archive === (p.archivedAt === null)) {
        await tx.advisoryPlan.update({
          where: { businessId_id: { businessId, id } },
          data: archive
            ? { status: 'ARCHIVED', archivedAt: new Date() }
            : {
                status: p.finalizedAt ? (p.sentAt ? 'SENT' : 'FINALIZED') : 'DRAFT',
                archivedAt: null,
              },
        });
        await this.audit.logIn(
          tx,
          archive ? 'advisory_plan.archived' : 'advisory_plan.restored',
          { type: 'advisory_plan', id },
          { advisoryClientId: p.advisoryClientId },
        );
      }
      return this.detailById(ctx, id);
    });
  }

  // ---------- Versions ----------

  private async contentOf(
    ctx: AdvisoryCtx,
    p: PlanShape,
  ): Promise<{ content: Content; asOf: Date | null }> {
    const { tx, businessId } = ctx;
    const [snapshots, goals, recs] = await Promise.all([
      this.read.latestSnapshots(ctx, p.advisoryClientId, 12),
      tx.advisoryGoal.findMany({
        where: { businessId, planId: p.id, archivedAt: null },
        orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
      tx.advisoryRecommendation.findMany({
        where: { businessId, planId: p.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const names = await memberNames(
      tx,
      businessId,
      snapshots.map((s) => s.overriddenByUserId),
    );
    const asOf = snapshots.reduce<Date | null>((m, s) => (!m || s.asOf > m ? s.asOf : m), null);
    return {
      asOf,
      content: {
        planName: p.name,
        targetYear: p.targetYear,
        profile: p.profile as Record<string, unknown>,
        assessment: p.assessment as Record<string, unknown>,
        strategy: p.strategy as Record<string, unknown>,
        goals: goals.map((g) => ({
          title: g.title,
          area: g.area,
          targetDate: day(g.targetDate),
          status: effectiveGoalStatus(g.status, g.targetDate, ctx.today),
        })),
        recommendations: recs.map((r) => ({
          title: r.title,
          rationale: r.rationale,
          impactLabel: r.impactLabel,
          status: r.status,
          clientVisible: r.clientVisible,
        })),
        workstreams: p.advisoryClient.workstreams.map((w) => ({
          serviceName: w.service.name,
          status: w.status,
          role: w.role,
        })),
        financials: snapshots.map((s) => this.read.financialRow(ctx, s, names)),
        disclaimer: DISCLAIMER,
      },
    };
  }

  private async nextVersionNo(ctx: AdvisoryCtx, planId: string) {
    const last = await ctx.tx.advisoryPlanVersion.findFirst({
      where: { businessId: ctx.businessId, planId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    return (last?.versionNo ?? 0) + 1;
  }

  finalize(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof FinalizeBody>,
  ): Promise<AdvisoryPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.editPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      const p = await this.editable(ctx, id, body.etag);
      const { content, asOf } = await this.contentOf(ctx, p);
      const missing: string[] = [];
      if (typeof content.profile.businessName !== 'string')
        missing.push('Add the business name (stage 1)');
      const areas = content.strategy.areas;
      if (!content.strategy.summary && !(Array.isArray(areas) && areas.length > 0))
        missing.push('Add the strategy summary or an area (stage 3)');
      if (content.goals.length === 0) missing.push('Add at least one goal to the plan');
      if (!asOf) missing.push('Add the financial figures');
      else if (
        (Date.parse(`${ctx.today}T00:00:00Z`) - asOf.getTime()) / 86_400_000 >
        ctx.settings.staleFinancialsDays
      )
        missing.push('The financial figures are out of date; add current ones');
      if (missing.length > 0) throw advErrors.planNotReady(missing);
      const versionNo = await this.nextVersionNo(ctx, id);
      await tx.advisoryPlanVersion.create({
        data: {
          businessId,
          planId: id,
          versionNo,
          content: content as unknown as Prisma.InputJsonObject,
          sourceDataAsOf: asOf,
          createdByUserId: userId,
        },
      });
      await tx.advisoryPlan.update({
        where: { businessId_id: { businessId, id } },
        data: {
          currentVersion: versionNo,
          finalizedAt: new Date(),
          ...(['DRAFT', 'IN_REVIEW', 'FINALIZED', 'SENT'].includes(p.status)
            ? { status: 'FINALIZED' as const }
            : {}),
          updatedByUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.finalized',
        { type: 'advisory_plan', id },
        { advisoryClientId: p.advisoryClientId, version: versionNo },
      );
      return this.detailById(ctx, id);
    });
  }

  async send(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SendPlanBody>,
  ): Promise<AdvisoryPlanDetail> {
    // Check and compose in one transaction, deliver, then record the delivery on the version.
    const prepared = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.send) throw advErrors.forbidden();
      const { tx } = ctx;
      const p = await this.load(ctx, id);
      if (p.archivedAt) throw advErrors.planArchived();
      if (p.advisoryClient.archivedAt) throw advErrors.clientArchived();
      const version = await tx.advisoryPlanVersion.findFirst({
        where: {
          businessId,
          planId: id,
          ...(body.version !== undefined ? { versionNo: body.version } : {}),
        },
        orderBy: { versionNo: 'desc' },
      });
      if (body.version !== undefined && !version) throw notFound();
      const newest = await tx.advisoryPlanVersion.findFirst({
        where: { businessId, planId: id },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      });
      const isOlder = !!version && !!newest && version.versionNo < newest.versionNo;
      const missing: string[] = [];
      if (!version) missing.push('Finalize the plan first');
      else if (changedSince(p, version.content as unknown as Content) && !isOlder)
        missing.push('The plan changed after it was finalized; finalize it again');
      if (missing.length > 0 || !version) throw advErrors.planNotReady(missing);
      const content = version.content as unknown as Content;
      const [recs, actions] = await Promise.all([
        tx.advisoryRecommendation.findMany({
          where: { businessId, planId: id, clientVisible: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        tx.advisoryActionItem.findMany({
          where: {
            businessId,
            planId: id,
            clientVisible: true,
            status: { in: ['NOT_STARTED', 'IN_PROGRESS'] },
          },
          orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        }),
      ]);
      const summary =
        typeof content.strategy.summary === 'string' ? content.strategy.summary : null;
      const text = [
        `Your business plan, ${content.planName} (${content.targetYear}), is ready.`,
        ...(summary ? ['', summary] : []),
        ...(content.goals.length
          ? [
              '',
              'Goals:',
              ...content.goals.map(
                (g) => `- ${g.title}${g.targetDate ? ` (by ${g.targetDate})` : ''}`,
              ),
            ]
          : []),
        ...(recs.length
          ? [
              '',
              'Recommendations:',
              ...recs.map((r) => `- ${r.title}${r.impactLabel ? ` (${r.impactLabel})` : ''}`),
            ]
          : []),
        ...(actions.length
          ? [
              '',
              'Next steps:',
              ...actions.map((a) => `- ${a.title}${a.dueOn ? ` (due ${day(a.dueOn)})` : ''}`),
            ]
          : []),
        ...(body.message ? ['', body.message] : []),
        '',
        DISCLAIMER,
      ].join('\n');
      return { plan: p, version, text, actor: ctx.actor };
    });
    if (body.channel !== 'DOWNLOAD') {
      await this.messages.create(
        businessId,
        prepared.actor,
        prepared.plan.advisoryClient.clientId,
        {
          subject: `Your business plan: ${prepared.plan.name}`.slice(0, 200),
          body: prepared.text,
          repliesEnabled: true,
        },
      );
    }
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      await this.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM advisory_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const p = await this.load(ctx, id);
      const now = new Date();
      const channel = body.channel.toLowerCase();
      let versionNo = prepared.version.versionNo;
      if (prepared.version.deliveredAt === null) {
        await tx.advisoryPlanVersion.update({
          where: { id: prepared.version.id },
          data: { deliveredAt: now, deliveredChannel: channel, deliveredByUserId: userId },
        });
      } else {
        // Each delivery is its own record: a version already delivered is kept as it is, and the
        // same content is kept again as the next version, with this delivery on it.
        versionNo = await this.nextVersionNo(ctx, id);
        await tx.advisoryPlanVersion.create({
          data: {
            businessId,
            planId: id,
            versionNo,
            content: prepared.version.content as Prisma.InputJsonObject,
            sourceDataAsOf: prepared.version.sourceDataAsOf,
            createdByUserId: userId,
            deliveredAt: now,
            deliveredChannel: channel,
            deliveredByUserId: userId,
          },
        });
      }
      await tx.advisoryPlan.update({
        where: { businessId_id: { businessId, id } },
        data: {
          sentAt: now,
          sentByUserId: userId,
          currentVersion: Math.max(p.currentVersion, versionNo),
          ...(p.status === 'FINALIZED' || p.status === 'SENT' ? { status: 'SENT' as const } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_plan.sent',
        { type: 'advisory_plan', id },
        { advisoryClientId: p.advisoryClientId, version: versionNo, channel },
      );
      return this.detailById(ctx, id);
    });
  }

  // ---------- Versions ----------

  versions(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AdvisoryVersionRow[]> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.load(ctx, id);
      const rows = await ctx.tx.advisoryPlanVersion.findMany({
        where: { businessId, planId: id },
        orderBy: { versionNo: 'desc' },
      });
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.flatMap((r) => [r.createdByUserId, r.deliveredByUserId]),
      );
      return rows.map((r) => this.versionRow(r, names));
    });
  }

  private versionRow(
    r: Prisma.AdvisoryPlanVersionGetPayload<object>,
    names: Map<string, string>,
  ): AdvisoryVersionRow {
    return {
      versionNo: r.versionNo,
      sourceDataAsOf: day(r.sourceDataAsOf),
      createdBy: memberRef(names, r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
      deliveredAt: iso(r.deliveredAt),
      deliveredChannel: r.deliveredChannel,
      deliveredBy: memberRef(names, r.deliveredByUserId),
    };
  }

  async version(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    versionNo: number,
  ): Promise<AdvisoryVersionDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) => {
      const p = await this.load(ctx, id);
      const r = await ctx.tx.advisoryPlanVersion.findFirst({
        where: { businessId, planId: id, versionNo },
      });
      if (!r) throw notFound();
      const names = await memberNames(ctx.tx, businessId, [r.createdByUserId, r.deliveredByUserId]);
      const c = r.content as unknown as Content;
      return {
        advisoryClientId: p.advisoryClientId,
        detail: {
          ...this.versionRow(r, names),
          planName: c.planName,
          targetYear: c.targetYear,
          profile: c.profile as AdvisoryVersionDetail['profile'],
          assessment: c.assessment as AdvisoryVersionDetail['assessment'],
          strategy: c.strategy as AdvisoryVersionDetail['strategy'],
          goals: c.goals as AdvisoryVersionDetail['goals'],
          recommendations: c.recommendations.map(
            ({ clientVisible: _v, ...rest }) => rest,
          ) as AdvisoryVersionDetail['recommendations'],
          workstreams: c.workstreams as AdvisoryVersionDetail['workstreams'],
          financials: ctx.perms.viewFinancials
            ? (c.financials as AdvisoryVersionDetail['financials'])
            : null,
          disclaimer: c.disclaimer,
        } satisfies AdvisoryVersionDetail,
      };
    });
    await this.audit.log(
      'advisory_plan.version_viewed',
      { type: 'advisory_plan', id },
      { advisoryClientId: out.advisoryClientId, version: versionNo },
    );
    return out.detail;
  }
}
