import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  OpportunityDataPoint,
  TaxOpportunityDetail,
  TaxOpportunityEvent,
  TaxOpportunityPage,
  TaxOpportunityRow,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import {
  assignee,
  checkAssignee,
  conflict,
  day,
  isUniqueViolation,
  memberNames,
  memberRef,
  notFound,
  toDay,
} from '../workspaces/common.js';
import type {
  ActionBody,
  CreateOpportunityBody,
  OpportunitiesQuery,
} from './tax-planning-input.js';
import { type TaxCtx, TaxPlanReadService } from './plan-read.service.js';
import {
  CLOSED_OPPORTUNITY_STATUSES,
  clientRef,
  clientRefSelect,
  DISCLAIMER,
  iso,
  OPEN_OPPORTUNITY_STATUSES,
  tpErrors,
} from './tax-planning.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Status =
  (typeof OPEN_OPPORTUNITY_STATUSES)[number] | (typeof CLOSED_OPPORTUNITY_STATUSES)[number];

export const oppInclude = {
  client: { select: clientRefSelect },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.TaxOpportunityInclude;
export type OppShape = Prisma.TaxOpportunityGetPayload<{ include: typeof oppInclude }>;

const isOpen = (s: string) => (OPEN_OPPORTUNITY_STATUSES as readonly string[]).includes(s);
const QUEUE_LIMIT = 5_000;

const array = (json: unknown): unknown[] => (Array.isArray(json) ? json : []);
const strings = (json: unknown): string[] =>
  array(json).filter((x): x is string => typeof x === 'string');

export function toOppRow(o: OppShape): TaxOpportunityRow {
  return {
    id: o.id,
    client: clientRef(o.client),
    strategyId: o.strategyId,
    name: o.name,
    category: o.category,
    priority: o.priority,
    status: o.status,
    source: o.source,
    taxYear: o.taxYear,
    estimatedSavingsCents: o.estimatedSavingsCents,
    assignedTo: assignee(o.assignedMember),
    dataComplete: o.dataComplete,
    planId: o.planId,
    lastEvaluatedAt: iso(o.lastEvaluatedAt),
    updatedAt: o.updatedAt.toISOString(),
  };
}

interface NewEvent {
  kind: 'SCREENED' | 'STATUS' | 'ASSIGNED' | 'DISCUSSION' | 'DOCUMENTS' | 'PLAN' | 'NOTE';
  fromStatus?: Status;
  toStatus?: Status;
  reason?: string | null;
  details?: Prisma.InputJsonObject;
}

/** The opportunity queue, the detail with its explicit review actions, and the history. */
@Injectable()
export class TaxOpportunitiesService {
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
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  private where(ctx: TaxCtx, q: Out<typeof OpportunitiesQuery>): Prisma.TaxOpportunityWhereInput {
    const search = q.search ? likeEscape(q.search) : undefined;
    const group =
      q.group === 'open'
        ? [...OPEN_OPPORTUNITY_STATUSES]
        : q.group === 'closed'
          ? [...CLOSED_OPPORTUNITY_STATUSES]
          : undefined;
    return {
      businessId: ctx.businessId,
      client: { ...this.read.clientReach(ctx), ...(q.clientId ? { id: q.clientId } : {}) },
      AND: [
        ...(q.status ? [{ status: q.status }] : []),
        ...(group ? [{ status: { in: group } }] : []),
      ],
      ...(q.category ? { category: q.category } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.strategyId ? { strategyId: q.strategyId } : {}),
      ...(q.taxYear ? { taxYear: q.taxYear } : {}),
      ...(q.assignedUserId ? { assignedUserId: q.assignedUserId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { client: { displayName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private orderBy(
    q: Out<typeof OpportunitiesQuery>,
  ): Prisma.TaxOpportunityOrderByWithRelationInput[] {
    const dir = q.direction;
    switch (q.sort) {
      case 'priority':
        return [{ priority: dir }, { updatedAt: 'desc' }, { id: 'asc' }];
      case 'client':
        return [{ client: { displayName: dir } }, { id: 'asc' }];
      case 'updated':
        return [{ updatedAt: dir }, { id: 'asc' }];
      default:
        return [{ estimatedSavingsCents: { sort: dir, nulls: 'last' } }, { id: 'asc' }];
    }
  }

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof OpportunitiesQuery>,
  ): Promise<TaxOpportunityPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const where = this.where(ctx, q);
      const [total, rows] = await Promise.all([
        ctx.tx.taxOpportunity.count({ where }),
        ctx.tx.taxOpportunity.findMany({
          where,
          include: oppInclude,
          orderBy: this.orderBy(q),
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: rows.map(toOppRow), total, page: q.page, pageSize: q.pageSize };
    });
  }

  private async load(ctx: TaxCtx, id: string): Promise<OppShape> {
    const o = await ctx.tx.taxOpportunity.findFirst({
      where: { businessId: ctx.businessId, id, client: this.read.clientReach(ctx) },
      include: oppInclude,
    });
    if (!o) throw notFound();
    return o;
  }

  private async detail(
    ctx: TaxCtx,
    o: OppShape,
    queue?: Out<typeof OpportunitiesQuery>,
  ): Promise<TaxOpportunityDetail> {
    const { tx, businessId } = ctx;
    const [plan, candidates, names] = await Promise.all([
      o.planId
        ? tx.taxPlan.findFirst({
            where: { businessId, id: o.planId },
            select: { id: true, name: true },
          })
        : null,
      tx.taxPlan.findMany({
        where: { businessId, clientId: o.clientId, archivedAt: null, status: { not: 'CLOSED' } },
        orderBy: [{ planYear: 'desc' }, { updatedAt: 'desc' }],
        select: { id: true, name: true, planYear: true },
        take: 50,
      }),
      memberNames(tx, businessId, [o.reviewedByUserId]),
    ]);
    let previousId: string | null = null;
    let nextId: string | null = null;
    if (queue) {
      const ids = await tx.taxOpportunity.findMany({
        where: this.where(ctx, queue),
        orderBy: this.orderBy(queue),
        select: { id: true },
        take: QUEUE_LIMIT,
      });
      const at = ids.findIndex((x) => x.id === o.id);
      if (at >= 0) {
        previousId = ids[at - 1]?.id ?? null;
        nextId = ids[at + 1]?.id ?? null;
      }
    }
    const data = array(o.clientDataUsed).map((x): OpportunityDataPoint => {
      const p = x as { label?: unknown; amountCents?: unknown; text?: unknown };
      return {
        label: String(p.label ?? ''),
        amountCents: typeof p.amountCents === 'number' ? p.amountCents : null,
        text: typeof p.text === 'string' ? p.text : null,
      };
    });
    const cents = o.estimatedSavingsCents;
    return {
      ...toOppRow(o),
      description: o.description,
      ruleId: o.ruleId,
      whyExplanation: o.whyExplanation,
      missingData: o.missingData,
      clientDataUsed: ctx.perms.viewInputs ? data : null,
      estimate: {
        cents,
        modelCents: cents,
        overridden: false,
        dataYear: cents === null ? null : o.taxYear,
        calculatedAt: iso(o.lastEvaluatedAt),
        basis: o.estimateBasis,
        unavailableReason: cents === null ? 'No estimate is available for this opportunity' : null,
      },
      impact: {
        suggestedActionCents: o.suggestedActionCents,
        newTaxableIncomeCents: o.newTaxableIncomeCents,
        effectiveRateBeforeBp: o.effectiveRateBeforeBp,
        effectiveRateAfterBp: o.effectiveRateAfterBp,
      },
      recommendedActions: strings(o.recommendedActions),
      eligibility: array(o.eligibility).map((x) => ({
        text: String((x as { text?: unknown }).text ?? ''),
        met: (x as { met?: unknown }).met === true,
      })),
      documentsNeeded: array(o.documentsNeeded).map((x, index) => ({
        index,
        label: String((x as { label?: unknown }).label ?? ''),
        received: (x as { received?: unknown }).received === true,
      })),
      plan,
      discussionOn: day(o.discussionOn),
      reviewed: o.reviewedAt !== null,
      reviewedBy: memberRef(names, o.reviewedByUserId),
      dispositionReason: o.dispositionReason,
      suppressedUntil: day(o.suppressedUntil),
      implementedOn: day(o.implementedOn),
      previousId,
      nextId,
      candidatePlans: candidates,
      disclaimer: DISCLAIMER,
      canReview: ctx.perms.review,
      createdAt: o.createdAt.toISOString(),
      etag: o.updatedAt.toISOString(),
    };
  }

  /** Reading never changes an opportunity; the read is audited. */
  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    queue: Out<typeof OpportunitiesQuery>,
  ): Promise<TaxOpportunityDetail> {
    const detail = await this.run(businessId, tenant, userId, async (ctx) =>
      this.detail(ctx, await this.load(ctx, id), queue),
    );
    await this.audit.log(
      'tax_opportunity.viewed',
      { type: 'tax_opportunity', id },
      { clientId: detail.client.id },
    );
    return detail;
  }

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateOpportunityBody>,
  ): Promise<TaxOpportunityDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.review) throw tpErrors.forbidden();
      const { tx } = ctx;
      const client = await tx.client.findFirst({
        where: { businessId, id: body.clientId, ...this.read.clientReach(ctx) },
        select: { id: true, archivedAt: true },
      });
      if (!client) throw notFound();
      if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
      if (body.strategyId) {
        const lib = await tx.taxPlanningStrategy.findFirst({
          where: { businessId, id: body.strategyId, active: true, archivedAt: null },
          select: { id: true },
        });
        if (!lib) throw notFound();
        const open = await tx.taxOpportunity.findFirst({
          where: {
            businessId,
            clientId: body.clientId,
            strategyId: body.strategyId,
            taxYear: body.taxYear,
            status: { notIn: ['NOT_APPLICABLE', 'DISMISSED', 'CLOSED'] },
          },
          select: { id: true },
        });
        if (open) throw tpErrors.duplicateOpportunity(open.id);
      }
      let created: { id: string };
      try {
        created = await tx.taxOpportunity.create({
          data: {
            businessId,
            clientId: body.clientId,
            strategyId: body.strategyId ?? null,
            name: body.name,
            category: body.category,
            priority: body.priority,
            description: body.description ?? null,
            taxYear: body.taxYear,
            source: body.strategyId ? 'STAFF' : 'MANUAL',
            estimatedSavingsCents: body.estimatedSavingsCents ?? null,
            estimateBasis: body.estimateBasis ?? null,
            recommendedActions: body.recommendedActions,
            documentsNeeded: body.documentsNeeded.map((label) => ({ label, received: false })),
            createdByUserId: userId,
          },
          select: { id: true },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const open = await tx.taxOpportunity.findFirst({
            where: {
              businessId,
              clientId: body.clientId,
              strategyId: body.strategyId ?? undefined,
              taxYear: body.taxYear,
              status: { notIn: ['NOT_APPLICABLE', 'DISMISSED', 'CLOSED'] },
            },
            select: { id: true },
          });
          throw tpErrors.duplicateOpportunity(open?.id ?? '');
        }
        throw error;
      }
      await tx.taxOpportunityEvent.create({
        data: {
          businessId,
          opportunityId: created.id,
          kind: 'STATUS',
          toStatus: 'NEW',
          reason: 'Created by staff',
          actorUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'tax_opportunity.created',
        { type: 'tax_opportunity', id: created.id },
        { clientId: body.clientId, taxYear: body.taxYear },
      );
      return this.detail(ctx, await this.load(ctx, created.id));
    });
  }

  events(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxOpportunityEvent[]> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      await this.load(ctx, id);
      const rows = await ctx.tx.taxOpportunityEvent.findMany({
        where: { businessId, opportunityId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      const names = await memberNames(
        ctx.tx,
        businessId,
        rows.map((r) => r.actorUserId),
      );
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        reason:
          r.kind === 'NOTE'
            ? (((r.details as { note?: unknown } | null)?.note as string | undefined) ?? null)
            : r.reason,
        actor: memberRef(names, r.actorUserId),
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  // ---------- Review actions ----------

  act(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ActionBody>,
  ): Promise<TaxOpportunityDetail> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.review) throw tpErrors.forbidden();
      const { tx } = ctx;
      await this.load(ctx, id);
      await tx.$queryRaw`
        SELECT 1 FROM tax_opportunities WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const o = await this.load(ctx, id);
      if (body.etag !== undefined && body.etag !== o.updatedAt.toISOString())
        throw tpErrors.saveConflict();
      const from = o.status as Status;
      const data: Prisma.TaxOpportunityUncheckedUpdateInput = { updatedAt: new Date() };
      const events: NewEvent[] = [];
      let to: Status = from;
      const setStatus = (next: Status, reason?: string | null) => {
        to = next;
        data.status = next;
        events.push({ kind: 'STATUS', fromStatus: from, toStatus: next, reason: reason ?? null });
      };
      const review = () => {
        if (!o.reviewedAt) {
          data.reviewedAt = new Date();
          data.reviewedByUserId = userId;
        }
      };
      const needOpen = () => {
        if (!isOpen(from)) throw tpErrors.invalidStatus(`This cannot be done while it is ${from}`);
      };
      const wrong = () => {
        throw tpErrors.invalidStatus(`${body.action} does not fit an opportunity that is ${from}`);
      };

      switch (body.action) {
        case 'START_REVIEW':
          if (from !== 'NEW') wrong();
          setStatus('UNDER_REVIEW');
          review();
          break;
        case 'ADD_TO_PLAN': {
          needOpen();
          if (from === 'ADDED_TO_PLAN') wrong();
          const linked = await this.addToPlan(ctx, o, body.planId);
          data.planId = linked.planId;
          data.planStrategyId = linked.planStrategyId;
          setStatus('ADDED_TO_PLAN');
          review();
          events.push({ kind: 'PLAN', details: { planId: linked.planId } });
          break;
        }
        case 'ASSIGN': {
          needOpen();
          if (body.userId) await checkAssignee(tx, businessId, body.userId, o.client);
          data.assignedUserId = body.userId;
          events.push({ kind: 'ASSIGNED', details: { userId: body.userId } });
          if (body.userId && (from === 'NEW' || from === 'UNDER_REVIEW')) setStatus('ASSIGNED');
          else if (!body.userId && from === 'ASSIGNED')
            setStatus(o.reviewedAt ? 'UNDER_REVIEW' : 'NEW');
          break;
        }
        case 'SCHEDULE_DISCUSSION': {
          needOpen();
          if (body.appointmentId) {
            const appt = await tx.appointment.findFirst({
              where: { businessId, id: body.appointmentId, clientId: o.clientId },
              select: { id: true },
            });
            if (!appt) throw notFound();
          }
          data.discussionOn = toDay(body.on);
          events.push({
            kind: 'DISCUSSION',
            details: {
              on: body.on,
              ...(body.appointmentId ? { appointmentId: body.appointmentId } : {}),
            },
          });
          if (['NEW', 'UNDER_REVIEW', 'ASSIGNED', 'NEEDS_DOCUMENTS'].includes(from))
            setStatus('DISCUSSION_SCHEDULED');
          break;
        }
        case 'SET_DOCUMENT': {
          needOpen();
          const docs = array(o.documentsNeeded) as { label?: unknown; received?: unknown }[];
          const item = docs[body.index];
          if (!item) throw tpErrors.invalid('index', 'There is no such document');
          const next = docs.map((d, i) =>
            i === body.index ? { ...d, received: body.received } : d,
          );
          data.documentsNeeded = next as Prisma.InputJsonValue;
          events.push({
            kind: 'DOCUMENTS',
            details: { index: body.index, received: body.received },
          });
          if (!body.received && ['UNDER_REVIEW', 'ASSIGNED', 'DISCUSSION_SCHEDULED'].includes(from))
            setStatus('NEEDS_DOCUMENTS');
          else if (
            body.received &&
            from === 'NEEDS_DOCUMENTS' &&
            next.every((d) => d.received === true)
          )
            setStatus('UNDER_REVIEW');
          break;
        }
        case 'MARK_NOT_APPLICABLE':
        case 'DISMISS':
          needOpen();
          setStatus(body.action === 'DISMISS' ? 'DISMISSED' : 'NOT_APPLICABLE', body.reason);
          data.dispositionReason = body.reason;
          data.suppressedUntil = body.suppressedUntil ? toDay(body.suppressedUntil) : null;
          review();
          break;
        case 'MARK_IMPLEMENTED':
          needOpen();
          if (from === 'NEW')
            throw tpErrors.invalidStatus('Review it before marking it implemented');
          setStatus('IMPLEMENTED', body.note ?? null);
          data.implementedOn = toDay(body.on);
          review();
          break;
        case 'CLOSE':
          if (from === 'NEW') throw tpErrors.invalidStatus('Review it before closing it');
          if (!isOpen(from) && from !== 'IMPLEMENTED') wrong();
          setStatus('CLOSED', body.note ?? null);
          review();
          break;
        case 'REOPEN':
          if (from !== 'NOT_APPLICABLE' && from !== 'DISMISSED') wrong();
          setStatus(o.reviewedAt ? 'UNDER_REVIEW' : 'NEW', body.note ?? null);
          data.dispositionReason = null;
          data.suppressedUntil = null;
          break;
        case 'ADD_NOTE':
          events.push({ kind: 'NOTE', details: { note: body.note } });
          break;
      }

      try {
        await tx.taxOpportunity.update({
          where: { businessId_id: { businessId, id } },
          data,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw tpErrors.duplicateOpportunity(id);
        throw error;
      }
      for (const e of events) {
        await tx.taxOpportunityEvent.create({
          data: {
            businessId,
            opportunityId: id,
            kind: e.kind,
            fromStatus: e.fromStatus ?? null,
            toStatus: e.toStatus ?? null,
            reason: e.reason ?? null,
            details: e.details ?? {},
            actorUserId: userId,
          },
        });
      }
      await this.audit.logIn(
        tx,
        'tax_opportunity.action',
        { type: 'tax_opportunity', id },
        { clientId: o.clientId, action: body.action, from, to },
      );
      return this.detail(ctx, await this.load(ctx, id));
    });
  }

  /** Links an opportunity to a plan of its client (or a new draft) and to a strategy in it, without a duplicate. */
  private async addToPlan(
    ctx: TaxCtx,
    o: OppShape,
    planId: string | undefined,
  ): Promise<{ planId: string; planStrategyId: string }> {
    const { tx, businessId } = ctx;
    let plan: { id: string } | null;
    if (planId) {
      plan = await tx.taxPlan.findFirst({
        where: {
          businessId,
          id: planId,
          clientId: o.clientId,
          archivedAt: null,
          status: { not: 'CLOSED' },
        },
        select: { id: true },
      });
      if (!plan) throw notFound();
    } else {
      plan = await tx.taxPlan.findFirst({
        where: {
          businessId,
          clientId: o.clientId,
          planYear: o.taxYear,
          archivedAt: null,
          status: { not: 'CLOSED' },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (!plan) {
        if (!ctx.perms.create) throw tpErrors.forbidden();
        plan = await tx.taxPlan.create({
          data: {
            businessId,
            clientId: o.clientId,
            name: `${o.taxYear} Tax Plan`,
            planYear: o.taxYear,
            createdByUserId: ctx.actor.userId,
          },
          select: { id: true },
        });
        await this.audit.logIn(
          tx,
          'tax_plan.created',
          { type: 'tax_plan', id: plan.id },
          { clientId: o.clientId, planYear: o.taxYear, status: 'DRAFT', fromOpportunity: o.id },
        );
      }
    }
    const existing = await tx.taxPlanStrategy.findFirst({
      where: {
        businessId,
        planId: plan.id,
        ...(o.strategyId
          ? { strategyId: o.strategyId }
          : { customName: { equals: o.name, mode: 'insensitive' as const } }),
      },
      select: { id: true },
    });
    let planStrategyId = existing?.id;
    if (!planStrategyId) {
      const last = await tx.taxPlanStrategy.findFirst({
        where: { businessId, planId: plan.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const position = (last?.position ?? -1) + 1;
      const cents = o.estimatedSavingsCents;
      if (o.strategyId) {
        const lib = await tx.taxPlanningStrategy.findFirst({
          where: { businessId, id: o.strategyId, active: true, archivedAt: null },
          select: { id: true, name: true },
        });
        if (!lib) throw tpErrors.invalidStatus('The library strategy is no longer active');
        planStrategyId = (
          await tx.taxPlanStrategy.create({
            data: {
              businessId,
              planId: plan.id,
              strategyId: lib.id,
              displayName: lib.name,
              priority: o.priority,
              estimatedSavingsCents: cents,
              estimateDataYear: cents === null ? null : o.taxYear,
              estimateCalculatedAt: cents === null ? null : (o.lastEvaluatedAt ?? new Date()),
              position,
            },
            select: { id: true },
          })
        ).id;
      } else {
        planStrategyId = (
          await tx.taxPlanStrategy.create({
            data: {
              businessId,
              planId: plan.id,
              customName: o.name,
              customCategory: o.category,
              displayName: o.name,
              priority: o.priority,
              position,
              ...(cents !== null
                ? {
                    overrideSavingsCents: cents,
                    overrideReason: 'Carried over from the opportunity',
                    overrideByUserId: ctx.actor.userId,
                  }
                : {}),
            },
            select: { id: true },
          })
        ).id;
      }
    }
    await tx.taxPlan.update({
      where: { businessId_id: { businessId, id: plan.id } },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
    return { planId: plan.id, planStrategyId };
  }
}
