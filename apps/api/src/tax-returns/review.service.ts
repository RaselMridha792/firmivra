import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  EfileReport,
  TaxApprovalList,
  TaxAuthorizationList,
  TaxChecklist,
  TaxReturnDetail,
  TaxReturnDocumentList,
  TaxReturnExportLink,
  TaxReturnFilingList,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { REPORT_FILES, type ReportFiles } from '../reports/report-files.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { isUniqueViolation, memberNames, memberRef, notAMember } from '../workspaces/common.js';
import { notFound } from './tax-return-rules.js';
import {
  blockersOf,
  conflict,
  detailSelect,
  invalid,
  returnReach,
  workspaceRefusal,
} from './workspace.common.js';
import type {
  ApprovalBody,
  ApproveBody,
  AttemptBody,
  ChecklistItemBody,
  EfileQ,
  LinkAuthorizationBody,
  LinkDocumentBody,
  PaperFiledBody,
  ReturnApprovalBody,
  ReturnsQ,
  SetAuthorizationsBody,
  SetFilingsBody,
  UpdateAttemptBody,
  UpdateChecklistItemBody,
  UpdateFilingBody,
  WetSignatureBody,
} from './workspace.input.js';
import { TaxReturnWorkspaceService } from './workspace.service.js';

type Out<S extends z.ZodType> = z.output<S>;

const toDay = (v: string) => new Date(`${v}T00:00:00Z`);
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * The Tax Returns workspace, part 2 (R55): Frame 3's filings per jurisdiction and their
 * transmissions, the checklists and final validation, the review steps, Form 8879 and state
 * authorizations, the return's documents, the e-file report and the list's CSV export. The
 * database keeps the rules (one waiting transmission at a time, a new one only after a rejection,
 * an answered one keeps its answer, decided steps never change, filed returns and
 * acknowledgments stay linked); its refusals are 4xx. Firmivra records filing; it never
 * transmits. Every change is audited on the return with ids and field names only.
 */
@Injectable()
export class TaxReturnReviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
    private readonly returns: TaxReturnWorkspaceService,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private async write<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(tenant, fn);
    } catch (error) {
      throw workspaceRefusal(error) ?? error;
    }
  }

  /** The return as the member reaches it (locked when it is about to change); 404 otherwise. */
  private async reach(
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
      select: { id: true, clientId: true, reviewerUserId: true, archivedAt: true },
    });
    if (!r) throw notFound();
    return r;
  }

  private log(
    tx: TxClient,
    tenant: TenantContext,
    id: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.logIn(tx, `tax_return.${action}`, { type: 'tax_return', id }, metadata, {
      businessId: tenant.businessId,
    });
  }

  private async activeMember(tx: TxClient, businessId: string, userId: string | null | undefined) {
    if (!userId) return;
    const [m] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM memberships
      WHERE business_id = ${businessId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
    if (m?.status !== 'ACTIVE') throw notAMember();
  }

  // ---------- Filings and transmissions ----------

  private async filingList(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<TaxReturnFilingList['items']> {
    const rows = await tx.taxReturnFiling.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [{ createdAt: 'asc' }, { jurisdiction: 'asc' }],
      include: { attempts: { orderBy: [{ transmittedAt: 'desc' }, { createdAt: 'desc' }] } },
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.flatMap((f) => f.attempts.map((a) => a.recordedByUserId)),
    );
    // Federal first, then the states.
    rows.sort((a, b) => Number(b.jurisdiction === 'US') - Number(a.jurisdiction === 'US'));
    return rows.map((f) => ({
      id: f.id,
      jurisdiction: f.jurisdiction,
      filingMethod: f.filingMethod,
      required: f.required,
      status: f.status,
      paperFiledOn: day(f.paperFiledOn),
      refundCents: f.refundCents,
      amountDueCents: f.amountDueCents,
      amountStatus: f.amountStatus,
      attempts: f.attempts.map((a) => ({
        id: a.id,
        submissionId: a.submissionId,
        transmittedAt: a.transmittedAt.toISOString(),
        ackStatus: a.ackStatus,
        acknowledgedAt: iso(a.acknowledgedAt),
        rejectCode: a.rejectCode,
        rejectDescription: a.rejectDescription,
        correctiveAction: a.correctiveAction,
        recordedBy: memberRef(names, a.recordedByUserId),
        createdAt: a.createdAt.toISOString(),
      })),
    }));
  }

  filings(tenant: TenantContext, userId: string, id: string) {
    return this.inFirm(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id);
      return this.filingList(tx, tenant.businessId, id);
    });
  }

  /** The jurisdictions it is filed in; one left out stays, as not required (filings are kept). */
  setFilings(tenant: TenantContext, userId: string, id: string, body: Out<typeof SetFilingsBody>) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const wanted = new Map(body.filings.map((f) => [f.jurisdiction, f]));
      if (wanted.size !== body.filings.length) throw invalid('Each jurisdiction once', 'filings');
      const have = await tx.taxReturnFiling.findMany({
        where: { businessId, taxReturnId: id },
        select: { id: true, jurisdiction: true, filingMethod: true, required: true },
      });
      for (const f of have) {
        const w = wanted.get(f.jurisdiction);
        const data = w
          ? {
              required: w.required,
              ...(w.filingMethod !== f.filingMethod ? { filingMethod: w.filingMethod } : {}),
            }
          : { required: false };
        await tx.taxReturnFiling.update({ where: { id: f.id }, data });
        wanted.delete(f.jurisdiction);
      }
      for (const w of wanted.values()) {
        await tx.taxReturnFiling.create({
          data: {
            businessId,
            taxReturnId: id,
            jurisdiction: w.jurisdiction,
            filingMethod: w.filingMethod,
            required: w.required,
          },
        });
      }
      await this.log(tx, tenant, id, 'filings_changed', {
        jurisdictions: body.filings.map((f) => f.jurisdiction).sort(),
      });
      return this.filingList(tx, businessId, id);
    });
  }

  private async filing(tx: TxClient, businessId: string, id: string, filingId: string) {
    const f = await tx.taxReturnFiling.findFirst({
      where: { businessId, id: filingId, taxReturnId: id },
      select: {
        id: true,
        filingMethod: true,
        refundCents: true,
        amountDueCents: true,
        amountStatus: true,
      },
    });
    if (!f) throw notFound();
    return f;
  }

  updateFiling(
    tenant: TenantContext,
    userId: string,
    id: string,
    filingId: string,
    body: Out<typeof UpdateFilingBody>,
  ) {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const f = await this.filing(tx, businessId, id, filingId);
      const refund = body.refundCents !== undefined ? body.refundCents : f.refundCents;
      const due = body.amountDueCents !== undefined ? body.amountDueCents : f.amountDueCents;
      const status = body.amountStatus !== undefined ? body.amountStatus : f.amountStatus;
      if ((refund ?? 0) > 0 && (due ?? 0) > 0)
        throw invalid('A refund or an amount due, not both', 'amountDueCents');
      if ((refund !== null || due !== null) !== (status !== null)) {
        throw invalid(
          'An amount says whether it is estimated or final, and only an amount does',
          'amountStatus',
        );
      }
      await tx.taxReturnFiling.update({
        where: { id: filingId },
        data: {
          ...(body.required !== undefined ? { required: body.required } : {}),
          ...(body.filingMethod !== undefined ? { filingMethod: body.filingMethod } : {}),
          ...(body.refundCents !== undefined ? { refundCents: body.refundCents } : {}),
          ...(body.amountDueCents !== undefined ? { amountDueCents: body.amountDueCents } : {}),
          ...(body.amountStatus !== undefined ? { amountStatus: body.amountStatus } : {}),
        },
      });
      await this.log(tx, tenant, id, 'filings_changed', { filingId, fields: fields.sort() });
      return this.filingList(tx, businessId, id);
    });
  }

  /** A transmission (or a retransmission after a rejection): 409 ATTEMPT_PENDING otherwise. */
  recordAttempt(
    tenant: TenantContext,
    userId: string,
    id: string,
    filingId: string,
    body: Out<typeof AttemptBody>,
  ) {
    const businessId = tenant.businessId;
    if (Date.parse(body.transmittedAt) > Date.now())
      throw invalid('Not in the future', 'transmittedAt');
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const f = await this.filing(tx, businessId, id, filingId);
      if (f.filingMethod !== 'EFILE')
        throw invalid('A paper filing has no transmissions', 'filingId');
      await tx.taxReturnFilingAttempt
        .create({
          data: {
            businessId,
            filingId,
            submissionId: body.submissionId,
            transmittedAt: new Date(body.transmittedAt),
            recordedByUserId: userId,
          },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) {
            throw conflict(
              'ATTEMPT_PENDING',
              'This submission id is recorded already, or one waits for its answer',
            );
          }
          throw e;
        });
      await this.log(tx, tenant, id, 'transmission', { filingId, action: 'recorded' });
      return this.filingList(tx, businessId, id);
    });
  }

  /** The acknowledgment (accepted or rejected with its code), or the corrective action after it. */
  updateAttempt(
    tenant: TenantContext,
    userId: string,
    id: string,
    attemptId: string,
    body: Out<typeof UpdateAttemptBody>,
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const a = await tx.taxReturnFilingAttempt.findFirst({
        where: { businessId, id: attemptId, filing: { taxReturnId: id } },
        select: { id: true, ackStatus: true, transmittedAt: true },
      });
      if (!a) throw notFound();
      if (body.ackStatus === 'NOTE') {
        await tx.taxReturnFilingAttempt.update({
          where: { id: attemptId },
          data: { correctiveAction: body.correctiveAction ?? null },
        });
      } else {
        if (a.ackStatus !== 'PENDING')
          throw conflict('RETURN_LOCKED', 'This transmission has its answer already');
        if (Date.parse(body.acknowledgedAt) < a.transmittedAt.getTime()) {
          throw invalid('The answer comes after the transmission', 'acknowledgedAt');
        }
        if (body.ackStatus === 'REJECTED' && !body.rejectCode && !body.rejectDescription) {
          throw invalid('Enter the reject code or what was rejected', 'rejectCode');
        }
        await tx.taxReturnFilingAttempt.update({
          where: { id: attemptId },
          data: {
            ackStatus: body.ackStatus,
            acknowledgedAt: new Date(body.acknowledgedAt),
            ...(body.ackStatus === 'REJECTED'
              ? {
                  rejectCode: body.rejectCode ?? null,
                  rejectDescription: body.rejectDescription ?? null,
                  correctiveAction: body.correctiveAction ?? null,
                }
              : {}),
          },
        });
      }
      await this.log(tx, tenant, id, 'transmission', { attemptId, action: body.ackStatus });
      return this.filingList(tx, businessId, id);
    });
  }

  paperFiled(
    tenant: TenantContext,
    userId: string,
    id: string,
    filingId: string,
    body: Out<typeof PaperFiledBody>,
  ) {
    const businessId = tenant.businessId;
    if (body.paperFiledOn > new Date().toISOString().slice(0, 10))
      throw invalid('Not in the future', 'paperFiledOn');
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const f = await this.filing(tx, businessId, id, filingId);
      if (f.filingMethod !== 'PAPER')
        throw invalid('Only a paper filing is filed on paper', 'filingId');
      await tx.taxReturnFiling.update({
        where: { id: filingId },
        data: { status: 'PAPER_FILED', paperFiledOn: toDay(body.paperFiledOn) },
      });
      await this.log(tx, tenant, id, 'transmission', { filingId, action: 'paper_filed' });
      return this.filingList(tx, businessId, id);
    });
  }

  // ---------- Checklists and validation ----------

  private async checklistOf(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<TaxChecklist['items']> {
    const rows = await tx.taxReturnChecklistItem.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [{ section: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.map((r) => r.acknowledgedByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      section: r.section,
      label: r.label,
      sortOrder: r.sortOrder,
      result: r.result,
      note: r.note,
      acknowledgedAt: iso(r.acknowledgedAt),
      acknowledgedBy: memberRef(names, r.acknowledgedByUserId),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  checklist(tenant: TenantContext, userId: string, id: string) {
    return this.inFirm(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id);
      return this.checklistOf(tx, tenant.businessId, id);
    });
  }

  private resultFits(section: string, result: string) {
    const validation = ['VALID', 'INFO', 'WARNING', 'ERROR'].includes(result);
    if ((section === 'VALIDATION') !== validation) {
      throw invalid(
        section === 'VALIDATION'
          ? 'A validation line is valid, info, a warning or an error'
          : 'A checklist line is open or done',
        'result',
      );
    }
  }

  addChecklistItem(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ChecklistItemBody>,
  ) {
    const businessId = tenant.businessId;
    const result = body.result ?? (body.section === 'VALIDATION' ? undefined : 'OPEN');
    if (!result) throw invalid('Give a validation line its result', 'result');
    this.resultFits(body.section, result);
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const top = await tx.taxReturnChecklistItem.aggregate({
        where: { businessId, taxReturnId: id, section: body.section },
        _max: { sortOrder: true },
      });
      await tx.taxReturnChecklistItem.create({
        data: {
          businessId,
          taxReturnId: id,
          section: body.section,
          label: body.label,
          result,
          note: body.note ?? null,
          sortOrder: (top._max.sortOrder ?? -1) + 1,
          updatedByUserId: userId,
        },
      });
      await this.log(tx, tenant, id, 'checklist_changed', {
        section: body.section,
        action: 'added',
      });
      return this.checklistOf(tx, businessId, id);
    });
  }

  updateChecklistItem(
    tenant: TenantContext,
    userId: string,
    id: string,
    itemId: string,
    body: Out<typeof UpdateChecklistItemBody>,
  ) {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const item = await tx.taxReturnChecklistItem.findFirst({
        where: { businessId, id: itemId, taxReturnId: id },
        select: { section: true, result: true },
      });
      if (!item) throw notFound();
      if (body.result !== undefined) this.resultFits(item.section, body.result);
      const result = body.result ?? item.result;
      if (body.acknowledge && result !== 'WARNING')
        throw invalid('Only a warning is acknowledged', 'acknowledge');
      await tx.taxReturnChecklistItem.update({
        where: { id: itemId },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.result !== undefined ? { result: body.result } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.acknowledge === true
            ? { acknowledgedAt: new Date(), acknowledgedByUserId: userId }
            : {}),
          ...(body.acknowledge === false
            ? { acknowledgedAt: null, acknowledgedByUserId: null }
            : {}),
          updatedByUserId: userId,
        },
      });
      await this.log(tx, tenant, id, 'checklist_changed', { itemId, fields: fields.sort() });
      return this.checklistOf(tx, businessId, id);
    });
  }

  removeChecklistItem(tenant: TenantContext, userId: string, id: string, itemId: string) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const item = await tx.taxReturnChecklistItem.findFirst({
        where: { businessId, id: itemId, taxReturnId: id },
        select: { id: true },
      });
      if (!item) throw notFound();
      await tx.taxReturnChecklistItem.delete({ where: { id: itemId } });
      await this.log(tx, tenant, id, 'checklist_changed', { itemId, action: 'removed' });
      return this.checklistOf(tx, businessId, id);
    });
  }

  /** Run Final Validation: recorded when no line is an error and every warning is acknowledged. */
  async finalValidation(
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<TaxReturnDetail> {
    await this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const lines = await tx.taxReturnChecklistItem.findMany({
        where: { businessId: tenant.businessId, taxReturnId: id, section: 'VALIDATION' },
        select: { result: true, acknowledgedAt: true },
      });
      if (
        lines.some((l) => l.result === 'ERROR' || (l.result === 'WARNING' && !l.acknowledgedAt))
      ) {
        const r = await tx.taxReturn.findUniqueOrThrow({ where: { id }, select: detailSelect });
        throw conflict('STATUS_BLOCKED', 'Fix the errors and acknowledge the warnings first', {
          blockers: blockersOf(r),
        });
      }
      await tx.taxReturn.update({
        where: { id },
        data: {
          finalValidatedAt: new Date(),
          finalValidatedByUserId: userId,
          updatedByUserId: userId,
        },
      });
      await this.log(tx, tenant, id, 'final_validation');
    });
    return this.returns.get(tenant, userId, id, false);
  }

  // ---------- Approvals ----------

  private async approvalsOf(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<TaxApprovalList['items']> {
    const rows = await tx.taxReturnApproval.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { approvedDocument: { select: { id: true, fileName: true } } },
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.flatMap((r) => [r.assignedUserId, r.decidedByUserId]),
    );
    return rows.map((r) => ({
      id: r.id,
      step: r.step,
      sortOrder: r.sortOrder,
      assignedTo: memberRef(names, r.assignedUserId),
      status: r.status,
      decidedAt: iso(r.decidedAt),
      decidedBy: memberRef(names, r.decidedByUserId),
      approvedDocument: r.approvedDocument,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  approvals(tenant: TenantContext, userId: string, id: string) {
    return this.inFirm(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id);
      return this.approvalsOf(tx, tenant.businessId, id);
    });
  }

  addApproval(tenant: TenantContext, userId: string, id: string, body: Out<typeof ApprovalBody>) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      await this.activeMember(tx, businessId, body.assignedUserId);
      const top = await tx.taxReturnApproval.aggregate({
        where: { businessId, taxReturnId: id },
        _max: { sortOrder: true },
      });
      await tx.taxReturnApproval.create({
        data: {
          businessId,
          taxReturnId: id,
          step: body.step,
          assignedUserId: body.assignedUserId ?? null,
          sortOrder: (top._max.sortOrder ?? -1) + 1,
        },
      });
      await this.log(tx, tenant, id, 'approval', { action: 'added' });
      return this.approvalsOf(tx, businessId, id);
    });
  }

  /** Approve or return a step: its assignee, or a member with the grid's APPROVE. */
  private async decide(
    tenant: TenantContext,
    userId: string,
    id: string,
    approvalId: string,
    decision:
      | { status: 'APPROVED'; approvedDocumentId?: string | null; note?: string | null }
      | { status: 'RETURNED'; note: string },
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const step = await tx.taxReturnApproval.findFirst({
        where: { businessId, id: approvalId, taxReturnId: id },
        select: { status: true, assignedUserId: true },
      });
      if (!step) throw notFound();
      if (step.assignedUserId !== userId) {
        const role = tenant.role as Parameters<PermissionGrantsService['can']>[1];
        if (!(await this.grants.can(businessId, role, 'TAX_RETURNS', 'APPROVE'))) {
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message: 'This step is for its reviewer or an approver',
          });
        }
      }
      if (step.status !== 'PENDING')
        throw conflict('RETURN_LOCKED', 'This step is decided already');
      await tx.taxReturnApproval.update({
        where: { id: approvalId },
        data: {
          status: decision.status,
          decidedAt: new Date(),
          decidedByUserId: userId,
          note: decision.note ?? null,
          ...(decision.status === 'APPROVED'
            ? { approvedDocumentId: decision.approvedDocumentId ?? null }
            : {}),
        },
      });
      await this.log(tx, tenant, id, 'approval', { approvalId, action: decision.status });
      return this.approvalsOf(tx, businessId, id);
    });
  }

  approve(
    tenant: TenantContext,
    userId: string,
    id: string,
    approvalId: string,
    body: Out<typeof ApproveBody>,
  ) {
    return this.decide(tenant, userId, id, approvalId, { status: 'APPROVED', ...body });
  }

  returnStep(
    tenant: TenantContext,
    userId: string,
    id: string,
    approvalId: string,
    body: Out<typeof ReturnApprovalBody>,
  ) {
    return this.decide(tenant, userId, id, approvalId, { status: 'RETURNED', note: body.note });
  }

  // ---------- Authorizations ----------

  private async authorizationsOf(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<TaxAuthorizationList['items']> {
    const rows = await tx.taxReturnAuthorization.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [{ kind: 'asc' }, { jurisdiction: 'asc' }],
      include: {
        esignRequest: { select: { status: true } },
        document: { select: { id: true, fileName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      jurisdiction: r.jurisdiction,
      required: r.required,
      status: r.signedOn ? 'SIGNED' : (r.esignRequest?.status ?? 'NOT_SENT'),
      esignRequestId: r.esignRequestId,
      signedOn: day(r.signedOn),
      document: r.document,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  authorizations(tenant: TenantContext, userId: string, id: string) {
    return this.inFirm(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id);
      return this.authorizationsOf(tx, tenant.businessId, id);
    });
  }

  /** The authorizations the return needs; one left out stays, as not required (never deleted). */
  setAuthorizations(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SetAuthorizationsBody>,
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const keyOf = (a: { kind: string; jurisdiction?: string | null }) =>
        `${a.kind}:${a.jurisdiction ?? ''}`;
      const wanted = new Map(body.items.map((a) => [keyOf(a), a]));
      if (wanted.size !== body.items.length) throw invalid('Each authorization once', 'items');
      const have = await tx.taxReturnAuthorization.findMany({
        where: { businessId, taxReturnId: id },
        select: { id: true, kind: true, jurisdiction: true },
      });
      for (const a of have) {
        const w = wanted.get(keyOf(a));
        await tx.taxReturnAuthorization.update({
          where: { id: a.id },
          data: { required: w ? w.required : false },
        });
        wanted.delete(keyOf(a));
      }
      for (const w of wanted.values()) {
        await tx.taxReturnAuthorization.create({
          data: {
            businessId,
            taxReturnId: id,
            kind: w.kind,
            jurisdiction: w.jurisdiction ?? null,
            required: w.required,
          },
        });
      }
      await this.log(tx, tenant, id, 'authorization', { action: 'set', count: body.items.length });
      return this.authorizationsOf(tx, businessId, id);
    });
  }

  private async authorization(
    tx: TxClient,
    businessId: string,
    id: string,
    authorizationId: string,
  ) {
    const a = await tx.taxReturnAuthorization.findFirst({
      where: { businessId, id: authorizationId, taxReturnId: id },
      select: { id: true },
    });
    if (!a) throw notFound();
  }

  linkAuthorization(
    tenant: TenantContext,
    userId: string,
    id: string,
    authorizationId: string,
    body: Out<typeof LinkAuthorizationBody>,
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id, true);
      await this.authorization(tx, businessId, id, authorizationId);
      const esign = await tx.esignRequest.findFirst({
        where: { businessId, id: body.esignRequestId },
        select: { id: true, clientId: true },
      });
      if (!esign) throw notFound();
      if (esign.clientId !== r.clientId)
        throw conflict('INVALID_DOCUMENT', "This request is not this client's");
      await tx.taxReturnAuthorization.update({
        where: { id: authorizationId },
        data: { esignRequestId: body.esignRequestId },
      });
      await this.log(tx, tenant, id, 'authorization', { authorizationId, action: 'linked' });
      return this.authorizationsOf(tx, businessId, id);
    });
  }

  wetSignature(
    tenant: TenantContext,
    userId: string,
    id: string,
    authorizationId: string,
    body: Out<typeof WetSignatureBody>,
  ) {
    const businessId = tenant.businessId;
    if (body.signedOn > new Date().toISOString().slice(0, 10))
      throw invalid('Not in the future', 'signedOn');
    return this.write(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id, true);
      await this.authorization(tx, businessId, id, authorizationId);
      const doc = await tx.document.findFirst({
        where: { businessId, id: body.documentId },
        select: { clientId: true },
      });
      if (!doc) throw notFound();
      if (doc.clientId !== r.clientId)
        throw conflict('INVALID_DOCUMENT', "This file is not this client's");
      await tx.taxReturnAuthorization.update({
        where: { id: authorizationId },
        data: { signedOn: toDay(body.signedOn), documentId: body.documentId },
      });
      await this.log(tx, tenant, id, 'authorization', {
        authorizationId,
        action: 'signed_on_paper',
      });
      return this.authorizationsOf(tx, businessId, id);
    });
  }

  // ---------- Documents ----------

  private async documentsOf(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<TaxReturnDocumentList['items']> {
    const rows = await tx.taxReturnDocument.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { document: { select: { id: true, fileName: true, scanStatus: true } } },
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.map((r) => r.createdByUserId),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      jurisdiction: r.jurisdiction,
      document: r.document,
      addedBy: memberRef(names, r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  documents(tenant: TenantContext, userId: string, id: string) {
    return this.inFirm(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id);
      return this.documentsOf(tx, tenant.businessId, id);
    });
  }

  linkDocument(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof LinkDocumentBody>,
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id, true);
      const doc = await tx.document.findFirst({
        where: { businessId, id: body.documentId },
        select: { clientId: true },
      });
      if (!doc) throw notFound();
      if (doc.clientId !== r.clientId)
        throw conflict('INVALID_DOCUMENT', "This file is not this client's");
      await tx.taxReturnDocument
        .create({
          data: {
            businessId,
            taxReturnId: id,
            documentId: body.documentId,
            kind: body.kind,
            jurisdiction: body.jurisdiction ?? null,
            createdByUserId: userId,
          },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e))
            throw conflict('INVALID_DOCUMENT', 'This file is linked to the return already');
          throw e;
        });
      await this.log(tx, tenant, id, 'document', { documentId: body.documentId, kind: body.kind });
      return this.documentsOf(tx, businessId, id);
    });
  }

  async unlinkDocument(
    tenant: TenantContext,
    userId: string,
    id: string,
    documentId: string,
  ): Promise<{ ok: true }> {
    const businessId = tenant.businessId;
    await this.write(tenant, async (tx) => {
      await this.reach(tx, tenant, userId, id, true);
      const link = await tx.taxReturnDocument.findFirst({
        where: { businessId, taxReturnId: id, documentId },
        select: { id: true, kind: true },
      });
      if (!link) throw notFound();
      if (link.kind === 'FILED_RETURN' || link.kind === 'ACKNOWLEDGMENT') {
        throw conflict('DOCUMENT_LOCKED', 'The filed return and acknowledgment stay linked');
      }
      await tx.taxReturnDocument.delete({ where: { id: link.id } });
      await this.log(tx, tenant, id, 'document', { documentId, action: 'unlinked' });
    });
    return { ok: true };
  }

  // ---------- Reports ----------

  async efileReport(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof EfileQ>,
  ): Promise<EfileReport> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const reach = returnReach(tenant, userId);
      const latest = await tx.taxReturn.findFirst({
        where: { AND: [{ businessId, archivedAt: null }, reach] },
        orderBy: { taxYear: 'desc' },
        select: { taxYear: true },
      });
      const taxYear = q.taxYear ?? latest?.taxYear ?? new Date().getUTCFullYear() - 1;
      const filings = await tx.taxReturnFiling.findMany({
        where: { businessId, taxReturn: { AND: [{ taxYear, archivedAt: null }, reach] } },
        select: {
          jurisdiction: true,
          status: true,
          taxReturnId: true,
          taxReturn: { select: { client: { select: { displayName: true } } } },
          attempts: {
            where: { ackStatus: 'REJECTED' },
            orderBy: { acknowledgedAt: 'desc' },
            take: 1,
            select: { rejectCode: true, acknowledgedAt: true },
          },
        },
      });
      const by = new Map<string, EfileReport['byJurisdiction'][number]>();
      for (const f of filings) {
        const row = by.get(f.jurisdiction) ?? {
          jurisdiction: f.jurisdiction,
          notFiled: 0,
          transmitted: 0,
          accepted: 0,
          rejected: 0,
          paperFiled: 0,
        };
        const key = {
          NOT_FILED: 'notFiled',
          TRANSMITTED: 'transmitted',
          ACCEPTED: 'accepted',
          REJECTED: 'rejected',
          PAPER_FILED: 'paperFiled',
        } as const;
        row[key[f.status]]++;
        by.set(f.jurisdiction, row);
      }
      const rejections = filings
        .filter((f) => f.status === 'REJECTED' && f.attempts[0]?.acknowledgedAt)
        .map((f) => ({
          taxReturnId: f.taxReturnId,
          clientName: f.taxReturn.client.displayName,
          jurisdiction: f.jurisdiction,
          rejectCode: f.attempts[0]!.rejectCode,
          acknowledgedAt: f.attempts[0]!.acknowledgedAt!.toISOString(),
        }))
        .sort((a, b) => b.acknowledgedAt.localeCompare(a.acknowledgedAt))
        .slice(0, 200);
      const order = (j: string) => (j === 'US' ? '' : j);
      return {
        taxYear,
        byJurisdiction: [...by.values()].sort((a, b) =>
          order(a.jurisdiction).localeCompare(order(b.jurisdiction)),
        ),
        rejections,
      };
    });
  }

  /** Print/Export List (EXPORT): the filtered list as CSV, SSN/EIN as their last four only. */
  async exportList(
    tenant: TenantContext,
    userId: string,
    q: Out<typeof ReturnsQ>,
  ): Promise<TaxReturnExportLink> {
    if (
      tenant.role === 'STAFF' &&
      !(await this.grants.can(tenant.businessId, 'STAFF', 'TAX_RETURNS', 'EXPORT'))
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action',
      });
    }
    const rows: string[][] = [];
    for (let page = 1; page <= 50; page++) {
      const part = await this.returns.list(tenant, userId, { ...q, page, pageSize: 100 });
      for (const r of part.items) {
        rows.push([
          r.client.name,
          r.client.maskedId ?? '',
          String(r.taxYear),
          r.formType ?? '',
          r.quarter ? `Q${String(r.quarter)}` : '',
          r.workflowStatus,
          r.preparer?.name ?? '',
          r.reviewer?.name ?? '',
          r.dueOn ?? '',
          r.updatedAt.slice(0, 10),
        ]);
      }
      if (page * 100 >= part.total) break;
    }
    const cell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const quote = (v: string) => `"${cell(v).replace(/"/g, '""')}"`;
    const head = [
      'Client',
      'SSN/EIN',
      'Tax year',
      'Form',
      'Quarter',
      'Status',
      'Preparer',
      'Reviewer',
      'Due',
      'Updated',
    ];
    const BOM = '\uFEFF';
    const csv = `${BOM}${[head, ...rows].map((r) => r.map(quote).join(',')).join('\r\n')}\r\n`;
    const key = `tenant/${tenant.businessId}/reports/tax-returns-${randomUUID()}.csv`;
    const fileName = `tax-returns-${new Date().toISOString().slice(0, 10)}.csv`;
    let url: string;
    try {
      await this.files.put(key, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
      url = await this.files.presignDownload({ key, fileName, contentType: 'text/csv' });
    } catch {
      throw new ServiceUnavailableException({
        code: 'FILE_STORE_UNAVAILABLE',
        message: 'The file could not be saved. Try again shortly.',
      });
    }
    await this.audit.log('tax_returns.exported', { type: 'tax_return' }, { rows: rows.length });
    return {
      url,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      fileName,
      rowCount: rows.length,
    };
  }
}
