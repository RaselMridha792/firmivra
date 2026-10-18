import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { AdvisoryFinancialPage, AdvisoryFinancialRow } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, toDay } from '../workspaces/common.js';
import { type AdvisoryCtx, AdvisoryReadService } from './advisory-read.service.js';
import { AdvisoryGoalsService } from './advisory-goals.service.js';
import type { CreateFinancialBody, FinancialsQuery } from './advisory-input.js';
import { advErrors, clientRef, clientRefSelect } from './advisory.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** Financial snapshots: insert-only rows with a source and an as-of date; a correction is a new row. */
@Injectable()
export class AdvisoryFinancialsService {
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

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof FinancialsQuery>,
  ): Promise<AdvisoryFinancialPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.viewFinancials) throw advErrors.financialsRestricted();
      const where: Prisma.AdvisoryFinancialSnapshotWhereInput = {
        businessId,
        advisoryClient: this.read.reach(ctx),
        ...(q.advisoryClientId ? { advisoryClientId: q.advisoryClientId } : {}),
        ...(q.planId ? { planId: q.planId } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.from ? { periodEnd: { gte: toDay(q.from) } } : {}),
        ...(q.to ? { periodStart: { lte: toDay(q.to) } } : {}),
      };
      const all = await ctx.tx.advisoryFinancialSnapshot.findMany({
        where,
        include: { advisoryClient: { select: { client: { select: clientRefSelect } } } },
        orderBy: [
          { periodEnd: 'desc' },
          { periodStart: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: 5_000,
      });
      let rows = all;
      if (!q.includeSuperseded) {
        const seen = new Set<string>();
        rows = all.filter((r) => {
          const key = `${r.advisoryClientId}|${r.periodStart.toISOString()}|${r.periodEnd.toISOString()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.overriddenByUserId),
      );
      const sum = (pick: (r: (typeof rows)[number]) => number | null): number | null => {
        const vals = rows.map(pick).filter((v): v is number => v !== null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
      };
      const budgeted = rows.filter((r) => r.budgetRevenueCents !== null && r.revenueCents !== null);
      const page = rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      return {
        items: page.map((r) => ({
          ...this.read.financialRow(ctx, r, names),
          client: clientRef(r.advisoryClient.client),
        })),
        summary: {
          revenueCents: sum((r) => r.revenueCents),
          expensesCents: sum((r) => r.expensesCents),
          netProfitCents: sum((r) => r.netProfitCents),
          budgetRevenueCents: sum((r) => r.budgetRevenueCents),
          budgetVarianceCents: budgeted.length
            ? budgeted.reduce(
                (n, r) => n + ((r.revenueCents as number) - (r.budgetRevenueCents as number)),
                0,
              )
            : null,
        },
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  add(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CreateFinancialBody>,
  ): Promise<AdvisoryFinancialRow> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.viewFinancials) throw advErrors.financialsRestricted();
      if (!ctx.perms.editPlans) throw advErrors.forbidden();
      const { tx } = ctx;
      const c = await this.read.lockClient(ctx, id);
      if (c.archivedAt) throw advErrors.clientArchived();
      await this.links.link(ctx, 'plan', body.planId, c.id);

      const revenue = body.revenueCents ?? null;
      const expenses = body.expensesCents ?? null;
      let net = body.netProfitCents ?? null;
      if (revenue !== null && expenses !== null) {
        if (net !== null && net !== revenue - expenses) throw advErrors.inconsistent();
        net = revenue - expenses;
      }
      // Replacing figures that came from a source (bookkeeping, payroll, bank) with one's own.
      const periodStart = toDay(body.periodStart);
      const periodEnd = toDay(body.periodEnd);
      const fromSource = await tx.advisoryFinancialSnapshot.findFirst({
        where: {
          businessId,
          advisoryClientId: c.id,
          periodStart,
          periodEnd,
          source: { in: ['BOOKKEEPING', 'PAYROLL', 'BANK'] },
        },
        select: { id: true },
      });
      const replaces = !!fromSource && (body.source === 'MANUAL' || body.source === 'UPLOADED');
      if (replaces && !ctx.perms.override) throw advErrors.overrideNotAllowed();
      if (replaces && !body.override)
        throw advErrors.invalid(
          'override.reason',
          'Say why the figures from the source are replaced',
        );
      if (!replaces && body.override)
        throw advErrors.invalid('override', 'There are no figures from a source to replace');

      const row = await tx.advisoryFinancialSnapshot.create({
        data: {
          businessId,
          advisoryClientId: c.id,
          planId: body.planId ?? null,
          periodStart,
          periodEnd,
          revenueCents: revenue,
          expensesCents: expenses,
          netProfitCents: net,
          cashFlowCents: body.cashFlowCents ?? null,
          debtCents: body.debtCents ?? null,
          budgetRevenueCents: body.budgetRevenueCents ?? null,
          budgetExpensesCents: body.budgetExpensesCents ?? null,
          headcount: body.headcount ?? null,
          source: body.source,
          asOf: toDay(body.asOf),
          overridden: replaces,
          overrideReason: replaces ? (body.override?.reason ?? null) : null,
          overriddenByUserId: replaces ? userId : null,
          createdByUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'advisory_financial.added',
        { type: 'advisory_client', id: c.id },
        {
          advisoryClientId: c.id,
          snapshotId: row.id,
          source: body.source,
          overridden: replaces,
        },
      );
      await this.read.recomputeHealth(ctx, c.id);
      const names = await memberNames(tx, businessId, [row.overriddenByUserId]);
      return this.read.financialRow(ctx, row, names);
    });
  }
}
