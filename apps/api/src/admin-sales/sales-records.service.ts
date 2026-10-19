import { Injectable } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type AssignSalesOpportunityRequest,
  type CreateSalesFollowUpRequest,
  type CreateSalesOpportunityRequest,
  type LinkSalesTransactionRequest,
  type LogSalesActivityRequest,
  type MoveSalesStageRequest,
  SALES_APPOINTMENT_KINDS,
  SALES_APPOINTMENT_SET_KEY,
  SALES_LEAD_SOURCE_LABELS,
  type SalesAttentionFlag,
  type SalesBulkRequest,
  type SalesBulkResult,
  type SalesDuplicateCheckRequest,
  type SalesDuplicateList,
  type SalesDuplicateMatch,
  type SalesFollowUp,
  type SalesLostReason,
  type SalesNote,
  type SalesOk,
  type SalesOpportunitiesQuery,
  type SalesOpportunity,
  type SalesOpportunityPage,
  type SalesOpportunityRecord,
  type SalesPipelineSummary,
  type SalesSubscriptionList,
  type SalesSubscriptionsQuery,
  type SalesSummaryQuery,
  type SaveSalesNoteRequest,
  type UpdateSalesFollowUpRequest,
  type UpdateSalesOpportunityRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  activeRep,
  asSalesError,
  type Built,
  buildViews,
  defaultPipelineId,
  entryStage,
  followUpSelect,
  followUpView,
  invalid,
  loadContext,
  notFound,
  opportunitySelect,
  orNull,
  refuse,
  type SalesContext,
  stageSelect,
  stageOrder,
  stagesOf,
  stageView,
  type StageRow,
  SUBSCRIPTION_KIND,
  viewOf,
} from './sales-common.js';
import { feedOf } from './sales-feed.js';
import {
  change,
  conversionOf,
  DAY_MS,
  entryProblem,
  OPEN_TYPES,
  phoneKeys,
  transactionStatusOf,
  utcDay,
} from './sales-math.js';

type Out<S extends z.ZodType> = z.output<S>;
type Filters = Out<typeof SalesSummaryQuery>;

/** The most recent records a list, the KPIs or a bulk action works over. */
export const CAP = 5000;
/** An activity's time may run this far ahead of the server's clock (the database's leeway). */
const FUTURE_LEEWAY_MS = 5 * 60_000;
const digits = (value: string) => value.replace(/\D/g, '');

/**
 * Super Admin Sales records (R60 on R0's B5): the board and list with their KPIs, the record
 * page, Add Lead with the duplicate check, edits, stage moves, owners, bulk actions, the linked
 * transaction, outreach, notes and follow-ups, in the Super Admin's admin scope. The database
 * writes the stage and owner history; each change writes a platform audit row (ids and codes,
 * never text).
 */
@Injectable()
export class SalesRecordsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  // ---------- Reads ----------

  list(query: Out<typeof SalesOpportunitiesQuery>): Promise<SalesOpportunityPage> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const rows = sortViews(
        (await this.filtered(tx, ctx, query)).map((b) => b.view),
        query.sort,
        query.dir,
      );
      const pageSize = query.pageSize ?? 100;
      const pages = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(query.page ?? 1, pages);
      return {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      };
    });
  }

  summary(query: Filters): Promise<SalesPipelineSummary> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const pipelineId = query.pipelineId ?? (await defaultPipelineId(tx));
      const all = (await this.filtered(tx, ctx, { ...query, pipelineId })).map((b) => b.view);
      return summaryOf(all, pipelineId, query, ctx.now);
    });
  }

  detail(id: string): Promise<SalesOpportunityRecord> {
    return this.admin.transaction(async (tx) => {
      const ctx = await loadContext(tx, this.admin.adminUserId);
      const built = await viewOf(tx, ctx, id);
      const [stages, counts, notes, followUps, activities, activity] = await Promise.all([
        tx.salesPipelineStage.findMany({
          where: { pipelineId: built.row.pipelineId },
          select: stageSelect,
        }),
        tx.salesOpportunity.groupBy({
          by: ['stageId'],
          where: { pipelineId: built.row.pipelineId },
          _count: { _all: true },
        }),
        tx.salesNote.findMany({
          where: { opportunityId: id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        tx.salesFollowUp.findMany({
          where: { opportunityId: id },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          select: followUpSelect,
        }),
        tx.salesActivity.findMany({
          where: { opportunityId: id },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        }),
        feedOf(tx, ctx, { opportunityId: id, limit: 500 }),
      ]);
      const pipeline = await tx.salesPipeline.findUniqueOrThrow({
        where: { id: built.row.pipelineId },
        select: { id: true, name: true },
      });
      const count = new Map(counts.map((c) => [c.stageId, c._count._all]));
      return {
        opportunity: built.view,
        pipeline: {
          ...pipeline,
          stages: [...stages].sort(stageOrder).map((s) => stageView(s, count.get(s.id) ?? 0)),
        },
        notes: notes.map((n) => noteView(ctx, n)),
        followUps: followUps.map((f) => followUpView(ctx, f)),
        communications: activities.map((a) => ({
          id: a.id,
          kind: a.kind,
          direction: a.direction,
          outcome: a.outcome,
          occurredAt: a.occurredAt.toISOString(),
          summary: a.summary,
          by: ctx.nameOf(a.actorUserId),
          followUpId: a.followUpId,
        })),
        activity,
      };
    });
  }

  duplicates(body: Out<typeof SalesDuplicateCheckRequest>): Promise<SalesDuplicateList> {
    return this.admin.transaction(async (tx) => ({ items: await findDuplicates(tx, body) }));
  }

  subscriptions(query: Out<typeof SalesSubscriptionsQuery>): Promise<SalesSubscriptionList> {
    return this.admin.transaction(async (tx) => {
      await loadContext(tx, this.admin.adminUserId);
      const search = query.search?.trim();
      const subs = await tx.platformFirmSubscription.findMany({
        where: search ? { business: { name: { contains: search, mode: 'insensitive' } } } : {},
        orderBy: [{ business: { name: 'asc' } }, { id: 'asc' }],
        take: 20,
        select: {
          id: true,
          status: true,
          business: { select: { id: true, name: true } },
          plan: { select: { id: true, name: true } },
        },
      });
      const linked = await tx.salesOpportunity.findMany({
        where: { transactionKind: SUBSCRIPTION_KIND, transactionId: { in: subs.map((s) => s.id) } },
        select: { id: true, transactionId: true },
      });
      const by = new Map(linked.map((o) => [o.transactionId, o.id]));
      return {
        items: subs.map((s) => ({
          id: s.id,
          firm: s.business,
          plan: s.plan,
          status: s.status,
          linkedOpportunityId: by.get(s.id) ?? null,
        })),
      };
    });
  }

  // ---------- Records ----------

  async create(body: Out<typeof CreateSalesOpportunityRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      // One record per form opening: the request id's lock, then the audit row it left.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${body.requestId}))) AS l`;
      const made = await tx.auditLog.findFirst({
        where: {
          businessId: null,
          action: 'sales_opportunity.created',
          metadata: { path: ['requestId'], equals: body.requestId },
        },
        select: { entityId: true },
      });
      if (made?.entityId) return (await viewOf(tx, ctx, made.entityId)).view;
      const pipelineId = body.pipelineId ?? (await defaultPipelineId(tx));
      const pipeline = await tx.salesPipeline.findUnique({ where: { id: pipelineId } });
      if (!pipeline?.isActive) throw refuse('INACTIVE_CHOICE', 'Choose an active pipeline.');
      const stages = (await stagesOf(tx, [pipelineId])).get(pipelineId) ?? [];
      const stage = body.stageId
        ? stages.find((s) => s.id === body.stageId)
        : stages.find((s) => s.isActive && s.stageType !== 'TRANSACTION_SYNCED');
      if (!stage) throw refuse('INACTIVE_CHOICE', 'Choose a stage of this pipeline.');
      if (body.ownerId) activeRep(ctx, body.ownerId);
      if (body.planId) await activePlan(tx, body.planId);
      await knownTags(tx, body.tagIds);
      const problem = entryProblem(
        entryStage(stage),
        {
          valueCents: body.valueCents,
          ownerId: body.ownerId,
          planId: body.planId,
          transactionId: null,
          transactionStatus: null,
          lostReason: body.lostReason ?? null,
          lostNote: orNull(body.lostNote),
        },
        ctx.rules.lostOtherNoteRequired,
      );
      if (problem) throw refuse(problem);
      if (!body.allowDuplicate) {
        const matches = await findDuplicates(tx, {
          firmName: body.firmName,
          email: body.email,
          phone: body.phone,
        });
        if (matches.length) throw refuse('POSSIBLE_DUPLICATE');
      }
      const contact = await tx.salesContact.create({
        data: {
          name: body.contactName,
          email: body.email ?? null,
          phone: body.phone ?? null,
          companyName: body.firmName,
        },
        select: { id: true },
      });
      const lost = stage.stageType === 'LOST';
      const row = await tx.salesOpportunity.create({
        data: {
          pipelineId,
          stageId: stage.id,
          contactId: contact.id,
          title: body.firmName,
          companyName: body.firmName,
          source: body.source,
          planId: body.planId,
          valueCents: body.valueCents,
          assignedToUserId: body.ownerId,
          lostReason: lost ? (body.lostReason ?? null) : null,
          lostNote: lost ? orNull(body.lostNote) : null,
        },
        select: { id: true },
      });
      if (body.tagIds.length)
        await tx.salesOpportunityTag.createMany({
          data: body.tagIds.map((tagId) => ({ opportunityId: row.id, tagId })),
        });
      if (body.note)
        await tx.salesNote.create({
          data: { opportunityId: row.id, authorUserId: ctx.me.id, body: body.note },
        });
      await this.enter(tx, ctx, { id: row.id, ownerId: body.ownerId }, stage);
      await this.log(tx, 'sales_opportunity.created', row.id, {
        requestId: body.requestId,
        pipelineId,
        stageId: stage.id,
        contactId: contact.id,
        source: body.source,
        planId: body.planId,
        ownerId: body.ownerId,
        tagIds: body.tagIds,
        hasValue: body.valueCents !== null,
        duplicateAllowed: body.allowDuplicate,
      });
      return (await viewOf(tx, ctx, row.id)).view;
    });
  }

  update(id: string, body: Out<typeof UpdateSalesOpportunityRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      const { row } = await viewOf(tx, ctx, id);
      const changed: string[] = [];
      const data: Prisma.SalesOpportunityUncheckedUpdateInput = {};
      if (body.firmName !== undefined && body.firmName !== row.title) {
        data.title = body.firmName;
        data.companyName = body.firmName;
        changed.push('firmName');
      }
      if (body.valueCents !== undefined && body.valueCents !== row.valueCents) {
        data.valueCents = body.valueCents;
        changed.push('valueCents');
      }
      if (body.planId !== undefined && body.planId !== row.planId) {
        if (body.planId) await activePlan(tx, body.planId);
        data.planId = body.planId;
        changed.push('planId');
      }
      if (body.source !== undefined && body.source !== row.source) {
        data.source = body.source;
        changed.push('source');
      }
      const contact: Prisma.SalesContactUpdateInput = {};
      if (body.contactName !== undefined && body.contactName !== row.contact.name)
        contact.name = body.contactName;
      if (body.email !== undefined && body.email !== row.contact.email) contact.email = body.email;
      if (body.phone !== undefined && body.phone !== row.contact.phone) contact.phone = body.phone;
      changed.push(...Object.keys(contact).map((k) => (k === 'name' ? 'contactName' : k)));
      let added: string[] = [];
      let removed: string[] = [];
      if (body.tagIds !== undefined) {
        await knownTags(tx, body.tagIds);
        const now = new Set(row.tags.map((t) => t.tag.id));
        added = body.tagIds.filter((t) => !now.has(t));
        removed = [...now].filter((t) => !body.tagIds!.includes(t));
        if (added.length)
          await tx.salesOpportunityTag.createMany({
            data: added.map((tagId) => ({ opportunityId: id, tagId })),
          });
        if (removed.length)
          await tx.salesOpportunityTag.deleteMany({
            where: { opportunityId: id, tagId: { in: removed } },
          });
        if (added.length || removed.length) changed.push('tagIds');
      }
      if (Object.keys(data).length)
        await tx.salesOpportunity.update({ where: { id }, data, select: { id: true } });
      if (Object.keys(contact).length)
        await tx.salesContact.update({ where: { id: row.contactId }, data: contact });
      if (changed.length)
        await this.log(tx, 'sales_opportunity.updated', id, {
          fields: changed,
          ...(data.source ? { source: data.source } : {}),
          ...('planId' in data ? { planId: data.planId } : {}),
          ...(added.length ? { tagsAdded: added } : {}),
          ...(removed.length ? { tagsRemoved: removed } : {}),
        });
      return (await viewOf(tx, ctx, id)).view;
    });
  }

  move(id: string, body: Out<typeof MoveSalesStageRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      const built = await viewOf(tx, ctx, id);
      const target = await tx.salesPipelineStage.findUnique({
        where: { id: body.stageId },
        select: stageSelect,
      });
      if (!target || target.pipelineId !== built.row.pipelineId)
        throw refuse('INACTIVE_CHOICE', 'Choose a stage of this pipeline.');
      if (target.id === built.row.stageId) return built.view;
      if (body.ownerId !== undefined) activeRep(ctx, body.ownerId);
      if (body.planId !== undefined) await activePlan(tx, body.planId);
      await this.moveTo(tx, ctx, built, target, {
        valueCents: body.valueCents,
        ownerId: body.ownerId,
        planId: body.planId,
        lostReason: body.lostReason,
        lostNote: body.lostNote,
      });
      return (await viewOf(tx, ctx, id)).view;
    });
  }

  assign(id: string, body: Out<typeof AssignSalesOpportunityRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      const { row } = await viewOf(tx, ctx, id);
      if (body.ownerId) activeRep(ctx, body.ownerId);
      if (row.assignedToUserId !== body.ownerId) {
        await tx.salesOpportunity.update({
          where: { id },
          data: { assignedToUserId: body.ownerId },
          select: { id: true },
        });
        await this.log(tx, 'sales_opportunity.assigned', id, {
          fromUserId: row.assignedToUserId,
          toUserId: body.ownerId,
        });
      }
      return (await viewOf(tx, ctx, id)).view;
    });
  }

  bulk(body: Out<typeof SalesBulkRequest>): Promise<SalesBulkResult> {
    return this.run(async (tx, ctx) => {
      const rows = await tx.salesOpportunity.findMany({
        where: { id: { in: body.ids } },
        select: opportunitySelect,
      });
      if (rows.length !== body.ids.length) throw notFound();
      const action = body.action;
      let updated = 0;
      if (action.type === 'ASSIGN') {
        if (action.ownerId) activeRep(ctx, action.ownerId);
        for (const row of rows) {
          if (row.assignedToUserId === action.ownerId) continue;
          await tx.salesOpportunity.update({
            where: { id: row.id },
            data: { assignedToUserId: action.ownerId },
            select: { id: true },
          });
          await this.log(tx, 'sales_opportunity.assigned', row.id, {
            fromUserId: row.assignedToUserId,
            toUserId: action.ownerId,
            bulk: true,
          });
          updated += 1;
        }
      } else if (action.type === 'STAGE') {
        const target = await tx.salesPipelineStage.findUnique({
          where: { id: action.stageId },
          select: stageSelect,
        });
        if (!target || rows.some((r) => r.pipelineId !== target.pipelineId))
          throw refuse('INACTIVE_CHOICE', 'Choose a stage of the records’ pipeline.');
        const built = await buildViews(tx, ctx, rows);
        for (const b of built) {
          if (b.row.stageId === target.id) continue;
          await this.moveTo(
            tx,
            ctx,
            b,
            target,
            { lostReason: action.lostReason, lostNote: action.lostNote },
            true,
          );
          updated += 1;
        }
      } else {
        const tag = await tx.salesTag.findUnique({ where: { id: action.tagId } });
        if (!tag) throw notFound('Tag');
        if (action.type === 'ADD_TAG') {
          const has = new Set(
            rows.filter((r) => r.tags.some((t) => t.tag.id === tag.id)).map((r) => r.id),
          );
          const add = rows.filter((r) => !has.has(r.id));
          if (add.length)
            await tx.salesOpportunityTag.createMany({
              data: add.map((r) => ({ opportunityId: r.id, tagId: tag.id })),
            });
          for (const r of add)
            await this.log(tx, 'sales_opportunity.updated', r.id, {
              fields: ['tagIds'],
              tagsAdded: [tag.id],
              bulk: true,
            });
          updated = add.length;
        } else {
          const drop = rows.filter((r) => r.tags.some((t) => t.tag.id === tag.id));
          if (drop.length)
            await tx.salesOpportunityTag.deleteMany({
              where: { tagId: tag.id, opportunityId: { in: drop.map((r) => r.id) } },
            });
          for (const r of drop)
            await this.log(tx, 'sales_opportunity.updated', r.id, {
              fields: ['tagIds'],
              tagsRemoved: [tag.id],
              bulk: true,
            });
          updated = drop.length;
        }
      }
      return { updated, unchanged: rows.length - updated };
    });
  }

  link(id: string, body: Out<typeof LinkSalesTransactionRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      const { row } = await viewOf(tx, ctx, id);
      if (body.subscriptionId === null) {
        if (!row.transactionId) return (await viewOf(tx, ctx, id)).view;
        if (row.transactionStatus === 'UNDER_CONTRACT') throw refuse('UNLINK_UNDER_CONTRACT');
        await tx.salesOpportunity.update({
          where: { id },
          data: { transactionKind: null, transactionId: null, transactionStatus: null },
          select: { id: true },
        });
        await this.log(tx, 'sales_opportunity.transaction_unlinked', id, {
          kind: row.transactionKind,
          transactionId: row.transactionId,
        });
        return (await viewOf(tx, ctx, id)).view;
      }
      const sub = await tx.platformFirmSubscription.findUnique({
        where: { id: body.subscriptionId },
        select: { id: true, businessId: true, status: true },
      });
      if (!sub) throw notFound('Subscription');
      if (row.transactionKind === SUBSCRIPTION_KIND && row.transactionId === sub.id)
        return (await viewOf(tx, ctx, id)).view;
      if (row.transactionStatus === 'UNDER_CONTRACT') throw refuse('UNLINK_UNDER_CONTRACT');
      const other = await tx.salesOpportunity.findFirst({
        where: { transactionKind: SUBSCRIPTION_KIND, transactionId: sub.id, id: { not: id } },
        select: { id: true },
      });
      if (other) throw refuse('TRANSACTION_IN_USE');
      if (row.linkedBusinessId && row.linkedBusinessId !== sub.businessId)
        throw refuse('FIRM_MISMATCH');
      const stages = (await stagesOf(tx, [row.pipelineId])).get(row.pipelineId) ?? [];
      const synced = stages.find((s) => s.isActive && s.stageType === 'TRANSACTION_SYNCED');
      const closed = stages.find((s) => s.isActive && s.stageType === 'CLOSED');
      if (!synced || !closed) throw refuse('SYNC_STAGE_REQUIRED');
      await tx.salesOpportunity.update({
        where: { id },
        data: {
          transactionKind: SUBSCRIPTION_KIND,
          transactionId: sub.id,
          transactionStatus: 'OPEN',
          linkedBusinessId: sub.businessId,
        },
        select: { id: true },
      });
      // A subscription already active or ended is reported at once (B5's mapping); the record
      // then follows it into Under Contract or Closed, which must accept it.
      const status = transactionStatusOf(sub.status);
      if (status === 'UNDER_CONTRACT' || status === 'CLOSED') {
        const to = status === 'UNDER_CONTRACT' ? synced : closed;
        const problem = requirementProblem(to, { ...row, transactionId: sub.id });
        if (problem) throw refuse(problem);
      }
      if (status !== 'OPEN')
        await tx.salesOpportunity.update({
          where: { id },
          data: { transactionStatus: status },
          select: { id: true },
        });
      await this.log(tx, 'sales_opportunity.transaction_linked', id, {
        kind: SUBSCRIPTION_KIND,
        transactionId: sub.id,
        status,
        businessId: sub.businessId,
      });
      return (await viewOf(tx, ctx, id)).view;
    });
  }

  logActivity(id: string, body: Out<typeof LogSalesActivityRequest>): Promise<SalesOpportunity> {
    return this.run(async (tx, ctx) => {
      await viewOf(tx, ctx, id);
      const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date(ctx.now);
      if (occurredAt.getTime() > Date.now() + FUTURE_LEEWAY_MS) throw refuse('IN_THE_FUTURE');
      if (body.followUpId) {
        const followUp = await tx.salesFollowUp.findFirst({
          where: { id: body.followUpId, opportunityId: id },
          select: { id: true },
        });
        if (!followUp) throw notFound('Follow-up');
      }
      const row = await tx.salesActivity.create({
        data: {
          opportunityId: id,
          kind: body.kind,
          direction: body.direction,
          outcome: body.outcome,
          occurredAt,
          summary: orNull(body.summary),
          followUpId: body.followUpId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'sales_activity.logged',
        { type: 'sales_activity', id: row.id },
        { opportunityId: id, kind: body.kind, direction: body.direction, outcome: body.outcome },
        { businessId: null },
      );
      return (await viewOf(tx, ctx, id)).view;
    });
  }

  // ---------- Notes ----------

  addNote(id: string, body: Out<typeof SaveSalesNoteRequest>): Promise<SalesNote> {
    return this.run(async (tx, ctx) => {
      await viewOf(tx, ctx, id);
      const note = await tx.salesNote.create({
        data: { opportunityId: id, authorUserId: ctx.me.id, body: body.body },
      });
      await this.noteLog(tx, 'sales_note.added', note);
      return noteView(ctx, note);
    });
  }

  updateNote(noteId: string, body: Out<typeof SaveSalesNoteRequest>): Promise<SalesNote> {
    return this.run(async (tx, ctx) => {
      const note = await this.mine(tx, ctx, noteId);
      if (note.body === body.body) return noteView(ctx, note);
      const saved = await tx.salesNote.update({ where: { id: noteId }, data: { body: body.body } });
      await this.noteLog(tx, 'sales_note.updated', saved);
      return noteView(ctx, saved);
    });
  }

  deleteNote(noteId: string): Promise<SalesOk> {
    return this.run(async (tx, ctx) => {
      const note = await this.mine(tx, ctx, noteId);
      await tx.salesNote.delete({ where: { id: noteId } });
      await this.noteLog(tx, 'sales_note.deleted', note);
      return { ok: true as const };
    });
  }

  // ---------- Follow-ups ----------

  addFollowUp(id: string, body: Out<typeof CreateSalesFollowUpRequest>): Promise<SalesFollowUp> {
    return this.run(async (tx, ctx) => {
      const built = await viewOf(tx, ctx, id);
      const assignee = body.assigneeId === undefined ? built.row.assignedToUserId : body.assigneeId;
      if (body.assigneeId) activeRep(ctx, body.assigneeId);
      const row = await tx.salesFollowUp.create({
        data: {
          opportunityId: id,
          kind: body.kind,
          title: body.title,
          dueAt: new Date(body.dueAt),
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          location: orNull(body.location),
          assignedToUserId: assignee,
        },
        select: { id: true },
      });
      const moved = await this.appointmentSet(tx, ctx, built, body.kind);
      await this.audit.logIn(
        tx,
        'sales_follow_up.scheduled',
        { type: 'sales_follow_up', id: row.id },
        { opportunityId: id, kind: body.kind, assigneeId: assignee, movedToStageId: moved },
        { businessId: null },
      );
      return followUpView(
        ctx,
        await tx.salesFollowUp.findUniqueOrThrow({ where: { id: row.id }, select: followUpSelect }),
      );
    });
  }

  updateFollowUp(id: string, body: Out<typeof UpdateSalesFollowUpRequest>): Promise<SalesFollowUp> {
    return this.run(async (tx, ctx) => {
      const row = await this.scheduled(tx, id);
      const dueAt = body.dueAt ? new Date(body.dueAt) : row.dueAt;
      const endsAt =
        body.endsAt === undefined
          ? row.endsAt
          : body.endsAt === null
            ? null
            : new Date(body.endsAt);
      if (endsAt && endsAt.getTime() <= dueAt.getTime()) throw invalid('End it after it starts.');
      if (body.assigneeId) activeRep(ctx, body.assigneeId);
      const data: Prisma.SalesFollowUpUncheckedUpdateInput = {
        ...(body.kind ? { kind: body.kind } : {}),
        ...(body.title ? { title: body.title } : {}),
        ...(body.dueAt ? { dueAt } : {}),
        ...(body.endsAt !== undefined ? { endsAt } : {}),
        ...(body.location !== undefined ? { location: orNull(body.location) } : {}),
        ...(body.assigneeId !== undefined ? { assignedToUserId: body.assigneeId } : {}),
      };
      const saved = await tx.salesFollowUp.update({ where: { id }, data, select: followUpSelect });
      await this.audit.logIn(
        tx,
        'sales_follow_up.updated',
        { type: 'sales_follow_up', id },
        { opportunityId: row.opportunityId, fields: Object.keys(data) },
        { businessId: null },
      );
      return followUpView(ctx, saved);
    });
  }

  end(id: string, status: 'COMPLETED' | 'CANCELLED'): Promise<SalesFollowUp> {
    return this.run(async (tx, ctx) => {
      const row = await this.scheduled(tx, id);
      const saved = await tx.salesFollowUp.update({
        where: { id },
        data: { status },
        select: followUpSelect,
      });
      await this.audit.logIn(
        tx,
        status === 'COMPLETED' ? 'sales_follow_up.completed' : 'sales_follow_up.cancelled',
        { type: 'sales_follow_up', id },
        { opportunityId: row.opportunityId, kind: row.kind },
        { businessId: null },
      );
      return followUpView(ctx, saved);
    });
  }

  // ---------- Helpers ----------

  /** One change in admin scope, with the database's refusals as contract errors. */
  private async run<T>(work: (tx: TxClient, ctx: SalesContext) => Promise<T>): Promise<T> {
    try {
      return await this.admin.transaction(async (tx) =>
        work(tx, await loadContext(tx, this.admin.adminUserId)),
      );
    } catch (error) {
      throw asSalesError(error);
    }
  }

  private log(tx: TxClient, action: string, id: string, metadata: Record<string, unknown>) {
    return this.audit.logIn(tx, action, { type: 'sales_opportunity', id }, metadata, {
      businessId: null,
    });
  }

  private noteLog(tx: TxClient, action: string, note: { id: string; opportunityId: string }) {
    return this.audit.logIn(
      tx,
      action,
      { type: 'sales_note', id: note.id },
      { opportunityId: note.opportunityId },
      { businessId: null },
    );
  }

  /** The note, if the signed-in member wrote it (403 NOT_AUTHOR otherwise). */
  private async mine(tx: TxClient, ctx: SalesContext, noteId: string) {
    const note = await tx.salesNote.findUnique({ where: { id: noteId } });
    if (!note) throw notFound('Note');
    if (note.authorUserId !== ctx.me.id) throw refuse('NOT_AUTHOR');
    return note;
  }

  /** A scheduled follow-up (409 FOLLOW_UP_CLOSED once completed or cancelled). */
  private async scheduled(tx: TxClient, id: string) {
    const row = await tx.salesFollowUp.findUnique({ where: { id } });
    if (!row) throw notFound('Follow-up');
    if (row.status !== 'SCHEDULED') throw refuse('FOLLOW_UP_CLOSED');
    return row;
  }

  /** The records the filters select, in the pipeline (the default one unless given). */
  private async filtered(tx: TxClient, ctx: SalesContext, query: Filters): Promise<Built[]> {
    const pipelineId = query.pipelineId ?? (await defaultPipelineId(tx));
    const where: Prisma.SalesOpportunityWhereInput = {
      pipelineId,
      ...(query.stageIds?.length ? { stageId: { in: query.stageIds } } : {}),
      ...(query.ownerId ? { assignedToUserId: query.ownerId } : {}),
      ...(query.unassigned ? { assignedToUserId: null } : {}),
      ...(query.planId ? { planId: query.planId } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      ...(query.to ? { createdAt: { lt: new Date(utcDay(query.to) + DAY_MS) } } : {}),
    };
    const rows = await tx.salesOpportunity.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: CAP,
      select: opportunitySelect,
    });
    const search = query.search?.trim().toLowerCase() ?? '';
    const searchDigits = digits(search);
    const from = query.from ? utcDay(query.from) : null;
    return (await buildViews(tx, ctx, rows)).filter(({ row, view }) => {
      if (from !== null && (view.stageType === 'CLOSED' || view.stageType === 'LOST'))
        if (row.stageEnteredAt.getTime() < from) return false;
      if (query.overdue && !view.attention.includes('OVERDUE')) return false;
      if (query.attention && view.attention.length === 0) return false;
      if (query.set && !inSet(view, query.set)) return false;
      if (search) {
        const text = [view.firmName, row.companyName ?? '', view.contactName, view.email ?? '']
          .join(' ')
          .toLowerCase();
        const phoneHit =
          searchDigits.length >= 3 && digits(view.phone ?? '').includes(searchDigits);
        if (!text.includes(search) && !phoneHit) return false;
      }
      return true;
    });
  }

  /**
   * Moves one record by hand: the stage's rules first (contract codes, before the database would
   * refuse), then the move (the database writes the history and stamps the times), then the
   * stage's actions.
   */
  private async moveTo(
    tx: TxClient,
    ctx: SalesContext,
    built: Built,
    target: StageRow,
    extra: {
      valueCents?: number | undefined;
      ownerId?: string | undefined;
      planId?: string | undefined;
      lostReason?: SalesLostReason | undefined;
      lostNote?: string | undefined;
    },
    bulk = false,
  ): Promise<void> {
    const { row } = built;
    const ownerId = extra.ownerId ?? row.assignedToUserId;
    const problem = entryProblem(
      entryStage(target),
      {
        valueCents: extra.valueCents ?? row.valueCents,
        ownerId,
        planId: extra.planId ?? row.planId,
        transactionId: row.transactionId,
        transactionStatus: row.transactionStatus,
        lostReason: extra.lostReason ?? null,
        lostNote: orNull(extra.lostNote),
      },
      ctx.rules.lostOtherNoteRequired,
    );
    if (problem)
      throw refuse(problem, bulk ? `${row.title}: ${refuseMessage(problem)}` : undefined);
    const lost = target.stageType === 'LOST';
    await tx.salesOpportunity.update({
      where: { id: row.id },
      data: {
        stageId: target.id,
        ...(extra.valueCents !== undefined ? { valueCents: extra.valueCents } : {}),
        ...(extra.ownerId !== undefined ? { assignedToUserId: extra.ownerId } : {}),
        ...(extra.planId !== undefined ? { planId: extra.planId } : {}),
        ...(lost ? { lostReason: extra.lostReason ?? null, lostNote: orNull(extra.lostNote) } : {}),
      },
      select: { id: true },
    });
    await this.enter(tx, ctx, { id: row.id, ownerId }, target);
    await this.log(tx, 'sales_opportunity.stage_changed', row.id, {
      fromStageId: row.stageId,
      toStageId: target.id,
      toStageType: target.stageType,
      ...(lost ? { lostReason: extra.lostReason } : {}),
      ...(extra.valueCents !== undefined ? { valueSet: true } : {}),
      ...(extra.ownerId !== undefined ? { ownerId: extra.ownerId } : {}),
      ...(extra.planId !== undefined ? { planId: extra.planId } : {}),
      ...(bulk ? { bulk: true } : {}),
    });
  }

  /** The stage's entry actions the API runs: CREATE_FOLLOW_UP adds one for the owner in two days. */
  private async enter(
    tx: TxClient,
    ctx: SalesContext,
    record: { id: string; ownerId: string | null },
    stage: StageRow,
  ): Promise<void> {
    if (!stage.onEnterActions.includes('create_follow_up')) return;
    const row = await tx.salesFollowUp.create({
      data: {
        opportunityId: record.id,
        kind: 'FOLLOW_UP',
        title: `Follow up: ${stage.name}`,
        dueAt: new Date(ctx.now + 2 * DAY_MS),
        assignedToUserId: record.ownerId,
      },
      select: { id: true },
    });
    await this.audit.logIn(
      tx,
      'sales_follow_up.scheduled',
      { type: 'sales_follow_up', id: row.id },
      { opportunityId: record.id, kind: 'FOLLOW_UP', automation: 'create_follow_up' },
      { businessId: null },
    );
  }

  /**
   * Booking an appointment for a record in an ACTIVE stage before the pipeline's Appointment Set
   * moves it there (history source AUTOMATION), when that stage takes it; otherwise nothing moves.
   */
  private async appointmentSet(
    tx: TxClient,
    ctx: SalesContext,
    built: Built,
    kind: (typeof SALES_APPOINTMENT_KINDS)[number],
  ): Promise<string | null> {
    if (!SALES_APPOINTMENT_KINDS.includes(kind) || built.stage.stageType !== 'ACTIVE') return null;
    const stages = (await stagesOf(tx, [built.row.pipelineId])).get(built.row.pipelineId) ?? [];
    const target = stages.find((s) => s.systemKey === SALES_APPOINTMENT_SET_KEY && s.isActive);
    if (!target || stages.indexOf(target) <= built.view.stageOrder) return null;
    const { row } = built;
    const blocked = entryProblem(
      entryStage(target),
      {
        valueCents: row.valueCents,
        ownerId: row.assignedToUserId,
        planId: row.planId,
        transactionId: row.transactionId,
        transactionStatus: row.transactionStatus,
        lostReason: null,
        lostNote: null,
      },
      ctx.rules.lostOtherNoteRequired,
    );
    if (blocked) return null;
    await tx.$queryRaw`SELECT set_config('app.sales_change_source', 'AUTOMATION', true)`;
    await tx.salesOpportunity.update({
      where: { id: row.id },
      data: { stageId: target.id },
      select: { id: true },
    });
    await this.log(tx, 'sales_opportunity.stage_changed', row.id, {
      fromStageId: row.stageId,
      toStageId: target.id,
      toStageType: target.stageType,
      automation: 'appointment_set',
    });
    await this.enter(tx, ctx, { id: row.id, ownerId: row.assignedToUserId }, target);
    return target.id;
  }
}

// ---------- Pure parts ----------

const refuseMessage = (code: Parameters<typeof refuse>[0]) =>
  (refuse(code).getResponse() as { message: string }).message;

/** What else a stage needs when the transaction sync moves a record into it. */
function requirementProblem(
  stage: StageRow,
  row: {
    valueCents: number | null;
    assignedToUserId: string | null;
    planId: string | null;
    transactionId: string | null;
  },
) {
  return entryProblem(
    { ...entryStage(stage), type: 'ACTIVE', active: true },
    {
      valueCents: row.valueCents,
      ownerId: row.assignedToUserId,
      planId: row.planId,
      transactionId: row.transactionId,
      transactionStatus: null,
      lostReason: null,
      lostNote: null,
    },
    false,
  );
}

export function inSet(view: SalesOpportunity, set: NonNullable<Filters['set']>): boolean {
  switch (set) {
    case 'OPEN':
      return OPEN_TYPES.includes(view.stageType);
    case 'IN_PROGRESS':
      return view.stageType === 'ACTIVE';
    case 'ACTIVE_CLIENTS':
      return view.stageType === 'CONVERTED' || view.stageType === 'TRANSACTION_SYNCED';
    case 'CONVERTED':
      return view.convertedAt !== null;
  }
}

/** The list's order: the stage order, then the latest activity first, unless a sort is given. */
export function sortViews(
  views: SalesOpportunity[],
  sort: Out<typeof SalesOpportunitiesQuery>['sort'],
  dir: 'asc' | 'desc' | undefined,
): SalesOpportunity[] {
  const text = (v: string | null | undefined) => (v ?? '￿').toLowerCase();
  const time = (v: string | null) => (v ? Date.parse(v) : null);
  type Key = string | number | null;
  const keyOf = (v: SalesOpportunity): Key => {
    switch (sort) {
      case 'FIRM':
        return text(v.firmName);
      case 'CONTACT':
        return text(v.contactName);
      case 'STAGE':
        return v.stageOrder;
      case 'OWNER':
        return text(v.owner?.name);
      case 'SOURCE':
        return text(SALES_LEAD_SOURCE_LABELS[v.source]);
      case 'PLAN':
        return text(v.plan?.name);
      case 'VALUE':
        return v.valueCents;
      case 'LAST_ACTIVITY':
        return time(v.lastActivityAt);
      case 'NEXT_FOLLOW_UP':
        return time(v.nextFollowUp?.dueAt ?? null);
      case 'ATTENTION':
        return v.attention.length;
      case 'CREATED':
        return time(v.createdAt);
      default:
        return null;
    }
  };
  if (!sort)
    return [...views].sort(
      (a, b) =>
        a.stageOrder - b.stageOrder ||
        Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt) ||
        a.id.localeCompare(b.id),
    );
  const descending =
    dir === 'desc' ||
    (dir === undefined && ['VALUE', 'LAST_ACTIVITY', 'ATTENTION', 'CREATED'].includes(sort));
  return [...views].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    const order = x === y || x === null ? 0 : x < y! ? -1 : 1;
    return (descending ? -order : order) || a.id.localeCompare(b.id);
  });
}

/** The KPI row (B5's definitions) over the filtered records. */
export function summaryOf(
  all: readonly SalesOpportunity[],
  pipelineId: string,
  range: { from?: string | undefined; to?: string | undefined },
  now: number,
): SalesPipelineSummary {
  const valueOf = (list: readonly SalesOpportunity[], test: (v: SalesOpportunity) => boolean) =>
    list.filter(test).reduce((sum, v) => sum + (v.valueCents ?? 0), 0);
  const open = (v: SalesOpportunity) => OPEN_TYPES.includes(v.stageType);
  const start = range.from ? utcDay(range.from) : -Infinity;
  const end = range.to ? utcDay(range.to) + DAY_MS : Infinity;
  const createdIn = (a: number, b: number) =>
    all.filter((v) => {
      const at = Date.parse(v.createdAt);
      return at >= a && at < b;
    });
  const conversionSet = (list: readonly SalesOpportunity[]) =>
    conversionOf(
      list.map((v) => ({
        convertedAt: v.convertedAt ? new Date(v.convertedAt) : null,
        lostReason: v.lostReason,
      })),
    );
  const recent = createdIn(now - 30 * DAY_MS, Infinity);
  const before = createdIn(now - 60 * DAY_MS, now - 30 * DAY_MS);
  const attention = Object.fromEntries(
    (
      [
        'NO_CONTACT',
        'OVERDUE',
        'NO_RESPONSE',
        'UNASSIGNED',
        'NO_ACTIVITY',
        'FOLLOW_UP_DUE',
      ] as const
    ).map((flag) => [flag, all.filter((v) => v.attention.includes(flag)).length]),
  ) as Record<SalesAttentionFlag, number>;
  const inProgress = (list: readonly SalesOpportunity[]) =>
    list.filter((v) => v.stageType === 'ACTIVE').length;
  return {
    pipelineId,
    totalOpportunities: all.length,
    inProgress: inProgress(all),
    pipelineValueCents: valueOf(all, open),
    closedRevenueCents: valueOf(all, (v) => v.stageType === 'CLOSED'),
    conversion: conversionSet(createdIn(start, end)),
    activeClients: all.filter(
      (v) => v.stageType === 'CONVERTED' || v.stageType === 'TRANSACTION_SYNCED',
    ).length,
    needsAttention: all.filter((v) => v.attention.length > 0).length,
    attention: {
      NO_CONTACT: attention.NO_CONTACT,
      OVERDUE: attention.OVERDUE,
      NO_RESPONSE: attention.NO_RESPONSE,
      UNASSIGNED: attention.UNASSIGNED,
      NO_ACTIVITY: attention.NO_ACTIVITY,
      FOLLOW_UP_DUE: attention.FOLLOW_UP_DUE,
    },
    trends: {
      totalOpportunities: change(recent.length, before.length),
      inProgress: change(inProgress(recent), inProgress(before)),
      pipelineValueCents: change(valueOf(recent, open), valueOf(before, open)),
      conversion: change(conversionSet(recent).rateBp, conversionSet(before).rateBp),
    },
  };
}

const noteView = (
  ctx: SalesContext,
  n: { id: string; body: string; authorUserId: string; createdAt: Date; updatedAt: Date },
): SalesNote => ({
  id: n.id,
  body: n.body,
  author: { id: n.authorUserId, name: ctx.nameOf(n.authorUserId) },
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
  mine: n.authorUserId === ctx.me.id,
});

async function activePlan(tx: TxClient, planId: string) {
  const plan = await tx.platformPlan.findUnique({
    where: { id: planId },
    select: { isActive: true },
  });
  if (!plan?.isActive) throw refuse('INACTIVE_CHOICE', 'Choose an active plan.');
}

async function knownTags(tx: TxClient, tagIds: readonly string[]) {
  if (!tagIds.length) return;
  const found = await tx.salesTag.count({ where: { id: { in: [...tagIds] } } });
  if (found !== tagIds.length) throw refuse('INACTIVE_CHOICE', 'Choose tags from the list.');
}

/**
 * B5's duplicate check: contacts with the same normalized email or phone (a US number with or
 * without its 1), and records or contacts with the same firm name (ignoring case). At most five
 * records, the most matched and newest first.
 */
export async function findDuplicates(
  tx: TxClient,
  probe: {
    firmName?: string | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
  },
): Promise<SalesDuplicateMatch[]> {
  const email = probe.email?.toLowerCase() || null;
  const phone = probe.phone ? digits(probe.phone) : '';
  const firm = probe.firmName?.trim() || null;
  const or: Prisma.SalesOpportunityWhereInput[] = [];
  if (email) or.push({ contact: { emailNormalized: email } });
  if (phone.length >= 7) or.push({ contact: { phoneNormalized: { in: phoneKeys(phone) } } });
  if (firm) {
    const same = { equals: firm, mode: 'insensitive' as const };
    or.push({ title: same }, { companyName: same }, { contact: { companyName: same } });
  }
  if (!or.length) return [];
  const rows = await tx.salesOpportunity.findMany({
    where: { OR: or },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      contactId: true,
      title: true,
      companyName: true,
      createdAt: true,
      stage: { select: { name: true } },
      contact: {
        select: { name: true, emailNormalized: true, phoneNormalized: true, companyName: true },
      },
    },
  });
  const keys = new Set(phone ? phoneKeys(phone) : []);
  const same = (a: string | null) => !!a && !!firm && a.toLowerCase() === firm.toLowerCase();
  return rows
    .map((r) => {
      const matchedOn: SalesDuplicateMatch['matchedOn'] = [];
      if (email && r.contact.emailNormalized === email) matchedOn.push('EMAIL');
      if (r.contact.phoneNormalized && keys.has(r.contact.phoneNormalized)) matchedOn.push('PHONE');
      if (same(r.title) || same(r.companyName) || same(r.contact.companyName))
        matchedOn.push('FIRM_NAME');
      return { r, matchedOn };
    })
    .filter((m) => m.matchedOn.length > 0)
    .sort(
      (a, b) =>
        b.matchedOn.length - a.matchedOn.length ||
        b.r.createdAt.getTime() - a.r.createdAt.getTime(),
    )
    .slice(0, 5)
    .map(({ r, matchedOn }) => ({
      opportunityId: r.id,
      contactId: r.contactId,
      firmName: r.title,
      contactName: r.contact.name,
      stageName: r.stage.name,
      matchedOn,
    }));
}
