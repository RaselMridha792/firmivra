import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import {
  ADVISORY_DISCLAIMER,
  isGridFirmRole,
  roleCan,
  type AdvisoryErrorCode,
  type AdvisoryGoalStatus,
  type AdvisoryPersonClient,
  type PermissionCapability,
} from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';

export const DISCLAIMER = ADVISORY_DISCLAIMER;

const refusal = (code: AdvisoryErrorCode | 'CLIENT_ARCHIVED', message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });

export const advErrors = {
  alreadyAdvisoryClient: () =>
    refusal('ALREADY_ADVISORY_CLIENT', 'This client is in the advisory program already'),
  duplicateService: () => refusal('DUPLICATE_SERVICE', 'This service is on the client already'),
  saveConflict: () =>
    refusal('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  invalidStatus: (message: string) => refusal('INVALID_STATUS', message),
  planNotReady: (missing: string[]) =>
    refusal(
      'PLAN_NOT_READY',
      'The plan is not ready yet',
      missing.map((m) => ({ path: 'plan', message: m })),
    ),
  planArchived: () => refusal('PLAN_ARCHIVED', 'Restore the plan before changing it'),
  inconsistent: () =>
    refusal('INCONSISTENT_FIGURES', 'Net profit must equal revenue minus expenses'),
  notThisClient: (what: string) =>
    refusal('NOT_THIS_CLIENT', `This ${what} belongs to another advisory client`),
  notClientFacing: () =>
    refusal('RESOURCE_NOT_CLIENT_FACING', 'This resource is for staff and cannot be sent'),
  clientArchived: () => refusal('CLIENT_ARCHIVED', 'Restore the advisory client first'),
  overrideNotAllowed: () =>
    new ForbiddenException({
      code: 'OVERRIDE_NOT_ALLOWED',
      message: 'You may not override figures that came from a source',
    }),
  financialsRestricted: () =>
    new ForbiddenException({
      code: 'FINANCIALS_RESTRICTED',
      message: 'You may not see or enter financial figures',
    }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

// ---------- What the caller may do ----------

export interface Perms {
  admin: boolean;
  createPlans: boolean;
  editPlans: boolean;
  manageGoals: boolean;
  manageRecs: boolean;
  viewFinancials: boolean;
  override: boolean;
  manageServices: boolean;
  send: boolean;
  advisoryAdmin: boolean;
}

const NONE: Perms = {
  admin: false,
  createPlans: false,
  editPlans: false,
  manageGoals: false,
  manageRecs: false,
  viewFinancials: false,
  override: false,
  manageServices: false,
  send: false,
  advisoryAdmin: false,
};

/**
 * Owner, Admin and Staff (on their assigned clients) do the day-to-day work; Owner and Admin also
 * override figures and run the settings. The other roles follow the grid's BUSINESS_ADVISORY row:
 * Create (plans, services), Edit (change plans, goals, recommendations, see the figures), Approve
 * (override, send) and Manage (everything, including the settings).
 */
export function permsOf(tenant: TenantContext | undefined): Perms {
  if (tenant?.kind !== 'staff') return NONE;
  const role = tenant.role;
  const admin = role === 'OWNER' || role === 'ADMIN';
  const staff = role === 'STAFF';
  const grid = (cap: PermissionCapability) =>
    isGridFirmRole(role) && roleCan(role, 'BUSINESS_ADVISORY', cap);
  const manage = grid('MANAGE');
  const approve = grid('APPROVE') || manage;
  const create = admin || staff || grid('CREATE') || manage;
  const edit = admin || staff || grid('EDIT') || manage;
  return {
    admin,
    createPlans: create,
    editPlans: edit,
    manageGoals: create || edit,
    manageRecs: edit,
    viewFinancials: edit || approve || grid('EXPORT'),
    override: admin || approve,
    manageServices: create,
    send: admin || staff || approve,
    advisoryAdmin: admin || manage,
  };
}

// ---------- Shapes ----------

export const clientRef = (c: {
  id: string;
  displayName: string;
  accountType: AdvisoryPersonClient['accountType'];
  email: string | null;
  phone: string | null;
}): AdvisoryPersonClient => ({
  id: c.id,
  name: c.displayName,
  accountType: c.accountType,
  email: c.email,
  phone: c.phone,
});

export const clientRefSelect = {
  id: true,
  displayName: true,
  accountType: true,
  email: true,
  phone: true,
  assignedUserId: true,
} satisfies Prisma.ClientSelect;

export const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The firm's calendar day. */
export const todayIn = (timezone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** The statuses of a goal or milestone that are still open (an open one past its target date is overdue). */
export const OPEN_GOAL_STATUSES = [
  'NOT_STARTED',
  'PLANNING',
  'IN_PROGRESS',
  'ON_TRACK',
  'AT_RISK',
] as const;

/** A goal's status as shown: an open one past its target date is OVERDUE. */
export function effectiveGoalStatus(
  status: AdvisoryGoalStatus,
  targetDate: Date | null,
  today: string,
): AdvisoryGoalStatus {
  if (
    targetDate &&
    (OPEN_GOAL_STATUSES as readonly string[]).includes(status) &&
    targetDate.toISOString().slice(0, 10) < today
  )
    return 'OVERDUE';
  return status;
}

/** The goal or milestone fields the database ties together: a status and its progress. */
export function settleProgress(
  current: { status: AdvisoryGoalStatus; progressPercent: number; completedAt: Date | null },
  change: { status?: AdvisoryGoalStatus; progressPercent?: number },
  now = new Date(),
): { status: AdvisoryGoalStatus; progressPercent: number; completedAt: Date | null } {
  const status = change.status ?? current.status;
  let progress = change.progressPercent ?? current.progressPercent;
  if (status === 'COMPLETED') {
    if (change.progressPercent !== undefined && change.progressPercent < 100)
      throw advErrors.invalid('progressPercent', 'A completed item is at 100%');
    progress = 100;
  } else if (current.status === 'COMPLETED' && change.status === undefined) {
    if (change.progressPercent !== undefined && change.progressPercent < 100)
      throw advErrors.invalid('progressPercent', 'Change the status of a completed item first');
  }
  if (status === 'NOT_STARTED') {
    if (change.progressPercent !== undefined && change.progressPercent > 0)
      throw advErrors.invalid('progressPercent', 'An item not started is at 0%');
    progress = 0;
  }
  return {
    status,
    progressPercent: progress,
    completedAt: status === 'COMPLETED' ? (current.completedAt ?? now) : null,
  };
}

/** A grouping word (an area, a category) as the columns keep it: lower case with underscores. */
export function slug(value: string | null | undefined, path: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  const s = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!/^[a-z][a-z0-9_]{0,59}$/.test(s))
    throw advErrors.invalid(path, 'Use letters, numbers and underscores, starting with a letter');
  return s;
}

/** Money as "$1,234". */
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

/** Merges a sent document into the stored one at its top-level keys; a key sent as null is removed. */
export function mergeDocument(
  stored: unknown,
  sent: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(stored as Record<string, unknown> | null) };
  for (const [key, value] of Object.entries(sent ?? {})) {
    if (value === null || value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}
