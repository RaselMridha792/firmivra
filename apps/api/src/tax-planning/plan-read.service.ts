import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  PlanInput,
  PlanStrategy,
  PlanWorkflow,
  StrategyCategory,
  TaxPlanDetail,
  TaxPlanRow,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { assignee, day, memberNames, memberRef, notFound } from '../workspaces/common.js';
import { inputDef } from './catalog.js';
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
import { workflowOf } from './workflow.js';

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
  // Review 2 workflow: Send for Internal Review's reviewer.
  reviewerMember: { select: { userId: true, user: { select: { name: true } } } },
  strategies: {
    include: { strategy: { select: { category: true, requiredInputs: true } } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
  taxPlanVersions: { select: { version: true }, orderBy: { version: 'desc' }, take: 1 },
} satisfies Prisma.TaxPlanInclude;
export type PlanShape = Prisma.TaxPlanGetPayload<{ include: typeof planInclude }>;

export const categoryOf = (s: PlanShape['strategies'][number]): StrategyCategory =>
  s.strategy?.category ?? s.customCategory ?? 'ESTATE_OTHER';

/**
 * C08 (Review 2): what keeps a plan from being finalized, each named with where to fix it (also
 * the readiness checklist's strategy and figures lines).
 */
export function finalBlockersOf(
  plan: Pick<PlanShape, 'strategies'>,
  inputs: { label: string; taxYear: number; asOf: Date | null }[],
): string[] {
  const missing: string[] = [];
  if (!plan.strategies.some((s) => s.selected && s.status !== 'DECLINED'))
    missing.push(
      'Select at least one strategy that is not declined: add or select one in Goals & Strategies.',
    );
  for (const i of inputs.filter((x) => isStale(x.asOf)))
    missing.push(
      `${i.label} (${i.taxYear}) is more than a year old: update it in Financial Overview.`,
    );
  return missing;
}

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
    const [rows, docs, tasks, discussions] = await Promise.all([
      this.inputRows(ctx, plan.id),
      tx.taxPlanDocument.findMany({
        where: { businessId, planId: plan.id },
        orderBy: { createdAt: 'asc' },
        include: { document: { select: { fileName: true } } },
      }),
      // C15 (Review 2): the plan's implementation tasks, due first.
      tx.task.findMany({
        where: { businessId, taxPlanId: plan.id, status: { not: 'DRAFT' } },
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 100,
        select: {
          id: true,
          title: true,
          status: true,
          dueOn: true,
          assignedMember: { select: { userId: true, user: { select: { name: true } } } },
        },
      }),
      // C12 (Review 2): the plan's client discussions, soonest first.
      tx.appointment.findMany({
        where: { businessId, taxPlanId: plan.id },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 50,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          timeZone: true,
          status: true,
          staff: { select: { userId: true, user: { select: { name: true } } } },
        },
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
          label: inputDef(r.key)?.label ?? r.key,
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
      // C27 (Review 2): a Closed plan is read-only until Reopen.
      canEdit: ctx.perms.edit && plan.status !== 'CLOSED',
      canChangeStatus: ctx.perms.edit,
      discussions: discussions.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        timeZone: a.timeZone,
        status: a.status,
        staff: assignee(a.staff),
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        dueOn: day(t.dueOn),
        assignedTo: assignee(t.assignedMember),
      })),
      workflow: await this.workflow(ctx, plan, rows, discussions.length, names),
      canOverride: ctx.perms.override,
      canSend: ctx.perms.send,
      createdAt: plan.createdAt.toISOString(),
      etag: plan.updatedAt.toISOString(),
    };
  }

  /**
   * Tax Planning Review 2's approved workflow for the detail: the next action and its owner, the
   * actions that fit, the readiness checklist, the reviewer, the versions sent and approved, the
   * approvals, the delivery and the requests.
   */
  private async workflow(
    ctx: TaxCtx,
    plan: PlanShape,
    inputs: { key: string; taxYear: number; asOf: Date | null }[],
    discussions: number,
    names: Map<string, string>,
  ): Promise<PlanWorkflow> {
    const { tx, businessId } = ctx;
    const [finalized, sent, approvals, requests] = await Promise.all([
      tx.taxPlanVersion.findFirst({
        where: { businessId, planId: plan.id, event: 'FINALIZED' },
        orderBy: { version: 'desc' },
        select: { createdAt: true },
      }),
      tx.taxPlanVersion.findFirst({
        where: { businessId, planId: plan.id, event: 'SENT' },
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      tx.taxPlanApproval.findMany({
        where: { businessId, planId: plan.id },
        orderBy: { version: 'desc' },
      }),
      tx.taxPlanRequest.findMany({
        where: { businessId, planId: plan.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    ]);
    const people = await memberNames(tx, businessId, [
      ...approvals.map((a) => a.recordedByUserId),
      ...requests.map((r) => r.requestedByUserId),
    ]);
    for (const [k, v] of names) people.set(k, v);
    const blockers = finalBlockersOf(
      plan,
      inputs.map((r) => ({
        label: inputDef(r.key)?.label ?? r.key,
        taxYear: r.taxYear,
        asOf: r.asOf,
      })),
    );
    const view = workflowOf({
      status: plan.status,
      canEdit: ctx.perms.edit,
      canSend: ctx.perms.send,
      assigned: plan.assignedUserId !== null,
      targetSet: plan.targetCompletionOn !== null,
      discussions,
      finalBlockers: blockers,
      finalizedCurrent: finalized !== null && plan.updatedAt <= finalized.createdAt,
      sentVersion: sent?.version ?? null,
      approvedVersion: approvals[0]?.version ?? null,
      delivered: plan.deliveredAt !== null,
      openClientRequests: requests.filter(
        (r) => r.direction === 'CLIENT_TO_FIRM' && r.status === 'OPEN',
      ).length,
    });
    return {
      nextAction: view.nextAction,
      owner:
        view.ownerIs === 'REVIEWER'
          ? assignee(plan.reviewerMember)
          : view.ownerIs === 'ASSIGNEE'
            ? assignee(plan.assignedMember)
            : null,
      waitingOnClient: view.waitingOnClient,
      actions: view.actions,
      readiness: view.readiness,
      reviewer: assignee(plan.reviewerMember),
      reviewRequestedAt: iso(plan.reviewRequestedAt),
      sentVersion: sent?.version ?? null,
      approvedVersion: approvals[0]?.version ?? null,
      approvals: approvals.map((a) => ({
        id: a.id,
        version: a.version,
        method: a.method,
        approvedOn: day(a.approvedOn)!,
        note: a.note,
        documentId: a.documentId,
        recordedBy: memberRef(people, a.recordedByUserId),
        createdAt: a.createdAt.toISOString(),
      })),
      delivered:
        plan.deliveredAt && plan.deliveredVersion
          ? { at: plan.deliveredAt.toISOString(), version: plan.deliveredVersion }
          : null,
      requests: requests.map((r) => ({
        id: r.id,
        direction: r.direction,
        kind: r.kind,
        body: r.body,
        status: r.status,
        response: r.response,
        documentId: r.documentId,
        requestedBy: memberRef(people, r.requestedByUserId),
        answeredAt: iso(r.answeredAt),
        closedAt: iso(r.closedAt),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Reloads a plan after a change and shapes it. */
  async detailById(ctx: TaxCtx, id: string): Promise<TaxPlanDetail> {
    return this.detail(ctx, await this.load(ctx, id));
  }
}
