import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  type PlanVersionDetail,
  type PlanVersionRow,
  type SavingsEstimate,
  type TaxPlanDetail,
  type TaxPlanEventList,
  type TaxPlanPage,
  type TaxPlanStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MessagesService } from '../messages/messages.service.js';
import {
  checkAssignee,
  checkMember,
  conflict,
  isUniqueViolation,
  lockClient,
  memberNames,
  memberRef,
  notFound,
  sentFields,
  toDay,
} from '../workspaces/common.js';
import { inputDef } from './catalog.js';
import {
  type PlanShape,
  type TaxCtx,
  TaxPlanReadService,
  categoryOf,
  finalBlockersOf,
  planInclude,
} from './plan-read.service.js';
import type {
  AddStrategyBody,
  AttachDocumentBody,
  CreatePlanBody,
  CreatePlanRequestBody,
  DuplicatePlanBody,
  FinalizeBody,
  PlanReasonBody,
  PlanReviewBody,
  RecordApprovalBody,
  UpdatePlanRequestBody,
  ReorderBody,
  SaveInputsBody,
  SendBody,
  SetStatusBody,
  TaxPlansListQuery,
  UpdatePlanBody,
  UpdateStrategyBody,
} from './tax-planning-input.js';
import {
  DISCLAIMER,
  estimateView,
  figuresOf,
  planTotals,
  todayIn,
  tpErrors,
} from './tax-planning.common.js';
import { estimateStrategy } from './tax-tables.js';

type Out<S extends z.ZodType> = z.output<S>;

/** C09 (Review 2): the statuses a send for the client's review moves to Awaiting Client Review. */
const SENT_MOVES_TO_AWAITING: readonly string[] = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'READY_FOR_REVIEW',
  'FINALIZED',
  'UNDER_REVIEW',
];

/** Review 2 workflow: what Send for Internal Review takes to Under Review. */
const REVIEWABLE: readonly string[] = ['IN_PROGRESS', 'FINALIZED', 'READY_FOR_REVIEW'];

/** Review 2 workflow: a client's request moves a plan waiting on them to Needs Review. */
const CLIENT_REQUEST_MOVES: readonly string[] = ['AWAITING_CLIENT', 'CLIENT_APPROVED'];

/** C08, C27 (Review 2): the statuses finalizing moves to Finalized (not one already sent on). */
const FINALIZE_MOVES: readonly string[] = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'UNDER_REVIEW',
  'READY_FOR_REVIEW',
  'FINALIZED',
];

/** C27 (Review 2): what Revise takes back to In Progress, to be finalized again. */
const REVISABLE: readonly string[] = [
  'FINALIZED',
  'AWAITING_CLIENT',
  'IMPLEMENTED',
  'CLIENT_APPROVED',
];

/**
 * The moves the status route makes (Review 2's approved workflow). The workflow's own steps have
 * their routes: Send for Internal Review (Under Review), Send to Client (Awaiting Client Review),
 * a client's request (Needs Review), Record Client Approval (Client Approved). Implemented only
 * after the client's approval of the version sent (Client Approved).
 */
const NEXT_STATUS: Record<TaxPlanStatus, TaxPlanStatus[]> = {
  DRAFT: ['SCHEDULED', 'IN_PROGRESS', 'CLOSED'],
  SCHEDULED: ['DRAFT', 'IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['DRAFT', 'SCHEDULED', 'CLOSED'],
  UNDER_REVIEW: ['IN_PROGRESS', 'CLOSED'],
  AWAITING_CLIENT: ['IN_PROGRESS', 'READY_FOR_REVIEW', 'CLOSED'],
  READY_FOR_REVIEW: ['IN_PROGRESS', 'CLOSED'],
  // S2 (Review 2 C27): a finalized plan is sent, closed, or revised back to work.
  FINALIZED: ['IN_PROGRESS', 'CLOSED'],
  CLIENT_APPROVED: ['IN_PROGRESS', 'IMPLEMENTED', 'CLOSED'],
  IMPLEMENTED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** What a version keeps: the plan as it was, in the shape of PlanVersionDetail. */
type Snapshot = Omit<
  PlanVersionDetail,
  'version' | 'event' | 'taxYear' | 'sourceDataAsOf' | 'createdBy' | 'createdAt'
>;

/** The plans: list, create, change, figures, strategies, documents, status, versions and delivery. */
@Injectable()
export class TaxPlansService {
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

  /** C27 (Review 2): one entry of the plan's history (tax_plan_events), in the same change. */
  private planEvent(
    ctx: TaxCtx,
    planId: string,
    kind:
      | 'STATUS'
      | 'REOPEN'
      | 'REVISE'
      | 'FINALIZE'
      | 'SEND'
      | 'ARCHIVE'
      | 'RESTORE'
      | 'REVIEW_REQUESTED'
      | 'INFO_REQUESTED'
      | 'CLIENT_REQUEST'
      | 'APPROVED'
      | 'DELIVERED',
    data: {
      fromStatus?: TaxPlanStatus | null;
      toStatus?: TaxPlanStatus | null;
      version?: number | null;
      reason?: string | null;
    } = {},
  ) {
    return ctx.tx.taxPlanEvent.create({
      data: {
        businessId: ctx.businessId,
        planId,
        kind,
        fromStatus: data.fromStatus ?? null,
        toStatus: data.toStatus ?? null,
        version: data.version ?? null,
        reason: data.reason ?? null,
        actorUserId: ctx.actor.userId,
      },
    });
  }

  /** The plan locked for a change: the caller's own, not archived, not closed. */
  private async editable(ctx: TaxCtx, id: string, etag?: string): Promise<PlanShape> {
    await this.read.load(ctx, id);
    await ctx.tx.$queryRaw`
      SELECT 1 FROM tax_plans WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    const plan = await this.read.load(ctx, id);
    if (plan.archivedAt) throw tpErrors.planArchived();
    if (plan.status === 'CLOSED') throw tpErrors.invalidStatus('A closed plan cannot be changed');
    if (etag !== undefined && etag !== plan.updatedAt.toISOString()) throw tpErrors.saveConflict();
    return plan;
  }

  /**
   * A change of the plan's content. Review 2 workflow: work begins by itself, so a Draft or
   * Scheduled plan is In Progress from its first change (in its history too).
   */
  private async touch(ctx: TaxCtx, id: string) {
    const now = await ctx.tx.taxPlan.findFirst({
      where: { businessId: ctx.businessId, id },
      select: { status: true },
    });
    const begins = now?.status === 'DRAFT' || now?.status === 'SCHEDULED';
    await ctx.tx.taxPlan.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: { updatedAt: new Date(), ...(begins ? { status: 'IN_PROGRESS' as const } : {}) },
      select: { id: true },
    });
    if (begins)
      await this.planEvent(ctx, id, 'STATUS', { fromStatus: now.status, toStatus: 'IN_PROGRESS' });
  }

  // ---------- Lists and reads ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof TaxPlansListQuery>,
  ): Promise<TaxPlanPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.TaxPlanWhereInput = {
        businessId,
        client: { ...this.read.clientReach(ctx), ...(q.clientId ? { id: q.clientId } : {}) },
        ...(q.status ? { status: q.status } : {}),
        ...(q.planYear ? { planYear: q.planYear } : {}),
        ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { client: { displayName: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.taxPlan.count({ where }),
        ctx.tx.taxPlan.findMany({
          where,
          include: planInclude,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: rows.map((r) => this.read.row(r)),
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
  ): Promise<TaxPlanDetail> {
    const detail = await this.run(businessId, tenant, userId, (ctx) =>
      this.read.detailById(ctx, id),
    );
    await this.audit.log(
      'tax_plan.viewed',
      { type: 'tax_plan', id },
      { clientId: detail.client.id },
    );
    return detail;
  }

  // ---------- Create and change ----------

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreatePlanBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.create) throw tpErrors.forbidden();
      const { tx } = ctx;
      const client = await tx.client.findFirst({
        where: { businessId, id: body.clientId, ...this.read.clientReach(ctx) },
        select: { id: true, archivedAt: true },
      });
      if (!client) throw notFound();
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      const locked = await lockClient(tx, businessId, body.clientId);
      if (!locked) throw notFound();
      if (body.assignedUserId) await checkAssignee(tx, businessId, body.assignedUserId, locked);
      const twin = await tx.taxPlan.findFirst({
        where: {
          businessId,
          clientId: body.clientId,
          planYear: body.planYear,
          name: { equals: body.name, mode: 'insensitive' },
          archivedAt: null,
        },
        select: { id: true },
      });
      if (twin) {
        if (!body.allowDuplicate) throw tpErrors.duplicatePlan();
        if (!ctx.perms.planningAdmin) throw tpErrors.forbidden();
      }
      const plan = await tx.taxPlan.create({
        data: {
          businessId,
          clientId: body.clientId,
          name: body.name,
          planYear: body.planYear,
          planType: body.planType,
          filingStatus: body.filingStatus ?? null,
          entityType: body.entityType ?? null,
          goals: body.goals,
          otherGoal: body.otherGoal ?? null,
          assignedUserId: body.assignedUserId ?? null,
          targetCompletionOn: body.targetCompletionOn ? toDay(body.targetCompletionOn) : null,
          nextDiscussionOn: body.nextDiscussionOn ? toDay(body.nextDiscussionOn) : null,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'tax_plan.created',
        { type: 'tax_plan', id: plan.id },
        { clientId: body.clientId, planYear: body.planYear, status: 'DRAFT' },
      );
      return this.read.detailById(ctx, plan.id);
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdatePlanBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id, body.etag);
      const goals = body.goals ?? plan.goals;
      let otherGoal = body.otherGoal !== undefined ? body.otherGoal : plan.otherGoal;
      if (!goals.includes('OTHER')) {
        if (body.otherGoal) throw tpErrors.invalid('goals', 'Choose Other to describe a goal');
        otherGoal = null;
      }
      if (body.assignedUserId && body.assignedUserId !== plan.assignedUserId) {
        await checkAssignee(tx, businessId, body.assignedUserId, plan.client);
      }
      const name = body.name ?? plan.name;
      const planYear = body.planYear ?? plan.planYear;
      if (body.name !== undefined || body.planYear !== undefined) {
        const twin = await tx.taxPlan.findFirst({
          where: {
            businessId,
            clientId: plan.clientId,
            planYear,
            name: { equals: name, mode: 'insensitive' },
            archivedAt: null,
            id: { not: id },
          },
          select: { id: true },
        });
        if (twin) throw tpErrors.duplicatePlan();
      }
      await tx.taxPlan.update({
        where: { businessId_id: { businessId, id } },
        data: {
          ...(body.name !== undefined ? { name } : {}),
          ...(body.planYear !== undefined ? { planYear } : {}),
          ...(body.planType !== undefined ? { planType: body.planType } : {}),
          ...(body.filingStatus !== undefined ? { filingStatus: body.filingStatus } : {}),
          ...(body.entityType !== undefined ? { entityType: body.entityType } : {}),
          goals,
          otherGoal,
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.clientNotes !== undefined ? { clientNotes: body.clientNotes } : {}),
          ...(body.assignedUserId !== undefined ? { assignedUserId: body.assignedUserId } : {}),
          ...(body.targetCompletionOn !== undefined
            ? {
                targetCompletionOn: body.targetCompletionOn ? toDay(body.targetCompletionOn) : null,
              }
            : {}),
          ...(body.nextDiscussionOn !== undefined
            ? { nextDiscussionOn: body.nextDiscussionOn ? toDay(body.nextDiscussionOn) : null }
            : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'tax_plan.updated',
        { type: 'tax_plan', id },
        {
          clientId: plan.clientId,
          fields: sentFields(body, [
            'name',
            'planYear',
            'planType',
            'filingStatus',
            'entityType',
            'goals',
            'otherGoal',
            'notes',
            'clientNotes',
            'assignedUserId',
            'targetCompletionOn',
            'nextDiscussionOn',
          ]),
        },
      );
      return this.read.detailById(ctx, id);
    });
  }

  saveInputs(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SaveInputsBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.viewInputs) throw tpErrors.financialRestricted();
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id, body.etag);
      const seen = new Set<string>();
      body.inputs.forEach((input, i) => {
        const at = `inputs.${i}`;
        const def = inputDef(input.key);
        if (!def) throw tpErrors.invalid(`${at}.key`, 'This figure is not one the plan takes');
        if (def.type === 'MONEY' && input.amountCents == null)
          throw tpErrors.invalid(`${at}.amountCents`, 'Enter an amount');
        if (def.type === 'TEXT' && !input.textValue)
          throw tpErrors.invalid(`${at}.textValue`, 'Enter a value');
        if (input.kind === 'HISTORICAL' && input.taxYear >= plan.planYear)
          throw tpErrors.invalid(
            `${at}.taxYear`,
            'A historical figure is of a year before the plan’s',
          );
        if (input.kind === 'PROJECTED' && input.taxYear < plan.planYear)
          throw tpErrors.invalid(
            `${at}.taxYear`,
            'A projected figure is of the plan year or later',
          );
        if (input.kind === 'ADJUSTMENT' && !ctx.perms.override) throw tpErrors.overrideNotAllowed();
        const k = `${input.key}|${input.kind}|${input.taxYear}`;
        if (seen.has(k)) throw tpErrors.invalid(at, 'This figure is sent twice');
        seen.add(k);
      });
      for (const input of body.inputs) {
        const data = {
          amountCents: input.amountCents ?? null,
          textValue: input.textValue ?? null,
          source: input.source,
          asOf: input.asOf ? new Date(input.asOf) : null,
          note: input.note ?? null,
          enteredByUserId: userId,
        };
        await tx.taxPlanInput.upsert({
          where: {
            businessId_planId_key_kind_taxYear: {
              businessId,
              planId: id,
              key: input.key,
              kind: input.kind,
              taxYear: input.taxYear,
            },
          },
          create: {
            businessId,
            planId: id,
            key: input.key,
            kind: input.kind,
            taxYear: input.taxYear,
            ...data,
          },
          update: data,
        });
      }
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.inputs_saved',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, keys: [...new Set(body.inputs.map((i) => i.key))].sort() },
      );
      return this.read.detailById(ctx, id);
    });
  }

  // ---------- Strategies ----------

  private async figures(ctx: TaxCtx, plan: PlanShape) {
    return figuresOf(await this.read.inputRows(ctx, plan.id), plan.planYear);
  }

  addStrategy(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof AddStrategyBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id);
      const position = plan.strategies.reduce((m, s) => Math.max(m, s.position), -1) + 1;
      let created: { id: string };
      try {
        if (body.kind === 'LIBRARY') {
          const lib = await tx.taxPlanningStrategy.findFirst({
            where: { businessId, id: body.strategyId, active: true, archivedAt: null },
          });
          if (!lib) throw notFound();
          if (plan.strategies.some((s) => s.strategyId === lib.id))
            throw tpErrors.duplicateStrategy();
          const est = estimateStrategy({
            requiredInputs: lib.requiredInputs,
            planYear: plan.planYear,
            filingStatus: plan.filingStatus,
            figures: await this.figures(ctx, plan),
          });
          created = await tx.taxPlanStrategy.create({
            data: {
              businessId,
              planId: id,
              strategyId: lib.id,
              displayName: lib.name,
              priority: body.priority ?? lib.defaultPriority,
              estimatedSavingsCents: est.cents,
              estimateDataYear: est.cents === null ? null : est.dataYear,
              estimateCalculatedAt: est.cents === null ? null : new Date(),
              position,
            },
            select: { id: true },
          });
        } else {
          const estimate = body.estimatedSavingsCents ?? null;
          if (estimate !== null && !ctx.perms.override) throw tpErrors.overrideNotAllowed();
          created = await tx.taxPlanStrategy.create({
            data: {
              businessId,
              planId: id,
              customName: body.name,
              customCategory: body.category,
              displayName: body.name,
              priority: body.priority,
              assumptions: body.assumptions ?? null,
              position,
              ...(estimate !== null
                ? {
                    overrideSavingsCents: estimate,
                    overrideReason: 'Entered when the strategy was added',
                    overrideByUserId: userId,
                  }
                : {}),
            },
            select: { id: true },
          });
        }
      } catch (error) {
        if (isUniqueViolation(error)) throw tpErrors.duplicateStrategy();
        throw error;
      }
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.strategy_added',
        { type: 'tax_plan', id },
        {
          clientId: plan.clientId,
          planStrategyId: created.id,
          ...(body.kind === 'LIBRARY' ? { strategyId: body.strategyId } : { custom: true }),
        },
      );
      return this.read.detailById(ctx, id);
    });
  }

  updateStrategy(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    strategyId: string,
    body: Out<typeof UpdateStrategyBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id, body.etag);
      const cur = plan.strategies.find((s) => s.id === strategyId);
      if (!cur) throw notFound();
      const data: Prisma.TaxPlanStrategyUncheckedUpdateInput = {};
      if (body.selected !== undefined) data.selected = body.selected;
      if (body.priority !== undefined) data.priority = body.priority;
      if (body.assumptions !== undefined) data.assumptions = body.assumptions;
      const status = body.status ?? cur.status;
      if (body.implementedOn && status !== 'IMPLEMENTED')
        throw tpErrors.invalid('implementedOn', 'Set the status to Implemented first');
      if (body.status !== undefined) {
        data.status = body.status;
        if (body.status === 'IMPLEMENTED')
          data.implementedOn = toDay(body.implementedOn ?? todayIn(ctx.timezone));
        else data.implementedOn = null;
      } else if (body.implementedOn !== undefined) {
        data.implementedOn = body.implementedOn ? toDay(body.implementedOn) : null;
        if (!body.implementedOn && cur.status === 'IMPLEMENTED')
          throw tpErrors.invalid('implementedOn', 'An implemented strategy has its date');
      }
      if (body.status === 'IMPLEMENTED' && body.implementedOn !== undefined && body.implementedOn)
        data.implementedOn = toDay(body.implementedOn);
      if (body.overrideSavingsCents !== undefined || body.overrideReason !== undefined) {
        if (!ctx.perms.override) throw tpErrors.overrideNotAllowed();
        if (body.overrideSavingsCents === undefined)
          throw tpErrors.invalid('overrideSavingsCents', 'Send the amount with its reason');
        if (body.overrideSavingsCents === null) {
          data.overrideSavingsCents = null;
          data.overrideReason = null;
          data.overrideByUserId = null;
        } else {
          data.overrideSavingsCents = body.overrideSavingsCents;
          data.overrideReason = body.overrideReason as string;
          data.overrideByUserId = userId;
        }
      }
      await tx.taxPlanStrategy.update({
        where: { businessId_id: { businessId, id: strategyId } },
        data,
      });
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.strategy_updated',
        { type: 'tax_plan', id },
        {
          clientId: plan.clientId,
          planStrategyId: strategyId,
          fields: sentFields(body, [
            'selected',
            'priority',
            'status',
            'assumptions',
            'implementedOn',
            'overrideSavingsCents',
          ]),
          overridden:
            body.overrideSavingsCents === undefined
              ? undefined
              : body.overrideSavingsCents !== null,
        },
      );
      return this.read.detailById(ctx, id);
    });
  }

  reorderStrategies(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ReorderBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id, body.etag);
      const have = new Set(plan.strategies.map((s) => s.id));
      if (
        body.ids.length !== have.size ||
        new Set(body.ids).size !== have.size ||
        body.ids.some((x) => !have.has(x))
      )
        throw tpErrors.invalid('ids', 'Send every strategy of the plan once');
      for (const [position, sid] of body.ids.entries()) {
        await tx.taxPlanStrategy.update({
          where: { businessId_id: { businessId, id: sid } },
          data: { position },
        });
      }
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.strategies_reordered',
        { type: 'tax_plan', id },
        { clientId: plan.clientId },
      );
      return this.read.detailById(ctx, id);
    });
  }

  recalculate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id);
      const figures = await this.figures(ctx, plan);
      let updated = 0;
      for (const s of plan.strategies) {
        if (!s.strategyId) continue;
        const est = estimateStrategy({
          requiredInputs: s.strategy?.requiredInputs ?? [],
          planYear: plan.planYear,
          filingStatus: plan.filingStatus,
          figures,
        });
        await tx.taxPlanStrategy.update({
          where: { businessId_id: { businessId, id: s.id } },
          data: {
            estimatedSavingsCents: est.cents,
            estimateDataYear: est.cents === null ? null : est.dataYear,
            estimateCalculatedAt: est.cents === null ? null : new Date(),
          },
        });
        updated += 1;
      }
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.recalculated',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, strategies: updated },
      );
      return this.read.detailById(ctx, id);
    });
  }

  // ---------- Documents ----------

  attachDocument(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof AttachDocumentBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id);
      const doc = await tx.document.findFirst({
        where: { businessId, id: body.documentId, clientId: plan.clientId },
        select: { id: true },
      });
      if (!doc) throw tpErrors.documentNotAllowed();
      if (body.planStrategyId && !plan.strategies.some((s) => s.id === body.planStrategyId))
        throw notFound();
      const where = {
        businessId_planId_documentId: { businessId, planId: id, documentId: body.documentId },
      };
      const data = {
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.planStrategyId !== undefined ? { planStrategyId: body.planStrategyId } : {}),
      };
      await tx.taxPlanDocument.upsert({
        where,
        create: {
          businessId,
          planId: id,
          documentId: body.documentId,
          addedByUserId: userId,
          ...data,
        },
        update: data,
      });
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.document_attached',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, documentId: body.documentId },
      );
      return this.read.detailById(ctx, id);
    });
  }

  detachDocument(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    documentId: string,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.editable(ctx, id);
      const { count } = await tx.taxPlanDocument.deleteMany({
        where: { businessId, planId: id, documentId },
      });
      if (count === 0) throw notFound();
      await this.touch(ctx, id);
      await this.audit.logIn(
        tx,
        'tax_plan.document_detached',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, documentId },
      );
      return this.read.detailById(ctx, id);
    });
  }

  // ---------- Status, archive ----------

  setStatus(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetStatusBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      await this.read.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM tax_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const plan = await this.read.load(ctx, id);
      if (plan.archivedAt) throw tpErrors.planArchived();
      if (body.etag !== plan.updatedAt.toISOString()) throw tpErrors.saveConflict();
      if (plan.status === 'CLOSED')
        throw tpErrors.invalidStatus('A closed plan changes only by Reopen, with its reason');
      if (body.status === plan.status) return this.read.detail(ctx, plan);
      // Review 2 workflow: implementation only after the client's recorded approval.
      if (body.status === 'IMPLEMENTED' && plan.status !== 'CLIENT_APPROVED')
        throw tpErrors.invalidStatus(
          "A plan is implemented only after the client's approval: use Record Client Approval first",
        );
      if (!NEXT_STATUS[plan.status].includes(body.status))
        throw tpErrors.invalidStatus(`A plan cannot go from ${plan.status} to ${body.status}`);
      if (body.status === 'DRAFT' && plan.taxPlanVersions.length > 0)
        throw tpErrors.invalidStatus('A plan that was finalized cannot go back to a draft');
      if (
        body.status === 'IMPLEMENTED' &&
        !plan.strategies.some(
          (s) => s.selected && (s.status === 'IN_PROGRESS' || s.status === 'IMPLEMENTED'),
        )
      )
        throw tpErrors.invalidStatus('A strategy must be in progress or implemented first');
      await tx.taxPlan.update({
        where: { businessId_id: { businessId, id } },
        data: { status: body.status },
      });
      await this.planEvent(ctx, id, 'STATUS', { fromStatus: plan.status, toStatus: body.status });
      await this.audit.logIn(
        tx,
        'tax_plan.status_changed',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, from: plan.status, to: body.status },
      );
      return this.read.detailById(ctx, id);
    });
  }

  archive(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.read.load(ctx, id);
      if (archive !== (plan.archivedAt === null)) return this.read.detail(ctx, plan);
      await tx.taxPlan.update({
        where: { businessId_id: { businessId, id } },
        data: { archivedAt: archive ? new Date() : null },
      });
      await this.planEvent(ctx, id, archive ? 'ARCHIVE' : 'RESTORE');
      await this.audit.logIn(
        tx,
        archive ? 'tax_plan.archived' : 'tax_plan.restored',
        { type: 'tax_plan', id },
        { clientId: plan.clientId },
      );
      return this.read.detailById(ctx, id);
    });
  }

  // ---------- Versions, finalize and send ----------

  private async snapshotOf(
    ctx: TaxCtx,
    plan: PlanShape,
  ): Promise<{ snapshot: Snapshot; asOf: Date | null }> {
    const rows = await this.read.inputRows(ctx, plan.id);
    const figures = figuresOf(rows, plan.planYear);
    const chosen = plan.strategies.filter((s) => s.selected && s.status !== 'DECLINED');
    const strategies = chosen.map((s) => {
      const model = s.strategyId
        ? estimateStrategy({
            requiredInputs: s.strategy?.requiredInputs ?? [],
            planYear: plan.planYear,
            filingStatus: plan.filingStatus,
            figures,
          })
        : null;
      return {
        name: s.displayName,
        category: categoryOf(s),
        priority: s.priority,
        estimate: estimateView(
          s,
          model?.reason ?? 'No estimate has been entered',
        ) as SavingsEstimate,
        assumptions: s.assumptions,
      };
    });
    const asOf = rows.reduce<Date | null>(
      (m, r) => (r.asOf && (!m || r.asOf > m) ? r.asOf : m),
      null,
    );
    return {
      asOf,
      snapshot: {
        planName: plan.name,
        strategies,
        inputs: rows.map((r) => ({
          key: r.key,
          label: inputDef(r.key)?.label ?? r.key,
          kind: r.kind,
          taxYear: r.taxYear,
          amountCents: r.amountCents,
          textValue: r.textValue,
          source: r.source,
          asOf: r.asOf?.toISOString() ?? null,
          note: r.note,
        })),
        projectedSavingsCents: planTotals(
          plan.strategies.map((s) => ({ ...s, category: categoryOf(s) })),
        ).cents,
        disclaimer: DISCLAIMER,
      },
    };
  }

  private async keepVersion(
    ctx: TaxCtx,
    plan: PlanShape,
    event: 'FINALIZED' | 'SENT' | 'DELIVERED',
    kept: { snapshot: Snapshot; asOf: Date | null },
  ) {
    const last = await ctx.tx.taxPlanVersion.findFirst({
      where: { businessId: ctx.businessId, planId: plan.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return ctx.tx.taxPlanVersion.create({
      data: {
        businessId: ctx.businessId,
        planId: plan.id,
        version: (last?.version ?? 0) + 1,
        event,
        taxYear: plan.planYear,
        snapshot: kept.snapshot as unknown as Prisma.InputJsonValue,
        sourceDataAsOf: kept.asOf,
        createdByUserId: ctx.actor.userId,
      },
      select: { version: true },
    });
  }

  /**
   * C08 (Review 2): what keeps a plan from being finalized, each named with where to fix it.
   */
  private missingForFinal(
    plan: PlanShape,
    inputs: { label: string; taxYear: number; asOf: string | null }[],
  ): string[] {
    return finalBlockersOf(
      plan,
      inputs.map((i) => ({ ...i, asOf: i.asOf ? new Date(i.asOf) : null })),
    );
  }

  finalize(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof FinalizeBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const plan = await this.editable(ctx, id, body.etag);
      const kept = await this.snapshotOf(ctx, plan);
      const missing = this.missingForFinal(plan, kept.snapshot.inputs ?? []);
      if (missing.length > 0) throw tpErrors.planNotReady(missing);
      const v = await this.keepVersion(ctx, plan, 'FINALIZED', kept);
      // C08, C27 (Review 2): a finalized plan is Finalized in every view. Its updated_at stays,
      // so the version still matches the plan and it can be sent.
      const toFinal = FINALIZE_MOVES.includes(plan.status);
      if (toFinal)
        await ctx.tx.$executeRaw`
          UPDATE tax_plans SET status = 'FINALIZED'
          WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid`;
      await this.planEvent(ctx, id, 'FINALIZE', {
        fromStatus: plan.status,
        toStatus: toFinal ? 'FINALIZED' : plan.status,
        version: v.version,
      });
      await this.audit.logIn(
        ctx.tx,
        'tax_plan.finalized',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, version: v.version },
      );
      return this.read.detailById(ctx, id);
    });
  }

  async send(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SendBody>,
  ): Promise<TaxPlanDetail> {
    // Check and compose in one transaction, deliver, then keep the SENT version of what was sent.
    const prepared = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.send) throw tpErrors.forbidden();
      const plan = await this.read.load(ctx, id);
      if (plan.archivedAt) throw tpErrors.planArchived();
      if (plan.status === 'CLOSED') throw tpErrors.invalidStatus('A closed plan cannot be sent');
      // Review 2 workflow: Deliver to Client is for the plan the client approved.
      if (
        body.purpose === 'DELIVERY' &&
        plan.status !== 'CLIENT_APPROVED' &&
        plan.status !== 'IMPLEMENTED'
      )
        throw tpErrors.invalidStatus(
          "Deliver to Client comes after the client's approval: use Record Client Approval first",
        );
      let kept: { snapshot: Snapshot; asOf: Date | null };
      if (body.purpose === 'DELIVERY') {
        // The exact version the client approved, as it was kept: implementation work since then
        // never changes what is delivered.
        const approval = await ctx.tx.taxPlanApproval.findFirst({
          where: { businessId, planId: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const approvedVersion = approval
          ? await ctx.tx.taxPlanVersion.findFirst({
              where: { businessId, planId: id, version: approval.version },
              select: { snapshot: true, sourceDataAsOf: true },
            })
          : null;
        if (!approvedVersion)
          throw tpErrors.invalidStatus(
            "Deliver to Client comes after the client's approval: use Record Client Approval first",
          );
        kept = {
          snapshot: approvedVersion.snapshot as unknown as Snapshot,
          asOf: approvedVersion.sourceDataAsOf,
        };
      } else {
        const finalized = await ctx.tx.taxPlanVersion.findFirst({
          where: { businessId, planId: id, event: 'FINALIZED' },
          orderBy: { version: 'desc' },
          select: { createdAt: true },
        });
        // C09 (Review 2): each blocker says what to do.
        const missing: string[] = [];
        if (!finalized)
          missing.push('The plan is not finalized: use Finalize Plan in Review & Save first.');
        else if (plan.updatedAt > finalized.createdAt)
          missing.push(
            'The plan changed after it was finalized: use Finalize Plan in Review & Save again.',
          );
        if (missing.length > 0) throw tpErrors.planNotReady(missing);
        kept = await this.snapshotOf(ctx, plan);
      }
      const lines = kept.snapshot.strategies.map((s) => {
        const c = s.estimate.cents;
        return `- ${s.name}: ${c === null ? 'estimate not available' : `about ${money(c)} estimated savings`}`;
      });
      const total = kept.snapshot.projectedSavingsCents;
      const delivery = body.purpose === 'DELIVERY';
      const message = [
        delivery
          ? `Here is your approved ${plan.planYear} tax plan, ${plan.name}.`
          : `Your ${plan.planYear} tax plan, ${plan.name}, is ready for your review.`,
        ...(plan.clientNotes ? ['', plan.clientNotes] : []),
        '',
        'Strategies:',
        ...lines,
        ...(total !== null ? ['', `Total estimated savings: about ${money(total)}.`] : []),
        ...(body.message ? ['', body.message] : []),
        ...(delivery
          ? []
          : ['', 'Please reply to approve it, or with any question or change you would like.']),
        '',
        DISCLAIMER,
      ].join('\n');
      return { plan, kept, message, actor: ctx.actor };
    });
    await this.messages.create(businessId, prepared.actor, prepared.plan.clientId, {
      subject:
        `Your ${body.purpose === 'DELIVERY' ? 'approved ' : ''}${prepared.plan.planYear} tax plan`.slice(
          0,
          200,
        ),
      body: prepared.message,
      repliesEnabled: true,
    });
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.load(ctx, id);
      await ctx.tx.$queryRaw`
        SELECT 1 FROM tax_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const plan = await this.read.load(ctx, id);
      if (body.purpose === 'DELIVERY') {
        // Deliver to Client: the delivered version is kept; the status stays (Delivered and
        // Implemented never imply each other).
        const d = await this.keepVersion(ctx, plan, 'DELIVERED', prepared.kept);
        await ctx.tx.$executeRaw`
          UPDATE tax_plans SET delivered_at = now(), delivered_version = ${d.version}
          WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid`;
        await this.planEvent(ctx, id, 'DELIVERED', { version: d.version });
        await this.audit.logIn(
          ctx.tx,
          'tax_plan.delivered',
          { type: 'tax_plan', id },
          { clientId: plan.clientId, version: d.version, channel: body.channel },
        );
        return this.read.detailById(ctx, id);
      }
      const v = await this.keepVersion(ctx, plan, 'SENT', prepared.kept);
      // C09 (Review 2): a plan sent for the client's review is Awaiting Client Review, in every
      // view. Its updated_at stays, so the finalized version still matches and it can be resent.
      const awaiting = SENT_MOVES_TO_AWAITING.includes(plan.status);
      if (awaiting)
        await ctx.tx.$executeRaw`
          UPDATE tax_plans SET status = 'AWAITING_CLIENT'
          WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid`;
      await this.planEvent(ctx, id, 'SEND', {
        fromStatus: plan.status,
        toStatus: awaiting ? 'AWAITING_CLIENT' : plan.status,
        version: v.version,
      });
      await this.audit.logIn(
        ctx.tx,
        'tax_plan.sent',
        { type: 'tax_plan', id },
        {
          clientId: plan.clientId,
          version: v.version,
          channel: body.channel,
          ...(awaiting ? { from: plan.status, to: 'AWAITING_CLIENT' } : {}),
        },
      );
      return this.read.detailById(ctx, id);
    });
  }

  /**
   * C27 (Review 2): Reopen (a Closed plan) or Revise (a Finalized, sent or Implemented one), with
   * the reason, back to In Progress: kept in the plan's history and the audit (never the reason).
   * A revised plan is finalized again as a new version; earlier versions never change.
   */
  reopen(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof PlanReasonBody>,
    kind: 'REOPEN' | 'REVISE',
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      await this.read.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM tax_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const plan = await this.read.load(ctx, id);
      if (plan.archivedAt) throw tpErrors.planArchived();
      if (body.etag !== plan.updatedAt.toISOString()) throw tpErrors.saveConflict();
      if (kind === 'REOPEN' && plan.status !== 'CLOSED')
        throw tpErrors.invalidStatus('Only a closed plan is reopened');
      if (kind === 'REVISE' && !REVISABLE.includes(plan.status))
        throw tpErrors.invalidStatus(
          'Only a finalized, sent or implemented plan is revised; change the plan instead',
        );
      await tx.taxPlan.update({
        where: { businessId_id: { businessId, id } },
        data: { status: 'IN_PROGRESS' },
      });
      await this.planEvent(ctx, id, kind, {
        fromStatus: plan.status,
        toStatus: 'IN_PROGRESS',
        version: plan.taxPlanVersions[0]?.version ?? null,
        reason: body.reason,
      });
      await this.audit.logIn(
        tx,
        kind === 'REOPEN' ? 'tax_plan.reopened' : 'tax_plan.revised',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, from: plan.status, to: 'IN_PROGRESS' },
      );
      return this.read.detailById(ctx, id);
    });
  }

  // ---------- Review 2's approved workflow ----------

  /** The plan locked for a workflow step: the caller's own, not archived; the etag when sent. */
  private async lockedPlan(ctx: TaxCtx, id: string, etag?: string): Promise<PlanShape> {
    await this.read.load(ctx, id);
    await ctx.tx.$queryRaw`
      SELECT 1 FROM tax_plans WHERE business_id = ${ctx.businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    const plan = await this.read.load(ctx, id);
    if (plan.archivedAt) throw tpErrors.planArchived();
    if (etag !== undefined && etag !== plan.updatedAt.toISOString()) throw tpErrors.saveConflict();
    return plan;
  }

  /** A status a workflow step moves to, with the plan's history and the audit. */
  private async moveTo(
    ctx: TaxCtx,
    plan: PlanShape,
    to: TaxPlanStatus,
    kind: 'REVIEW_REQUESTED' | 'CLIENT_REQUEST' | 'APPROVED',
    data: Prisma.TaxPlanUncheckedUpdateInput = {},
    version: number | null = null,
  ) {
    await ctx.tx.taxPlan.update({
      where: { businessId_id: { businessId: ctx.businessId, id: plan.id } },
      data: { ...data, status: to },
    });
    await this.planEvent(ctx, plan.id, kind, { fromStatus: plan.status, toStatus: to, version });
  }

  /** Send for Internal Review: a chosen reviewer (an active member of the firm), Under Review. */
  review(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof PlanReviewBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const plan = await this.lockedPlan(ctx, id, body.etag);
      if (!REVIEWABLE.includes(plan.status))
        throw tpErrors.invalidStatus(
          'Send for Internal Review is for a plan in progress, finalized or being revised',
        );
      // An active member of the firm, whatever their role.
      await checkMember(ctx.tx, businessId, body.reviewerUserId);
      await this.moveTo(ctx, plan, 'UNDER_REVIEW', 'REVIEW_REQUESTED', {
        reviewerUserId: body.reviewerUserId,
        reviewRequestedAt: new Date(),
      });
      await this.audit.logIn(
        ctx.tx,
        'tax_plan.review_requested',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, from: plan.status, reviewerUserId: body.reviewerUserId },
      );
      return this.read.detailById(ctx, id);
    });
  }

  /**
   * Record Client Approval: the client's documented approval of an exact version sent for review
   * (the newest by default), with its date: Client Approved. Implementation may start.
   */
  recordApproval(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof RecordApprovalBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.lockedPlan(ctx, id, body.etag);
      if (plan.status !== 'AWAITING_CLIENT' && plan.status !== 'READY_FOR_REVIEW')
        throw tpErrors.invalidStatus(
          "Record the client's approval of a plan sent for their review (Awaiting Client Review)",
        );
      const sent = await tx.taxPlanVersion.findFirst({
        where: {
          businessId,
          planId: id,
          event: 'SENT',
          ...(body.version ? { version: body.version } : {}),
        },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (!sent)
        throw tpErrors.invalid('version', "Choose a version that was sent for the client's review");
      if (body.documentId) {
        const doc = await tx.document.findFirst({
          where: { businessId, id: body.documentId, clientId: plan.clientId },
          select: { id: true },
        });
        if (!doc) throw notFound();
      }
      if (body.approvedOn > todayIn(ctx.timezone))
        throw tpErrors.invalid('approvedOn', 'The approval date cannot be after today');
      const already = await tx.taxPlanApproval.findFirst({
        where: { businessId, planId: id, version: sent.version },
        select: { id: true },
      });
      if (already)
        throw tpErrors.invalidStatus(`Version ${sent.version} is already recorded as approved`);
      await tx.taxPlanApproval.create({
        data: {
          businessId,
          clientId: plan.clientId,
          planId: id,
          version: sent.version,
          method: 'MANUAL',
          approvedOn: toDay(body.approvedOn),
          note: body.note,
          documentId: body.documentId ?? null,
          recordedByUserId: ctx.actor.userId,
        },
      });
      await this.moveTo(ctx, plan, 'CLIENT_APPROVED', 'APPROVED', {}, sent.version);
      await this.audit.logIn(
        tx,
        'tax_plan.approval_recorded',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, version: sent.version, method: 'MANUAL' },
      );
      return this.read.detailById(ctx, id);
    });
  }

  /**
   * A request on the plan. The firm asks the client for information or a document (a portal
   * message tells them); or staff record what the client asked, which moves a plan waiting on the
   * client to Needs Review.
   */
  async createRequest(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CreatePlanRequestBody>,
  ): Promise<TaxPlanDetail> {
    const made = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.lockedPlan(ctx, id);
      if (plan.status === 'CLOSED')
        throw tpErrors.invalidStatus('A closed plan changes only by Reopen, with its reason');
      const firm = body.direction === 'FIRM_TO_CLIENT';
      const row = await tx.taxPlanRequest.create({
        data: {
          businessId,
          clientId: plan.clientId,
          planId: id,
          direction: body.direction,
          kind: body.kind,
          body: body.body,
          requestedByUserId: firm ? ctx.actor.userId : null,
        },
        select: { id: true },
      });
      if (firm) {
        await this.planEvent(ctx, id, 'INFO_REQUESTED');
      } else if (CLIENT_REQUEST_MOVES.includes(plan.status)) {
        await this.moveTo(ctx, plan, 'READY_FOR_REVIEW', 'CLIENT_REQUEST');
      } else {
        await this.planEvent(ctx, id, 'CLIENT_REQUEST');
      }
      await this.audit.logIn(
        tx,
        firm ? 'tax_plan.information_requested' : 'tax_plan.client_request_recorded',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, requestId: row.id, kind: body.kind },
      );
      return { plan, firm, actor: ctx.actor };
    });
    if (made.firm) {
      // The client hears of it in the portal, in the firm's words; they answer there or upload.
      await this.messages.create(businessId, made.actor, made.plan.clientId, {
        subject: `A question about your ${made.plan.planYear} tax plan`.slice(0, 200),
        body: [
          body.body,
          '',
          body.kind === 'DOCUMENT'
            ? 'Please upload the document in your portal, or reply with it attached.'
            : 'Please reply with the information.',
        ].join('\n'),
        repliesEnabled: true,
      });
    }
    return this.run(businessId, tenant, userId, (ctx) => this.read.detailById(ctx, id));
  }

  /** Answer or close a request (the answer, or a document of the client's). */
  updateRequest(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    requestId: string,
    body: Out<typeof UpdatePlanRequestBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.lockedPlan(ctx, id);
      const row = await tx.taxPlanRequest.findFirst({
        where: { businessId, planId: id, id: requestId },
        select: { id: true, status: true, answeredAt: true },
      });
      if (!row) throw notFound();
      if (row.status === 'CLOSED') throw tpErrors.invalidStatus('This request is closed');
      if (body.documentId) {
        const doc = await tx.document.findFirst({
          where: { businessId, id: body.documentId, clientId: plan.clientId },
          select: { id: true },
        });
        if (!doc) throw notFound();
      }
      const now = new Date();
      await tx.taxPlanRequest.update({
        where: { businessId_id: { businessId, id: requestId } },
        data: {
          status: body.status,
          ...(body.response !== undefined ? { response: body.response } : {}),
          ...(body.documentId !== undefined ? { documentId: body.documentId } : {}),
          ...(body.status === 'ANSWERED' || !row.answeredAt
            ? { answeredAt: row.answeredAt ?? now }
            : {}),
          ...(body.status === 'CLOSED' ? { closedAt: now } : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'tax_plan.request_updated',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, requestId, status: body.status },
      );
      return this.read.detailById(ctx, id);
    });
  }

  /**
   * Duplicate Plan (Review 2 approved addition): an editable copy, a new Draft of the same client,
   * with the plan's setup, figures and strategies; the original is unchanged. Documents, tasks,
   * discussions, versions, approvals, requests and history stay with the original.
   */
  duplicate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof DuplicatePlanBody>,
  ): Promise<TaxPlanDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.edit) throw tpErrors.forbidden();
      const { tx } = ctx;
      const plan = await this.read.load(ctx, id);
      const name = (body.name ?? `${plan.name} (copy)`).slice(0, 200);
      const copy = await tx.taxPlan.create({
        data: {
          businessId,
          clientId: plan.clientId,
          engagementId: plan.engagementId,
          name,
          planYear: plan.planYear,
          filingStatus: plan.filingStatus,
          entityType: plan.entityType,
          planType: plan.planType,
          status: 'DRAFT',
          goals: plan.goals,
          otherGoal: plan.otherGoal,
          notes: plan.notes,
          clientNotes: plan.clientNotes,
          assignedUserId: plan.assignedUserId,
          targetCompletionOn: plan.targetCompletionOn,
          createdByUserId: ctx.actor.userId,
        },
        select: { id: true },
      });
      const inputs = await this.read.inputRows(ctx, id);
      if (inputs.length > 0)
        await tx.taxPlanInput.createMany({
          data: inputs.map((i) => {
            const { id: _id, planId: _planId, createdAt: _c, updatedAt: _u, ...rest } = i;
            return { ...rest, planId: copy.id };
          }),
        });
      for (const s of plan.strategies) {
        const { id: _id, planId: _planId, createdAt: _c, updatedAt: _u, strategy: _s, ...rest } = s;
        await tx.taxPlanStrategy.create({
          data: {
            ...rest,
            planId: copy.id,
            // A copy is planned again: nothing of it is in progress or done yet.
            status: s.status === 'DECLINED' ? 'DECLINED' : 'PROPOSED',
            implementedOn: null,
          } as Prisma.TaxPlanStrategyUncheckedCreateInput,
        });
      }
      await this.audit.logIn(
        tx,
        'tax_plan.duplicated',
        { type: 'tax_plan', id: copy.id },
        { clientId: plan.clientId, fromPlanId: id },
      );
      return this.read.detailById(ctx, copy.id);
    });
  }

  /** C27 (Review 2): the plan's history, newest first. */
  events(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxPlanEventList> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.load(ctx, id);
      const rows = await ctx.tx.taxPlanEvent.findMany({
        where: { businessId, planId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.actorUserId),
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          fromStatus: r.fromStatus,
          toStatus: r.toStatus,
          version: r.version,
          reason: r.reason,
          actor: memberRef(names, r.actorUserId),
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }

  versions(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<PlanVersionRow[]> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.load(ctx, id);
      const rows = await ctx.tx.taxPlanVersion.findMany({
        where: { businessId, planId: id },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          event: true,
          taxYear: true,
          sourceDataAsOf: true,
          createdByUserId: true,
          createdAt: true,
        },
      });
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.createdByUserId),
      );
      return rows.map((r) => ({
        version: r.version,
        event: r.event,
        taxYear: r.taxYear,
        sourceDataAsOf: r.sourceDataAsOf?.toISOString() ?? null,
        createdBy: memberRef(names, r.createdByUserId),
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async version(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    version: number,
  ): Promise<PlanVersionDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) => {
      const plan = await this.read.load(ctx, id);
      const row = await ctx.tx.taxPlanVersion.findFirst({
        where: { businessId, planId: id, version },
      });
      if (!row) throw notFound();
      const names = await memberNames(ctx.tx, businessId, [row.createdByUserId]);
      const snap = row.snapshot as unknown as Snapshot;
      return {
        clientId: plan.clientId,
        detail: {
          version: row.version,
          event: row.event,
          taxYear: row.taxYear,
          sourceDataAsOf: row.sourceDataAsOf?.toISOString() ?? null,
          createdBy: memberRef(names, row.createdByUserId),
          createdAt: row.createdAt.toISOString(),
          planName: snap.planName,
          strategies: snap.strategies,
          inputs: ctx.perms.viewInputs ? snap.inputs : null,
          projectedSavingsCents: snap.projectedSavingsCents,
          disclaimer: snap.disclaimer,
        } satisfies PlanVersionDetail,
      };
    });
    await this.audit.log(
      'tax_plan.version_viewed',
      { type: 'tax_plan', id },
      { clientId: out.clientId, version },
    );
    return out.detail;
  }
}
