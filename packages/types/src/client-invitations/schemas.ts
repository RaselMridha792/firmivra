import { z } from 'zod';
import { ClientPortalRole } from '../db-enums.js';
import { ClientAccountStatus } from '../schemas.js';
import { SearchText } from '../clients/text.js';

const DateTime = z.iso.datetime({ offset: true });

/** How long an invitation link works (days), as the staff activation link does. */
export const PORTAL_INVITATION_DAYS = 7;
/** At most this many invitations per client in a day (resends included). */
export const PORTAL_INVITATIONS_PER_DAY = 3;

/**
 * Why an invitation cannot be sent now:
 * - `NO_EMAIL`: the client has no email on file (add one on the client's record).
 * - `HAS_LOGIN`: a portal login is linked to the client already.
 * - `SIGN_UP_WAITING`: someone signed up with the client's email; the firm approves it in Sign-ups.
 * - `ARCHIVED`: the client is archived.
 * - `DAILY_LIMIT`: `PORTAL_INVITATIONS_PER_DAY` were sent in the last 24 hours.
 */
export const PortalInvitationBlock = z.enum([
  'NO_EMAIL',
  'HAS_LOGIN',
  'SIGN_UP_WAITING',
  'ARCHIVED',
  'DAILY_LIMIT',
]);
export type PortalInvitationBlock = z.infer<typeof PortalInvitationBlock>;

/** The last invitation sent for the client, from its audit record. */
export const PortalInvitation = z.object({
  id: z.uuid(),
  sentAt: DateTime,
  /** The member who sent it; null when that member's name is not available. */
  sentBy: z.string().nullable(),
  expiresAt: DateTime,
  /** False when the email could not be sent; the link was never delivered. */
  delivered: z.boolean(),
  revokedAt: DateTime.nullable(),
  /**
   * `OPEN` (delivered, not expired, revoked or replaced), `EXPIRED`, `REVOKED`, `NOT_SENT`
   * (delivery failed), or `ACCEPTED` once a login is linked or a sign-up waits.
   */
  state: z.enum(['OPEN', 'EXPIRED', 'REVOKED', 'NOT_SENT', 'ACCEPTED']),
});
export type PortalInvitation = z.infer<typeof PortalInvitation>;

/**
 * GET /business/clients/{id}/portal-access: who can sign in for the client, and whether the
 * firm can invite them. The recipient is the client's email on file; an invitation goes nowhere
 * else.
 */
export const ClientPortalAccess = z.object({
  clientId: z.uuid(),
  clientName: z.string(),
  recipient: z.object({ name: z.string(), email: z.string() }).nullable(),
  logins: z.array(
    z.object({
      clientAccountId: z.uuid(),
      email: z.string(),
      portalRole: ClientPortalRole,
      status: ClientAccountStatus,
    }),
  ),
  invitation: PortalInvitation.nullable(),
  /** Null when an invitation can be sent now. */
  blocked: PortalInvitationBlock.nullable(),
});
export type ClientPortalAccess = z.infer<typeof ClientPortalAccess>;

/**
 * POST /business/clients/{id}/portal-invitation. `confirm` is the staff member's confirmation of
 * the recipient and access shown. A new invitation replaces the client's earlier link.
 */
export const SendPortalInvitationRequest = z.strictObject({
  confirm: z.literal(true),
});
export type SendPortalInvitationRequest = z.infer<typeof SendPortalInvitationRequest>;

/** POST /portal/{firmSlug}/invitation: the link's token (from the URL fragment). */
export const OpenPortalInvitationRequest = z.strictObject({
  token: z.string().min(20).max(4096),
});
export type OpenPortalInvitationRequest = z.infer<typeof OpenPortalInvitationRequest>;

/**
 * The invitation as its recipient sees it: the firm, their name and the email to sign up with
 * (masked, since a link can be forwarded). 410 INVITATION_INVALID for an expired, replaced,
 * revoked or unknown link; 409 ALREADY_SIGNED_UP once a login or sign-up exists for the email.
 */
export const OpenedPortalInvitation = z.object({
  firmName: z.string(),
  name: z.string(),
  maskedEmail: z.string(),
  expiresAt: DateTime,
});
export type OpenedPortalInvitation = z.infer<typeof OpenedPortalInvitation>;

// ---------- Sign-ups > Invitations (Clients Review Two, N8-09) ----------

/**
 * A row's state in Sign-ups > Invitations:
 * - `NOT_INVITED`: no invitation in the last eight days (Invite);
 * - `OPEN`: sent and waiting (Resend, Revoke); `OPENED`: the client opened its link;
 * - `EXPIRED`, `REVOKED`, `NOT_SENT` (the email failed): Resend;
 * - `ACCEPTED`: a login is linked or a sign-up with the email waits;
 * - `BLOCKED`: nothing can be sent now, `blocked` says why.
 */
export const PortalInvitationListState = z.enum([
  'NOT_INVITED',
  'OPEN',
  'OPENED',
  'EXPIRED',
  'REVOKED',
  'NOT_SENT',
  'ACCEPTED',
  'BLOCKED',
]);
export type PortalInvitationListState = z.infer<typeof PortalInvitationListState>;

/** GET /business/portal-invitations: newest invitation first, then the clients never invited. */
export const PortalInvitationsQuery = z.strictObject({
  /** The client's name, number or email. */
  search: SearchText.optional(),
  state: PortalInvitationListState.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PortalInvitationsQuery = z.input<typeof PortalInvitationsQuery>;

/**
 * One client in Sign-ups > Invitations: a client with no portal login, or one with an invitation
 * in the last eight days. The email is the client's on file, as their Portal Access card shows it.
 */
export const PortalInvitationRow = z.object({
  clientId: z.uuid(),
  clientName: z.string(),
  clientNumber: z.string(),
  email: z.string().nullable(),
  state: PortalInvitationListState,
  invitation: z
    .object({
      sentAt: DateTime,
      sentBy: z.string().nullable(),
      expiresAt: DateTime,
      openedAt: DateTime.nullable(),
      revokedAt: DateTime.nullable(),
    })
    .nullable(),
  /** Why nothing can be sent now; null when Invite or Resend may go. */
  blocked: PortalInvitationBlock.nullable(),
});
export type PortalInvitationRow = z.infer<typeof PortalInvitationRow>;

export const PortalInvitationPage = z.object({
  items: z.array(PortalInvitationRow).max(100),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type PortalInvitationPage = z.infer<typeof PortalInvitationPage>;
