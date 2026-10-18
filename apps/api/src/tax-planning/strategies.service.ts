import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { PlanningStrategy, PlanningStrategyPage } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, notFound, sentFields } from '../workspaces/common.js';
import { INPUT_KEYS } from './catalog.js';
import type {
  CreateStrategyBody,
  StrategiesQuery,
  UpdateStrategyLibraryBody,
} from './tax-planning-input.js';
import { OPEN_OPPORTUNITY_STATUSES, permsOf, tpErrors } from './tax-planning.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const count = {
  _count: {
    select: {
      planStrategies: true,
      taxOpportunities: { where: { status: { in: [...OPEN_OPPORTUNITY_STATUSES] } } },
    },
  },
} satisfies Prisma.TaxPlanningStrategyInclude;
type Row = Prisma.TaxPlanningStrategyGetPayload<{ include: typeof count }>;

const lines = (json: unknown, key: string): string[] => {
  const v = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

function toView(r: Row): PlanningStrategy {
  const checklist = Array.isArray(r.implementationChecklist) ? r.implementationChecklist : [];
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    defaultPriority: r.defaultPriority,
    eligibility: lines(r.eligibility, 'criteria'),
    requiredInputs: r.requiredInputs,
    requiredDocuments: r.requiredDocuments,
    implementationChecklist: checklist
      .map((c) => (c as { label?: unknown }).label)
      .filter((x): x is string => typeof x === 'string'),
    active: r.active,
    archived: r.archivedAt !== null,
    planCount: r._count.planStrategies,
    openOpportunityCount: r._count.taxOpportunities,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** The firm's strategy library. Reading is for everyone with Tax Planning; changing needs Manage Strategies. */
@Injectable()
export class PlanningStrategiesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async one(tx: TxClient, businessId: string, id: string): Promise<Row> {
    const row = await tx.taxPlanningStrategy.findFirst({
      where: { businessId, id },
      include: count,
    });
    if (!row) throw notFound();
    return row;
  }

  private checkInputs(keys: string[]) {
    keys.forEach((k, i) => {
      if (!INPUT_KEYS.has(k))
        throw tpErrors.invalid(`requiredInputs.${i}`, 'This figure is not one the plan takes');
    });
  }

  list(businessId: string, q: Out<typeof StrategiesQuery>): Promise<PlanningStrategyPage> {
    return this.inFirm(businessId, async (tx) => {
      const search = q.search ? likeEscape(q.search) : undefined;
      const where: Prisma.TaxPlanningStrategyWhereInput = {
        businessId,
        ...(q.category ? { category: q.category } : {}),
        ...(q.active !== undefined ? { active: q.active } : {}),
        ...(q.includeArchived ? {} : { archivedAt: null }),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.taxPlanningStrategy.count({ where }),
        tx.taxPlanningStrategy.findMany({
          where,
          include: count,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { items: rows.map(toView), total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(businessId: string, id: string): Promise<PlanningStrategy> {
    return this.inFirm(businessId, async (tx) => toView(await this.one(tx, businessId, id)));
  }

  create(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateStrategyBody>,
  ): Promise<PlanningStrategy> {
    if (!permsOf(tenant).manageStrategies) throw tpErrors.forbidden();
    this.checkInputs(body.requiredInputs);
    return this.inFirm(businessId, async (tx) => {
      const twin = await tx.taxPlanningStrategy.findFirst({
        where: { businessId, name: { equals: body.name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (twin) throw tpErrors.duplicateName();
      try {
        const row = await tx.taxPlanningStrategy.create({
          data: {
            businessId,
            name: body.name,
            category: body.category,
            description: body.description ?? null,
            defaultPriority: body.defaultPriority,
            eligibility: { criteria: body.eligibility },
            requiredInputs: body.requiredInputs,
            requiredDocuments: body.requiredDocuments,
            implementationChecklist: body.implementationChecklist.map((label) => ({ label })),
            createdByUserId: userId,
          },
          select: { id: true },
        });
        await this.audit.logIn(tx, 'tax_strategy.created', { type: 'tax_strategy', id: row.id });
        return toView(await this.one(tx, businessId, row.id));
      } catch (error) {
        if (isUniqueViolation(error)) throw tpErrors.duplicateName();
        throw error;
      }
    });
  }

  update(
    businessId: string,
    tenant: TenantContext,
    id: string,
    body: Out<typeof UpdateStrategyLibraryBody>,
  ): Promise<PlanningStrategy> {
    if (!permsOf(tenant).manageStrategies) throw tpErrors.forbidden();
    if (body.requiredInputs) this.checkInputs(body.requiredInputs);
    return this.inFirm(businessId, async (tx) => {
      const cur = await this.one(tx, businessId, id);
      if (body.active === true && cur.archivedAt) throw tpErrors.invalidStatus('Restore it first');
      if (body.name !== undefined) {
        const twin = await tx.taxPlanningStrategy.findFirst({
          where: { businessId, name: { equals: body.name, mode: 'insensitive' }, id: { not: id } },
          select: { id: true },
        });
        if (twin) throw tpErrors.duplicateName();
      }
      try {
        await tx.taxPlanningStrategy.update({
          where: { businessId_id: { businessId, id } },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.category !== undefined ? { category: body.category } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.defaultPriority !== undefined
              ? { defaultPriority: body.defaultPriority }
              : {}),
            ...(body.eligibility !== undefined
              ? { eligibility: { criteria: body.eligibility } }
              : {}),
            ...(body.requiredInputs !== undefined ? { requiredInputs: body.requiredInputs } : {}),
            ...(body.requiredDocuments !== undefined
              ? { requiredDocuments: body.requiredDocuments }
              : {}),
            ...(body.implementationChecklist !== undefined
              ? {
                  implementationChecklist: body.implementationChecklist.map((label) => ({ label })),
                }
              : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw tpErrors.duplicateName();
        throw error;
      }
      await this.audit.logIn(
        tx,
        'tax_strategy.updated',
        { type: 'tax_strategy', id },
        {
          fields: sentFields(body, [
            'name',
            'category',
            'description',
            'defaultPriority',
            'eligibility',
            'requiredInputs',
            'requiredDocuments',
            'implementationChecklist',
            'active',
          ]),
        },
      );
      return toView(await this.one(tx, businessId, id));
    });
  }

  setArchived(
    businessId: string,
    tenant: TenantContext,
    id: string,
    archive: boolean,
  ): Promise<PlanningStrategy> {
    if (!permsOf(tenant).manageStrategies) throw tpErrors.forbidden();
    return this.inFirm(businessId, async (tx) => {
      const cur = await this.one(tx, businessId, id);
      if (archive === (cur.archivedAt !== null)) return toView(cur);
      await tx.taxPlanningStrategy.update({
        where: { businessId_id: { businessId, id } },
        data: archive
          ? { archivedAt: new Date(), active: false }
          : { archivedAt: null, active: true },
      });
      await this.audit.logIn(tx, archive ? 'tax_strategy.archived' : 'tax_strategy.restored', {
        type: 'tax_strategy',
        id,
      });
      return toView(await this.one(tx, businessId, id));
    });
  }
}
