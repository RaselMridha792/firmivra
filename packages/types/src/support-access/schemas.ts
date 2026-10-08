import { z } from 'zod';
import { text } from '../clients/text.js';

// Support access (R8 step 1; AUTH-DESIGN.md, "Super Admin access to a firm"): a Super Admin never
// reaches a firm's data without a grant that one of the firm's Owners approved, for at most 72
// hours (Rasel, Oct 6).
// - The Super Admin asks, with a reason the firm reads. One open request (pending or active) per
//   firm and Super Admin; another is 409 SUPPORT_REQUEST_OPEN.
// - The firm's Owner and Admins see the requests; only an Owner approves (1 to 72 hours from the
//   approval), declines a pending one, or revokes an active one. The firm sees "Firmivra Support"
//   and the reason, never which Super Admin asked (Rasel's q31, defaults of Oct 8).
// - A grant ends on its own when it expires, or when an Owner revokes it. While it is active the
//   Super Admin has read-only support views on the admin site (the firm's audit log first), never
//   the firm's workspace under a Super Admin session.
// - Every request, decision and support view is written to both audit logs: the platform's, with
//   the person, and the firm's, as "Firmivra Support" (no user id in it).
// Statuses are derived: PENDING (asked, not answered), ACTIVE (approved, not yet expired),
// EXPIRED, DECLINED (ended before an approval), REVOKED (ended after one).
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const SupportAccessId = z.uuid();
export const SupportAccessStatus = z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'DECLINED', 'REVOKED']);
export type SupportAccessStatus = z.infer<typeof SupportAccessStatus>;

/** A support access request as the firm sees it: who asked is always Firmivra Support. */
export const FirmSupportAccess = z.object({
  id: z.uuid(),
  reason: z.string(),
  status: SupportAccessStatus,
  requestedAt: DateTime,
  /** The Owner who approved it; null until approved. */
  approvedBy: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
  /** When an approved grant ends (or ended) on its own; null until approved. */
  expiresAt: DateTime.nullable(),
  /** When it was declined or revoked; null otherwise. */
  endedAt: DateTime.nullable(),
});
export type FirmSupportAccess = z.infer<typeof FirmSupportAccess>;

export const FirmSupportAccessList = z.object({
  items: z.array(FirmSupportAccess).max(100),
  nextCursor: z.string().nullable(),
});
export type FirmSupportAccessList = z.infer<typeof FirmSupportAccessList>;

/** Open ones (pending, then active) first, then the rest, newest first; paged. */
export const SupportAccessQuery = z.strictObject({
  status: SupportAccessStatus.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type SupportAccessQuery = z.input<typeof SupportAccessQuery>;

/** Owner only: the grant lasts this many hours from the approval (the database caps it at 72). */
export const ApproveSupportAccessRequest = z.strictObject({
  hours: z.number().int().min(1).max(72).default(24),
});
export type ApproveSupportAccessRequest = z.input<typeof ApproveSupportAccessRequest>;

/** A support access request as the Super Admins see it: the firm and who asked. */
export const AdminSupportAccess = z.object({
  id: z.uuid(),
  firm: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  admin: z.object({ userId: z.uuid(), name: z.string() }),
  reason: z.string(),
  status: SupportAccessStatus,
  requestedAt: DateTime,
  expiresAt: DateTime.nullable(),
  endedAt: DateTime.nullable(),
});
export type AdminSupportAccess = z.infer<typeof AdminSupportAccess>;

export const AdminSupportAccessList = z.object({
  items: z.array(AdminSupportAccess).max(100),
  nextCursor: z.string().nullable(),
});
export type AdminSupportAccessList = z.infer<typeof AdminSupportAccessList>;

/** Every firm's, or one firm's with `businessId`; the same order and paging as the firm's list. */
export const AdminSupportAccessQuery = SupportAccessQuery.extend({
  businessId: z.uuid().optional(),
});
export type AdminSupportAccessQuery = z.input<typeof AdminSupportAccessQuery>;

/** POST /admin/firms/{businessId}/support-access: why, on one line, which the firm reads. */
export const CreateSupportAccessRequest = z.strictObject({ reason: text(500) });
export type CreateSupportAccessRequest = z.input<typeof CreateSupportAccessRequest>;

/** Stable `error.code` values of these routes, besides the generic ones. */
export const SupportAccessErrorCode = z.enum([
  /** 409: this Super Admin already has a pending or active request for this firm. */
  'SUPPORT_REQUEST_OPEN',
  /** 409: approve and decline need a pending request; this one was already answered or ended. */
  'SUPPORT_REQUEST_DECIDED',
  /** 409: revoke needs an active grant (a pending request is declined; an ended one is over). */
  'SUPPORT_GRANT_NOT_ACTIVE',
  /** 403: a support view without an active grant for that firm. */
  'SUPPORT_GRANT_REQUIRED',
]);
export type SupportAccessErrorCode = z.infer<typeof SupportAccessErrorCode>;
