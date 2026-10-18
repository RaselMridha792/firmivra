import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  type PlanVersionDetail,
  type PlanVersionRow,
  type SavingsEstimate,
  type TaxPlanDetail,
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
  conflict,
  isUniqueViolation,
  lockClient,
  memberNames,
  memberRef,
  notFound,
  sentFields,
  toDay,
} from '../workspaces/common.js';
import { INPUT_KEYS } from './catalog.js';
import {
  type PlanShape,
  type TaxCtx,
  TaxPlanReadService,
  categoryOf,
  planInclude,
} from './plan-read.service.js';
import type {
  AddStrategyBody,
  AttachDocumentBody,
  CreatePlanBody,
  FinalizeBody,
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
  isStale,
  planTotals,
  todayIn,
  tpErrors,
} from './tax-planning.common.js';
import { estimateStrategy } from './tax-tables.js';

type Out<S extends z.ZodType> = z.output<S>;

const NEXT_STATUS: Record<TaxPlanStatus, TaxPlanStatus[]> = {
  DRAFT: ['SCHEDULED', 'IN_PROGRESS', 'CLOSED'],
  SCHEDULED: ['DRAFT', 'IN_PROGRESS', 'AWAITING_CLIENT', 'CLOSED'],
  IN_PROGRESS: [
    'DRAFT',
    'SCHEDULED',
    'AWAITING_CLIENT',
    'READY_FOR_REVIEW',
    'IMPLEMENTED',
    'CLOSED',
  ],
  AWAITING_CLIENT: ['IN_PROGRESS', 'READY_FOR_REVIEW', 'CLOSED'],
  READY_FOR_REVIEW: ['IN_PROGRESS', 'AWAITING_CLIENT', 'IMPLEMENTED', 'CLOSED'],
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

  private touch(ctx: TaxCtx, id: string) {
    return ctx.tx.taxPlan.update({
      where: { businessId_id: { businessId: ctx.businessId, id } },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
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
        const def = INPUT_KEYS.get(input.key);
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
          label: INPUT_KEYS.get(r.key)?.label ?? r.key,
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
    event: 'FINALIZED' | 'SENT',
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

  private missingForFinal(plan: PlanShape, stale: boolean): string[] {
    const missing: string[] = [];
    if (!plan.strategies.some((s) => s.selected && s.status !== 'DECLINED'))
      missing.push('Select at least one strategy');
    if (stale) missing.push('Some figures are out of date; review them');
    return missing;
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
      const missing = this.missingForFinal(
        plan,
        kept.snapshot.inputs?.some((i) => isStale(i.asOf ? new Date(i.asOf) : null)) ?? false,
      );
      if (missing.length > 0) throw tpErrors.planNotReady(missing);
      const v = await this.keepVersion(ctx, plan, 'FINALIZED', kept);
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
      const finalized = await ctx.tx.taxPlanVersion.findFirst({
        where: { businessId, planId: id, event: 'FINALIZED' },
        orderBy: { version: 'desc' },
        select: { createdAt: true },
      });
      const missing: string[] = [];
      if (!finalized) missing.push('Finalize the plan first');
      else if (plan.updatedAt > finalized.createdAt)
        missing.push('The plan changed after it was finalized; finalize it again');
      if (missing.length > 0) throw tpErrors.planNotReady(missing);
      const kept = await this.snapshotOf(ctx, plan);
      const lines = kept.snapshot.strategies.map((s) => {
        const c = s.estimate.cents;
        return `- ${s.name}: ${c === null ? 'estimate not available' : `about ${money(c)} estimated savings`}`;
      });
      const total = kept.snapshot.projectedSavingsCents;
      const message = [
        `Your ${plan.planYear} tax plan, ${plan.name}, is ready.`,
        ...(plan.clientNotes ? ['', plan.clientNotes] : []),
        '',
        'Strategies:',
        ...lines,
        ...(total !== null ? ['', `Total estimated savings: about ${money(total)}.`] : []),
        ...(body.message ? ['', body.message] : []),
        '',
        DISCLAIMER,
      ].join('\n');
      return { plan, kept, message, actor: ctx.actor };
    });
    await this.messages.create(businessId, prepared.actor, prepared.plan.clientId, {
      subject: `Your ${prepared.plan.planYear} tax plan`.slice(0, 200),
      body: prepared.message,
      repliesEnabled: true,
    });
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.read.load(ctx, id);
      await ctx.tx.$queryRaw`
        SELECT 1 FROM tax_plans WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const plan = await this.read.load(ctx, id);
      const v = await this.keepVersion(ctx, plan, 'SENT', prepared.kept);
      await this.audit.logIn(
        ctx.tx,
        'tax_plan.sent',
        { type: 'tax_plan', id },
        { clientId: plan.clientId, version: v.version, channel: body.channel },
      );
      return this.read.detailById(ctx, id);
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
