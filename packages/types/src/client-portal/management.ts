import { z } from 'zod';
import { PortalInvitation, PortalInvitationBlock } from '../client-invitations/schemas.js';
import {
  ClientAccountStatus,
  ClientAccountType,
  ClientPortalRole,
  ClientStatus,
} from '../db-enums.js';
import { ClientPortalLock } from './access.js';

// The firm workspace's Client Portal module (Client Portal developer instructions 1 to 5, 13, 14,
// 17, 24 and 26): one page for any client, switched, never a page per client. These are internal
// firm views of the canonical records (Clients, Documents, Intake Forms, Messages, Appointments,
// Tax Returns, Invoices, Tasks); nothing here is a second copy. Staff see only their own clients.

const DateTime = z.iso.datetime({ offset: true });
const DateOnly = z.iso.date();
const Count = z.number().int().nonnegative();

/** Where the client's portal access stands, one value for the header's badge. */
export const ClientPortalStatus = z.enum([
  /** A login is ACTIVE and the client is not locked. */
  'ACTIVE',
  /** The firm locked the client (Lock Portal Access): every login refused until unlocked. */
  'LOCKED',
  /** Every login the client had is DISABLED (Deactivate Portal). */
  'DEACTIVATED',
  /** A sign-up waits for the firm's approval in Sign-ups. */
  'PENDING_APPROVAL',
  /** No login yet, and an invitation link is open. */
  'INVITATION_PENDING',
  /** No login and no open invitation. */
  'NOT_ACTIVATED',
]);
export type ClientPortalStatus = z.infer<typeof ClientPortalStatus>;

export const ClientPortalLogin = z.object({
  clientAccountId: z.uuid(),
  email: z.string(),
  portalRole: ClientPortalRole,
  status: ClientAccountStatus,
});
export type ClientPortalLogin = z.infer<typeof ClientPortalLogin>;

/** GET /business/client-portal/clients/{id}: the header and its status strip (Frame 2). */
export const ClientPortalHeader = z.object({
  client: z.object({
    id: z.uuid(),
    /** "CL-10024". */
    number: z.string(),
    name: z.string(),
    accountType: ClientAccountType,
    status: ClientStatus,
    email: z.string().nullable(),
    phone: z.string().nullable(),
    clientSince: DateOnly.nullable(),
    archived: z.boolean(),
  }),
  portal: z.object({
    status: ClientPortalStatus,
    lock: ClientPortalLock,
    logins: z.array(ClientPortalLogin),
    /** When the client's first login was approved; null with none. */
    portalSince: DateTime.nullable(),
    /** The latest successful sign-in of any of the client's logins; never made up. */
    lastLogin: DateTime.nullable(),
    /** The latest event in the client's portal activity. */
    lastActivity: z.object({ at: DateTime, type: z.string() }).nullable(),
    /** The primary login's authenticator app; null with no login. */
    mfa: z.enum(['ENABLED', 'NOT_ENROLLED']).nullable(),
    invitation: PortalInvitation.nullable(),
    /** Why an invitation can't be sent now; null when it can. */
    invitationBlocked: PortalInvitationBlock.nullable(),
    /** The firm's portal address (`{PORTAL_BASE_URL}/{slug}`), for Portal Link and Copy Link. */
    link: z.url(),
  }),
  /** What this member may do here; the API checks each again. */
  can: z.object({
    /** Lock, deactivate, reset access, MFA reset, visibility: Owner and Admin. */
    manageAccess: z.boolean(),
    /** Send or resend the invitation: anyone who may see the client. */
    invite: z.boolean(),
  }),
});
export type ClientPortalHeader = z.infer<typeof ClientPortalHeader>;

/** GET /business/client-portal/recent: the member's recently opened clients, newest first. */
export const RecentPortalClient = z.object({
  id: z.uuid(),
  number: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  viewedAt: DateTime,
});
export type RecentPortalClient = z.infer<typeof RecentPortalClient>;
export const RECENT_PORTAL_CLIENTS = 8;
export const RecentPortalClients = z.object({
  items: z.array(RecentPortalClient).max(RECENT_PORTAL_CLIENTS),
});
export type RecentPortalClients = z.infer<typeof RecentPortalClients>;

/** The Portal Summary's range: the last 7, 30 or 90 days. */
export const PortalSummaryDays = z.enum(['7', '30', '90']);
export type PortalSummaryDays = z.infer<typeof PortalSummaryDays>;
export const PortalSummaryQuery = z.strictObject({ days: PortalSummaryDays.default('30') });

/**
 * GET /business/client-portal/clients/{id}/summary?days=30: the six cards. A card is null when
 * the member may not view its module. Counts "in the range" are of things that happened in it;
 * the rest (pending review, unread, upcoming, in progress, outstanding, pending) are as of now.
 */
export const ClientPortalSummary = z.object({
  days: z.number().int(),
  documents: z.object({ added: Count, pendingReview: Count }).nullable(),
  messages: z.object({ inRange: Count, unread: Count }).nullable(),
  appointments: z.object({ upcoming: Count, next: DateTime.nullable() }).nullable(),
  taxReturns: z.object({ total: Count, inProgress: Count }).nullable(),
  invoices: z.object({ issued: Count, outstandingCents: Count }).nullable(),
  intakeForms: z.object({ sent: Count, pending: Count, needsReview: Count }).nullable(),
});
export type ClientPortalSummary = z.infer<typeof ClientPortalSummary>;

export const PendingClientActionKind = z.enum([
  'DOCUMENTS_REQUESTED',
  'INTAKE_INCOMPLETE',
  'INTAKE_SUBMITTED',
  'SIGNATURE_REQUIRED',
  'INVOICE_OUTSTANDING',
  'APPOINTMENT_UPCOMING',
  'TASK_OPEN',
]);
export type PendingClientActionKind = z.infer<typeof PendingClientActionKind>;

/** One kind of item waiting on the client (or, for a submitted form, on the firm). */
export const PendingClientAction = z.object({
  kind: PendingClientActionKind,
  count: Count,
  /** The first item's name: the form, the request, the invoice number, the meeting. */
  title: z.string(),
  /** The first item, for its link. */
  recordId: z.uuid(),
  /** Outstanding invoices: their balance in cents. */
  amountCents: Count.nullable(),
  /** The earliest due date of the kind's items. */
  dueOn: DateOnly.nullable(),
  /** The next appointment's start. */
  at: DateTime.nullable(),
  /** Some item of the kind is past its due date. */
  overdue: z.boolean(),
});
export type PendingClientAction = z.infer<typeof PendingClientAction>;

/** GET /business/client-portal/clients/{id}/pending-actions: only kinds with items. */
export const PendingClientActions = z.object({ items: z.array(PendingClientAction) });
export type PendingClientActions = z.infer<typeof PendingClientActions>;

export const PortalActivityActor = z.enum(['CLIENT', 'STAFF', 'SYSTEM']);
export type PortalActivityActor = z.infer<typeof PortalActivityActor>;

/** One event in the client's portal activity (client-portal/portal-activity.ts lists the types). */
export const ClientPortalActivityItem = z.object({
  id: z.uuid(),
  at: DateTime,
  /** For example `portal.signed_in`, `document.uploaded`, `portal.locked`. */
  type: z.string(),
  actor: z.object({ kind: PortalActivityActor, name: z.string().nullable() }),
  entity: z.object({ type: z.string(), id: z.uuid() }).nullable(),
  /** Owner and Admin only; null for everyone else. */
  ip: z.string().nullable(),
});
export type ClientPortalActivityItem = z.infer<typeof ClientPortalActivityItem>;

export const PORTAL_ACTIVITY_PAGE = 50;
/** GET .../activity: newest first; `type` matches a type or its prefix (`document`). */
export const ClientPortalActivityQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PORTAL_ACTIVITY_PAGE).default(20),
  type: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/)
    .max(60)
    .optional(),
  actor: PortalActivityActor.optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
});
export type ClientPortalActivityQuery = z.input<typeof ClientPortalActivityQuery>;
export const ClientPortalActivityPage = z.object({
  items: z.array(ClientPortalActivityItem),
  nextCursor: z.string().nullable(),
});
export type ClientPortalActivityPage = z.infer<typeof ClientPortalActivityPage>;

export const PortalLoginEvent = z.enum([
  'SIGNED_IN',
  'SIGNED_OUT',
  'SIGN_IN_FAILED',
  'MFA_FAILED',
  'LOCKED_OUT',
]);
export type PortalLoginEvent = z.infer<typeof PortalLoginEvent>;

/** One sign-in event of the client's logins, from the audit log (never a password or code). */
export const ClientPortalLoginItem = z.object({
  id: z.uuid(),
  at: DateTime,
  event: PortalLoginEvent,
  /** Which login; null when the record names none. */
  email: z.string().nullable(),
  /** Owner and Admin only; null for everyone else. */
  ip: z.string().nullable(),
  /** LOCKED_OUT: until when. */
  until: DateTime.nullable(),
});
export type ClientPortalLoginItem = z.infer<typeof ClientPortalLoginItem>;

/** GET .../logins: Login History and Security Events, newest first. */
export const ClientPortalLoginsQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PORTAL_ACTIVITY_PAGE).default(20),
});
export type ClientPortalLoginsQuery = z.input<typeof ClientPortalLoginsQuery>;
export const ClientPortalLogins = z.object({
  items: z.array(ClientPortalLoginItem),
  nextCursor: z.string().nullable(),
});
export type ClientPortalLogins = z.infer<typeof ClientPortalLogins>;
