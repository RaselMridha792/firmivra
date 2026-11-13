import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { TaxValidationIssueList } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { memberNames, memberRef, notAMember } from '../workspaces/common.js';
import { notFound } from './tax-return-rules.js';
import { conflict, invalid, returnReach, workspaceRefusal } from './workspace.common.js';
import type { IssueBody, UpdateIssueBody } from './workspace.input.js';

type Out<S extends z.ZodType> = z.output<S>;
type Items = TaxValidationIssueList['items'];

// Octavia's TX-F19 and F20 (Oct 26 review) on R1's tax_return_validation_issues (#1172): a
// problem the reviewer found and handed to someone, with its severity, the version it was found in
// and the checklist line it belongs to. An unresolved ERROR blocks Ready to File and every filing
// (a transmission or a paper filing); a MANUAL_WARNING needs review but never blocks; INFO never
// blocks. Resolved, never deleted. Audited on the return with ids only (never the note).

/** TX-F20: how many of the return's Error issues are unresolved (each blocks filing). */
export function openErrorIssues(tx: TxClient, businessId: string, taxReturnId: string) {
  return tx.taxReturnValidationIssue.count({
    where: { businessId, taxReturnId, severity: 'ERROR', resolvedAt: null },
  });
}

export const ISSUES_BLOCK = 'Resolve the validation errors first';

@Injectable()
export class TaxReturnIssuesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
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
      select: { id: true, reviewerUserId: true },
    });
    if (!r) throw notFound();
    return r;
  }

  /** TX-F18's override: an Owner, or an Admin whose grid keeps APPROVE on Tax Returns. */
  private async mayOverride(tenant: TenantContext): Promise<boolean> {
    if (tenant.kind !== 'staff') return false;
    const role = legacyFirmRole(tenant.role);
    if (role !== 'OWNER' && role !== 'ADMIN') return false;
    return this.grants.canTenant(tenant, 'TAX_RETURNS', 'APPROVE');
  }

  /**
   * Who may resolve or reopen an issue: who raised it, or the return's reviewer; a Manual Warning
   * or Info issue also the person responsible. Anyone else only as the override (recorded).
   */
  private static responsible(
    issue: { severity: string; createdByUserId: string; responsibleUserId: string | null },
    reviewerUserId: string | null,
    userId: string,
  ) {
    return (
      issue.createdByUserId === userId ||
      reviewerUserId === userId ||
      (issue.severity !== 'ERROR' && issue.responsibleUserId === userId)
    );
  }

  private log(tx: TxClient, tenant: TenantContext, id: string, metadata: Record<string, unknown>) {
    return this.audit.logIn(tx, 'tax_return.issue', { type: 'tax_return', id }, metadata, {
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

  private async issuesOf(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    reviewerUserId: string | null,
  ): Promise<Items> {
    const businessId = tenant.businessId;
    // Open first, Errors first, then the newest.
    const rows = await tx.taxReturnValidationIssue.findMany({
      where: { businessId, taxReturnId: id },
      orderBy: [
        { resolvedAt: { sort: 'asc', nulls: 'first' } },
        { severity: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        draft: { select: { document: { select: { id: true, fileName: true } } } },
        step: { select: { id: true, label: true } },
      },
    });
    const override = await this.mayOverride(tenant);
    const names = await memberNames(
      tx,
      businessId,
      rows.flatMap((r) => [r.responsibleUserId, r.createdByUserId, r.resolvedByUserId]),
    );
    return rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      note: r.note,
      responsible: memberRef(names, r.responsibleUserId),
      draft: r.draft?.document ?? null,
      step: r.step,
      raisedBy: memberRef(names, r.createdByUserId),
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: memberRef(names, r.resolvedByUserId),
      canResolve: TaxReturnIssuesService.responsible(r, reviewerUserId, userId) || override,
    }));
  }

  list(tenant: TenantContext, userId: string, id: string): Promise<Items> {
    return this.inFirm(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id);
      return this.issuesOf(tx, tenant, userId, id, r.reviewerUserId);
    });
  }

  raise(tenant: TenantContext, userId: string, id: string, body: Out<typeof IssueBody>) {
    return this.write(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id, true);
      await this.createIn(tx, tenant, userId, id, body);
      return this.issuesOf(tx, tenant, userId, id, r.reviewerUserId);
    });
  }

  /**
   * Raises an issue on a return the caller has reached and locked (Return to Preparer uses it
   * too): the person responsible is an active member, the version one of the return's draft
   * returns, the line one of its checklist lines. Returns its id.
   */
  async createIn(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof IssueBody>,
  ): Promise<string> {
    const businessId = tenant.businessId;
    await this.activeMember(tx, businessId, body.responsibleUserId);
    if (body.draftDocumentId) {
      const draft = await tx.taxReturnDocument.findFirst({
        where: {
          businessId,
          taxReturnId: id,
          documentId: body.draftDocumentId,
          kind: 'DRAFT_RETURN',
        },
        select: { documentId: true },
      });
      if (!draft) {
        throw conflict('INVALID_DOCUMENT', "Choose one of this return's draft returns");
      }
    }
    if (body.checklistItemId) {
      const line = await tx.taxReturnChecklistItem.findFirst({
        where: { businessId, taxReturnId: id, id: body.checklistItemId },
        select: { id: true },
      });
      if (!line) throw invalid("Choose one of this return's checklist lines", 'checklistItemId');
    }
    const row = await tx.taxReturnValidationIssue.create({
      data: {
        businessId,
        taxReturnId: id,
        severity: body.severity,
        note: body.note,
        responsibleUserId: body.responsibleUserId ?? null,
        draftDocumentId: body.draftDocumentId ?? null,
        checklistItemId: body.checklistItemId ?? null,
        createdByUserId: userId,
      },
      select: { id: true },
    });
    await this.log(tx, tenant, id, {
      issueId: row.id,
      action: 'raised',
      severity: body.severity,
    });
    return row.id;
  }

  /** TX-F19: the open issues a reviewer names when returning the return to its preparer. */
  async openOf(tx: TxClient, businessId: string, id: string, issueIds: string[]) {
    const wanted = [...new Set(issueIds)];
    const rows = await tx.taxReturnValidationIssue.findMany({
      where: { businessId, taxReturnId: id, id: { in: wanted } },
      select: { id: true, resolvedAt: true },
    });
    if (rows.length !== wanted.length) throw notFound();
    if (rows.some((r) => r.resolvedAt)) {
      throw invalid('Name only the issues still open', 'issueIds');
    }
    return wanted;
  }

  update(
    tenant: TenantContext,
    userId: string,
    id: string,
    issueId: string,
    body: Out<typeof UpdateIssueBody>,
  ) {
    const businessId = tenant.businessId;
    return this.write(tenant, async (tx) => {
      const r = await this.reach(tx, tenant, userId, id, true);
      const issue = await tx.taxReturnValidationIssue.findFirst({
        where: { businessId, id: issueId, taxReturnId: id },
        select: {
          severity: true,
          createdByUserId: true,
          responsibleUserId: true,
          resolvedAt: true,
        },
      });
      if (!issue) throw notFound();
      if (body.resolved !== undefined && body.resolved !== (issue.resolvedAt !== null)) {
        const own = TaxReturnIssuesService.responsible(issue, r.reviewerUserId, userId);
        if (!own && !(await this.mayOverride(tenant))) {
          throw new ForbiddenException({
            code: 'FORBIDDEN',
            message:
              issue.severity === 'ERROR'
                ? "Only who raised it or the return's reviewer, or an Owner or Admin, can resolve this error"
                : "Only who raised it, the person responsible or the return's reviewer, or an Owner or Admin, can resolve this issue",
          });
        }
        await tx.taxReturnValidationIssue.update({
          where: { id: issueId },
          data: body.resolved
            ? { resolvedAt: new Date(), resolvedByUserId: userId }
            : { resolvedAt: null, resolvedByUserId: null },
        });
        await this.log(tx, tenant, id, {
          issueId,
          action: body.resolved ? 'resolved' : 'reopened',
          severity: issue.severity,
          ...(own ? {} : { override: true }),
        });
      }
      if (
        body.responsibleUserId !== undefined &&
        body.responsibleUserId !== issue.responsibleUserId
      ) {
        await this.activeMember(tx, businessId, body.responsibleUserId);
        await tx.taxReturnValidationIssue.update({
          where: { id: issueId },
          data: { responsibleUserId: body.responsibleUserId },
        });
        await this.log(tx, tenant, id, {
          issueId,
          action: 'reassigned',
          responsibleUserId: body.responsibleUserId,
        });
      }
      return this.issuesOf(tx, tenant, userId, id, r.reviewerUserId);
    });
  }
}
