import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { text } from '../clients/text.js';
import { EsignBulkRoleFill, EsignTemplateVisibility } from './admin.js';
import { EsignAccessRole, EsignRequestStatus } from './enums.js';
import { EsignErrorCode } from './errors.js';
import { EsignReadinessCode } from './schemas.js';

// Firm Sign (R13), firm side, contract 3: the extras. Approvals, Firm Sign roles (Manager and
// Viewer), template versions and duplicate, in-person signing, bulk send and reports. Same access
// rules as the requests (schemas.ts); every route answers 403 MODULE_OFF when Firm Sign is off.

const DateTime = z.iso.datetime({ offset: true });

// ---------- Approvals ----------
// Who approves: an APPROVER recipient is a STAFF member who is an Owner, Admin or Firm Sign
// Manager and is not the request's sender. PUT recipients and `use` (template) answer 409
// APPROVER_NOT_ALLOWED otherwise, and the rule is checked again on submit and on each decision
// (a member whose role changed since answers 403 NOT_AN_APPROVER). An approver always opens, lists
// (the NEEDS_MY_APPROVAL filter) and decides the requests they approve, whatever the client
// assignment; they see nothing else of that client.

/**
 * POST /esign/requests/{id}/submit-for-approval (the sender, Owner, Admin, Manager): a DRAFT whose
 * only readiness problem is APPROVAL_PENDING becomes NEEDS_APPROVAL, and its approvers get an
 * email. `confirm: true` is the review screen's explicit confirmation. 409 NOT_READY,
 * INVALID_STATE.
 */
export const SubmitEsignApprovalBody = z.strictObject({ confirm: z.literal(true) });
export type SubmitEsignApprovalBody = z.input<typeof SubmitEsignApprovalBody>;

/**
 * POST /esign/requests/{id}/approval (an APPROVER recipient on the request, NEEDS_APPROVAL only):
 * APPROVE, or REJECT with a note. When the last approver approves, the request is sent at once, in
 * the sender's name. If that send fails (a readiness problem that appeared since, such as a merge
 * value), the approvals stand: the request goes back to DRAFT with its approvers APPROVED and
 * the sender is told; sending it again needs no new approval. Any edit to a DRAFT (files, page
 * plan, recipients, fields, settings) clears every approval. REJECT puts it back to DRAFT and
 * every approval so far is cleared; the sender is told. The note is for staff only: never shown to a signer or put in an email.
 * 403 NOT_AN_APPROVER, 409 INVALID_STATE, RECIPIENT_DONE (already decided).
 */
export const EsignApprovalBody = z
  .strictObject({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: text(500, 'many').optional(),
  })
  .refine((b) => b.decision === 'APPROVE' || b.note, {
    path: ['note'],
    message: 'Say what needs to change',
  });
export type EsignApprovalBody = z.input<typeof EsignApprovalBody>;

// ---------- Firm Sign roles ----------
/**
 * A member's access in Firm Sign. Owner and Admin are always OWNER and ADMIN; a Staff member is
 * STAFF unless the firm made them a MANAGER or a VIEWER. A MANAGER sees what STAFF sees (their own
 * requests and their assigned clients'), and also approves and manages every FIRM template.
 */
export const EsignMemberRole = z.object({
  user: MemberRef,
  email: z.string(),
  esignRole: EsignAccessRole,
  /** False for Owner and Admin: their access follows their firm role. */
  canChange: z.boolean(),
});
export type EsignMemberRole = z.infer<typeof EsignMemberRole>;

/** GET /esign/roles (Owner, Admin): every active member, by name. */
export const EsignMemberRoleList = z.object({ items: z.array(EsignMemberRole) });
export type EsignMemberRoleList = z.infer<typeof EsignMemberRoleList>;

/**
 * PUT /esign/roles/{userId} (Owner, Admin): a Staff member's Firm Sign access. 409 ROLE_FIXED for
 * an Owner or Admin, NOT_A_MEMBER for anyone not an active member.
 */
export const SetEsignMemberRoleBody = z.strictObject({
  esignRole: z.enum(['MANAGER', 'STAFF', 'VIEWER']),
});
export type SetEsignMemberRoleBody = z.input<typeof SetEsignMemberRoleBody>;

/**
 * GET /esign/approvers (Owner, Admin, Manager, Staff; a Viewer gets 403 FORBIDDEN): who may approve
 * a request, for the wizard's approver picker. Active Owners, Admins and Managers, by name, without
 * the caller (a sender can't approve their own request). Names only, no emails.
 */
export const EsignApprover = z.object({
  user: MemberRef,
  esignRole: z.enum(['OWNER', 'ADMIN', 'MANAGER']),
});
export type EsignApprover = z.infer<typeof EsignApprover>;
export const EsignApproverList = z.object({ items: z.array(EsignApprover) });
export type EsignApproverList = z.infer<typeof EsignApproverList>;

// ---------- Template versions ----------
/**
 * One saved version of a template. Using a template copies its newest version; a request records
 * which version it came from. Versions are never changed or deleted.
 */
export const EsignTemplateVersion = z.object({
  version: z.number().int().min(1),
  savedAt: DateTime,
  savedBy: MemberRef,
  /** What changed, in the saver's words; null for none. */
  note: z.string().nullable(),
  pageCount: z.number().int().min(1),
  roleCount: z.number().int().min(0),
  fieldCount: z.number().int().min(0),
  /** True for the version that `use` copies now. */
  current: z.boolean(),
});
export type EsignTemplateVersion = z.infer<typeof EsignTemplateVersion>;

/** GET /esign/templates/{id}/versions: newest first. */
export const EsignTemplateVersionList = z.object({ items: z.array(EsignTemplateVersion) });
export type EsignTemplateVersionList = z.infer<typeof EsignTemplateVersionList>;

/**
 * POST /esign/requests/{id}/save-as-version (the template's owner, Owner, Admin): the request's
 * packet, recipients (as roles), fields and settings become the template's next version. It
 * copies, leaves out and refuses exactly what save-as-template does (SaveEsignTemplateBody: 409
 * TEMPLATE_HAS_CLIENT_FILES, SCAN_PENDING). 409 TEMPLATE_ARCHIVED.
 */
export const SaveEsignTemplateVersionBody = z.strictObject({
  templateId: z.uuid(),
  note: text(500, 'many').optional(),
});
export type SaveEsignTemplateVersionBody = z.input<typeof SaveEsignTemplateVersionBody>;

/**
 * POST /esign/templates/{id}/versions/{version}/restore (its owner, Owner, Admin): copies an older
 * version into a new newest version; nothing is overwritten.
 */
export const RestoreEsignTemplateVersionBody = z.strictObject({
  note: text(500, 'many').optional(),
});
export type RestoreEsignTemplateVersionBody = z.input<typeof RestoreEsignTemplateVersionBody>;

/**
 * POST /esign/templates/{id}/duplicate (anyone who may use it, but a VIEWER): a new template,
 * owned by the caller, from the newest version, starting again at version 1. `visibility` is the
 * source's when left out. 409 TEMPLATE_NAME_TAKEN.
 */
export const DuplicateEsignTemplateBody = z.strictObject({
  name: text(200, 'one', 'Name the template'),
  visibility: EsignTemplateVisibility.optional(),
});
export type DuplicateEsignTemplateBody = z.input<typeof DuplicateEsignTemplateBody>;

// ---------- In-person signing ----------
/**
 * POST /esign/requests/{id}/in-person (the sender, Owner, Admin, Manager): hand this device to a
 * signer whose `delivery` is IN_PERSON and whose turn it is. The answer's `signingUrl` opens the
 * signer pages on the portal (a fresh one-time link; the old one stops working); the staff
 * member's own session is locked until `exit` with their password: every other firm route
 * answers 403 KIOSK_LOCKED. The signer skips the email code (the staff member vouches); the
 * events record IN_PERSON_STARTED with who started it. The staff tab shows the lock screen at once
 * (and on every load while `GET /esign/in-person` has a session); the signer pages open in a new
 * tab. After ESIGN_KIOSK_IDLE_MINUTES with no signer activity the signer's session ends and the
 * staff member is signed out (401), so an unattended device never stays open. 409 NOT_IN_PERSON,
 * NOT_YOUR_TURN, RECIPIENT_DONE, REQUEST_CLOSED.
 */
export const ESIGN_KIOSK_IDLE_MINUTES = 15;
/** Wrong staff passwords on `exit` before the staff member is signed out. */
export const ESIGN_KIOSK_PASSWORD_TRIES = 5;

export const StartEsignInPersonBody = z.strictObject({ recipientId: z.uuid() });
export type StartEsignInPersonBody = z.input<typeof StartEsignInPersonBody>;

export const EsignInPersonSession = z.object({
  requestId: z.uuid(),
  recipientId: z.uuid(),
  /** The signer's name, for the handoff screen. */
  signerName: z.string(),
  /**
   * An absolute URL on the portal site, `<PORTAL_BASE_URL>/<slug>/sign#t=<token>`: open it in a new
   * tab of the same browser. The signer starts at the consent step.
   */
  signingUrl: z.url(),
  startedAt: DateTime,
  /** The link stops working after this (15 minutes) if signing has not started. */
  expiresAt: DateTime,
});
export type EsignInPersonSession = z.infer<typeof EsignInPersonSession>;

/** GET /esign/in-person: the caller's open in-person session, or null. Allowed while locked. */
export const EsignInPersonState = z.object({ session: EsignInPersonSession.nullable() });
export type EsignInPersonState = z.infer<typeof EsignInPersonState>;

/**
 * POST /esign/in-person/exit: unlocks the staff session with the staff member's own password and
 * ends the signer's session on the portal. 400 PASSWORD_WRONG; after ESIGN_KIOSK_PASSWORD_TRIES wrong
 * passwords the staff member is signed out (401). That sign-out, like the idle one, also revokes
 * the refresh token, so the browser's silent refresh cannot re-send the exit. Allowed while
 * locked.
 */
export const ExitEsignInPersonBody = z.strictObject({
  password: z.string().min(1).max(256),
});
export type ExitEsignInPersonBody = z.input<typeof ExitEsignInPersonBody>;

// ---------- Bulk send ----------
export const ESIGN_BULK_MAX = 200;

/**
 * POST /esign/templates/{id}/bulk-send (Owner and Admin for any client; Manager and Staff for
 * their own assigned clients): one separate request per client, each with its own signers, audit trail and signed
 * copy; no request ever holds two clients. CLIENT, SPOUSE and PREPARER roles fill themselves for
 * each client; `roles` gives the same person for every other role (a STAFF member or an EXTERNAL
 * person, never a client login), and a role's delivery and access code, with the same rules as
 * `use` (EsignBulkRoleFill). An access code given here is the same on every client's request. Answers 202 with the batch; the job runner creates and sends the
 * requests. A client whose request can't be sent (a readiness problem) stays a DRAFT and the batch
 * row says why. 400 BULK_LIMIT (the client checks it before sending), 409 TEMPLATE_ARCHIVED,
 * TEMPLATE_ROLES_UNFILLED, APPROVER_NOT_ALLOWED.
 */
export const EsignBulkSendBody = z
  .strictObject({
    clients: z
      .array(
        z.strictObject({
          clientId: z.uuid(),
          /** The service to file the signed copy under; the client's only open one when left out. */
          engagementId: z.uuid().optional(),
        }),
      )
      .min(1, 'Choose at least one client')
      .max(ESIGN_BULK_MAX, 'At most 200 clients'),
    /** Each request's name; the template's name when left out. */
    title: text(200).optional(),
    roles: z.array(EsignBulkRoleFill).max(20).default([]),
    confirm: z.literal(true),
  })
  .refine((b) => new Set(b.clients.map((c) => c.clientId)).size === b.clients.length, {
    path: ['clients'],
    message: 'Each client at most once',
  })
  .refine((b) => new Set(b.roles.map((r) => r.key)).size === b.roles.length, {
    path: ['roles'],
    message: 'Each role at most once',
  });
export type EsignBulkSendBody = z.input<typeof EsignBulkSendBody>;

export const EsignBulkItemState = z.enum(['QUEUED', 'SENT', 'NOT_SENT']);
export type EsignBulkItemState = z.infer<typeof EsignBulkItemState>;

/** GET /esign/bulk/{batchId}: the batch and one row per client, in the order given. */
export const EsignBulkBatch = z.object({
  id: z.uuid(),
  templateId: z.uuid(),
  templateName: z.string(),
  createdBy: MemberRef,
  createdAt: DateTime,
  /** True once every row is SENT or NOT_SENT. */
  done: z.boolean(),
  items: z.array(
    z.object({
      clientId: z.uuid(),
      clientName: z.string(),
      state: EsignBulkItemState,
      /** The client's request once created (a DRAFT when NOT_SENT). */
      requestId: z.uuid().nullable(),
      /** Why it was not sent: a readiness code or an error code. Null otherwise. */
      problem: z.union([EsignReadinessCode, EsignErrorCode]).nullable(),
    }),
  ),
});
export type EsignBulkBatch = z.infer<typeof EsignBulkBatch>;

// ---------- Reports ----------
/**
 * GET /esign/reports?from=&to=&status=&senderId=: requests SENT in the date range (calendar days,
 * inclusive, in the firm's time zone; at most 366 days). Owner and Admin see the whole firm;
 * Managers, Staff and Viewers see only the requests they may open, so another member's restricted
 * clients never count. `senderId` narrows to one sender.
 */
export const EsignReportQuery = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    status: EsignRequestStatus.optional(),
    senderId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'The end date is before the start date' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 365 * 86_400_000, {
    path: ['to'],
    message: 'Choose at most a year',
  });
export type EsignReportQuery = z.input<typeof EsignReportQuery>;

/** The numbers for a set of requests. Rates are 0 to 1; null when nothing was sent. */
export const EsignReportTotals = z.object({
  sent: z.number().int().min(0),
  completed: z.number().int().min(0),
  /** Open: SENT, DELIVERED, VIEWED or PARTIALLY_SIGNED now. */
  outstanding: z.number().int().min(0),
  declined: z.number().int().min(0),
  expired: z.number().int().min(0),
  voided: z.number().int().min(0),
  completionRate: z.number().min(0).max(1).nullable(),
  /** From sent to completed, over the completed ones; null when none completed. */
  averageCompletionHours: z.number().min(0).nullable(),
});
export type EsignReportTotals = z.infer<typeof EsignReportTotals>;

export const EsignReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  totals: EsignReportTotals,
  /** Activity by employee: one row per sender, most sent first. */
  bySender: z.array(EsignReportTotals.extend({ sender: MemberRef })),
});
export type EsignReport = z.infer<typeof EsignReport>;
