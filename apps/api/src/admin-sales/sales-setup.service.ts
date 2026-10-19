import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type CreateSalesPipelineRequest,
  SALES_DEFAULT_PIPELINE_KEY,
  SALES_STAGE_ACTION_KEYS,
  SALES_STAGE_ACTIONS_AVAILABLE,
  SALES_STAGE_REQUIREMENT_KEYS,
  type SalesAttentionSettings,
  type SalesMeta,
  type SalesOk,
  type SalesPipeline,
  type SalesPipelineList,
  type SalesPlanList,
  type SalesStageType,
  type SalesTag,
  type SaveSalesAttentionSettingsRequest,
  type SaveSalesPipelineRequest,
  type SaveSalesTagRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { uuidv7 } from '../clients/client-ids.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  asSalesError,
  defaultPipelineId,
  entryStage,
  invalid,
  loadContext,
  loadPipelines,
  notFound,
  opportunitySelect,
  orNull,
  refuse,
  requirementsOf,
  type SalesContext,
  stageOrder,
  stageSelect,
  type StageRow,
} from './sales-common.js';
import { dayOf, entryProblem } from './sales-math.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The ten stages Firmivra ships, for a new pipeline's DEFAULT template when none is stored. */
const SHIPPED: readonly [string, SalesStageType, string[]][] = [
  ['New Lead', 'ACTIVE', []],
  ['Attempted Contact', 'ACTIVE', []],
  ['Contacted', 'ACTIVE', []],
  ['Qualified', 'ACTIVE', []],
  ['Appointment Set', 'ACTIVE', []],
  ['Nurturing', 'ACTIVE', []],
  ['Active Client', 'CONVERTED', []],
  ['Under Contract', 'TRANSACTION_SYNCED', ['transaction']],
  ['Closed / Past Client', 'CLOSED', []],
  ['Unqualified / Lost', 'LOST', []],
];
const BASIC: readonly [string, SalesStageType, string[]][] = [
  ['New', 'ACTIVE', []],
  ['Won', 'CONVERTED', []],
  ['Lost', 'LOST', []],
];

/**
 * Super Admin Sales setup (R60 on R0's B5): the pickers and rights (meta), the plan ladder, the
 * pipeline builder, tags and the attention settings, in the Super Admin's admin scope. Shipped
 * stages keep their key and type and are switched off, never removed; a stage holding records
 * keeps its type and is removed only after its records move.
 */
@Injectable()
export class SalesSetupService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  meta(): Promise<SalesMeta> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const [teams, tags, plans, pipelines, defaultId] = await Promise.all([
        tx.platformDepartment.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        }),
        tx.salesTag.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
        tx.platformPlan.findMany({
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, code: true, name: true, isActive: true },
        }),
        tx.salesPipeline.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, systemKey: true, isActive: true },
        }),
        defaultPipelineId(tx),
      ]);
      return {
        me: ctx.me,
        permissions: ctx.permissions,
        recordScope: 'COMPANY',
        reps: ctx.reps,
        teams,
        tags: tags.map(tagView),
        plans: plans.map((p) => ({ id: p.id, code: p.code, name: p.name, active: p.isActive })),
        pipelines: pipelines
          .map((p) => ({
            id: p.id,
            name: p.name,
            isDefault: p.systemKey === SALES_DEFAULT_PIPELINE_KEY,
            active: p.isActive,
          }))
          .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
        defaultPipelineId: defaultId,
        today: dayOf(ctx.now),
        attention: ctx.rules,
      };
    });
  }

  plans(): Promise<SalesPlanList> {
    return this.admin.transaction(async (tx) => {
      await loadContext(tx, this.admin.adminUserId);
      const plans = await tx.platformPlan.findMany({
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        include: { features: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
      });
      return {
        items: plans.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          priceCents: p.basePriceCents,
          billingCycle: p.billingCycle,
          includedSeats: p.includedSeats,
          maxSeats: p.maxSeats,
          seatPriceCents: p.overagePriceCentsPerSeat,
          includedLocations: p.includedLocations,
          locationPriceCents: p.overagePriceCentsPerLocation,
          displayOrder: p.displayOrder,
          active: p.isActive,
          features: p.features.map((f) => ({ key: f.featureKey, label: f.label })),
        })),
      };
    });
  }

  // ---------- Pipelines ----------

  pipelines(): Promise<SalesPipelineList> {
    return this.admin.transaction(async (tx) => {
      await loadContext(tx, this.admin.adminUserId);
      return { items: await loadPipelines(tx) };
    });
  }

  createPipeline(body: Out<typeof CreateSalesPipelineRequest>): Promise<SalesPipeline> {
    return this.run(async (tx) => {
      await this.uniqueName(tx, body.name);
      const layout = body.template === 'BASIC' ? BASIC : await this.shippedLayout(tx);
      const pipeline = await tx.salesPipeline.create({
        // The id is a key of the pipeline's own return-stage relation: Prisma makes none for it.
        data: { id: uuidv7(), name: body.name, description: orNull(body.description) },
        select: { id: true },
      });
      const stages: { id: string; type: SalesStageType }[] = [];
      for (const [position, [name, type, required]] of layout.entries()) {
        const s = await tx.salesPipelineStage.create({
          data: {
            pipelineId: pipeline.id,
            name,
            stageType: type,
            position,
            requiredFields: required,
          },
          select: { id: true },
        });
        stages.push({ id: s.id, type });
      }
      const back = stages.find((s) => s.type === 'CONVERTED');
      if (back)
        await tx.salesPipeline.update({
          where: { id: pipeline.id },
          data: { terminatedReturnStageId: back.id },
        });
      await this.log(tx, 'sales_pipeline.created', pipeline.id, {
        template: body.template,
        stages: stages.length,
      });
      return this.one(tx, pipeline.id);
    });
  }

  /**
   * Save Pipeline: every check first (the codes the screen shows), then the stages (temporary
   * names first, so a swap of two names never meets the unique index), the moves out of removed
   * stages (the database writes their history), the pipeline, and last the removals.
   */
  savePipeline(id: string, body: Out<typeof SaveSalesPipelineRequest>): Promise<SalesPipeline> {
    return this.run(async (tx, ctx) => {
      const current = await tx.salesPipeline.findUnique({ where: { id } });
      if (!current) throw notFound('Pipeline');
      const [before] = await loadPipelines(tx, { id });
      if (!before || Date.parse(before.updatedAt) !== Date.parse(body.expectedUpdatedAt))
        throw refuse('CONFLICT');
      if (body.name.toLowerCase() !== current.name.toLowerCase())
        await this.uniqueName(tx, body.name, id);
      const rows = (
        await tx.salesPipelineStage.findMany({ where: { pipelineId: id }, select: stageSelect })
      ).sort(stageOrder);
      const byId = new Map(rows.map((s) => [s.id, s]));
      const records = new Map(before.stages.map((s) => [s.id, s.records]));
      for (const draft of body.stages) {
        if (draft.id && !byId.has(draft.id)) throw invalid('A stage is not in this pipeline.');
        if (draft.requires.includes('LOST_NOTE') && draft.type !== 'LOST')
          throw invalid('Only a lost stage can need a lost note.');
        if (draft.onEnter.some((a) => !SALES_STAGE_ACTIONS_AVAILABLE.includes(a)))
          throw refuse('NOT_SUPPORTED_YET', 'That stage action cannot run yet.');
        const was = draft.id ? byId.get(draft.id) : undefined;
        if (was && was.stageType !== draft.type) {
          if (was.systemKey) throw refuse('SHIPPED_STAGE');
          if ((records.get(was.id) ?? 0) > 0) throw refuse('STAGE_HAS_RECORDS');
        }
      }
      const kept = new Set(body.stages.flatMap((s) => (s.id ? [s.id] : [])));
      const removed = rows.filter((s) => !kept.has(s.id));
      const moveTo = new Map(body.removed.map((r) => [r.id, r.moveTo]));
      const finalType = new Map(body.stages.flatMap((s) => (s.id ? [[s.id, s] as const] : [])));
      for (const s of removed) {
        if (s.systemKey) throw refuse('SHIPPED_STAGE');
        if ((records.get(s.id) ?? 0) > 0 && !moveTo.get(s.id)) throw refuse('STAGE_HAS_RECORDS');
      }
      const returnId =
        body.terminatedReturnStageId === undefined
          ? current.terminatedReturnStageId
          : body.terminatedReturnStageId;
      if (returnId) {
        const back = finalType.get(returnId);
        if (!back?.active || (back.type !== 'ACTIVE' && back.type !== 'CONVERTED'))
          throw refuse('RETURN_STAGE_INVALID');
      }
      const linked = await tx.salesOpportunity.count({
        where: { pipelineId: id, transactionStatus: { not: null } },
      });
      if (
        linked > 0 &&
        !(['TRANSACTION_SYNCED', 'CLOSED'] as const).every((type) =>
          body.stages.some((s) => s.active && s.type === type),
        )
      )
        throw refuse('SYNC_STAGE_REQUIRED');
      // The records of each removed stage must be able to enter the stage they move to.
      const moving = removed.filter((s) => (records.get(s.id) ?? 0) > 0);
      for (const s of moving) {
        const to = finalType.get(moveTo.get(s.id)!);
        const toRow = byId.get(moveTo.get(s.id)!);
        if (!to || !toRow) throw refuse('STAGE_HAS_RECORDS');
        const target = {
          ...entryStage(toRow),
          type: to.type,
          active: to.active,
          requires: to.requires,
        };
        const people = await tx.salesOpportunity.findMany({
          where: { stageId: s.id },
          select: opportunitySelect,
        });
        for (const row of people) {
          const problem = builderMoveProblem(target, row, ctx);
          if (problem) throw refuse(problem, `${row.title}: ${messageOf(problem)}`);
        }
      }

      // Stages: temporary names, then the layout.
      for (const s of rows.filter((r) => kept.has(r.id)))
        await tx.salesPipelineStage.update({
          where: { id: s.id },
          data: { name: `~${randomUUID().slice(0, 12)}` },
        });
      for (const [position, draft] of body.stages.entries()) {
        const data = {
          name: draft.name,
          stageType: draft.type,
          position,
          isActive: draft.active,
          requiredFields: draft.requires.map((r) => SALES_STAGE_REQUIREMENT_KEYS[r]),
          onEnterActions: draft.onEnter.map((a) => SALES_STAGE_ACTION_KEYS[a]),
        };
        if (draft.id) {
          const was = byId.get(draft.id)!;
          await tx.salesPipelineStage.update({
            where: { id: draft.id },
            data: was.stageType === draft.type ? { ...data, stageType: undefined } : data,
          });
        } else await tx.salesPipelineStage.create({ data: { ...data, pipelineId: id } });
      }
      let moved = 0;
      for (const s of moving) {
        const result = await tx.salesOpportunity.updateMany({
          where: { stageId: s.id },
          data: { stageId: moveTo.get(s.id)! },
        });
        moved += result.count;
      }
      await tx.salesPipeline.update({
        where: { id },
        data: {
          name: body.name,
          description: orNull(body.description),
          terminatedReturnStageId: returnId,
        },
      });
      if (removed.length)
        await tx.salesPipelineStage.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
      await this.log(tx, 'sales_pipeline.saved', id, {
        stages: body.stages.length,
        added: body.stages.filter((s) => !s.id).length,
        removed: removed.map((s) => s.id),
        recordsMoved: moved,
        terminatedReturnStageId: returnId,
      });
      return this.one(tx, id);
    }, 'STAGE_HAS_RECORDS');
  }

  // ---------- Tags ----------

  saveTag(id: string | null, body: Out<typeof SaveSalesTagRequest>): Promise<SalesTag> {
    return this.run(async (tx) => {
      const same = await tx.salesTag.findFirst({
        where: {
          name: { equals: body.name, mode: 'insensitive' },
          ...(id ? { id: { not: id } } : {}),
        },
        select: { id: true },
      });
      if (same) throw refuse('DUPLICATE_NAME');
      if (id && !(await tx.salesTag.findUnique({ where: { id }, select: { id: true } })))
        throw notFound('Tag');
      const tag = id
        ? await tx.salesTag.update({ where: { id }, data: body })
        : await tx.salesTag.create({ data: body });
      await this.audit.logIn(
        tx,
        id ? 'sales_tag.updated' : 'sales_tag.created',
        { type: 'sales_tag', id: tag.id },
        { colorKey: tag.colorKey },
        { businessId: null },
      );
      return tagView(tag);
    });
  }

  deleteTag(id: string): Promise<SalesOk> {
    return this.run(async (tx) => {
      const tag = await tx.salesTag.findUnique({ where: { id } });
      if (!tag) throw notFound('Tag');
      const records = await tx.salesOpportunityTag.count({ where: { tagId: id } });
      await tx.salesTag.delete({ where: { id } });
      await this.audit.logIn(
        tx,
        'sales_tag.deleted',
        { type: 'sales_tag', id },
        { records },
        { businessId: null },
      );
      return { ok: true as const };
    });
  }

  // ---------- Attention settings ----------

  attention(): Promise<SalesAttentionSettings> {
    return this.admin.transaction(
      async (tx) => (await loadContext(tx, this.admin.adminUserId)).rules,
    );
  }

  saveAttention(
    body: Out<typeof SaveSalesAttentionSettingsRequest>,
  ): Promise<SalesAttentionSettings> {
    return this.run(async (tx) => {
      await tx.salesAttentionSettings.update({ where: { id: 1 }, data: body });
      await this.audit.logIn(
        tx,
        'sales_attention_settings.updated',
        { type: 'sales_attention_settings' },
        { ...body },
        { businessId: null },
      );
      return (await loadContext(tx, this.admin.adminUserId)).rules;
    });
  }

  // ---------- Helpers ----------

  private async run<T>(
    work: (tx: TxClient, ctx: SalesContext) => Promise<T>,
    foreignKey?: 'STAGE_HAS_RECORDS',
  ): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asSalesError(error, { foreignKey });
    }
  }

  private log(tx: TxClient, action: string, id: string, metadata: Record<string, unknown>) {
    return this.audit.logIn(tx, action, { type: 'sales_pipeline', id }, metadata, {
      businessId: null,
    });
  }

  private async one(tx: TxClient, id: string): Promise<SalesPipeline> {
    const [pipeline] = await loadPipelines(tx, { id });
    if (!pipeline) throw notFound('Pipeline');
    return pipeline;
  }

  /** 409 DUPLICATE_NAME when another pipeline has the name (ignoring case). */
  private async uniqueName(tx: TxClient, name: string, except?: string) {
    const where: Prisma.SalesPipelineWhereInput = {
      name: { equals: name, mode: 'insensitive' },
      ...(except ? { id: { not: except } } : {}),
    };
    if (await tx.salesPipeline.findFirst({ where, select: { id: true } }))
      throw refuse('DUPLICATE_NAME');
  }

  /** The shipped pipeline's stages (names, types, required fields), or the migration's ten. */
  private async shippedLayout(tx: TxClient) {
    const shipped = await tx.salesPipeline.findFirst({
      where: { systemKey: SALES_DEFAULT_PIPELINE_KEY },
      include: { stages: { select: stageSelect } },
    });
    const stages = shipped ? [...shipped.stages].sort(stageOrder) : [];
    if (!stages.length) return SHIPPED;
    return stages.map((s) => [s.name, s.stageType, s.requiredFields] as const);
  }
}

const tagView = (t: { id: string; name: string; colorKey: string | null }): SalesTag => ({
  id: t.id,
  name: t.name,
  colorKey: t.colorKey,
});

const messageOf = (code: Parameters<typeof refuse>[0]) =>
  (refuse(code).getResponse() as { message: string }).message;

/**
 * Whether a record of a removed stage may enter the stage it moves to: a move's rules, except
 * that a record under contract or closed may move to another stage of its transaction's type, and
 * a lost record keeps its reason.
 */
export function builderMoveProblem(
  target: { type: SalesStageType; active: boolean; requires: ReturnType<typeof requirementsOf> },
  row: {
    valueCents: number | null;
    assignedToUserId: string | null;
    planId: string | null;
    transactionId: string | null;
    transactionStatus: 'OPEN' | 'UNDER_CONTRACT' | 'CLOSED' | 'TERMINATED' | null;
    lostReason: Parameters<typeof entryProblem>[1]['lostReason'];
    lostNote: string | null;
  },
  ctx: Pick<SalesContext, 'rules'>,
) {
  const values = {
    valueCents: row.valueCents,
    ownerId: row.assignedToUserId,
    planId: row.planId,
    transactionId: row.transactionId,
  };
  const follows =
    (row.transactionStatus === 'UNDER_CONTRACT' && target.type === 'TRANSACTION_SYNCED') ||
    (row.transactionStatus === 'CLOSED' && target.type === 'CLOSED');
  if (follows) {
    if (!target.active) return 'STAGE_INACTIVE' as const;
    return entryProblem(
      { ...target, type: 'ACTIVE' },
      { ...values, transactionStatus: null, lostReason: null, lostNote: null },
      false,
    );
  }
  const lost = target.type === 'LOST';
  return entryProblem(
    target,
    {
      ...values,
      transactionStatus: row.transactionStatus,
      lostReason: lost ? row.lostReason : null,
      lostNote: lost ? row.lostNote : null,
    },
    ctx.rules.lostOtherNoteRequired,
  );
}

export type { StageRow };
