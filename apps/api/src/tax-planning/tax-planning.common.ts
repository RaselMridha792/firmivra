import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import {
  isGridFirmRole,
  roleCan,
  TAX_PLANNING_DISCLAIMER,
  type PermissionCapability,
  type PlanInput,
  type PlanningClientRef,
  type SavingsEstimate,
  type StrategyCategory,
  type TaxPlanningErrorCode,
} from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';
import type { PlanFigure } from './tax-tables.js';

export const DISCLAIMER = TAX_PLANNING_DISCLAIMER;

const refusal = (code: TaxPlanningErrorCode, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });

export const tpErrors = {
  duplicatePlan: () =>
    refusal('DUPLICATE_PLAN', 'This client already has a plan with this name for this year'),
  duplicateStrategy: () => refusal('DUPLICATE_STRATEGY', 'This strategy is already in the plan'),
  duplicateOpportunity: (existingId: string) =>
    refusal('DUPLICATE_OPPORTUNITY', 'This client already has an open opportunity for this', [
      { path: 'existingId', message: existingId },
    ]),
  duplicateName: () => refusal('DUPLICATE_NAME', 'A strategy with this name exists'),
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
  documentNotAllowed: () =>
    refusal('DOCUMENT_NOT_ALLOWED', 'Only the plan client’s own documents can be linked'),
  overrideNotAllowed: () =>
    new ForbiddenException({
      code: 'OVERRIDE_NOT_ALLOWED',
      message: 'You may not override an estimate',
    }),
  financialRestricted: () =>
    new ForbiddenException({
      code: 'FINANCIAL_INPUTS_RESTRICTED',
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
  /** Owner or Admin. */
  admin: boolean;
  create: boolean;
  edit: boolean;
  review: boolean;
  manageStrategies: boolean;
  override: boolean;
  send: boolean;
  viewInputs: boolean;
  planningAdmin: boolean;
}

/**
 * Owner and Admin may do everything. Staff may create, edit, review, send and see the figures of
 * their assigned clients, but not manage the library, override an estimate or run the screening.
 * The other roles follow the permission grid's TAX_PLANNING row: Create, Edit (also review and
 * view the figures), Approve (override, send) and Manage (library and screening).
 */
export function permsOf(tenant: TenantContext | undefined): Perms {
  if (tenant?.kind !== 'staff')
    return {
      admin: false,
      create: false,
      edit: false,
      review: false,
      manageStrategies: false,
      override: false,
      send: false,
      viewInputs: false,
      planningAdmin: false,
    };
  const admin = tenant.role === 'OWNER' || tenant.role === 'ADMIN';
  const staff = tenant.role === 'STAFF';
  const role = tenant.role;
  const grid = (cap: PermissionCapability) =>
    isGridFirmRole(role) && roleCan(role, 'TAX_PLANNING', cap);
  const manage = grid('MANAGE');
  const approve = grid('APPROVE') || manage;
  return {
    admin,
    create: admin || staff || grid('CREATE') || manage,
    edit: admin || staff || grid('EDIT') || manage,
    review: admin || staff || grid('EDIT') || manage,
    manageStrategies: admin || manage,
    override: admin || approve,
    send: admin || staff || approve,
    viewInputs: admin || staff || grid('EDIT') || approve,
    planningAdmin: admin || manage,
  };
}

// ---------- Shapes ----------

export const clientRef = (c: {
  id: string;
  displayName: string;
  accountType: PlanningClientRef['accountType'];
  email: string | null;
  phone: string | null;
}): PlanningClientRef => ({
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

export const ENTITY_LABELS: Record<string, string> = {
  INDIVIDUAL: 'Individual',
  BUSINESS: 'Business',
};
export const entityLabel = (entityType: string | null, accountType: string): string =>
  entityType ?? ENTITY_LABELS[accountType] ?? accountType;

/** The firm's calendar day today. */
export const todayIn = (timezone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export const iso = (d: Date | null) => d?.toISOString() ?? null;

interface StrategyShape {
  selected: boolean;
  status: string;
  category: StrategyCategory;
  displayName: string;
  estimatedSavingsCents: number | null;
  overrideSavingsCents: number | null;
}

export const effectiveCents = (s: {
  estimatedSavingsCents: number | null;
  overrideSavingsCents: number | null;
}): number | null => s.overrideSavingsCents ?? s.estimatedSavingsCents;

/**
 * The plan's projected savings (cents) and the notes on how overlapping savings were handled.
 * Strategies that are selected and not declined count. Every category adds up, except that the
 * retirement strategies share one contribution limit and one reduction of taxable income: only
 * the largest of their figures counts.
 */
export function planTotals(strategies: StrategyShape[]): { cents: number | null; notes: string[] } {
  const counted = strategies.filter(
    (s) => s.selected && s.status !== 'DECLINED' && effectiveCents(s) !== null,
  );
  if (counted.length === 0) return { cents: null, notes: [] };
  const retirement = counted.filter((s) => s.category === 'RETIREMENT');
  const others = counted.filter((s) => s.category !== 'RETIREMENT');
  const notes: string[] = [];
  let largest = 0;
  if (retirement.length > 0) {
    const top = retirement.reduce((a, b) =>
      (effectiveCents(b) ?? 0) > (effectiveCents(a) ?? 0) ? b : a,
    );
    largest = effectiveCents(top) ?? 0;
    if (retirement.length > 1)
      notes.push(
        `Retirement strategies share one contribution limit, so only the largest (${top.displayName}) is counted.`,
      );
  }
  const cents = others.reduce((sum, s) => sum + (effectiveCents(s) ?? 0), 0) + largest;
  return { cents, notes };
}

export function estimateView(
  s: {
    estimatedSavingsCents: number | null;
    estimateDataYear: number | null;
    estimateCalculatedAt: Date | null;
    overrideSavingsCents: number | null;
  },
  reason: string | null,
): SavingsEstimate {
  const cents = effectiveCents(s);
  return {
    cents,
    modelCents: s.estimatedSavingsCents,
    overridden: s.overrideSavingsCents !== null,
    dataYear: s.estimateDataYear,
    calculatedAt: iso(s.estimateCalculatedAt),
    basis:
      s.overrideSavingsCents !== null
        ? 'Entered by an authorized person'
        : s.estimatedSavingsCents !== null && s.estimateDataYear !== null
          ? `Based on ${s.estimateDataYear} figures`
          : null,
    unavailableReason: cents === null ? (reason ?? 'Not calculated yet') : null,
  };
}

/** The figures the model reads from a plan's rows: an adjustment, else a projected figure, else the latest historical one. */
export function figuresOf(
  rows: { key: string; kind: PlanInput['kind']; taxYear: number; amountCents: number | null }[],
  planYear: number,
): Map<string, PlanFigure> {
  const rank = (kind: PlanInput['kind']) =>
    kind === 'ADJUSTMENT' ? 3 : kind === 'PROJECTED' ? 2 : 1;
  const best = new Map<string, PlanFigure>();
  for (const r of rows) {
    if (r.amountCents === null) continue;
    if (r.kind === 'PROJECTED' && r.taxYear < planYear) continue;
    const cur = best.get(r.key);
    if (
      !cur ||
      rank(r.kind) > rank(cur.kind) ||
      (rank(r.kind) === rank(cur.kind) && r.taxYear > cur.taxYear)
    )
      best.set(r.key, { amountCents: r.amountCents, taxYear: r.taxYear, kind: r.kind });
  }
  return best;
}

/** A figure is stale when it was last confirmed more than this many days ago. */
export const STALE_AFTER_DAYS = 365;
export const isStale = (asOf: Date | null, now = new Date()) =>
  asOf !== null && now.getTime() - asOf.getTime() > STALE_AFTER_DAYS * 86_400_000;

export const LIVE_PLAN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'READY_FOR_REVIEW',
  'IMPLEMENTED',
] as const;

export const OPEN_OPPORTUNITY_STATUSES = [
  'NEW',
  'UNDER_REVIEW',
  'ASSIGNED',
  'DISCUSSION_SCHEDULED',
  'NEEDS_DOCUMENTS',
  'ADDED_TO_PLAN',
] as const;
export const CLOSED_OPPORTUNITY_STATUSES = [
  'NOT_APPLICABLE',
  'DISMISSED',
  'IMPLEMENTED',
  'CLOSED',
] as const;
