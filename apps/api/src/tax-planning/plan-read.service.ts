import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  PlanInput,
  PlanStrategy,
  StrategyCategory,
  TaxPlanDetail,
  TaxPlanRow,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { assignee, day, memberNames, memberRef, notFound } from '../workspaces/common.js';
import { INPUT_KEYS } from './catalog.js';
import {
  clientRef,
  clientRefSelect,
  DISCLAIMER,
  entityLabel,
  estimateView,
  figuresOf,
  iso,
  isStale,
  type Perms,
  permsOf,
  planTotals,
} from './tax-planning.common.js';
import { estimateStrategy } from './tax-tables.js';

/** What a caller is, for every Tax Planning request. */
export interface TaxCtx {
  tx: TxClient;
  businessId: string;
  tenant: TenantContext;
  timezone: string;
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
  /** Staff reach only the clients assigned to them. */
  reachOnly: boolean;
  perms: Perms;
}

export const planInclude = {
  client: { select: clientRefSelect },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
  strategies: {
    include: { strategy: { select: { category: true, requiredInputs: true } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  taxPlanVersions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} satisfies Prisma.TaxPlanInclude;
export type PlanShape = Prisma.TaxPlanGetPayload<{ include: typeof planInclude }>;

export const categoryOf = (s: PlanShape['strategies'][number]): StrategyCategory =>
  s.strategy?.category ?? s.customCategory ?? 'ESTATE_OTHER';

/** Reads the plans: the same shapes for the lists, the detail and the answers of every change. */
@Injectable()
export class TaxPlanReadService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async ctx(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<TaxCtx> {
    const role = tenant.kind === 'staff' ? legacyFirmRole(tenant.role) : 'STAFF';
    return {
      tx,
      businessId,
      tenant,
      timezone: await firmTimeZone(tx, businessId),
      actor: { userId, role },
      reachOnly: role === 'STAFF',
      perms: permsOf(tenant),
    };
  }

  /** The clients the caller reaches. */
  clientReach(ctx: TaxCtx): Prisma.ClientWhereInput {
    return ctx.reachOnly ? { assignedUserId: ctx.actor.userId } : {};
  }

  /** The caller's plan, or 404 (another firm's, another client's for Staff, or none). */
  async load(ctx: TaxCtx, id: string): Promise<PlanShape> {
    const plan = await ctx.tx.taxPlan.findFirst({
      where: { businessId: ctx.businessId, id, client: this.clientReach(ctx) },
      include: planInclude,
    });
    if (!plan) throw notFound();
    return plan;
  }

  row(plan: PlanShape): TaxPlanRow {
    return {
      id: plan.id,
      client: clientRef(plan.client),
      name: plan.name,
      planYear: plan.planYear,
      planType: plan.planType,
      status: plan.status,
      entityLabel: entityLabel(plan.entityType, plan.client.accountType),
      assignedTo: assignee(plan.assignedMember),
      targetCompletionOn: day(plan.targetCompletionOn),
      nextDiscussionOn: day(plan.nextDiscussionOn),
      projectedSavingsCents: planTotals(
        plan.strategies.map((s) => ({ ...s, category: categoryOf(s) })),
      ).cents,
      strategyCount: plan.strategies.length,
      version: plan.taxPlanVersions[0]?.version ?? 0,
      archived: plan.archivedAt !== null,
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  /** The plan's figures as rows, every one (the model reads them even when the caller may not see them). */
  async inputRows(ctx: TaxCtx, planId: string) {
    return ctx.tx.taxPlanInput.findMany({
      where: { businessId: ctx.businessId, planId },
      orderBy: [{ key: 'asc' }, { taxYear: 'desc' }, { kind: 'asc' }],
    });
  }

  async detail(ctx: TaxCtx, plan: PlanShape): Promise<TaxPlanDetail> {
    const { tx, businessId } = ctx;
    const [rows, docs] = await Promise.all([
      this.inputRows(ctx, plan.id),
      tx.taxPlanDocument.findMany({
        where: { businessId, planId: plan.id },
        orderBy: { createdAt: 'asc' },
        include: { document: { select: { fileName: true } } },
      }),
    ]);
    const names = await memberNames(tx, businessId, [
      ...plan.strategies.map((s) => s.overrideByUserId),
      ...docs.map((d) => d.addedByUserId),
      ...rows.map((r) => r.enteredByUserId),
    ]);
    const figures = figuresOf(rows, plan.planYear);
    const strategies: PlanStrategy[] = plan.strategies.map((s) => {
      const model = s.strategyId
        ? estimateStrategy({
            requiredInputs: s.strategy?.requiredInputs ?? [],
            planYear: plan.planYear,
            filingStatus: plan.filingStatus,
            figures,
          })
        : null;
      const category = categoryOf(s);
      return {
        id: s.id,
        strategyId: s.strategyId,
        name: s.displayName,
        category,
        custom: s.strategyId === null,
        selected: s.selected,
        priority: s.priority,
        status: s.status,
        estimate: estimateView(s, model?.reason ?? 'No estimate has been entered'),
        overrideReason: s.overrideReason,
        overriddenBy: memberRef(names, s.overrideByUserId),
        assumptions: s.assumptions,
        implementedOn: day(s.implementedOn),
        position: s.position,
      };
    });
    const totals = planTotals(plan.strategies.map((s) => ({ ...s, category: categoryOf(s) })));
    const inputs: PlanInput[] | null = ctx.perms.viewInputs
      ? rows.map((r) => ({
          key: r.key,
          label: INPUT_KEYS.get(r.key)?.label ?? r.key,
          kind: r.kind,
          taxYear: r.taxYear,
          amountCents: r.amountCents,
          textValue: r.textValue,
          source: r.source,
          asOf: iso(r.asOf),
          note: r.note,
        }))
      : null;
    return {
      ...this.row(plan),
      filingStatus: plan.filingStatus,
      entityType: plan.entityType,
      goals: plan.goals,
      otherGoal: plan.otherGoal,
      notes: plan.notes,
      clientNotes: plan.clientNotes,
      inputs,
      strategies,
      documents: docs.map((d) => ({
        documentId: d.documentId,
        fileName: d.document.fileName,
        category: d.category,
        planStrategyId: d.planStrategyId,
        addedBy: memberRef(names, d.addedByUserId),
        addedAt: d.createdAt.toISOString(),
      })),
      overlapNotes: totals.notes,
      staleData: rows.some((r) => isStale(r.asOf)),
      disclaimer: DISCLAIMER,
      canEdit: ctx.perms.edit,
      canOverride: ctx.perms.override,
      canSend: ctx.perms.send,
      createdAt: plan.createdAt.toISOString(),
      etag: plan.updatedAt.toISOString(),
    };
  }

  /** Reloads a plan after a change and shapes it. */
  async detailById(ctx: TaxCtx, id: string): Promise<TaxPlanDetail> {
    return this.detail(ctx, await this.load(ctx, id));
  }
}
