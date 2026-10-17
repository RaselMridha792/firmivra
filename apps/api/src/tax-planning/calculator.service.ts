import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { CalculatorResult, TaxScenario, TaxScenarioPage } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import { type TaxCtx, TaxPlanReadService } from './plan-read.service.js';
import type { CalculateBody, SaveScenarioBody, ScenariosQuery } from './tax-planning-input.js';
import { clientRef, clientRefSelect, DISCLAIMER, tpErrors } from './tax-planning.common.js';
import { calculateSavings } from './tax-tables.js';

type Out<S extends z.ZodType> = z.output<S>;

const include = {
  client: { select: clientRefSelect },
  plan: { select: { id: true, name: true } },
} satisfies Prisma.TaxSavingsScenarioInclude;
type Row = Prisma.TaxSavingsScenarioGetPayload<{ include: typeof include }>;

const result = (c: ReturnType<typeof calculateSavings>): CalculatorResult => ({
  ...c,
  disclaimer: DISCLAIMER,
});

/** The Tax Savings Calculator and its saved scenarios. The figures are the client's: they need "View Financial Inputs". */
@Injectable()
export class TaxCalculatorService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: TaxPlanReadService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: TaxCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) => {
      const ctx = await this.read.ctx(tx, businessId, tenant, userId);
      if (!ctx.perms.viewInputs) throw tpErrors.financialRestricted();
      return fn(ctx);
    });
  }

  private async clientOk(ctx: TaxCtx, clientId: string) {
    const c = await ctx.tx.client.findFirst({
      where: { businessId: ctx.businessId, id: clientId, ...this.read.clientReach(ctx) },
      select: { id: true },
    });
    if (!c) throw notFound();
  }

  async calculate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CalculateBody>,
  ): Promise<CalculatorResult> {
    const out = await this.run(businessId, tenant, userId, async (ctx) => {
      if (body.clientId) await this.clientOk(ctx, body.clientId);
      return result(calculateSavings(body));
    });
    if (body.clientId)
      await this.audit.log(
        'tax_calculation.run',
        { type: 'client', id: body.clientId },
        { taxYear: body.taxYear, available: out.differenceCents !== null },
      );
    return out;
  }

  private view(r: Row, names: Map<string, string>): TaxScenario {
    const baseline = r.baselineInputs as TaxScenario['baseline'];
    const strategy = r.strategyInputs as TaxScenario['strategy'];
    const available = r.baselineTaxCents !== null;
    const fresh = available
      ? null
      : calculateSavings({
          taxYear: r.taxYear,
          ...(r.filingStatus ? { filingStatus: r.filingStatus } : {}),
          baseline,
          strategy,
        });
    return {
      id: r.id,
      name: r.name,
      client: r.client ? clientRef(r.client) : null,
      plan: r.plan,
      taxYear: r.taxYear,
      filingStatus: r.filingStatus,
      baseline,
      strategy,
      result: {
        baselineTaxCents: r.baselineTaxCents,
        modeledTaxCents: r.modeledTaxCents,
        differenceCents: r.differenceCents,
        unavailableReason: available
          ? null
          : (fresh?.unavailableReason ?? 'The result is not available'),
        assumptions: (r.assumptions ?? '').split('\n').filter(Boolean),
        disclaimer: DISCLAIMER,
      },
      savedToPlanAt: r.savedToPlanAt?.toISOString() ?? null,
      createdBy: memberRef(names, r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** Staff see the scenarios of their clients and their own standalone ones; Owner and Admin all. */
  private visible(ctx: TaxCtx): Prisma.TaxSavingsScenarioWhereInput {
    return ctx.reachOnly
      ? {
          OR: [
            { client: { assignedUserId: ctx.actor.userId } },
            { clientId: null, createdByUserId: ctx.actor.userId },
          ],
        }
      : {};
  }

  saveScenario(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof SaveScenarioBody>,
  ): Promise<TaxScenario> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      const calc = body.calculation;
      let clientId = calc.clientId ?? null;
      if (body.planId) {
        if (!ctx.perms.edit) throw tpErrors.forbidden();
        const plan = await tx.taxPlan.findFirst({
          where: { businessId, id: body.planId, client: this.read.clientReach(ctx) },
          select: { clientId: true, archivedAt: true, status: true },
        });
        if (!plan) throw notFound();
        if (plan.archivedAt) throw tpErrors.planArchived();
        if (plan.status === 'CLOSED')
          throw tpErrors.invalidStatus('A closed plan cannot be changed');
        if (clientId && clientId !== plan.clientId)
          throw tpErrors.invalid('calculation.clientId', 'This is not the plan’s client');
        clientId = plan.clientId;
      } else if (clientId) await this.clientOk(ctx, clientId);
      const out = calculateSavings(calc);
      const row = await tx.taxSavingsScenario.create({
        data: {
          businessId,
          clientId,
          planId: body.planId ?? null,
          name: body.name ?? null,
          taxYear: calc.taxYear,
          filingStatus: calc.filingStatus ?? null,
          baselineInputs: calc.baseline as Prisma.InputJsonObject,
          strategyInputs: calc.strategy as Prisma.InputJsonObject,
          baselineTaxCents: out.baselineTaxCents,
          modeledTaxCents: out.modeledTaxCents,
          differenceCents: out.differenceCents,
          assumptions: out.assumptions.join('\n').slice(0, 2_000),
          savedToPlanAt: body.planId ? new Date() : null,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'tax_scenario.saved',
        { type: 'tax_scenario', id: row.id },
        { ...(clientId ? { clientId } : {}), ...(body.planId ? { planId: body.planId } : {}) },
      );
      return this.one(ctx, row.id);
    });
  }

  private async one(ctx: TaxCtx, id: string): Promise<TaxScenario> {
    const r = await ctx.tx.taxSavingsScenario.findFirst({
      where: { businessId: ctx.businessId, id, ...this.visible(ctx) },
      include,
    });
    if (!r) throw notFound();
    return this.view(r, await memberNames(ctx.tx, ctx.businessId, [r.createdByUserId]));
  }

  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxScenario> {
    const s = await this.run(businessId, tenant, userId, (ctx) => this.one(ctx, id));
    await this.audit.log(
      'tax_scenario.viewed',
      { type: 'tax_scenario', id },
      s.client ? { clientId: s.client.id } : undefined,
    );
    return s;
  }

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ScenariosQuery>,
  ): Promise<TaxScenarioPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const where: Prisma.TaxSavingsScenarioWhereInput = {
        businessId,
        AND: [this.visible(ctx)],
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.planId ? { planId: q.planId } : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.tx.taxSavingsScenario.count({ where }),
        ctx.tx.taxSavingsScenario.findMany({
          where,
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.createdByUserId),
      );
      return {
        items: rows.map((r) => this.view(r, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }
}
