import { z } from 'zod';
import { CalendarDate, MemberRef, TaxYear } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  ClientAccountType,
  EsignRequestStatus,
  TaxAckStatus,
  TaxAmountStatus,
  TaxApprovalStatus,
  TaxAuthorizationKind,
  TaxChecklistSection,
  TaxCheckResult,
  TaxEstimateStatus,
  TaxFilingMethod,
  TaxFilingType,
  TaxJurisdictionStatus,
  TaxpayerFilingStatus,
  TaxReturnDocumentKind,
  TaxReturnStatus,
  TaxReturnWorkflowStatus,
} from '../db-enums.js';

// The Tax Returns workspace (R55 contract, for R56's screens): Frame 1 the overview (tabs, KPI
// cards, table, Create New Return), Frame 2 a client's return workspace (header, stepper, tabs),
// Frame 3 Review, E-File & Filing Status (validation, approvals, Form 8879 and state
// authorizations, filings per jurisdiction with their transmissions). Guide:
// docs/mockups/firm-workspace/tax-return/source/. API brief: docs/work/briefs/r37-intake-docs-tax-api.md.
// It adds to R10's contract (schemas.ts, client.ts), which stays as it is.
//
// The database keeps the rules: `status` follows `workflowStatus` (never written), going back a
// step needs a reason, nothing moves on to Ready to File while validation, approvals or required
// authorizations block it, an e-file filing's status follows its newest transmission, and filed
// returns, transmissions and decided approvals never change. Firmivra tracks filing; it does not
// transmit. Routes under /api/v1/business, `@Access('TAX_RETURNS', capability)`; Staff reach only
// their own clients (others 404). Every change is audited (ids and field names only).

const DateTime = z.iso.datetime({ offset: true });
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const Cents = z.number().int().min(0).max(99_999_999_999);
const Jurisdiction = z.string().regex(/^(US|[A-Z]{2})$/, 'Use US or a two-letter state code');
const State = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter state code');
const DocumentRef = z.object({ id: z.uuid(), fileName: z.string() });

export const TaxFilingId = z.uuid();
export const TaxFilingAttemptId = z.uuid();
export const TaxChecklistItemId = z.uuid();
export const TaxApprovalId = z.uuid();
export const TaxAuthorizationId = z.uuid();

// ---------- Overview (Frame 1) ----------

/** The tax-type tabs: views of one dataset (Amended: amends a filed return; Prior Year: older). */
export const TaxReturnTab = z.enum([
  'all',
  'personal',
  'business',
  'quarterly',
  'amended',
  'prior_year',
]);
export type TaxReturnTab = z.infer<typeof TaxReturnTab>;

const ClientCell = z.object({
  id: z.uuid(),
  name: z.string(),
  accountType: ClientAccountType,
  /** "***-**-1234" or "**-***1234": the last four only. */
  maskedId: z.string().nullable(),
});

/** One row of the overview table. */
export const TaxReturnRow = z.object({
  id: z.uuid(),
  client: ClientCell,
  taxYear: z.number().int(),
  filingType: TaxFilingType,
  /** 1 to 4 for a quarterly estimate; null for an annual return. */
  quarter: z.number().int().nullable(),
  /** "1040", "1120S", "941"... */
  formType: z.string().nullable(),
  workflowStatus: TaxReturnWorkflowStatus,
  /** R10's coarse status (In progress, Filed, Accepted, Rejected, Completed), derived. */
  status: TaxReturnStatus,
  preparer: MemberRef.nullable(),
  reviewer: MemberRef.nullable(),
  dueOn: CalendarDate.nullable(),
  amendsReturnId: z.uuid().nullable(),
  /** Quarterly: the estimate (Overdue is computed: unpaid after the due date). */
  estimate: z
    .object({
      amountCents: z.number().int().nullable(),
      status: TaxEstimateStatus.nullable(),
      paidOn: CalendarDate.nullable(),
      overdue: z.boolean(),
    })
    .nullable(),
  archivedAt: DateTime.nullable(),
  updatedAt: DateTime,
});
export type TaxReturnRow = z.infer<typeof TaxReturnRow>;

/** GET /business/tax-returns. Search: client name, business name, SSN/EIN last 4, form, id. */
export const TaxReturnsQuery = z.strictObject({
  tab: TaxReturnTab.optional().default('all'),
  workflowStatus: TaxReturnWorkflowStatus.optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  formType: text(20).optional(),
  clientType: ClientAccountType.optional(),
  /** Preparer or reviewer. */
  assignedUserId: z.uuid().optional(),
  updatedFrom: CalendarDate.optional(),
  updatedTo: CalendarDate.optional(),
  archived: z.union([z.boolean(), z.stringbool()]).optional().default(false),
  search: SearchText.optional(),
  sort: z.enum(['updated', 'client', 'due', 'year', 'status']).optional().default('updated'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type TaxReturnsQuery = z.input<typeof TaxReturnsQuery>;

export const TaxReturnPage = z.object({ items: z.array(TaxReturnRow).max(100), ...Page });
export type TaxReturnPage = z.infer<typeof TaxReturnPage>;

const Count = z.object({
  value: z.number().int(),
  /** The same count at the start of this month (from the return history). */
  previous: z.number().int().nullable(),
});

/** GET /business/tax-returns/summary?taxYear=: the KPI cards and Tax Season Progress. */
export const TaxReturnSummaryQuery = z.strictObject({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type TaxReturnSummaryQuery = z.input<typeof TaxReturnSummaryQuery>;

export const TaxReturnSummary = z.object({
  taxYear: z.number().int(),
  total: Count,
  inPreparation: Count,
  waitingOnClient: Count,
  /** Ready for Review, Ready for Signature and Ready to File. */
  readyForReviewOrFile: Count,
  transmitted: Count,
  accepted: Count,
  rejected: Count,
  /** Tax Season Progress: the year's returns by workflow status (sums to total). */
  progress: z.array(z.object({ workflowStatus: TaxReturnWorkflowStatus, count: z.number().int() })),
});
export type TaxReturnSummary = z.infer<typeof TaxReturnSummary>;

// ---------- One return (Frames 2 and 3) ----------

/** What stops the return from moving on (Next Steps), as the database checks it. */
export const TaxReturnBlocker = z.enum([
  /** Validation items exist and Run Final Validation has not been recorded. */
  'VALIDATION_NOT_RUN',
  /** A validation item is an ERROR. */
  'VALIDATION_ERRORS',
  /** A WARNING is not acknowledged. */
  'WARNINGS_NOT_ACKNOWLEDGED',
  'APPROVAL_PENDING',
  /** A reviewer returned it: fix and ask again. */
  'APPROVAL_RETURNED',
  /** A required authorization (8879, state, consent) is not signed. */
  'AUTHORIZATION_UNSIGNED',
  /** Transmitted needs a required filing transmitted, accepted or paper filed. */
  'NO_FILING_TRANSMITTED',
  /** Accepted or Closed needs every required filing accepted or paper filed. */
  'FILINGS_NOT_ACCEPTED',
  /** An amendment's original return was never filed. */
  'ORIGINAL_NOT_FILED',
]);
export type TaxReturnBlocker = z.infer<typeof TaxReturnBlocker>;

/** GET /business/tax-returns/{id}: the workspace header, people, dates and Next Steps. */
export const TaxReturnDetail = TaxReturnRow.extend({
  client: ClientCell.extend({ email: z.string().nullable(), phone: z.string().nullable() }),
  engagement: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  statusReason: z.string().nullable(),
  /** Individual returns only. */
  filingStatus: TaxpayerFilingStatus.nullable(),
  amends: z
    .object({ id: z.uuid(), taxYear: z.number().int(), formType: z.string().nullable() })
    .nullable(),
  amendReason: z.string().nullable(),
  amendedBy: z.array(z.object({ id: z.uuid(), workflowStatus: TaxReturnWorkflowStatus })),
  finalValidatedAt: DateTime.nullable(),
  finalValidatedBy: MemberRef.nullable(),
  importSource: z.string().nullable(),
  importedAt: DateTime.nullable(),
  filedOn: CalendarDate.nullable(),
  firstFiledAt: DateTime.nullable(),
  /** The filed return's PDF (R10). */
  document: DocumentRef.nullable(),
  /** The workflow statuses it can move to now (the stepper's buttons). */
  canMoveTo: z.array(TaxReturnWorkflowStatus),
  /** Why it cannot move on to Ready to File, Transmitted or Accepted yet. */
  blockers: z.array(TaxReturnBlocker),
  createdAt: DateTime,
});
export type TaxReturnDetail = z.infer<typeof TaxReturnDetail>;

/**
 * POST /business/tax-returns (Create New Return). Quarterly needs `quarter`; Amended needs
 * `amendsReturnId` (a filed return of the same client) and `amendReason`. The same client, year,
 * form and quarter again is 409 DUPLICATE_RETURN unless `allowDuplicate`.
 */
export const CreateWorkspaceTaxReturnRequest = z
  .strictObject({
    clientId: z.uuid(),
    taxYear: TaxYear,
    filingType: TaxFilingType,
    quarter: z.number().int().min(1).max(4).nullable().optional(),
    formType: clearable(text(20)),
    engagementId: z.uuid().nullable().optional(),
    filingStatus: TaxpayerFilingStatus.nullable().optional(),
    preparerUserId: z.uuid().nullable().optional(),
    reviewerUserId: z.uuid().nullable().optional(),
    dueOn: CalendarDate.nullable().optional(),
    /** The states it is filed in besides the federal return (one filing each). */
    states: z.array(State).max(10).optional(),
    amendsReturnId: z.uuid().nullable().optional(),
    amendReason: clearable(text(2000, 'many')),
    allowDuplicate: z.boolean().optional().default(false),
  })
  .refine((b) => !b.amendsReturnId === !b.amendReason, {
    path: ['amendReason'],
    message: 'An amended return needs the original return and a reason',
  })
  .refine((b) => !b.filingStatus || b.filingType === 'INDIVIDUAL', {
    path: ['filingStatus'],
    message: 'A filing status is for individual returns',
  });
export type CreateWorkspaceTaxReturnRequest = z.input<typeof CreateWorkspaceTaxReturnRequest>;

/**
 * PATCH /business/tax-returns/{id}/details (Edit Return Details, Assign/Reassign, quarterly
 * estimate). R10's PATCH /business/tax-returns/{id} keeps its older fields.
 */
export const UpdateTaxReturnDetailsRequest = z
  .strictObject({
    formType: clearable(text(20)),
    filingStatus: TaxpayerFilingStatus.nullable(),
    preparerUserId: z.uuid().nullable(),
    reviewerUserId: z.uuid().nullable(),
    dueOn: CalendarDate.nullable(),
    engagementId: z.uuid().nullable(),
    estimateAmountCents: Cents.nullable(),
    estimateStatus: TaxEstimateStatus.nullable(),
    /** Set exactly when the estimate is PAID. */
    estimatePaidOn: CalendarDate.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateTaxReturnDetailsRequest = z.input<typeof UpdateTaxReturnDetailsRequest>;

/**
 * POST /business/tax-returns/{id}/status (Change Status, Ready for Review, Mark Ready to File,
 * Close). Going back a step needs a reason; Ready to File and Close need APPROVE or the
 * reviewer. 409 STATUS_BLOCKED with the blockers when the database refuses it.
 */
export const ChangeTaxReturnStatusRequest = z.strictObject({
  workflowStatus: TaxReturnWorkflowStatus,
  reason: clearable(text(500, 'many')),
});
export type ChangeTaxReturnStatusRequest = z.input<typeof ChangeTaxReturnStatusRequest>;

/** GET /business/tax-returns/{id}/history: status and assignment changes, newest first. */
export const TaxReturnHistoryList = z.object({
  items: z.array(
    z.object({
      at: DateTime,
      workflowStatus: TaxReturnWorkflowStatus,
      preparer: MemberRef.nullable(),
      reviewer: MemberRef.nullable(),
      reason: z.string().nullable(),
      by: MemberRef.nullable(),
    }),
  ),
});
export type TaxReturnHistoryList = z.infer<typeof TaxReturnHistoryList>;

/** GET /business/tax-returns/{id}/activity: the Activity tab (from the audit log, never values). */
export const TaxReturnActivityList = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        at: DateTime,
        kind: z.enum([
          'CREATED',
          'UPDATED',
          'STATUS',
          'ASSIGNED',
          'CHECKLIST',
          'VALIDATION',
          'APPROVAL',
          'AUTHORIZATION',
          'FILING',
          'TRANSMISSION',
          'DOCUMENT',
          'ARCHIVED',
          'RESTORED',
          'OTHER',
        ]),
        label: z.string(),
        by: z.string().nullable(),
      }),
    )
    .max(200),
});
export type TaxReturnActivityList = z.infer<typeof TaxReturnActivityList>;

/** POST /business/tax-returns/{id}/amend: a new return amending a filed one. */
export const AmendTaxReturnRequest = z.strictObject({ reason: text(2000, 'many') });
export type AmendTaxReturnRequest = z.input<typeof AmendTaxReturnRequest>;

/**
 * POST /business/tax-returns/{id}/carry-forward: next year's return for the same client and
 * form, with its people, states, approval steps and checklist labels; never amounts or answers.
 */
export const CarryForwardTaxReturnRequest = z.strictObject({ taxYear: TaxYear });
export type CarryForwardTaxReturnRequest = z.input<typeof CarryForwardTaxReturnRequest>;

// ---------- Filings and transmissions (Frame 3, E-File) ----------

export const TaxFilingAttempt = z.object({
  id: z.uuid(),
  submissionId: z.string(),
  transmittedAt: DateTime,
  ackStatus: TaxAckStatus,
  acknowledgedAt: DateTime.nullable(),
  rejectCode: z.string().nullable(),
  rejectDescription: z.string().nullable(),
  correctiveAction: z.string().nullable(),
  recordedBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type TaxFilingAttempt = z.infer<typeof TaxFilingAttempt>;

/** One jurisdiction's filing (federal "US" or a state), with its transmissions, newest first. */
export const TaxReturnFiling = z.object({
  id: z.uuid(),
  jurisdiction: z.string(),
  filingMethod: TaxFilingMethod,
  required: z.boolean(),
  status: TaxJurisdictionStatus,
  paperFiledOn: CalendarDate.nullable(),
  /** Never both above zero. */
  refundCents: z.number().int().nullable(),
  amountDueCents: z.number().int().nullable(),
  /** ESTIMATED until the return is final. */
  amountStatus: TaxAmountStatus.nullable(),
  attempts: z.array(TaxFilingAttempt),
});
export type TaxReturnFiling = z.infer<typeof TaxReturnFiling>;
export const TaxReturnFilingList = z.object({ items: z.array(TaxReturnFiling) });
export type TaxReturnFilingList = z.infer<typeof TaxReturnFilingList>;

/**
 * PUT /business/tax-returns/{id}/filings: the jurisdictions it is filed in. A jurisdiction left
 * out that has a transmission is kept as not required (409 FILING_IN_USE if asked to drop it).
 */
export const SetTaxReturnFilingsRequest = z.strictObject({
  filings: z
    .array(
      z.strictObject({
        jurisdiction: Jurisdiction,
        filingMethod: TaxFilingMethod.optional().default('EFILE'),
        required: z.boolean().optional().default(true),
      }),
    )
    .min(1)
    .max(20),
});
export type SetTaxReturnFilingsRequest = z.input<typeof SetTaxReturnFilingsRequest>;

/** PATCH /business/tax-returns/{id}/filings/{filingId}: refund or amount due, method, required. */
export const UpdateTaxReturnFilingRequest = z
  .strictObject({
    required: z.boolean(),
    /** Only before the first transmission. */
    filingMethod: TaxFilingMethod,
    refundCents: Cents.nullable(),
    amountDueCents: Cents.nullable(),
    amountStatus: TaxAmountStatus.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateTaxReturnFilingRequest = z.input<typeof UpdateTaxReturnFilingRequest>;

/** POST .../filings/{filingId}/attempts: record a transmission (a retransmit after a reject). */
export const RecordTaxFilingAttemptRequest = z.strictObject({
  submissionId: text(50),
  /** Not in the future. */
  transmittedAt: DateTime,
});
export type RecordTaxFilingAttemptRequest = z.input<typeof RecordTaxFilingAttemptRequest>;

/** PATCH /business/tax-returns/{id}/attempts/{attemptId}: the acknowledgment, or the fix note. */
export const UpdateTaxFilingAttemptRequest = z.discriminatedUnion('ackStatus', [
  z.strictObject({ ackStatus: z.literal('ACCEPTED'), acknowledgedAt: DateTime }),
  z.strictObject({
    ackStatus: z.literal('REJECTED'),
    acknowledgedAt: DateTime,
    rejectCode: clearable(text(50)),
    rejectDescription: clearable(text(2000, 'many')),
    correctiveAction: clearable(text(2000, 'many')),
  }),
  /** After the answer, only the corrective action changes. */
  z.strictObject({ ackStatus: z.literal('NOTE'), correctiveAction: clearable(text(2000, 'many')) }),
]);
export type UpdateTaxFilingAttemptRequest = z.input<typeof UpdateTaxFilingAttemptRequest>;

/** POST .../filings/{filingId}/paper-filed: a paper filing's date. */
export const PaperFiledRequest = z.strictObject({ paperFiledOn: CalendarDate });
export type PaperFiledRequest = z.input<typeof PaperFiledRequest>;

// ---------- Checklists and validation (Frames 2 and 3) ----------

export const TaxChecklistItem = z.object({
  id: z.uuid(),
  section: TaxChecklistSection,
  label: z.string(),
  sortOrder: z.number().int(),
  /** PREPARATION and REVIEW: OPEN or DONE. VALIDATION: VALID, INFO, WARNING or ERROR. */
  result: TaxCheckResult,
  note: z.string().nullable(),
  acknowledgedAt: DateTime.nullable(),
  acknowledgedBy: MemberRef.nullable(),
  updatedAt: DateTime,
});
export type TaxChecklistItem = z.infer<typeof TaxChecklistItem>;
export const TaxChecklist = z.object({ items: z.array(TaxChecklistItem) });
export type TaxChecklist = z.infer<typeof TaxChecklist>;

/** POST /business/tax-returns/{id}/checklist. */
export const CreateTaxChecklistItemRequest = z.strictObject({
  section: TaxChecklistSection,
  label: text(200),
  result: TaxCheckResult.optional(),
  note: clearable(text(1000, 'many')),
});
export type CreateTaxChecklistItemRequest = z.input<typeof CreateTaxChecklistItemRequest>;

/**
 * PATCH /business/tax-returns/{id}/checklist/{itemId}. `acknowledge` records the reviewer's
 * acknowledgment of a WARNING; a new result clears it.
 */
export const UpdateTaxChecklistItemRequest = z
  .strictObject({
    label: text(200),
    result: TaxCheckResult,
    note: clearable(text(1000, 'many')),
    sortOrder: z.number().int().min(0).max(10_000),
    acknowledge: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateTaxChecklistItemRequest = z.input<typeof UpdateTaxChecklistItemRequest>;

// ---------- Approvals (Frame 3) ----------

export const TaxApproval = z.object({
  id: z.uuid(),
  step: z.string(),
  sortOrder: z.number().int(),
  assignedTo: MemberRef.nullable(),
  status: TaxApprovalStatus,
  decidedAt: DateTime.nullable(),
  decidedBy: MemberRef.nullable(),
  /** The version approved (a document of the return's client). */
  approvedDocument: DocumentRef.nullable(),
  note: z.string().nullable(),
  createdAt: DateTime,
});
export type TaxApproval = z.infer<typeof TaxApproval>;
export const TaxApprovalList = z.object({ items: z.array(TaxApproval) });
export type TaxApprovalList = z.infer<typeof TaxApprovalList>;

/** POST /business/tax-returns/{id}/approvals: a step ("Preparer Review", "Final Review"). */
export const CreateTaxApprovalRequest = z.strictObject({
  step: text(100),
  assignedUserId: z.uuid().nullable().optional(),
});
export type CreateTaxApprovalRequest = z.input<typeof CreateTaxApprovalRequest>;

/** POST .../approvals/{approvalId}/approve (the assignee, or APPROVE). */
export const ApproveTaxApprovalRequest = z.strictObject({
  approvedDocumentId: z.uuid().nullable().optional(),
  note: clearable(text(2000, 'many')),
});
export type ApproveTaxApprovalRequest = z.input<typeof ApproveTaxApprovalRequest>;

/** POST .../approvals/{approvalId}/return: back to the preparer, with the review note. */
export const ReturnTaxApprovalRequest = z.strictObject({ note: text(2000, 'many') });
export type ReturnTaxApprovalRequest = z.input<typeof ReturnTaxApprovalRequest>;

// ---------- Authorizations: Form 8879, state, consent (Frame 3) ----------

export const TaxAuthorization = z.object({
  id: z.uuid(),
  kind: TaxAuthorizationKind,
  /** STATE_EFILE only. */
  jurisdiction: z.string().nullable(),
  required: z.boolean(),
  /**
   * Not Sent (no request and no wet signature), the Firm Sign request's status, or SIGNED for a
   * wet signature.
   */
  status: z.union([z.literal('NOT_SENT'), z.literal('SIGNED'), EsignRequestStatus]),
  esignRequestId: z.uuid().nullable(),
  signedOn: CalendarDate.nullable(),
  /** The signed form, for a wet signature. */
  document: DocumentRef.nullable(),
  updatedAt: DateTime,
});
export type TaxAuthorization = z.infer<typeof TaxAuthorization>;
export const TaxAuthorizationList = z.object({ items: z.array(TaxAuthorization) });
export type TaxAuthorizationList = z.infer<typeof TaxAuthorizationList>;

/**
 * PUT /business/tax-returns/{id}/authorizations: the authorizations the return needs. Sending is
 * Firm Sign's (esign requests); `link` ties a request to a line.
 */
export const SetTaxAuthorizationsRequest = z.strictObject({
  items: z
    .array(
      z
        .strictObject({
          kind: TaxAuthorizationKind,
          jurisdiction: State.nullable().optional(),
          required: z.boolean().optional().default(true),
        })
        .refine((a) => (a.kind === 'STATE_EFILE') === Boolean(a.jurisdiction), {
          path: ['jurisdiction'],
          message: 'A state authorization names its state, and only it does',
        }),
    )
    .max(20),
});
export type SetTaxAuthorizationsRequest = z.input<typeof SetTaxAuthorizationsRequest>;

/** POST .../authorizations/{authorizationId}/link: a Firm Sign request of the return's client. */
export const LinkTaxAuthorizationRequest = z.strictObject({ esignRequestId: z.uuid() });
export type LinkTaxAuthorizationRequest = z.input<typeof LinkTaxAuthorizationRequest>;

/** POST .../authorizations/{authorizationId}/wet-signature: signed on paper, with the scan. */
export const WetSignatureRequest = z.strictObject({
  signedOn: CalendarDate,
  documentId: z.uuid(),
});
export type WetSignatureRequest = z.input<typeof WetSignatureRequest>;

// ---------- Return documents (Frame 3) ----------

export const TaxReturnDocument = z.object({
  id: z.uuid(),
  kind: TaxReturnDocumentKind,
  jurisdiction: z.string().nullable(),
  document: DocumentRef.extend({ scanStatus: z.enum(['PENDING', 'CLEAN', 'INFECTED', 'FAILED']) }),
  addedBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type TaxReturnDocument = z.infer<typeof TaxReturnDocument>;
export const TaxReturnDocumentList = z.object({ items: z.array(TaxReturnDocument) });
export type TaxReturnDocumentList = z.infer<typeof TaxReturnDocumentList>;

/**
 * POST /business/tax-returns/{id}/documents: link one of the client's documents (upload it with
 * Documents first). Filed returns and acknowledgments are never unlinked (409 DOCUMENT_LOCKED).
 */
export const LinkTaxReturnDocumentRequest = z.strictObject({
  documentId: z.uuid(),
  kind: TaxReturnDocumentKind,
  jurisdiction: Jurisdiction.nullable().optional(),
});
export type LinkTaxReturnDocumentRequest = z.input<typeof LinkTaxReturnDocumentRequest>;

// ---------- Reports ----------

/** GET /business/tax-returns/reports/efile?taxYear=: Generate E-File Reports. */
export const EfileReportQuery = z.strictObject({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type EfileReportQuery = z.input<typeof EfileReportQuery>;

export const EfileReport = z.object({
  taxYear: z.number().int(),
  byJurisdiction: z.array(
    z.object({
      jurisdiction: z.string(),
      notFiled: z.number().int(),
      transmitted: z.number().int(),
      accepted: z.number().int(),
      rejected: z.number().int(),
      paperFiled: z.number().int(),
    }),
  ),
  /** Open rejections: the return, jurisdiction and reject code, newest first. */
  rejections: z
    .array(
      z.object({
        taxReturnId: z.uuid(),
        clientName: z.string(),
        jurisdiction: z.string(),
        rejectCode: z.string().nullable(),
        acknowledgedAt: DateTime,
      }),
    )
    .max(200),
});
export type EfileReport = z.infer<typeof EfileReport>;

/** POST /business/tax-returns/export (EXPORT): the filtered list as CSV, masked, audited. */
export const TaxReturnExportLink = z.object({
  url: z.string(),
  expiresAt: DateTime,
  fileName: z.string(),
  rowCount: z.number().int(),
});
export type TaxReturnExportLink = z.infer<typeof TaxReturnExportLink>;

export const TaxReturnWorkspaceErrorCode = z.enum([
  /** 409: the same client, year, form and quarter exists; send allowDuplicate to go on. */
  'DUPLICATE_RETURN',
  /** 409: the database refused the move; `details.blockers` says why. */
  'STATUS_BLOCKED',
  /** 400: going back a step needs a reason. */
  'REASON_REQUIRED',
  /** 409: a filed return, a transmission or a decided approval does not change. */
  'RETURN_LOCKED',
  /** 409: a new transmission only after the last one was rejected; one waiting at a time. */
  'ATTEMPT_PENDING',
  /** 409: a jurisdiction with transmissions is not removed. */
  'FILING_IN_USE',
  /** 409: a filed return or acknowledgment stays linked. */
  'DOCUMENT_LOCKED',
  /** 409: the document or esign request is not the return's client's. */
  'INVALID_DOCUMENT',
  /** 409: the preparer, reviewer or approver is not an active member. */
  'NOT_A_MEMBER',
  /** 409: an amendment's original must have been filed. */
  'ORIGINAL_NOT_FILED',
]);
export type TaxReturnWorkspaceErrorCode = z.infer<typeof TaxReturnWorkspaceErrorCode>;
