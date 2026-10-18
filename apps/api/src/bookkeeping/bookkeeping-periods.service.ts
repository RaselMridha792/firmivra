import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BookkeepingPeriod,
  BookkeepingPeriodList,
  BookkeepingPeriodsQuery,
  BookkeepingReconciliation,
  BookkeepingReconciliationList,
  CreateBookkeepingPeriodRequest,
  CreateBookkeepingReconciliationRequest,
  UpdateBookkeepingCloseItemRequest,
  UpdateBookkeepingPeriodRequest,
  UpdateBookkeepingReconciliationRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames } from '../workspaces/common.js';
import {
  addActivity,
  type BookkeepingActor,
  findProfile,
  iso,
  lockProfile,
  lockProfileOf,
  memberRefOf,
  periodSelect,
  reachEngagement,
  reconSelect,
  reportMemberIds,
  reportSelect,
  skipTake,
  toClientRef,
  toPeriodSummary,
  toReconciliation,
  toReport,
  clientRefSelect,
} from './bookkeeping.mappers.js';
import {
  dueAfter,
  errors,
  inFirm,
  isoDay,
  mapBookkeepingDbError,
  periodLabel,
  toDay,
} from './bookkeeping.shared.js';
import {
  BookkeepingStatusService,
  closeChecklistOf,
  readSettings,
} from './bookkeeping-status.service.js';

const detailSelect = {
  ...periodSelect,
  readyForReviewAt: true,
  readyForReviewBy: true,
  approvedAt: true,
  approvedBy: true,
  closedAt: true,
  closedBy: true,
  reopenedAt: true,
  reopenedBy: true,
  reopenReason: true,
  engagement: {
    select: { client: { select: clientRefSelect }, bookkeepingProfile: { select: { id: true } } },
  },
} satisfies Prisma.BookkeepingPeriodSelect;

type PeriodRow = Prisma.BookkeepingPeriodGetPayload<{ select: typeof detailSelect }>;

/**
 * A client's reporting periods, their close workflow (start, ready for review, approve, close,
 * reopen with a reason) and the bank and credit card reconciliations inside them. The database
 * locks a closed period and everything in it; the services check the same rules first so the
 * answer is a clear 409 and never a database error.
 */
@Injectable()
export class BookkeepingPeriodsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly status: BookkeepingStatusService,
  ) {}

  // ---------- Reading ----------

  private async findPeriod(tx: TxClient, businessId: string, actor: BookkeepingActor, id: string) {
    const row = await tx.bookkeepingPeriod.findFirst({
      where: { businessId, id, engagement: reachEngagement(actor) },
      select: detailSelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  private async detail(tx: TxClient, businessId: string, p: PeriodRow): Promise<BookkeepingPeriod> {
    const today = isoDay(new Date());
    const [items, recons, accounts, reports] = await Promise.all([
      tx.bookkeepingCloseItem.findMany({
        where: { businessId, periodId: p.id },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
      }),
      tx.bookkeepingReconciliation.findMany({
        where: { businessId, periodId: p.id },
        select: reconSelect,
        orderBy: [{ account: { name: 'asc' } }, { id: 'asc' }],
      }),
      tx.bookkeepingAccount.findMany({
        where: { businessId, engagementId: p.engagementId, reconcile: true, archivedAt: null },
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      tx.bookkeepingReport.findMany({
        where: { businessId, periodId: p.id },
        select: reportSelect,
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
    ]);
    const names = await memberNames(tx, businessId, [
      p.readyForReviewBy,
      p.approvedBy,
      p.closedBy,
      p.reopenedBy,
      ...items.map((i) => i.completedByUserId),
      ...recons.map((r) => r.approvedBy),
      ...reportMemberIds(reports),
    ]);
    const reconciled = new Set(recons.map((r) => r.account.id));
    return {
      ...toPeriodSummary(p, today),
      bookkeepingClientId: p.engagement.bookkeepingProfile?.id as string,
      client: toClientRef(p.engagement.client),
      readyForReviewAt: iso(p.readyForReviewAt),
      readyForReviewBy: memberRefOf(names, p.readyForReviewBy),
      approvedAt: iso(p.approvedAt),
      approvedBy: memberRefOf(names, p.approvedBy),
      closedAt: iso(p.closedAt),
      closedBy: memberRefOf(names, p.closedBy),
      reopenedAt: iso(p.reopenedAt),
      reopenedBy: memberRefOf(names, p.reopenedBy),
      reopenReason: p.reopenReason,
      closeItems: items.map((i) => ({
        id: i.id,
        itemKey: i.itemKey,
        label: i.label,
        required: i.required,
        position: i.position,
        completed: i.completedAt !== null,
        completedAt: iso(i.completedAt),
        completedBy: memberRefOf(names, i.completedByUserId),
        note: i.note,
      })),
      reconciliations: recons.map((r) => toReconciliation(r, names)),
      accountsWithoutReconciliation: accounts.filter((a) => !reconciled.has(a.id)),
      reports: reports.map((r) => toReport(r, names, today)),
    };
  }

  async list(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    q: z.output<typeof BookkeepingPeriodsQuery>,
  ): Promise<BookkeepingPeriodList> {
    const today = isoDay(new Date());
    const { rows, total } = await inFirm(this.database, businessId, async (tx) => {
      const p = await findProfile(tx, businessId, actor, id);
      const where: Prisma.BookkeepingPeriodWhereInput = {
        businessId,
        engagementId: p.engagementId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.year
          ? { periodStart: { gte: toDay(`${q.year}-01-01`), lte: toDay(`${q.year}-12-31`) } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.bookkeepingPeriod.findMany({
          where,
          select: periodSelect,
          orderBy: [{ periodStart: 'desc' }, { id: 'asc' }],
          ...skipTake(q),
        }),
        tx.bookkeepingPeriod.count({ where }),
      ]);
      return { rows, total };
    });
    await this.audit.log(
      'bookkeeping.periods.listed',
      { type: 'bookkeeping_client', id },
      { count: rows.length },
    );
    return {
      items: rows.map((r) => toPeriodSummary(r, today)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    log = true,
  ): Promise<BookkeepingPeriod> {
    const result = await inFirm(this.database, businessId, async (tx) => {
      const p = await this.findPeriod(tx, businessId, actor, id);
      return this.detail(tx, businessId, p);
    });
    if (log) await this.audit.log('bookkeeping.period.viewed', { type: 'bookkeeping_period', id });
    return result;
  }

  // ---------- Periods ----------

  async create(
    businessId: string,
    actor: BookkeepingActor,
    clientId: string,
    body: z.output<typeof CreateBookkeepingPeriodRequest>,
  ): Promise<BookkeepingPeriod> {
    const id = await inFirm(this.database, businessId, async (tx) => {
      const p = await lockProfile(tx, businessId, actor, clientId);
      const settings = await readSettings(tx, businessId);
      const label = body.label ?? periodLabel(body.kind, body.periodStart, body.periodEnd);
      if (!label) {
        throw errors.invalid(
          'label',
          `The dates are not a whole ${body.kind.toLowerCase()}: name the period`,
        );
      }
      const closeBy =
        body.closeByOn !== undefined
          ? body.closeByOn
          : dueAfter(body.periodEnd, p.closeTargetDay ?? settings.closeTargetDay);
      let created;
      try {
        created = await tx.bookkeepingPeriod.create({
          data: {
            businessId,
            engagementId: p.engagementId,
            kind: body.kind,
            periodStart: toDay(body.periodStart),
            periodEnd: toDay(body.periodEnd),
            label,
            closeByOn: closeBy ? toDay(closeBy) : null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw errors.duplicate('This period already exists for the client');
        return mapBookkeepingDbError(e);
      }
      const steps = closeChecklistOf(settings);
      await tx.bookkeepingCloseItem.createMany({
        data: steps.map((s, position) => ({
          businessId,
          periodId: created.id,
          itemKey: s.key,
          label: s.label,
          required: s.required,
          position,
        })),
      });
      await addActivity(
        tx,
        businessId,
        p.engagementId,
        actor.userId,
        'CLOSE',
        `Period ${label} added`,
        {
          periodId: created.id,
        },
      );
      await this.status.refresh(tx, businessId, p.engagementId, actor.userId, settings);
      await this.audit.logIn(
        tx,
        'bookkeeping.period.created',
        { type: 'bookkeeping_period', id: created.id },
        { clientId: p.engagement.clientId },
      );
      return created.id;
    });
    return this.get(businessId, actor, id, false);
  }

  /** Runs `change` on the period, locked with its client; the status and next report date follow. */
  private async act(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    action: string,
    change: (
      tx: TxClient,
      p: PeriodRow,
      profile: Awaited<ReturnType<typeof lockProfileOf>>,
    ) => Promise<void>,
  ): Promise<BookkeepingPeriod> {
    await inFirm(this.database, businessId, async (tx) => {
      const found = await this.findPeriod(tx, businessId, actor, id);
      const profile = await lockProfileOf(tx, businessId, actor, found.engagementId);
      // Read again under the lock: a change that committed first wins.
      const p = await this.findPeriod(tx, businessId, actor, id);
      try {
        await change(tx, p, profile);
      } catch (e) {
        return mapBookkeepingDbError(e);
      }
      await this.status.followChange(tx, businessId, actor.userId, profile);
      await this.audit.logIn(
        tx,
        `bookkeeping.period.${action}`,
        { type: 'bookkeeping_period', id },
        { clientId: profile.engagement.clientId },
      );
    });
    return this.get(businessId, actor, id, false);
  }

  async update(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingPeriodRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.act(businessId, actor, id, 'updated', async (tx, p, profile) => {
      if (p.status === 'CLOSED') throw errors.periodLocked();
      const figures =
        body.incomeCents !== undefined ||
        body.expensesCents !== undefined ||
        body.uncategorizedCount !== undefined;
      if (figures && p.status === 'APPROVED') {
        throw errors.periodState('The period is approved: reopen it to change its figures');
      }
      const data: Prisma.BookkeepingPeriodUncheckedUpdateInput = {};
      if (body.closeByOn !== undefined)
        data.closeByOn = body.closeByOn ? toDay(body.closeByOn) : null;
      if (body.incomeCents !== undefined || body.expensesCents !== undefined) {
        const income = body.incomeCents !== undefined ? body.incomeCents : p.incomeCents;
        const expenses = body.expensesCents !== undefined ? body.expensesCents : p.expensesCents;
        if ((income === null) !== (expenses === null)) {
          throw errors.invalid('expensesCents', 'Income and expenses are entered together');
        }
        data.incomeCents = income;
        data.expensesCents = expenses;
        data.figuresSource = income === null ? null : 'MANUAL';
        data.figuresAsOf = income === null ? null : new Date();
      }
      if (body.uncategorizedCount !== undefined) data.uncategorizedCount = body.uncategorizedCount;
      await tx.bookkeepingPeriod.update({
        where: { businessId_id: { businessId, id: p.id } },
        data,
      });
      await addActivity(
        tx,
        businessId,
        profile.engagementId,
        actor.userId,
        'CLOSE',
        `Period ${p.label} updated`,
        {
          periodId: p.id,
        },
      );
    });
  }

  private transition(
    id: string,
    from: readonly string[],
    to: 'IN_PROGRESS' | 'READY_FOR_REVIEW' | 'APPROVED' | 'CLOSED',
    extra: (actor: BookkeepingActor) => Prisma.BookkeepingPeriodUncheckedUpdateInput,
    summary: (label: string) => string,
  ) {
    return (businessId: string, actor: BookkeepingActor, action: string) =>
      this.act(businessId, actor, id, action, async (tx, p, profile) => {
        if (!from.includes(p.status)) {
          throw p.status === 'CLOSED'
            ? errors.periodLocked()
            : errors.periodState(
                `A ${p.status.toLowerCase().replace(/_/g, ' ')} period cannot do this`,
              );
        }
        await tx.bookkeepingPeriod.update({
          where: { businessId_id: { businessId, id: p.id } },
          data: { status: to, ...extra(actor) },
        });
        await addActivity(
          tx,
          businessId,
          profile.engagementId,
          actor.userId,
          'CLOSE',
          summary(p.label),
          {
            periodId: p.id,
            to,
          },
        );
      });
  }

  start(businessId: string, actor: BookkeepingActor, id: string) {
    return this.transition(
      id,
      ['NOT_STARTED'],
      'IN_PROGRESS',
      () => ({}),
      (l) => `Started ${l}`,
    )(businessId, actor, 'started');
  }

  markReady(businessId: string, actor: BookkeepingActor, id: string) {
    return this.transition(
      id,
      ['IN_PROGRESS'],
      'READY_FOR_REVIEW',
      (a) => ({ readyForReviewAt: new Date(), readyForReviewBy: a.userId }),
      (l) => `${l} sent for review`,
    )(businessId, actor, 'ready');
  }

  sendBack(businessId: string, actor: BookkeepingActor, id: string) {
    return this.transition(
      id,
      ['READY_FOR_REVIEW'],
      'IN_PROGRESS',
      () => ({}),
      (l) => `${l} sent back for changes`,
    )(businessId, actor, 'sent_back');
  }

  approve(businessId: string, actor: BookkeepingActor, id: string) {
    return this.transition(
      id,
      ['READY_FOR_REVIEW'],
      'APPROVED',
      (a) => ({ approvedAt: new Date(), approvedBy: a.userId }),
      (l) => `${l} approved`,
    )(businessId, actor, 'approved');
  }

  close(businessId: string, actor: BookkeepingActor, id: string) {
    return this.transition(
      id,
      ['APPROVED'],
      'CLOSED',
      (a) => ({ closedAt: new Date(), closedBy: a.userId }),
      (l) => `${l} closed`,
    )(businessId, actor, 'closed');
  }

  reopen(businessId: string, actor: BookkeepingActor, id: string, reason: string) {
    return this.transition(
      id,
      ['APPROVED', 'CLOSED'],
      'IN_PROGRESS',
      (a) => ({ reopenedAt: new Date(), reopenedBy: a.userId, reopenReason: reason }),
      (l) => `${l} reopened`,
    )(businessId, actor, 'reopened');
  }

  async updateCloseItem(
    businessId: string,
    actor: BookkeepingActor,
    periodId: string,
    itemId: string,
    body: z.output<typeof UpdateBookkeepingCloseItemRequest>,
  ): Promise<BookkeepingPeriod> {
    return this.act(businessId, actor, periodId, 'close_item_updated', async (tx, p, profile) => {
      if (p.status === 'CLOSED') throw errors.periodLocked();
      const item = await tx.bookkeepingCloseItem.findFirst({
        where: { businessId, periodId, id: itemId },
      });
      if (!item) throw errors.notFound();
      const data: Prisma.BookkeepingCloseItemUncheckedUpdateInput = {};
      if (body.completed !== undefined) {
        data.completedAt = body.completed ? (item.completedAt ?? new Date()) : null;
        data.completedByUserId = body.completed ? (item.completedByUserId ?? actor.userId) : null;
      }
      if (body.note !== undefined) data.note = body.note;
      await tx.bookkeepingCloseItem.update({ where: { id: itemId }, data });
      if (body.completed !== undefined && body.completed !== (item.completedAt !== null)) {
        await addActivity(
          tx,
          businessId,
          profile.engagementId,
          actor.userId,
          'CLOSE',
          `${item.label}: ${body.completed ? 'done' : 'reopened'}`,
          { periodId, itemKey: item.itemKey },
        );
      }
    });
  }

  // ---------- Reconciliations ----------

  private async findRecon(tx: TxClient, businessId: string, actor: BookkeepingActor, id: string) {
    const row = await tx.bookkeepingReconciliation.findFirst({
      where: { businessId, id, period: { engagement: reachEngagement(actor) } },
      select: {
        ...reconSelect,
        period: { select: { engagementId: true, status: true, label: true } },
      },
    });
    if (!row) throw errors.notFound();
    return row;
  }

  private async toRecon(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<BookkeepingReconciliation> {
    const row = await tx.bookkeepingReconciliation.findFirstOrThrow({
      where: { businessId, id },
      select: reconSelect,
    });
    return toReconciliation(row, await memberNames(tx, businessId, [row.approvedBy]));
  }

  async reconciliations(
    businessId: string,
    actor: BookkeepingActor,
    periodId: string,
  ): Promise<BookkeepingReconciliationList> {
    const items = await inFirm(this.database, businessId, async (tx) => {
      await this.findPeriod(tx, businessId, actor, periodId);
      const rows = await tx.bookkeepingReconciliation.findMany({
        where: { businessId, periodId },
        select: reconSelect,
        orderBy: [{ account: { name: 'asc' } }, { id: 'asc' }],
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.approvedBy),
      );
      return rows.map((r) => toReconciliation(r, names));
    });
    await this.audit.log(
      'bookkeeping.reconciliations.listed',
      { type: 'bookkeeping_period', id: periodId },
      { count: items.length },
    );
    return { items };
  }

  async getReconciliation(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
  ): Promise<BookkeepingReconciliation> {
    const row = await inFirm(this.database, businessId, async (tx) => {
      await this.findRecon(tx, businessId, actor, id);
      return this.toRecon(tx, businessId, id);
    });
    await this.audit.log('bookkeeping.reconciliation.viewed', {
      type: 'bookkeeping_reconciliation',
      id,
    });
    return row;
  }

  /** The statement must be a document of the client; another client's or firm's is refused alike. */
  private async checkStatement(
    tx: TxClient,
    businessId: string,
    engagementId: string,
    documentId: string | null | undefined,
  ) {
    if (!documentId) return;
    const doc = await tx.document.findFirst({
      where: { businessId, id: documentId, engagementId, archivedAt: null },
      select: { id: true },
    });
    if (!doc) throw errors.notThisClients('statement');
  }

  async createReconciliation(
    businessId: string,
    actor: BookkeepingActor,
    periodId: string,
    body: z.output<typeof CreateBookkeepingReconciliationRequest>,
  ): Promise<BookkeepingReconciliation> {
    const id = await inFirm(this.database, businessId, async (tx) => {
      const found = await this.findPeriod(tx, businessId, actor, periodId);
      const profile = await lockProfileOf(tx, businessId, actor, found.engagementId);
      if (found.status === 'CLOSED') throw errors.periodLocked();
      const account = await tx.bookkeepingAccount.findFirst({
        where: {
          businessId,
          id: body.accountId,
          engagementId: found.engagementId,
          archivedAt: null,
        },
        select: { id: true },
      });
      if (!account) throw errors.notThisClients('account');
      await this.checkStatement(tx, businessId, found.engagementId, body.statementDocumentId);
      const settings = await readSettings(tx, businessId);
      const cleared = body.clearedBalanceCents ?? 0;
      let created;
      try {
        created = await tx.bookkeepingReconciliation.create({
          data: {
            businessId,
            periodId,
            accountId: account.id,
            statementStart: toDay(body.statementStart),
            statementEnd: toDay(body.statementEnd),
            beginningBalanceCents: body.beginningBalanceCents,
            endingBalanceCents: body.endingBalanceCents,
            clearedBalanceCents: cleared,
            clearedCount: body.clearedCount ?? 0,
            differenceCents: body.endingBalanceCents - cleared,
            toleranceCents: settings.reconToleranceCents,
            exceptionsCount: body.exceptionsCount ?? 0,
            statementDocumentId: body.statementDocumentId ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        if (isUniqueViolation(e))
          throw errors.duplicate('This account already has a reconciliation for the period');
        return mapBookkeepingDbError(e);
      }
      await addActivity(
        tx,
        businessId,
        profile.engagementId,
        actor.userId,
        'RECONCILIATION',
        `Reconciliation started for ${found.label}`,
        {
          reconciliationId: created.id,
        },
      );
      await this.audit.logIn(
        tx,
        'bookkeeping.reconciliation.created',
        { type: 'bookkeeping_reconciliation', id: created.id },
        { clientId: profile.engagement.clientId },
      );
      return created.id;
    });
    return this.getReconciliation(businessId, actor, id);
  }

  private async reconAct(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    action: string,
    change: (
      tx: TxClient,
      r: Awaited<ReturnType<BookkeepingPeriodsService['findRecon']>>,
      engagementId: string,
    ) => Promise<Prisma.BookkeepingReconciliationUncheckedUpdateInput>,
    summary?: (periodLabel: string) => string,
  ): Promise<BookkeepingReconciliation> {
    await inFirm(this.database, businessId, async (tx) => {
      const found = await this.findRecon(tx, businessId, actor, id);
      const profile = await lockProfileOf(tx, businessId, actor, found.period.engagementId);
      const r = await this.findRecon(tx, businessId, actor, id);
      if (r.period.status === 'CLOSED') throw errors.periodLocked();
      const data = await change(tx, r, r.period.engagementId);
      try {
        await tx.bookkeepingReconciliation.update({ where: { id }, data });
      } catch (e) {
        return mapBookkeepingDbError(e);
      }
      if (summary) {
        await addActivity(
          tx,
          businessId,
          profile.engagementId,
          actor.userId,
          'RECONCILIATION',
          summary(r.period.label),
          {
            reconciliationId: id,
          },
        );
      }
      await this.audit.logIn(
        tx,
        `bookkeeping.reconciliation.${action}`,
        { type: 'bookkeeping_reconciliation', id },
        { clientId: profile.engagement.clientId },
      );
    });
    return this.getReconciliation(businessId, actor, id);
  }

  saveReconciliation(
    businessId: string,
    actor: BookkeepingActor,
    id: string,
    body: z.output<typeof UpdateBookkeepingReconciliationRequest>,
  ) {
    return this.reconAct(businessId, actor, id, 'saved', async (tx, r, engagementId) => {
      if (r.status !== 'IN_PROGRESS' && r.status !== 'REOPENED') {
        throw errors.reconState('Reopen the reconciliation to change it');
      }
      await this.checkStatement(tx, businessId, engagementId, body.statementDocumentId);
      const ending = body.endingBalanceCents ?? r.endingBalanceCents;
      const cleared = body.clearedBalanceCents ?? r.clearedBalanceCents;
      const start = body.statementStart ?? isoDay(r.statementStart);
      const end = body.statementEnd ?? isoDay(r.statementEnd);
      if (end < start)
        throw errors.invalid('statementEnd', 'The statement cannot end before it starts');
      const data: Prisma.BookkeepingReconciliationUncheckedUpdateInput = {
        statementStart: toDay(start),
        statementEnd: toDay(end),
        endingBalanceCents: ending,
        clearedBalanceCents: cleared,
        differenceCents: ending - cleared,
      };
      if (body.beginningBalanceCents !== undefined)
        data.beginningBalanceCents = body.beginningBalanceCents;
      if (body.clearedCount !== undefined) data.clearedCount = body.clearedCount;
      if (body.exceptionsCount !== undefined) data.exceptionsCount = body.exceptionsCount;
      if (body.statementDocumentId !== undefined)
        data.statementDocumentId = body.statementDocumentId;
      return data;
    });
  }

  markReconciliationReady(businessId: string, actor: BookkeepingActor, id: string) {
    return this.reconAct(
      businessId,
      actor,
      id,
      'ready',
      async (_tx, r) => {
        if (r.status !== 'IN_PROGRESS' && r.status !== 'REOPENED') {
          throw errors.reconState('The reconciliation is not in progress');
        }
        return { status: 'READY_FOR_REVIEW', readyForReviewAt: new Date() };
      },
      (l) => `Reconciliation for ${l} ready for review`,
    );
  }

  approveReconciliation(businessId: string, actor: BookkeepingActor, id: string) {
    return this.reconAct(
      businessId,
      actor,
      id,
      'approved',
      async (_tx, r) => {
        if (r.status !== 'READY_FOR_REVIEW') {
          throw errors.reconState('The reconciliation is not waiting for review');
        }
        if (Math.abs(r.differenceCents) > r.toleranceCents) throw errors.reconDifference();
        if (r.exceptionsCount > 0) throw errors.reconState('Resolve the open exceptions first');
        return { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor.userId };
      },
      (l) => `Reconciliation for ${l} approved`,
    );
  }

  reopenReconciliation(businessId: string, actor: BookkeepingActor, id: string, reason: string) {
    return this.reconAct(
      businessId,
      actor,
      id,
      'reopened',
      async (_tx, r) => {
        if (r.status !== 'APPROVED' && r.status !== 'READY_FOR_REVIEW') {
          throw errors.reconState(
            'Only a reconciliation waiting for review or approved can be reopened',
          );
        }
        return {
          status: 'REOPENED',
          reopenedAt: new Date(),
          reopenedBy: actor.userId,
          reopenReason: reason,
          approvedAt: null,
          approvedBy: null,
          readyForReviewAt: null,
        };
      },
      (l) => `Reconciliation for ${l} reopened`,
    );
  }
}
