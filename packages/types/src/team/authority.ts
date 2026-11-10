import { z } from 'zod';
import { MembershipRole } from '../schemas.js';
import { ROLES_MANAGED_BY } from './roles.js';

// SM14, the approved account authority rules (Octavia's Staff Management review of Oct 23), with
// Rasel's default of Nov 7: an Owner acts on everyone, an Admin only on the roles below Admin.
// One rule for the API (which enforces it) and the screens (which read it from the API).

/**
 * Where a member stands. The Original Owner is the firm's first Owner (the account its
 * application created); a delegated Owner is any other Owner, given owner-level access by the
 * Original Owner. Everyone below Admin is a member.
 */
export type StaffTier = 'ORIGINAL_OWNER' | 'OWNER' | 'ADMIN' | 'MEMBER';

export const tierOf = (role: MembershipRole, originalOwner: boolean): StaffTier =>
  role === 'OWNER'
    ? originalOwner
      ? 'ORIGINAL_OWNER'
      : 'OWNER'
    : role === 'ADMIN'
      ? 'ADMIN'
      : 'MEMBER';

/** What one member may do to another's account. */
export const STAFF_AUTHORITY_ACTIONS = [
  'edit',
  'resetPassword',
  'resetMfa',
  'resendInvitation',
  'signOutSessions',
  'lock',
  'deactivate',
] as const;
export type StaffAuthorityAction = (typeof STAFF_AUTHORITY_ACTIONS)[number];

/**
 * May `actor` take `action` on another member, `target`? Never on oneself: one's own password and
 * sessions are self-service.
 * - Nobody acts on the Original Owner.
 * - Owner-level (Original or delegated) acts on everyone else, Reset MFA included.
 * - An Admin acts on the roles below Admin only, and never resets MFA.
 * - Below Admin, nobody acts on another account.
 */
export function mayActOn(actor: StaffTier, target: StaffTier, action: StaffAuthorityAction) {
  if (target === 'ORIGINAL_OWNER') return false;
  if (actor === 'ORIGINAL_OWNER' || actor === 'OWNER') return true;
  if (actor === 'ADMIN') return target === 'MEMBER' && action !== 'resetMfa';
  return false;
}

/**
 * The roles `actor` may give on a role change. Owner-level access only by the Original Owner;
 * otherwise ROLES_MANAGED_BY (an Owner gives Admin and below, an Admin the roles below Admin).
 */
export function rolesGivenBy(actor: StaffTier): readonly MembershipRole[] {
  if (actor === 'ORIGINAL_OWNER') return ['OWNER', ...ROLES_MANAGED_BY.OWNER];
  if (actor === 'OWNER') return ROLES_MANAGED_BY.OWNER;
  if (actor === 'ADMIN') return ROLES_MANAGED_BY.ADMIN;
  return [];
}

/**
 * May `actor` move another member from `from` to `to`? Granting owner-level access, and taking it
 * away (a delegate back to Admin or below), is the Original Owner's alone.
 */
export function mayChangeRole(actor: StaffTier, from: MembershipRole, to: MembershipRole) {
  if (from === to) return true;
  if (from === 'OWNER' && actor !== 'ORIGINAL_OWNER') return false;
  return rolesGivenBy(actor).includes(to);
}

/**
 * GET /business/staff/{id}: what the signed-in person may do to this member, from the rule above
 * (all false on one's own record). The screens enable their controls from it; the API checks the
 * same rule on every change.
 */
export const StaffAuthority = z.object({
  /** This member is the firm's Original Owner: nobody else changes their account. */
  originalOwner: z.boolean(),
  edit: z.boolean(),
  /** The role can be changed at all (a delegate's Owner role only by the Original Owner). */
  changeRole: z.boolean(),
  resetPassword: z.boolean(),
  resetMfa: z.boolean(),
  resendInvitation: z.boolean(),
  signOutSessions: z.boolean(),
  lock: z.boolean(),
  deactivate: z.boolean(),
  /** The roles the signed-in person may give this member on Edit Staff. */
  roles: z.array(MembershipRole),
});
export type StaffAuthority = z.infer<typeof StaffAuthority>;

/** The authority block for `actor` looking at `target` (`self`: their own record). */
export function staffAuthority(actor: StaffTier, target: StaffTier, self: boolean): StaffAuthority {
  const may = (action: StaffAuthorityAction) => !self && mayActOn(actor, target, action);
  const edit = may('edit');
  const role: MembershipRole =
    target === 'ORIGINAL_OWNER' || target === 'OWNER'
      ? 'OWNER'
      : target === 'ADMIN'
        ? 'ADMIN'
        : 'STAFF';
  const changeRole = edit && (role !== 'OWNER' || actor === 'ORIGINAL_OWNER');
  return {
    originalOwner: target === 'ORIGINAL_OWNER',
    edit,
    changeRole,
    resetPassword: may('resetPassword'),
    resetMfa: may('resetMfa'),
    resendInvitation: may('resendInvitation'),
    signOutSessions: may('signOutSessions'),
    lock: may('lock'),
    deactivate: may('deactivate'),
    roles: changeRole ? [...rolesGivenBy(actor)] : [],
  };
}
