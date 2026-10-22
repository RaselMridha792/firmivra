import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { databaseErrorCode } from '@firmivra/db';
import {
  LOCATION_DUPLICATE_MESSAGE,
  type LocationsKpis,
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
} from '@firmivra/types';

// Settings > Locations' rules that need no database: the errors in the contract's words, the
// Super Administrator rule, who runs a location (its manager, or the main location's acting), the
// plan's allowance, and what a scheduled change does when it is due (location-actions.job.ts).

export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message,
    details: [{ path, message }],
  });

export const errors = {
  duplicate: () => conflict('DUPLICATE_LOCATION', LOCATION_DUPLICATE_MESSAGE),
  limit: () =>
    conflict(
      'LOCATION_LIMIT',
      "Your plan's locations are all in use. Upgrade the plan or deactivate a location first.",
    ),
  saveConflict: () =>
    conflict('SAVE_CONFLICT', 'This location was changed by someone else. Reload and try again.'),
  isPrimary: () =>
    conflict(
      'LOCATION_IS_PRIMARY',
      'This is the primary location. Set another location as primary first.',
    ),
  pendingExists: () =>
    conflict(
      'PENDING_ACTION_EXISTS',
      'A scheduled change is already pending here. Edit or cancel it first.',
    ),
  actionFinished: () =>
    conflict(
      'ACTION_FINISHED',
      'This scheduled change already ran, was cancelled or failed, so it cannot change.',
    ),
  notEligible: (path: string) =>
    new BadRequestException({
      code: 'MANAGER_NOT_ELIGIBLE',
      message: 'Choose an active member of the firm',
      details: [{ path, message: 'Choose an active member of the firm' }],
    }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
};

/** The member's grid, as PermissionGrantsService answers it. */
export interface GridReader {
  memberCell(
    businessId: string,
    userId: string,
    module: PermissionModule,
    capability: PermissionCapability,
  ): Promise<boolean | undefined>;
  /** A custom role's cell (its whole grid stands in for the role's); undefined if it lacks it. */
  customCell(
    businessId: string,
    customRoleId: string,
    module: PermissionModule,
    capability: PermissionCapability,
  ): Promise<boolean | undefined>;
  can(
    businessId: string,
    role: MembershipRole,
    module: PermissionModule,
    capability: PermissionCapability,
  ): Promise<boolean>;
}

/**
 * The "Super Administrator" of the Locations guide (Rasel, Oct 21, as for MFA in R60): the Owner,
 * and an Admin with MANAGE on SETTINGS, in the guard's order (auth/roles.guard.ts): the Admin's
 * own cell (member_permissions, Staff Management) first, then their custom role's grid when they
 * have one (#1010), then the firm's change to the Admin role (role_permissions, Users & Roles),
 * then the default grid (every cell for Admin). No other role, whatever its grid says.
 */
export async function isSuperAdministrator(
  grants: GridReader,
  viewer: { businessId: string; userId: string; role: string; customRoleId?: string | null },
): Promise<boolean> {
  if (viewer.role === 'OWNER') return true;
  if (viewer.role !== 'ADMIN') return false;
  const own = await grants.memberCell(viewer.businessId, viewer.userId, 'SETTINGS', 'MANAGE');
  if (own !== undefined) return own;
  if (viewer.customRoleId) {
    const custom = await grants.customCell(
      viewer.businessId,
      viewer.customRoleId,
      'SETTINGS',
      'MANAGE',
    );
    if (custom !== undefined) return custom;
  }
  return grants.can(viewer.businessId, 'ADMIN', 'SETTINGS', 'MANAGE');
}

/** A manager as the rules see them: a member, and whether they still work at the firm. */
export interface ManagerRef {
  userId: string;
  /** Not DEACTIVATED: a deactivated manager counts as removed. */
  present: boolean;
}

/**
 * Who runs a location (Locations guide, final decision 4): its own manager; without one (none
 * assigned, or deactivated) the main location's manager acts; nobody when neither is there.
 */
export function runnerOf(
  own: ManagerRef | null,
  main: ManagerRef | null,
): { userId: string; acting: boolean } | null {
  if (own?.present) return { userId: own.userId, acting: false };
  if (main?.present) return { userId: main.userId, acting: true };
  return null;
}

/**
 * Subscriptions no longer in force: their plan sets no limit (Rasel, Oct 22: cancelled or
 * suspended; expired is the same, an ended plan).
 */
export const ENDED_SUBSCRIPTIONS: readonly string[] = ['CANCELLED', 'SUSPENDED', 'EXPIRED'];

/**
 * The plan's locations: included plus purchased; null (no limit) when the firm has no
 * subscription row, or its subscription is cancelled, suspended or expired.
 */
export function allowanceOf(
  sub: { locationsIncluded: number; locationsPurchased: number; status?: string } | null,
): number | null {
  if (!sub || (sub.status !== undefined && ENDED_SUBSCRIPTIONS.includes(sub.status))) return null;
  return Math.max(0, sub.locationsIncluded + sub.locationsPurchased);
}

/** One more ACTIVE location would pass the plan's allowance. */
export const overAllowance = (active: number, allowed: number | null, adding = 1) =>
  allowed !== null && active + adding > allowed;

export function kpisOf(
  counts: { total: number; active: number },
  allowed: number | null,
): LocationsKpis {
  return {
    total: counts.total,
    active: counts.active,
    subscription: { used: counts.active, allowed },
  };
}

/** A scheduled time: absent or not in the future is now; later at most a year ahead. */
export const MAX_SCHEDULE_MS = 366 * 24 * 60 * 60_000;
export function whenOf(effectiveAt: string | undefined, now: number): { now: true } | { at: Date } {
  if (effectiveAt === undefined) return { now: true };
  const at = Date.parse(effectiveAt);
  if (at <= now) return { now: true };
  if (at - now > MAX_SCHEDULE_MS)
    throw invalid('effectiveAt', 'Choose a time within the next year');
  return { at: new Date(at) };
}

export type ActionKind = 'DEACTIVATE_LOCATION' | 'REASSIGN_MANAGER' | 'DEACTIVATE_MANAGER';
export type Decision = { outcome: 'DONE' } | { outcome: 'FAILED'; code: string };

/**
 * What a due scheduled change does (the job, and "now"): DEACTIVATE_LOCATION of the main location
 * fails LOCATION_IS_PRIMARY; a new manager (REASSIGN_MANAGER's, or DEACTIVATE_MANAGER's
 * replacement) who is no longer ACTIVE fails NEW_MANAGER_INACTIVE; a location archived since
 * fails LOCATION_ARCHIVED; a manager the scheduler's role may no longer deactivate (an Owner, or
 * an Admin for an Admin) fails MANAGER_NOT_ALLOWED. Otherwise it runs.
 */
export function decide(input: {
  kind: ActionKind;
  office?: { live: boolean; isMain: boolean } | null;
  newManagerActive?: boolean | null;
  managerAllowed?: boolean;
}): Decision {
  if (input.kind !== 'DEACTIVATE_MANAGER') {
    if (!input.office?.live) return { outcome: 'FAILED', code: 'LOCATION_ARCHIVED' };
    if (input.kind === 'DEACTIVATE_LOCATION' && input.office.isMain)
      return { outcome: 'FAILED', code: 'LOCATION_IS_PRIMARY' };
  }
  if (input.kind === 'DEACTIVATE_MANAGER' && input.managerAllowed === false)
    return { outcome: 'FAILED', code: 'MANAGER_NOT_ALLOWED' };
  if (input.kind !== 'DEACTIVATE_LOCATION' && input.newManagerActive === false)
    return { outcome: 'FAILED', code: 'NEW_MANAGER_INACTIVE' };
  return { outcome: 'DONE' };
}

/** The unique index a Prisma error names (the pg adapter keeps PostgreSQL's), if any. */
export function violatedIndex(error: unknown): string | undefined {
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { constraint?: { index?: unknown }; originalMessage?: unknown } | undefined;
  const index = cause?.constraint?.index;
  if (typeof index === 'string') return index;
  const message = cause?.originalMessage;
  return typeof message === 'string' ? /constraint "([^"]+)"/.exec(message)?.[1] : undefined;
}

const databaseMessage = (error: unknown): string => {
  const cause = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta
    ?.driverAdapterError?.cause as { originalMessage?: unknown } | undefined;
  return typeof cause?.originalMessage === 'string' ? cause.originalMessage : '';
};

/**
 * The database's refusals as the contract's answers, never a 500: the live name or address
 * (DUPLICATE_LOCATION), one pending change (PENDING_ACTION_EXISTS), a finished action
 * (ACTION_FINISHED), any other CHECK (a time zone, a field's shape: VALIDATION_FAILED).
 */
export function mapLocationDbError(error: unknown): unknown {
  const code = databaseErrorCode(error) ?? (error as { code?: unknown } | null)?.code;
  if (code === '23505' || code === 'P2002') {
    const index = violatedIndex(error) ?? '';
    if (index.startsWith('firm_office_actions_one_pending')) return errors.pendingExists();
    if (index === 'firm_offices_live_address' || index === 'firm_offices_live_name')
      return errors.duplicate();
    if (index === 'firm_offices_one_main')
      return conflict('CONFLICT', 'Another change to the primary location came first. Try again.');
    return error;
  }
  if (code === '23514' || code === '23P01') {
    if (databaseMessage(error).includes('a finished action never changes'))
      return errors.actionFinished();
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some details are not valid. Check them and try again.',
    });
  }
  return error;
}
