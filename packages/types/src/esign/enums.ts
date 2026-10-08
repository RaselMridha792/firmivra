import { z } from 'zod';

// Firm Sign's value lists (R13). They match the database enums of migration r0_esign; once that
// migration is on main and db-enums.ts is generated from it, these re-export the generated ones.

/**
 * A signature request's status. DELIVERED (our mail provider accepted the email) is shown as
 * "Sent" everywhere (ESIGN_STATUS_LABELS); the dashboard's Sent counter includes it.
 */
export const EsignRequestStatus = z.enum([
  'DRAFT',
  /** Waiting for an internal approver before it can be sent. */
  'NEEDS_APPROVAL',
  'SENT',
  'DELIVERED',
  /** A signer opened it. */
  'VIEWED',
  /** At least one signer signed, and at least one has not. */
  'PARTIALLY_SIGNED',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
]);
export type EsignRequestStatus = z.infer<typeof EsignRequestStatus>;

/** The open statuses: the request is out for signature. */
export const ESIGN_OPEN_STATUSES = ['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'] as const;
/** The final statuses: nothing about the request changes any more. */
export const ESIGN_CLOSED_STATUSES = ['COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED'] as const;

/** Where a request was started. */
export const EsignSource = z.enum(['TAB', 'CLIENT_RECORD', 'TEMPLATE', 'BULK']);
export type EsignSource = z.infer<typeof EsignSource>;

/** SEQUENTIAL: by `routingOrder`, the next group gets its link when the one before is done. */
export const EsignRouting = z.enum(['SEQUENTIAL', 'PARALLEL']);
export type EsignRouting = z.infer<typeof EsignRouting>;

/** An APPROVER reviews before sending and signs nothing; a CC only gets the completed copy. */
export const EsignRecipientKind = z.enum(['SIGNER', 'APPROVER', 'CC']);
export type EsignRecipientKind = z.infer<typeof EsignRecipientKind>;

/** The spec's signing roles (section 7). CUSTOM takes a `roleLabel`. */
export const EsignRecipientRole = z.enum([
  'CLIENT',
  'SPOUSE',
  'BUSINESS_OWNER',
  'EMPLOYEE',
  'PREPARER',
  'MANAGER',
  'WITNESS',
  'CUSTOM',
]);
export type EsignRecipientRole = z.infer<typeof EsignRecipientRole>;

export const EsignRecipientStatus = z.enum([
  /** Not their turn yet (sequential), or the request is not sent. */
  'WAITING',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'SIGNED',
  'APPROVED',
  'REJECTED',
  'DECLINED',
]);
export type EsignRecipientStatus = z.infer<typeof EsignRecipientStatus>;

/** How the recipient gets the request. PORTAL: a client login, through the portal's Signature center. */
export const EsignDelivery = z.enum(['EMAIL', 'PORTAL', 'IN_PERSON']);
export type EsignDelivery = z.infer<typeof EsignDelivery>;

/**
 * How a signer proves who they are, on top of their own link. EMAIL_CODE (the default): a
 * 6-digit code by email. ACCESS_CODE: a code the firm gives the signer another way.
 * PORTAL_SESSION is never chosen: it is what the events record when a signed-in client signs
 * from the Signature center.
 */
export const EsignAuthMethod = z.enum(['LINK', 'EMAIL_CODE', 'ACCESS_CODE', 'PORTAL_SESSION']);
export type EsignAuthMethod = z.infer<typeof EsignAuthMethod>;
/** What staff may pick for a recipient. */
export const EsignChosenAuthMethod = z.enum(['LINK', 'EMAIL_CODE', 'ACCESS_CODE']);
export type EsignChosenAuthMethod = z.infer<typeof EsignChosenAuthMethod>;

/** The spec's 12 field types (section 8). */
export const EsignFieldType = z.enum([
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'PRINTED_NAME',
  'EMAIL',
  'PHONE',
  'ADDRESS',
  'TEXT',
  'CHECKBOX',
  'RADIO',
  'DROPDOWN',
  'ATTACHMENT',
]);
export type EsignFieldType = z.infer<typeof EsignFieldType>;
/** Field types only a signer fills: they always belong to a signer. */
export const ESIGN_SIGNER_ONLY_FIELDS = [
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'ATTACHMENT',
] as const satisfies readonly EsignFieldType[];

/** What the timeline (`events`) records. */
export const EsignEventType = z.enum([
  'CREATED',
  'EDITED',
  'APPROVAL_REQUESTED',
  'APPROVED',
  'APPROVAL_REJECTED',
  'SENT',
  'DELIVERED',
  'VIEWED',
  'AUTH_PASSED',
  'AUTH_FAILED',
  'CONSENTED',
  'SIGNED',
  'REMINDER_SENT',
  'EXPIRY_WARNING_SENT',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
  'CORRECTED',
  'REPLACED',
  'COMPLETED',
  'COPY_SENT',
  'DOWNLOADED',
  'IN_PERSON_STARTED',
  'IN_PERSON_ENDED',
]);
export type EsignEventType = z.infer<typeof EsignEventType>;

export const EsignActorKind = z.enum(['STAFF', 'SIGNER', 'CLIENT', 'SYSTEM']);
export type EsignActorKind = z.infer<typeof EsignActorKind>;

/**
 * The caller's access in Firm Sign (`GET /esign/status`). OWNER and ADMIN: everything, settings
 * included. MANAGER (a Staff member the firm made a Firm Sign manager): every request, approves.
 * STAFF: their own requests and their assigned clients' requests. VIEWER (a Staff member made a
 * viewer): reads what STAFF could see, changes nothing.
 */
export const EsignAccessRole = z.enum(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER']);
export type EsignAccessRole = z.infer<typeof EsignAccessRole>;

/** The list's quick filters (spec section 3). */
export const EsignQuickFilter = z.enum([
  /** SENT, DELIVERED, VIEWED or PARTIALLY_SIGNED. */
  'AWAITING_SIGNATURE',
  /** Open, and it expires within ESIGN_EXPIRING_SOON_DAYS. */
  'EXPIRING_SOON',
  /** COMPLETED within ESIGN_RECENT_DAYS. */
  'RECENTLY_COMPLETED',
  /** Sent (or being prepared) by the caller. */
  'MY_REQUESTS',
  /** NEEDS_APPROVAL, with the caller as an approver who has not decided. */
  'NEEDS_MY_APPROVAL',
]);
export type EsignQuickFilter = z.infer<typeof EsignQuickFilter>;
export const ESIGN_EXPIRING_SOON_DAYS = 3;
export const ESIGN_RECENT_DAYS = 30;

/**
 * The merge fields (spec sections 5 and 6): the request's client, the sender (the staff member
 * preparing it) and the firm. CURRENT_DATE is the day it is sent, in the firm's time zone.
 */
export const EsignMergeKey = z.enum([
  'CLIENT_FIRST_NAME',
  'CLIENT_LAST_NAME',
  'CLIENT_FULL_NAME',
  'CLIENT_EMAIL',
  'CLIENT_PHONE',
  'CLIENT_ADDRESS',
  'BUSINESS_NAME',
  'SPOUSE_NAME',
  'STAFF_NAME',
  'STAFF_TITLE',
  'STAFF_EMAIL',
  'STAFF_PHONE',
  'FIRM_NAME',
  'FIRM_ADDRESS',
  'FIRM_PHONE',
  'FIRM_EMAIL',
  'CURRENT_DATE',
]);
export type EsignMergeKey = z.infer<typeof EsignMergeKey>;

/** Merge field names for the editor's chips. */
export const ESIGN_MERGE_LABELS = {
  CLIENT_FIRST_NAME: 'Client First Name',
  CLIENT_LAST_NAME: 'Client Last Name',
  CLIENT_FULL_NAME: 'Client Full Name',
  CLIENT_EMAIL: 'Client Email',
  CLIENT_PHONE: 'Client Phone',
  CLIENT_ADDRESS: 'Client Address',
  BUSINESS_NAME: 'Business Name',
  SPOUSE_NAME: 'Spouse/Secondary Signer Name',
  STAFF_NAME: 'Preparer/Staff Name',
  STAFF_TITLE: 'Staff Title',
  STAFF_EMAIL: 'Staff Email',
  STAFF_PHONE: 'Staff Phone',
  FIRM_NAME: 'Firm Name',
  FIRM_ADDRESS: 'Firm Address',
  FIRM_PHONE: 'Firm Phone',
  FIRM_EMAIL: 'Firm Email',
  CURRENT_DATE: 'Current Date',
} as const satisfies Record<EsignMergeKey, string>;

/** What screens show for a status. DELIVERED reads "Sent" (the mockup has no Delivered). */
export const ESIGN_STATUS_LABELS = {
  DRAFT: 'Draft',
  NEEDS_APPROVAL: 'Needs Approval',
  SENT: 'Sent',
  DELIVERED: 'Sent',
  VIEWED: 'Viewed',
  PARTIALLY_SIGNED: 'Partially Signed',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  VOIDED: 'Voided',
} as const satisfies Record<EsignRequestStatus, string>;

/** The dashboard's 9 counters, in the mockup's order (`EsignSummary.counts`). */
export const ESIGN_COUNTERS = [
  'DRAFT',
  'NEEDS_APPROVAL',
  'SENT',
  'VIEWED',
  'PARTIALLY_SIGNED',
  'COMPLETED',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
] as const satisfies readonly EsignRequestStatus[];
export type EsignCounter = (typeof ESIGN_COUNTERS)[number];
