import { BadRequestException, ConflictException, type HttpException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  TaxReturnBlocker,
  TaxReturnDetail,
  TaxReturnRow,
  TaxReturnWorkflowStatus,
} from '@firmivra/types';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { memberRef } from '../workspaces/common.js';

// Shared by the Tax Returns workspace (R55; contract packages/types/src/tax-returns/workspace.ts).

export const invalid = (message: string, path?: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message, ...(path ? { path } : {}) });
export const conflict = (code: string, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details ? { details } : {}) });

/** The database's step of each workflow status (tax_return_step); Waiting on Client has none. */
export const STEP: Partial<Record<TaxReturnWorkflowStatus, number>> = {
  IN_PREPARATION: 1,
  READY_FOR_REVIEW: 2,
  READY_FOR_SIGNATURE: 3,
  READY_TO_FILE: 4,
  TRANSMITTED: 5,
  REJECTED: 6,
  ACCEPTED: 7,
  CLOSED: 8,
};
const ALL: TaxReturnWorkflowStatus[] = [
  'IN_PREPARATION',
  'WAITING_ON_CLIENT',
  'READY_FOR_REVIEW',
  'READY_FOR_SIGNATURE',
  'READY_TO_FILE',
  'TRANSMITTED',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
];

/** Where the database lets a return go from its workflow status (tax_returns_0_workflow). */
export function canMoveTo(from: TaxReturnWorkflowStatus): TaxReturnWorkflowStatus[] {
  if (from === 'TRANSMITTED') return ['ACCEPTED', 'REJECTED', 'CLOSED'];
  if (from === 'ACCEPTED') return ['CLOSED'];
  if (from === 'CLOSED') return [];
  return ALL.filter((s) => s !== from);
}

/** Going back a step (it needs a reason). */
export const isBackward = (from: TaxReturnWorkflowStatus, to: TaxReturnWorkflowStatus) =>
  STEP[from] !== undefined && STEP[to] !== undefined && STEP[to]! < STEP[from]!;

/** Staff reach the returns of the clients assigned to them; Owner and Admin every one. */
export function returnReach(tenant: TenantContext, userId: string): Prisma.TaxReturnWhereInput {
  const role = legacyFirmRole(tenant.role as Parameters<typeof legacyFirmRole>[0]);
  return role === 'STAFF' ? { client: { assignedUserId: userId } } : {};
}

export const rowSelect = {
  id: true,
  taxYear: true,
  filingType: true,
  quarter: true,
  formType: true,
  workflowStatus: true,
  status: true,
  preparerUserId: true,
  reviewerUserId: true,
  dueOn: true,
  amendsReturnId: true,
  estimateAmountCents: true,
  estimateStatus: true,
  estimatePaidOn: true,
  archivedAt: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      displayName: true,
      accountType: true,
      email: true,
      phone: true,
      profile: { select: { ssnLast4: true, einLast4: true } },
    },
  },
} satisfies Prisma.TaxReturnSelect;
export type RowSource = Prisma.TaxReturnGetPayload<{ select: typeof rowSelect }>;

export const detailSelect = {
  ...rowSelect,
  statusReason: true,
  filingStatus: true,
  amendReason: true,
  finalValidatedAt: true,
  finalValidatedByUserId: true,
  importSource: true,
  importedAt: true,
  filedOn: true,
  firstFiledAt: true,
  createdAt: true,
  engagement: { select: { id: true, title: true } },
  document: { select: { id: true, fileName: true } },
  amends: { select: { id: true, taxYear: true, formType: true, firstFiledAt: true } },
  amendedBy: { select: { id: true, workflowStatus: true }, orderBy: { createdAt: 'asc' } },
  checklist: {
    where: { section: 'VALIDATION' },
    select: { result: true, acknowledgedAt: true },
  },
  approvals: { select: { status: true } },
  authorizations: {
    where: { required: true },
    select: { signedOn: true, esignRequest: { select: { status: true } } },
  },
  filings: { where: { required: true }, select: { status: true } },
} satisfies Prisma.TaxReturnSelect;
export type DetailSource = Prisma.TaxReturnGetPayload<{ select: typeof detailSelect }>;

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const today = () => new Date().toISOString().slice(0, 10);

/** "***-**-1234" for a person, "**-***1234" for a business, from the last four only. */
function maskedId(c: RowSource['client']): string | null {
  if (c.profile?.ssnLast4) return `***-**-${c.profile.ssnLast4}`;
  if (c.profile?.einLast4) return `**-***${c.profile.einLast4}`;
  return null;
}

export function toRow(r: RowSource, names: Map<string, string>): TaxReturnRow {
  return {
    id: r.id,
    client: {
      id: r.client.id,
      name: r.client.displayName,
      accountType: r.client.accountType,
      maskedId: maskedId(r.client),
    },
    taxYear: r.taxYear,
    filingType: r.filingType,
    quarter: r.quarter,
    formType: r.formType,
    workflowStatus: r.workflowStatus,
    status: r.status,
    preparer: memberRef(names, r.preparerUserId),
    reviewer: memberRef(names, r.reviewerUserId),
    dueOn: day(r.dueOn),
    amendsReturnId: r.amendsReturnId,
    estimate:
      r.quarter === null
        ? null
        : {
            amountCents: r.estimateAmountCents,
            status: r.estimateStatus,
            paidOn: day(r.estimatePaidOn),
            overdue: r.estimateStatus !== 'PAID' && !!r.dueOn && day(r.dueOn)! < today(),
          },
    archivedAt: r.archivedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Next Steps: what the database would refuse on the way to Ready to File, Transmitted, Accepted. */
export function blockersOf(r: DetailSource): TaxReturnBlocker[] {
  const out: TaxReturnBlocker[] = [];
  const step = STEP[r.workflowStatus] ?? 0;
  if (step < 4) {
    if (r.checklist.length > 0) {
      if (!r.finalValidatedAt) out.push('VALIDATION_NOT_RUN');
      if (r.checklist.some((c) => c.result === 'ERROR')) out.push('VALIDATION_ERRORS');
      if (r.checklist.some((c) => c.result === 'WARNING' && !c.acknowledgedAt)) {
        out.push('WARNINGS_NOT_ACKNOWLEDGED');
      }
    }
    if (r.approvals.some((a) => a.status === 'PENDING')) out.push('APPROVAL_PENDING');
    if (r.approvals.some((a) => a.status === 'RETURNED')) out.push('APPROVAL_RETURNED');
    if (r.authorizations.some((a) => !a.signedOn && a.esignRequest?.status !== 'COMPLETED')) {
      out.push('AUTHORIZATION_UNSIGNED');
    }
  }
  if (r.filings.length > 0) {
    const done = (s: string) => s === 'ACCEPTED' || s === 'PAPER_FILED';
    if (step === 4 && !r.filings.some((f) => f.status === 'TRANSMITTED' || done(f.status))) {
      out.push('NO_FILING_TRANSMITTED');
    }
    if ((step === 5 || step === 6) && !r.filings.every((f) => done(f.status))) {
      out.push('FILINGS_NOT_ACCEPTED');
    }
  }
  if (r.amends && !r.amends.firstFiledAt) out.push('ORIGINAL_NOT_FILED');
  return out;
}

export function toDetail(r: DetailSource, names: Map<string, string>): TaxReturnDetail {
  const row = toRow(r, names);
  return {
    ...row,
    client: { ...row.client, email: r.client.email, phone: r.client.phone },
    engagement: r.engagement,
    statusReason: r.statusReason,
    filingStatus: r.filingStatus,
    amends: r.amends
      ? { id: r.amends.id, taxYear: r.amends.taxYear, formType: r.amends.formType }
      : null,
    amendReason: r.amendReason,
    amendedBy: r.amendedBy,
    finalValidatedAt: r.finalValidatedAt?.toISOString() ?? null,
    finalValidatedBy: memberRef(names, r.finalValidatedByUserId),
    importSource: r.importSource,
    importedAt: r.importedAt?.toISOString() ?? null,
    filedOn: day(r.filedOn),
    firstFiledAt: r.firstFiledAt?.toISOString() ?? null,
    document: r.document,
    canMoveTo: canMoveTo(r.workflowStatus),
    blockers: blockersOf(r),
    createdAt: r.createdAt.toISOString(),
  };
}

/** The SQLSTATE and message behind a Prisma error from the pg adapter. */
function causeOf(error: unknown): { code?: string; message: string } {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { originalCode?: unknown; originalMessage?: unknown } | undefined;
  return {
    code: typeof cause?.originalCode === 'string' ? cause.originalCode : undefined,
    message: typeof cause?.originalMessage === 'string' ? cause.originalMessage : '',
  };
}

/**
 * The database's refusal of a workspace write (R37's tax return triggers raise 23514) as the
 * contract's answer, never a 500: a move it refuses is 409 STATUS_BLOCKED, a step back without a
 * reason 400 REASON_REQUIRED, an unfiled original 409 ORIGINAL_NOT_FILED, anything that is fixed
 * once filed, transmitted or decided 409 RETURN_LOCKED, another client's file 409 INVALID_DOCUMENT.
 */
export function workspaceRefusal(error: unknown): HttpException | undefined {
  const { code, message } = causeOf(error);
  if (code !== '23514') return undefined;
  if (message.includes('moving back a step needs a reason')) {
    return new BadRequestException({
      code: 'REASON_REQUIRED',
      message: 'Say why it goes back a step',
    });
  }
  if (message.includes('amends a return that was filed')) {
    return conflict('ORIGINAL_NOT_FILED', 'An amended return amends a return that was filed');
  }
  if (message.includes('a new attempt follows a rejection')) {
    return conflict('ATTEMPT_PENDING', 'Record the answer to the last transmission first');
  }
  if (message.includes('stay linked')) {
    return conflict('DOCUMENT_LOCKED', 'The filed return and acknowledgment stay linked');
  }
  if (
    message.includes("is a document of the return's client") ||
    message.includes("the return's client's")
  ) {
    return conflict('INVALID_DOCUMENT', "The file or request is not this client's");
  }
  if (
    message.startsWith('tax returns: finish') ||
    message.startsWith('tax returns: every') ||
    message.startsWith('tax returns: record a transmission') ||
    message.startsWith('tax returns: a return that was filed cannot go')
  ) {
    return conflict('STATUS_BLOCKED', message.replace(/^tax returns: /, ''));
  }
  if (message.startsWith('tax return')) {
    return conflict('RETURN_LOCKED', message.replace(/^tax return[a-z ]*: /, ''));
  }
  // Any other rule of the table (a CHECK constraint): refused, never a 500.
  return conflict('RETURN_LOCKED', 'The return cannot change this way');
}
