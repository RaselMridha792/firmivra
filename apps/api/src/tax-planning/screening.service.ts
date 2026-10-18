import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type { RunScreeningResult } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import { type TaxCtx, TaxPlanReadService } from './plan-read.service.js';
import type { ScreeningBody } from './tax-planning-input.js';
import { figuresOf, todayIn, tpErrors } from './tax-planning.common.js';
import {
  effectiveRateBp,
  estimateStrategy,
  roomUnderLimit,
  standardDeductionCents,
  groupOf,
  tableFor,
} from './tax-tables.js';

type Out<S extends z.ZodType> = z.output<S>;

/** At most this many clients are screened in one run; a larger firm runs it again (`queued`). */
export const SCREENING_BATCH = 500;

interface Rule {
  id: string;
  /** The plan figure and library requirement the rule reads. */
  inputKey: 'retirement_contributions' | 'hsa_contributions';
  kind: 'retirement' | 'hsa';
  why: string;
  eligibility: string;
  actions: string[];
  documents: string[];
  contributedLabel: string;
}

/** The documented rules. A rule fires for a library strategy that requires the figure it reads. */
export const RULES: readonly Rule[] = [
  {
    id: 'retirement-room',
    inputKey: 'retirement_contributions',
    kind: 'retirement',
    why: 'Retirement contributions for the year are below the annual limit, so more could be set aside and taken out of taxable income.',
    eligibility: 'Retirement contributions so far are below the annual limit',
    actions: [
      'Confirm the client can afford a larger contribution',
      'Raise the plan deferral or make a contribution before the deadline',
      'Keep the contribution statement for the return',
    ],
    documents: ['Year-to-date retirement contribution statement'],
    contributedLabel: 'Retirement contributions so far',
  },
  {
    id: 'hsa-room',
    inputKey: 'hsa_contributions',
    kind: 'hsa',
    why: 'Health savings account contributions are below the annual limit, so more could be contributed and deducted.',
    eligibility: 'HSA contributions so far are below the annual limit',
    actions: [
      'Confirm the client has a qualifying high-deductible health plan',
      'Make or raise the HSA contribution before the deadline',
      'Keep the HSA statement for the return',
    ],
    documents: ['HSA contribution statement', 'Proof of high-deductible health plan coverage'],
    contributedLabel: 'HSA contributions so far',
  },
];

const OPEN_OR_REVIEWED_LEAVE_ALONE = [
  'UNDER_REVIEW',
  'ASSIGNED',
  'DISCUSSION_SCHEDULED',
  'NEEDS_DOCUMENTS',
  'ADDED_TO_PLAN',
  'IMPLEMENTED',
  'CLOSED',
];

/**
 * The screening run: re-screens a client or the firm's clients for a tax year under the
 * documented rules, from the figures in each client's plan for that year. It creates opportunities
 * (never recommendations until staff review them), refreshes the ones nobody has touched, and
 * leaves alone anything a person reviewed, and anything Not Applicable or Dismissed before its
 * suppression date (or for good when it has none).
 */
@Injectable()
export class TaxScreeningService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: TaxPlanReadService,
    private readonly audit: AuditService,
  ) {}

  run(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof ScreeningBody>,
  ): Promise<RunScreeningResult> {
    return this.read.inFirm(businessId, async (tx) => {
      const ctx = await this.read.ctx(tx, businessId, tenant, userId);
      if (!ctx.perms.planningAdmin) throw tpErrors.forbidden();
      const today = todayIn(ctx.timezone);
      const taxYear = body.taxYear ?? Number(today.slice(0, 4));
      const clients = await tx.client.findMany({
        where: {
          businessId,
          archivedAt: null,
          ...(body.clientId ? { id: body.clientId } : {}),
        },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: SCREENING_BATCH + 1,
      });
      if (body.clientId && clients.length === 0) throw notFound();
      const queued = clients.length > SCREENING_BATCH;
      const result = { clientsScreened: 0, created: 0, updated: 0, skippedSuppressed: 0 };
      const strategies = await tx.taxPlanningStrategy.findMany({
        where: { businessId, active: true, archivedAt: null },
      });
      for (const c of clients.slice(0, SCREENING_BATCH)) {
        result.clientsScreened += 1;
        await this.screenClient(ctx, c.id, taxYear, today, strategies, result);
      }
      await this.audit.logIn(
        tx,
        'tax_screening.run',
        { type: 'tax_screening' },
        { taxYear, ...result, ...(body.clientId ? { clientId: body.clientId } : {}) },
      );
      return { ...result, queued };
    });
  }

  private async screenClient(
    ctx: TaxCtx,
    clientId: string,
    taxYear: number,
    today: string,
    strategies: Prisma.TaxPlanningStrategyGetPayload<object>[],
    result: { created: number; updated: number; skippedSuppressed: number },
  ) {
    const { tx, businessId } = ctx;
    const plan = await tx.taxPlan.findFirst({
      where: { businessId, clientId, planYear: taxYear, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (!plan || !plan.filingStatus) return;
    const rows = await this.read.inputRows(ctx, plan.id);
    const figures = figuresOf(rows, plan.planYear);
    const table = tableFor(taxYear);
    if (!table) return;
    const group = groupOf(plan.filingStatus);
    const now = new Date();
    for (const rule of RULES) {
      for (const strategy of strategies.filter((s) => s.requiredInputs.includes(rule.inputKey))) {
        const est = estimateStrategy({
          requiredInputs: strategy.requiredInputs,
          planYear: taxYear,
          filingStatus: plan.filingStatus,
          figures,
        });
        if (est.cents === null || est.cents <= 0) continue;
        const prior = await tx.taxOpportunity.findFirst({
          where: { businessId, clientId, strategyId: strategy.id, taxYear },
          orderBy: { createdAt: 'desc' },
        });
        if (prior && OPEN_OR_REVIEWED_LEAVE_ALONE.includes(prior.status)) continue;
        if (prior && (prior.status === 'NOT_APPLICABLE' || prior.status === 'DISMISSED')) {
          const until = prior.suppressedUntil?.toISOString().slice(0, 10);
          if (!until || until > today) {
            result.skippedSuppressed += 1;
            continue;
          }
        }
        const taxable =
          figures.get('taxable_income')?.amountCents ??
          Math.max(
            0,
            (figures.get('agi')?.amountCents ?? 0) - standardDeductionCents(table, group),
          );
        const contributed = figures.get(rule.inputKey)?.amountCents ?? 0;
        const room = roomUnderLimit(taxYear, rule.kind, contributed) ?? 0;
        const used = Math.min(room, taxable);
        const fields = {
          category: strategy.category,
          priority: strategy.defaultPriority,
          name: strategy.name,
          ruleId: rule.id,
          whyExplanation: rule.why,
          dataComplete: true,
          missingData: [] as string[],
          lastEvaluatedAt: now,
          clientDataUsed: [
            { label: 'Taxable income', amountCents: taxable },
            { label: rule.contributedLabel, amountCents: contributed },
            { label: 'Room under the annual limit', amountCents: room },
          ],
          estimatedSavingsCents: est.cents,
          estimateBasis: est.basis,
          suggestedActionCents: used,
          newTaxableIncomeCents: Math.max(0, taxable - used),
          effectiveRateBeforeBp: effectiveRateBp(taxYear, plan.filingStatus, taxable),
          effectiveRateAfterBp: effectiveRateBp(taxYear, plan.filingStatus, taxable - used),
          recommendedActions: rule.actions,
          eligibility: [{ text: rule.eligibility, met: true }],
        } satisfies Prisma.TaxOpportunityUncheckedUpdateInput;
        if (prior && prior.status === 'NEW') {
          const changed =
            prior.estimatedSavingsCents !== est.cents ||
            prior.suggestedActionCents !== used ||
            prior.ruleId !== rule.id;
          await tx.taxOpportunity.update({
            where: { businessId_id: { businessId, id: prior.id } },
            data: changed ? fields : { lastEvaluatedAt: now },
          });
          if (changed) {
            result.updated += 1;
            await tx.taxOpportunityEvent.create({
              data: {
                businessId,
                opportunityId: prior.id,
                kind: 'SCREENED',
                reason: 'Screened again; the figures changed',
                details: { ruleId: rule.id },
                actorUserId: ctx.actor.userId,
              },
            });
          }
          continue;
        }
        const created = await tx.taxOpportunity.create({
          data: {
            businessId,
            clientId,
            strategyId: strategy.id,
            taxYear,
            source: 'SYSTEM',
            ...fields,
            documentsNeeded: rule.documents.map((label) => ({ label, received: false })),
            createdByUserId: ctx.actor.userId,
          },
          select: { id: true },
        });
        result.created += 1;
        await tx.taxOpportunityEvent.create({
          data: {
            businessId,
            opportunityId: created.id,
            kind: 'SCREENED',
            reason: 'Found by screening',
            details: { ruleId: rule.id },
            actorUserId: ctx.actor.userId,
          },
        });
      }
    }
  }
}
