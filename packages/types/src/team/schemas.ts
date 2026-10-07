import { z } from 'zod';
import { MembershipRole } from '../schemas.js';

// The firm's team (/team): who works there, their role and status, and open invites.
// Owner and Admin only. Inviting someone is R2's `staffAuth.createInvite` (POST /auth/invites);
// this module lists, changes roles, deactivates and resends. API: /api/v1/business/team
// (lead's T03, from Tumit's design). Rules, until Rasel decides otherwise:
// - Owners manage everyone: role (Owner, Admin, Staff) of ACTIVE members, deactivate, resend.
// - Admins manage Staff only (deactivate, resend) and change no roles, as they invite Staff only.
// - An invited person's role changes by inviting them again (staffAuth.createInvite), so a link
//   never grants a role its inviter could not; only the platform invites (and resends to) Owners.
// - Nobody changes their own role or deactivates themselves; a firm always keeps an active Owner.

export const TeamMemberStatus = z.enum(['INVITED', 'ACTIVE', 'DEACTIVATED']);
export type TeamMemberStatus = z.infer<typeof TeamMemberStatus>;

/** A membership id in a path: anything else gets 400 VALIDATION_FAILED. */
export const TeamMemberId = z.uuid();

/** Responses are plain objects: a field added later is dropped, so an open page keeps working. */
export const TeamMember = z.object({
  /** The membership id, used in team paths. */
  id: z.uuid(),
  user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
  role: MembershipRole,
  status: TeamMemberStatus,
  /** The newest invite of an INVITED member (may have expired: offer Resend); else null. */
  invite: z
    .object({
      sentAt: z.iso.datetime({ offset: true }),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .nullable(),
  /** The signed-in person: the screen hides their own role and deactivate controls. */
  isYou: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type TeamMember = z.infer<typeof TeamMember>;

/** GET /business/team: everyone, Owners first, then Admins, then Staff, by name. */
export const ListTeamResponse = z.object({ items: z.array(TeamMember) });
export type ListTeamResponse = z.infer<typeof ListTeamResponse>;

/** PATCH /business/team/{id}: Owners only, for ACTIVE members (409 NOT_ACTIVE otherwise). */
export const ChangeTeamRoleRequest = z.strictObject({ role: MembershipRole });
export type ChangeTeamRoleRequest = z.input<typeof ChangeTeamRoleRequest>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const TeamErrorCode = z.enum([
  /**
   * 409: the change would leave the firm without an active Owner. A safety net (enforced by the
   * database): since nobody changes themselves, a signed-in Owner only meets it in a race.
   */
  'LAST_ACTIVE_OWNER',
  /** 409: people cannot change their own role or deactivate themselves. */
  'CANNOT_CHANGE_SELF',
  /** 409: Resend works only for someone with an open invite (INVITED). */
  'NOT_INVITED',
  /** 409: roles change only for ACTIVE members; invite an invited person again instead. */
  'NOT_ACTIVE',
]);
export type TeamErrorCode = z.infer<typeof TeamErrorCode>;
