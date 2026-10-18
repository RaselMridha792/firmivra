import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnHistoryList,
  TaxReturnPage,
  TaxReturnSummary,
  TaxReturnWorkflowStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { lockClient, memberNames, memberRef, notAMember } from '../workspaces/common.js';
import { notFound } from './tax-return-rules.js';
import type {
  AmendBody,
  CarryForwardBody,
  CreateReturnBody,
  ReturnsQ,
  StatusBody,
  SummaryQ,
  UpdateDetailsBody,
} from './workspace.input.js';
import {
  blockersOf,
  canMoveTo,
  conflict,
  detailSelect,
  invalid,
  isBackward,
  returnReach,
  rowSelect,
  toDetail,
  toRow,
  workspaceRefusal,
} from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
const toDay = (v: string) => new Date(`${v}T00:00:00Z`);
const GROUPS: Record<string, TaxReturnWorkflowStatus[]> = {
  inPreparation: ['IN_PREPARATION'],
  waitingOnClient: ['WAITING_ON_CLIENT'],
  readyForReviewOrFile: ['READY_FOR_REVIEW', 'READY_FOR_SIGNATURE', 'READY_TO_FILE'],
  transmitted: ['TRANSMITTED'],
  accepted: ['ACCEPTED'],
  rejected: ['REJECTED'],
};

/**
 * The Tax Returns workspace, part 1 (R55): the overview (list with tabs, KPI cards, Create New
 * Return), one return's workspace header (people, dates, amendments, Next Steps), Edit Details,
 * Change Status, history, activity, archive, amend and carry forward. The database keeps the
 * workflow rules (tax_returns_0_workflow, _1_filings, _2_ready); its refusals are 4xx. `status`
 * (what the client sees) follows the workflow status and is never written here. Staff reach their
 * own clients only (404 otherwise); every change is audited with ids and field names.
 */
@Injectable()
export class TaxReturnWorkspaceService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  /** Runs a write; the database's refusals become the contract's 4xx. */
  private async write<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(tenant, fn);
    } catch (error) {
      throw workspaceRefusal(error) ?? error;
    }
  }

  private async find(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    lock = false,
  ) {
    const businessId = tenant.businessId;
    if (lock) {
      await tx.$executeRaw`SELECT 1 FROM tax_returns WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const r = await tx.taxReturn.findFirst({
      where: { AND: [{ businessId, id }, returnReach(tenant, userId)] },
      select: detailSelect,
    });
    if (!r) throw notFound();
    return r;
  }

  private async detail(tx: TxClient, tenant: TenantContext, userId: string, id: string) {
    const r = await this.find(tx, tenant, userId, id);
    const names = await memberNames(tx, tenant.businessId, [
      r.preparerUserId,
      r.reviewerUserId,
      r.finalValidatedByUserId,
    ]);
    return toDetail(r, names);
  }

  private async activeMember(tx: TxClient, businessId: string, userId: string | null | undefined) {
    if (!userId) return;
    const [m] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM memberships
      WHERE business_id = ${businessId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
    if (m?.status !== 'ACTIVE') throw notAMember();
  }

  // ---------- Overview ----------

  async list(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ReturnsQ>,
  ): Promise<TaxReturnPage> {
    const businessId = tenant.businessId;
    const and: Prisma.TaxReturnWhereInput[] = [
      { businessId, archivedAt: q.archived ? { not: null } : null },
      returnReach(tenant, userId),
    ];
    const year = new Date().getUTCFullYear();
    if (q.tab === 'personal')
      and.push({ filingType: 'INDIVIDUAL', quarter: null, amendsReturnId: null });
    if (q.tab === 'business')
      and.push({ filingType: 'BUSINESS', quarter: null, amendsReturnId: null });
    if (q.tab === 'quarterly') and.push({ quarter: { not: null } });
    if (q.tab === 'amended') and.push({ amendsReturnId: { not: null } });
    if (q.tab === 'prior_year') and.push({ taxYear: { lt: year - 1 } });
    if (q.workflowStatus) and.push({ workflowStatus: q.workflowStatus });
    if (q.taxYear) and.push({ taxYear: q.taxYear });
    if (q.formType) and.push({ formType: { equals: q.formType, mode: 'insensitive' } });
    if (q.clientType) and.push({ client: { accountType: q.clientType } });
    if (q.assignedUserId) {
      and.push({
        OR: [{ preparerUserId: q.assignedUserId }, { reviewerUserId: q.assignedUserId }],
      });
    }
    if (q.updatedFrom) and.push({ updatedAt: { gte: toDay(q.updatedFrom) } });
    if (q.updatedTo) and.push({ updatedAt: { lt: new Date(toDay(q.updatedTo).getTime() + DAY) } });
    if (q.search) {
      const s = q.search.trim();
      const contains = { contains: likeEscape(s), mode: 'insensitive' as const };
      and.push({
        OR: [
          { client: { displayName: contains } },
          { formType: contains },
          ...(/^\d{4}$/.test(s)
            ? [{ client: { profile: { OR: [{ ssnLast4: s }, { einLast4: s }] } } }]
            : []),
          ...(/^[0-9a-f-]{36}$/i.test(s) ? [{ id: s.toLowerCase() }] : []),
        ],
      });
    }
    const orderBy: Prisma.TaxReturnOrderByWithRelationInput[] =
      q.sort === 'client'
        ? [{ client: { displayName: 'asc' } }]
        : q.sort === 'due'
          ? [{ dueOn: { sort: 'asc', nulls: 'last' } }]
          : q.sort === 'year'
            ? [{ taxYear: 'desc' }]
            : q.sort === 'status'
              ? [{ workflowStatus: 'asc' }]
              : [{ updatedAt: 'desc' }];
    const where: Prisma.TaxReturnWhereInput = { AND: and };
    const page = await this.inFirm(tenant, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.taxReturn.count({ where }),
        tx.taxReturn.findMany({
          where,
          orderBy: [...orderBy, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: rowSelect,
        }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        rows.flatMap((r) => [r.preparerUserId, r.reviewerUserId]),
      );
      return { items: rows.map((r) => toRow(r, names)), total, page: q.page, pageSize: q.pageSize };
    });
    await this.audit.log(
      'tax_returns.listed',
      { type: 'tax_return' },
      { count: page.items.length },
    );
    return page;
  }

  /** The KPI cards (with the figure at the start of this month) and Tax Season Progress. */
  async summary(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof SummaryQ>,
  ): Promise<TaxReturnSummary> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const reach = returnReach(tenant, userId);
      const latest = await tx.taxReturn.findFirst({
        where: { AND: [{ businessId, archivedAt: null }, reach] },
        orderBy: { taxYear: 'desc' },
        select: { taxYear: true },
      });
      const taxYear = q.taxYear ?? latest?.taxYear ?? new Date().getUTCFullYear() - 1;
      const rows = await tx.taxReturn.findMany({
        where: { AND: [{ businessId, archivedAt: null, taxYear }, reach] },
        select: { id: true, workflowStatus: true, createdAt: true },
      });
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const before = rows.length
        ? await tx.taxReturnHistory.findMany({
            where: {
              businessId,
              taxReturnId: { in: rows.map((r) => r.id) },
              changedAt: { lt: monthStart },
            },
            orderBy: [{ changedAt: 'desc' }, { seq: 'desc' }],
            distinct: ['taxReturnId'],
            select: { taxReturnId: true, workflowStatus: true },
          })
        : [];
      const then = new Map(before.map((h) => [h.taxReturnId, h.workflowStatus]));
      const count = (statuses: TaxReturnWorkflowStatus[] | null) => ({
        value: rows.filter((r) => !statuses || statuses.includes(r.workflowStatus)).length,
        previous: rows.filter(
          (r) =>
            r.createdAt < monthStart &&
            then.has(r.id) &&
            (!statuses || statuses.includes(then.get(r.id)!)),
        ).length,
      });
      const progress = new Map<TaxReturnWorkflowStatus, number>();
      for (const r of rows)
        progress.set(r.workflowStatus, (progress.get(r.workflowStatus) ?? 0) + 1);
      return {
        taxYear,
        total: count(null),
        inPreparation: count(GROUPS.inPreparation!),
        waitingOnClient: count(GROUPS.waitingOnClient!),
        readyForReviewOrFile: count(GROUPS.readyForReviewOrFile!),
        transmitted: count(GROUPS.transmitted!),
        accepted: count(GROUPS.accepted!),
        rejected: count(GROUPS.rejected!),
        progress: [...progress.entries()].map(([workflowStatus, n]) => ({
          workflowStatus,
          count: n,
        })),
      };
    });
  }

  // ---------- Create, amend, carry forward ----------

  private async duplicate(
    tx: TxClient,
    businessId: string,
    r: { clientId: string; taxYear: number; formType: string | null; quarter: number | null },
  ) {
    const same = await tx.taxReturn.findFirst({
      where: {
        businessId,
        clientId: r.clientId,
        taxYear: r.taxYear,
        quarter: r.quarter,
        formType: r.formType ? { equals: r.formType, mode: 'insensitive' } : null,
        archivedAt: null,
        amendsReturnId: null,
      },
      select: { id: true },
    });
    if (same) {
      throw conflict('DUPLICATE_RETURN', 'This client already has this return for that year', {
        taxReturnId: same.id,
      });
    }
  }

  private async lockReachable(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ) {
    const client = await lockClient(tx, tenant.businessId, clientId);
    const staff = Object.keys(returnReach(tenant, userId)).length > 0;
    if (!client || (staff && client.assignedUserId !== userId.toLowerCase())) throw notFound();
  }

  async create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateReturnBody>,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    if (body.amendsReturnId === null || body.amendsReturnId === undefined) {
      if (body.filingType === 'BUSINESS' && body.filingStatus) {
        throw invalid('A filing status is for individual returns', 'filingStatus');
      }
    }
    const id = await this.write(tenant, async (tx) => {
      await this.lockReachable(tx, tenant, userId, body.clientId);
      if (body.engagementId) {
        const e = await tx.engagement.findFirst({
          where: { businessId, id: body.engagementId, clientId: body.clientId },
          select: { id: true },
        });
        if (!e) throw notFound();
      }
      await this.activeMember(tx, businessId, body.preparerUserId);
      await this.activeMember(tx, businessId, body.reviewerUserId);
      if (body.amendsReturnId) {
        const original = await tx.taxReturn.findFirst({
          where: { businessId, id: body.amendsReturnId, clientId: body.clientId },
          select: { firstFiledAt: true },
        });
        if (!original) throw notFound();
        if (!original.firstFiledAt)
          throw conflict('ORIGINAL_NOT_FILED', 'An amended return amends a return that was filed');
      } else if (!body.allowDuplicate) {
        await this.duplicate(tx, businessId, {
          clientId: body.clientId,
          taxYear: body.taxYear,
          formType: body.formType ?? null,
          quarter: body.quarter ?? null,
        });
      }
      const row = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: body.clientId,
          engagementId: body.engagementId ?? null,
          taxYear: body.taxYear,
          filingType: body.filingType,
          quarter: body.quarter ?? null,
          formType: body.formType ?? null,
          filingStatus: body.filingStatus ?? null,
          preparerUserId: body.preparerUserId ?? null,
          reviewerUserId: body.reviewerUserId ?? null,
          dueOn: body.dueOn ? toDay(body.dueOn) : null,
          amendsReturnId: body.amendsReturnId ?? null,
          amendReason: body.amendReason ?? null,
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      const states = [...new Set(body.states ?? [])];
      if (states.length || body.quarter == null) {
        for (const jurisdiction of ['US', ...states]) {
          await tx.taxReturnFiling.create({
            data: { businessId, taxReturnId: row.id, jurisdiction },
          });
        }
      }
      await this.audit.logIn(
        tx,
        'tax_return.created',
        { type: 'tax_return', id: row.id },
        { clientId: body.clientId, taxYear: body.taxYear, amends: body.amendsReturnId ?? null },
        { businessId },
      );
      return row.id;
    });
    return this.get(tenant, userId, id, false);
  }

  async amend(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof AmendBody>,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    const created = await this.write(tenant, async (tx) => {
      const o = await this.find(tx, tenant, userId, id, true);
      if (!o.firstFiledAt)
        throw conflict('ORIGINAL_NOT_FILED', 'An amended return amends a return that was filed');
      const full = await tx.taxReturn.findUniqueOrThrow({
        where: { id },
        select: { clientId: true, engagementId: true, filingType: true, filingStatus: true },
      });
      const row = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: full.clientId,
          engagementId: full.engagementId,
          taxYear: o.taxYear,
          filingType: full.filingType,
          quarter: o.quarter,
          formType: o.formType,
          filingStatus: full.filingStatus,
          preparerUserId: o.preparerUserId,
          reviewerUserId: o.reviewerUserId,
          amendsReturnId: id,
          amendReason: body.reason,
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'tax_return.amended',
        { type: 'tax_return', id: row.id },
        { amends: id },
        { businessId },
      );
      return row.id;
    });
    return this.get(tenant, userId, created, false);
  }

  /** Next year's return: people, states, approval steps and checklist labels; never amounts. */
  async carryForward(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CarryForwardBody>,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    const created = await this.write(tenant, async (tx) => {
      await this.find(tx, tenant, userId, id);
      const o = await tx.taxReturn.findUniqueOrThrow({
        where: { id },
        select: {
          clientId: true,
          engagementId: true,
          filingType: true,
          filingStatus: true,
          quarter: true,
          formType: true,
          preparerUserId: true,
          reviewerUserId: true,
          filings: { select: { jurisdiction: true, filingMethod: true, required: true } },
          approvals: {
            orderBy: { sortOrder: 'asc' },
            select: { step: true, sortOrder: true, assignedUserId: true },
          },
          checklist: {
            where: { section: { in: ['PREPARATION', 'REVIEW'] } },
            orderBy: { sortOrder: 'asc' },
            select: { section: true, label: true, sortOrder: true },
          },
        },
      });
      if (
        body.taxYear ===
        (await tx.taxReturn.findUniqueOrThrow({ where: { id }, select: { taxYear: true } })).taxYear
      ) {
        throw invalid('Carry it forward to another year', 'taxYear');
      }
      await this.duplicate(tx, businessId, {
        clientId: o.clientId,
        taxYear: body.taxYear,
        formType: o.formType,
        quarter: o.quarter,
      });
      const row = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: o.clientId,
          engagementId: null,
          taxYear: body.taxYear,
          filingType: o.filingType,
          filingStatus: o.filingStatus,
          quarter: o.quarter,
          formType: o.formType,
          preparerUserId: o.preparerUserId,
          reviewerUserId: o.reviewerUserId,
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      for (const f of o.filings) {
        await tx.taxReturnFiling.create({ data: { businessId, taxReturnId: row.id, ...f } });
      }
      for (const a of o.approvals) {
        await tx.taxReturnApproval.create({ data: { businessId, taxReturnId: row.id, ...a } });
      }
      for (const c of o.checklist) {
        await tx.taxReturnChecklistItem.create({
          data: { businessId, taxReturnId: row.id, ...c, updatedByUserId: userId },
        });
      }
      await this.audit.logIn(
        tx,
        'tax_return.carried_forward',
        { type: 'tax_return', id: row.id },
        { from: id, taxYear: body.taxYear },
        { businessId },
      );
      return row.id;
    });
    return this.get(tenant, userId, created, false);
  }

  // ---------- One return ----------

  async get(
    tenant: TenantContext,
    userId: string,
    id: string,
    audit = true,
  ): Promise<TaxReturnDetail> {
    const out = await this.inFirm(tenant, (tx) => this.detail(tx, tenant, userId, id));
    if (audit) await this.audit.log('tax_return.viewed', { type: 'tax_return', id });
    return out;
  }

  async updateDetails(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateDetailsBody>,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    await this.write(tenant, async (tx) => {
      const r = await this.find(tx, tenant, userId, id, true);
      if (r.archivedAt) throw conflict('RETURN_LOCKED', 'Restore the return first');
      const estimateSent = ['estimateAmountCents', 'estimateStatus', 'estimatePaidOn'].some((k) =>
        fields.includes(k),
      );
      if (estimateSent && r.quarter === null) {
        throw invalid('Estimates are for quarterly returns', 'estimateStatus');
      }
      const status = body.estimateStatus !== undefined ? body.estimateStatus : r.estimateStatus;
      const paidOn = body.estimatePaidOn !== undefined ? body.estimatePaidOn : r.estimatePaidOn;
      if (estimateSent && (status === 'PAID') !== Boolean(paidOn)) {
        throw invalid(
          'A paid estimate has its paid date, and only a paid one does',
          'estimatePaidOn',
        );
      }
      if (body.filingStatus && r.filingType !== 'INDIVIDUAL') {
        throw invalid('A filing status is for individual returns', 'filingStatus');
      }
      await this.activeMember(tx, businessId, body.preparerUserId);
      await this.activeMember(tx, businessId, body.reviewerUserId);
      if (body.engagementId) {
        const e = await tx.engagement.findFirst({
          where: { businessId, id: body.engagementId, clientId: r.client.id },
          select: { id: true },
        });
        if (!e) throw notFound();
      }
      await tx.taxReturn.update({
        where: { id },
        data: {
          ...(body.formType !== undefined ? { formType: body.formType } : {}),
          ...(body.filingStatus !== undefined ? { filingStatus: body.filingStatus } : {}),
          ...(body.preparerUserId !== undefined ? { preparerUserId: body.preparerUserId } : {}),
          ...(body.reviewerUserId !== undefined ? { reviewerUserId: body.reviewerUserId } : {}),
          ...(body.dueOn !== undefined ? { dueOn: body.dueOn ? toDay(body.dueOn) : null } : {}),
          ...(body.engagementId !== undefined ? { engagementId: body.engagementId } : {}),
          ...(body.estimateAmountCents !== undefined
            ? { estimateAmountCents: body.estimateAmountCents }
            : {}),
          ...(body.estimateStatus !== undefined ? { estimateStatus: body.estimateStatus } : {}),
          ...(body.estimatePaidOn !== undefined
            ? { estimatePaidOn: body.estimatePaidOn ? toDay(body.estimatePaidOn) : null }
            : {}),
          updatedByUserId: userId,
        },
      });
      await this.audit.logIn(
        tx,
        'tax_return.updated',
        { type: 'tax_return', id },
        { fields: fields.sort() },
        { businessId },
      );
    });
    return this.get(tenant, userId, id, false);
  }

  /** Change Status. Ready to File and Close need APPROVE, or the return's reviewer. */
  async changeStatus(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof StatusBody>,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    try {
      await this.write(tenant, async (tx) => {
        const r = await this.find(tx, tenant, userId, id, true);
        const to = body.workflowStatus;
        if (to === r.workflowStatus) return;
        if (!canMoveTo(r.workflowStatus).includes(to)) {
          throw conflict(
            'STATUS_BLOCKED',
            `A ${r.workflowStatus.toLowerCase().replace(/_/g, ' ')} return cannot go there`,
            {
              blockers: blockersOf(r),
            },
          );
        }
        if (isBackward(r.workflowStatus, to) && !body.reason) {
          throw new BadRequestException({
            code: 'REASON_REQUIRED',
            message: 'Say why it goes back a step',
          });
        }
        if ((to === 'READY_TO_FILE' || to === 'CLOSED') && r.reviewerUserId !== userId) {
          const role = tenant.role as Parameters<PermissionGrantsService['can']>[1];
          if (!(await this.grants.can(businessId, role, 'TAX_RETURNS', 'APPROVE'))) {
            throw new ForbiddenException({
              code: 'FORBIDDEN',
              message: 'Ready to file and closing are for the reviewer or an approver',
            });
          }
        }
        await tx.taxReturn.update({
          where: { id },
          data: {
            workflowStatus: to,
            ...(body.reason ? { statusReason: body.reason } : {}),
            updatedByUserId: userId,
          },
        });
        await this.audit.logIn(
          tx,
          'tax_return.status_changed',
          { type: 'tax_return', id },
          { from: r.workflowStatus, to },
          { businessId },
        );
      });
    } catch (error) {
      // A move the database refused says what blocks it.
      const code = (error as { response?: { code?: string } }).response?.code;
      if (code === 'STATUS_BLOCKED') {
        const r = await this.inFirm(tenant, (tx) => this.find(tx, tenant, userId, id));
        const message =
          (error as { response?: { message?: string } }).response?.message ?? 'Blocked';
        throw conflict('STATUS_BLOCKED', message, { blockers: blockersOf(r) });
      }
      throw error;
    }
    return this.get(tenant, userId, id, false);
  }

  async history(
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxReturnHistoryList['items']> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      await this.find(tx, tenant, userId, id);
      const rows = await tx.taxReturnHistory.findMany({
        where: { businessId, taxReturnId: id },
        orderBy: [{ changedAt: 'desc' }, { seq: 'desc' }],
        take: 200,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.flatMap((r) => [r.preparerUserId, r.reviewerUserId, r.changedByUserId]),
      );
      return rows.map((r) => ({
        at: r.changedAt.toISOString(),
        workflowStatus: r.workflowStatus,
        preparer: memberRef(names, r.preparerUserId),
        reviewer: memberRef(names, r.reviewerUserId),
        reason: r.reason,
        by: memberRef(names, r.changedByUserId),
      }));
    });
  }

  async activity(
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxReturnActivityList['items']> {
    const businessId = tenant.businessId;
    const KIND: Record<string, [TaxReturnActivityList['items'][number]['kind'], string]> = {
      'tax_return.created': ['CREATED', 'Return created'],
      'tax_return.amended': ['CREATED', 'Amended return created'],
      'tax_return.carried_forward': ['CREATED', 'Carried forward'],
      'tax_return.updated': ['UPDATED', 'Details changed'],
      'tax_return.status_changed': ['STATUS', 'Status changed'],
      'tax_return.archived': ['ARCHIVED', 'Archived'],
      'tax_return.restored': ['RESTORED', 'Restored'],
      'tax_return.checklist_changed': ['CHECKLIST', 'Checklist changed'],
      'tax_return.final_validation': ['VALIDATION', 'Final validation recorded'],
      'tax_return.approval': ['APPROVAL', 'Review step updated'],
      'tax_return.authorization': ['AUTHORIZATION', 'Signature updated'],
      'tax_return.filings_changed': ['FILING', 'Filings changed'],
      'tax_return.transmission': ['TRANSMISSION', 'Transmission recorded'],
      'tax_return.document': ['DOCUMENT', 'Documents changed'],
    };
    return this.inFirm(tenant, async (tx) => {
      await this.find(tx, tenant, userId, id);
      const logs = await tx.auditLog.findMany({
        where: { businessId, entityType: 'tax_return', entityId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: { id: true, action: true, actorUserId: true, createdAt: true, metadata: true },
      });
      const names = await memberNames(
        tx,
        businessId,
        logs.map((l) => l.actorUserId),
      );
      return logs.flatMap((l) => {
        let k = KIND[l.action];
        if (!k) return [];
        if (l.action === 'tax_return.updated') {
          const f = ((l.metadata as { fields?: string[] } | null)?.fields ?? []) as string[];
          if (f.every((x) => x === 'preparerUserId' || x === 'reviewerUserId') && f.length) {
            k = ['ASSIGNED', 'Assignment changed'];
          }
        }
        return [
          {
            id: l.id,
            at: l.createdAt.toISOString(),
            kind: k[0],
            label: k[1],
            by: l.actorUserId ? (names.get(l.actorUserId) ?? null) : null,
          },
        ];
      });
    });
  }

  async archive(
    tenant: TenantContext,
    userId: string,
    id: string,
    archived: boolean,
  ): Promise<TaxReturnDetail> {
    const businessId = tenant.businessId;
    await this.write(tenant, async (tx) => {
      const r = await this.find(tx, tenant, userId, id, true);
      if (Boolean(r.archivedAt) === archived) return;
      await tx.taxReturn.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null, updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        archived ? 'tax_return.archived' : 'tax_return.restored',
        { type: 'tax_return', id },
        {},
        { businessId },
      );
    });
    return this.get(tenant, userId, id, false);
  }
}
