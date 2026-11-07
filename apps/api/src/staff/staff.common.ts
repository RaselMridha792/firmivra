import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { databaseErrorCode, isDbError, type TxClient } from '@firmivra/db';
import {
  mayActOn,
  mayChangeRole,
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
  ROLES_MANAGED_BY,
  type StaffActionResult,
  type StaffAuthorityAction,
  type StaffTier,
  tierOf,
} from '@firmivra/types';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { notFound } from '../workspaces/common.js';

// Shared by the Staff Management write services (R55): who may act on whom, the member as read
// for a change, the save version, and the errors of the contract (StaffErrorCode, TeamErrorCode).

/** The signed-in Owner or Admin who changes a member. */
export interface StaffActor {
  businessId: string;
  userId: string;
  role: MembershipRole;
}

export function staffActorOf(auth: AuthContext, tenant: TenantContext): StaffActor {
  if (tenant.kind !== 'staff') throw new Error('staff routes are for firm members');
  return { businessId: tenant.businessId, userId: auth.userId, role: tenant.role };
}

export const forbidden = (message = 'You do not have access to this action') =>
  new ForbiddenException({ code: 'FORBIDDEN', message });
export const cannotGrant = (message = 'You cannot give this role') =>
  new ForbiddenException({ code: 'CANNOT_GRANT', message });
export const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message,
    details: [{ path, message }],
  });
export const staffConflict = (code: string, message: string) =>
  new ConflictException({ code, message });

/**
 * The actor is still an active Owner or Admin, read in the change's transaction: someone demoted
 * or deactivated a moment ago can no longer act. Their membership id (the `*_by_membership_id`
 * columns).
 */
export async function requireManager(tx: TxClient, actor: StaffActor): Promise<string> {
  const self = await tx.membership.findFirst({
    where: { businessId: actor.businessId, userId: actor.userId, status: 'ACTIVE' },
    select: { id: true, role: true },
  });
  if (!self || (self.role !== 'OWNER' && self.role !== 'ADMIN')) throw forbidden();
  if (actor.role === 'OWNER' && self.role !== 'OWNER') throw forbidden();
  return self.id;
}

export const targetSelect = {
  id: true,
  userId: true,
  role: true,
  customRoleId: true,
  status: true,
  joinedAt: true,
  updatedAt: true,
} as const;
export type Target = {
  id: string;
  userId: string;
  role: MembershipRole;
  customRoleId: string | null;
  status: StaffActionResult['status'];
  joinedAt: Date | null;
  updatedAt: Date;
};

/** The member, locked until the change commits, so two changes to one member run one by one. */
export async function lockTarget(tx: TxClient, businessId: string, id: string): Promise<Target> {
  await tx.$executeRaw`SELECT 1 FROM memberships WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  const row = await tx.membership.findFirst({ where: { businessId, id }, select: targetSelect });
  if (!row) throw notFound();
  return row as Target;
}

/**
 * SM14: the firm's Original Owner (its user id): the first Owner, the account the firm's
 * application created. Nobody can demote or deactivate that account, so it stays the first.
 */
export async function originalOwnerOf(tx: TxClient, businessId: string): Promise<string | null> {
  const first = await tx.membership.findFirst({
    where: { businessId, role: 'OWNER' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { userId: true },
  });
  return first?.userId ?? null;
}

/** Where the actor and the target stand (packages/types, team/authority.ts). */
export async function tiersOf(
  tx: TxClient,
  actor: { businessId: string; userId: string; role: MembershipRole },
  target: { role: MembershipRole; userId: string },
): Promise<{ actor: StaffTier; target: StaffTier }> {
  const original = await originalOwnerOf(tx, actor.businessId);
  return {
    actor: tierOf(actor.role, actor.userId === original),
    target: tierOf(target.role, target.userId === original),
  };
}

const protectedOwner = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: "Only the Original Owner can change the Original Owner's account",
  });

/**
 * SM14, the account authority rule (mayActOn): nobody acts on themselves or on the Original
 * Owner; owner-level acts on everyone else; an Admin on the roles below Admin, never Reset MFA.
 * Returns both places, for a role change after it (assertRoleChange).
 */
export async function assertActsOn(
  tx: TxClient,
  actor: { businessId: string; userId: string; role: MembershipRole },
  target: { role: MembershipRole; userId: string },
  action: StaffAuthorityAction,
): Promise<{ actor: StaffTier; target: StaffTier }> {
  if (target.userId === actor.userId)
    throw staffConflict('CANNOT_CHANGE_SELF', 'You cannot change your own access');
  const tiers = await tiersOf(tx, actor, target);
  if (tiers.target === 'ORIGINAL_OWNER') throw protectedOwner();
  if (!mayActOn(tiers.actor, tiers.target, action)) throw forbidden();
  return tiers;
}

/**
 * A role change (mayChangeRole): giving owner-level access, or taking it from a delegate, is the
 * Original Owner's alone; otherwise the roles the actor may give. Else 403 CANNOT_GRANT.
 */
export function assertRoleChange(actor: StaffTier, from: MembershipRole, to: MembershipRole) {
  if (!mayChangeRole(actor, from, to)) throw cannotGrant();
}

/** The actor may give this role (ROLES_MANAGED_BY): else 403 CANNOT_GRANT. */
export function assertMayGive(actor: StaffActor, role: MembershipRole) {
  if (!ROLES_MANAGED_BY[actor.role].includes(role)) throw cannotGrant();
}

/**
 * The custom role a change gives (account.customRoleId): in this firm (404), not archived (409
 * CUSTOM_ROLE_ARCHIVED), and the member's role is the one it is based on (400
 * CUSTOM_ROLE_MISMATCH).
 */
export async function customRoleFor(
  tx: TxClient,
  businessId: string,
  customRoleId: string,
  role: MembershipRole | undefined,
): Promise<{ id: string; name: string; basedOn: MembershipRole }> {
  const r = await tx.customRole.findFirst({
    where: { businessId, id: customRoleId },
    select: { id: true, name: true, basedOn: true, archivedAt: true },
  });
  if (!r) throw notFound();
  if (r.archivedAt)
    throw staffConflict('CUSTOM_ROLE_ARCHIVED', 'This role is archived and can no longer be given');
  if (role !== undefined && role !== r.basedOn)
    throw new BadRequestException({
      code: 'CUSTOM_ROLE_MISMATCH',
      message: 'The role must be the one this custom role is based on',
      details: [{ path: 'account.role', message: 'Use the role it is based on' }],
    });
  return { id: r.id, name: r.name, basedOn: r.basedOn };
}

/** GET's `version`: the newer of the membership's and the profile's last change. */
export const versionOf = (memberAt: Date, profileAt: Date | null | undefined) =>
  (profileAt && profileAt > memberAt ? profileAt : memberAt).toISOString();

/**
 * Signs the member's sessions here out (Active Sessions): the rows the concurrent-session limit
 * counts. The tenant guard already refuses a member who is not ACTIVE on the next request.
 */
export async function revokeSessions(
  tx: TxClient,
  businessId: string,
  membershipId: string,
): Promise<number> {
  const { count } = await tx.staffSession.updateMany({
    where: { businessId, membershipId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/** The database's rules as the contract's errors: never a 500. */
export function mapStaffDbError(e: unknown): unknown {
  if (isDbError(e, 'LAST_ACTIVE_OWNER'))
    return staffConflict('LAST_ACTIVE_OWNER', 'The firm needs at least one active owner');
  if (e instanceof HttpException) return e;
  const code = databaseErrorCode(e) ?? (e as { code?: string } | null)?.code;
  if (code === 'P2002' || code === '23505')
    return staffConflict(
      'CONFLICT',
      'This was just changed by someone else. Reload and try again.',
    );
  if (code === '23514')
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some of the values are not allowed',
    });
  return e;
}

export const cellKey = (m: PermissionModule | string, c: PermissionCapability | string) =>
  `${m}:${c}`;
