import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { databaseErrorCode, type Prisma, type TxClient } from '@firmivra/db';
import {
  type BillingFirm,
  SUBSCRIPTION_ERRORS,
  type SubscriptionErrorCode,
  type SubscriptionPlan,
  type SubscriptionRow,
  websiteHost,
} from '@firmivra/types';
import { z } from 'zod';
import { loadFirms } from '../admin-billing/billing-common.js';
import type { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  accessEndsOf,
  dayOf,
  dayOrNull,
  nextBillingOf,
  pricesOf,
  usageOf,
} from './subscriptions-math.js';

// What every Subscriptions read and write needs, in the Super Admin's admin scope: the errors, the
// plans, and one row view for the table, the detail panel and every change's answer
// (docs/work/R60-subscriptions.md, "Subscriptions API").

type Status = 400 | 403 | 404 | 409 | 422;
/** The HTTP status each contract code answers with. */
const STATUS: Readonly<Record<SubscriptionErrorCode, Status>> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ALREADY_SUBSCRIBED: 409,
  FIRM_NOT_AVAILABLE: 422,
  FIRM_NOT_BILLABLE: 409,
  STATUS_NOT_ALLOWED: 409,
  NO_CHANGE: 422,
  PLAN_INACTIVE: 422,
  SEATS_OUT_OF_RANGE: 422,
  SEATS_IN_USE: 422,
  LOCATIONS_NOT_OFFERED: 422,
  RENEWAL_ALREADY_OFF: 409,
  RENEWAL_ALREADY_ON: 409,
  NONPAYMENT_NOT_PAST_DUE: 422,
  BALANCE_DUE: 409,
  PAYMENT_CONFIRMATION_REQUIRED: 422,
  PLAN_REQUIRED: 422,
  NO_BILLING_DATE: 409,
  BILLING_DATE_OUT_OF_RANGE: 422,
  CONFIRM_NAME_MISMATCH: 422,
};

function subscriptionError(
  status: Status,
  code: SubscriptionErrorCode | 'VALIDATION_FAILED',
  message?: string,
) {
  const body = {
    code,
    message:
      message ??
      (code === 'VALIDATION_FAILED' ? 'The request is not valid' : SUBSCRIPTION_ERRORS[code]),
  };
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 409:
      return new ConflictException(body);
    default:
      return new UnprocessableEntityException(body);
  }
}
/** A contract error with its status and message. */
export const refuse = (code: SubscriptionErrorCode, message?: string) =>
  subscriptionError(STATUS[code], code, message);
export const notFound = () => refuse('NOT_FOUND');
export const invalid = (message: string) => subscriptionError(400, 'VALIDATION_FAILED', message);

/**
 * A backstop for a database refusal the checks before it missed: the firm's one subscription
 * (unique `business_id`) as ALREADY_SUBSCRIBED, a missing row as NOT_FOUND, any other check or
 * trigger as 400. HTTP errors (this module's and Billing's) pass as they are.
 */
export function asSubscriptionError(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  const sqlState = databaseErrorCode(error);
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === 'P2002' || sqlState === '23505') return refuse('ALREADY_SUBSCRIBED');
  if (prismaCode === 'P2025' || prismaCode === 'P2003' || sqlState === '23503') return notFound();
  if (sqlState === '23514') return invalid('The database refused this change');
  return error;
}

// ---------- Plans ----------

export const planInclude = {
  features: { orderBy: [{ createdAt: 'asc' }, { featureKey: 'asc' }] },
} satisfies Prisma.PlatformPlanInclude;
type PlanRow = Prisma.PlatformPlanGetPayload<{ include: typeof planInclude }>;

export const planView = (p: PlanRow): SubscriptionPlan => ({
  id: p.id,
  code: p.code,
  name: p.name,
  priceCents: p.basePriceCents,
  billingCycle: p.billingCycle,
  includedSeats: p.includedSeats,
  maxSeats: p.maxSeats,
  seatPriceCents: p.overagePriceCentsPerSeat,
  includedLocations: p.includedLocations,
  locationPriceCents: p.overagePriceCentsPerLocation,
  displayOrder: p.displayOrder,
  active: p.isActive,
  features: p.features.map((f) => ({ key: f.featureKey, label: f.label })),
});

/** Every plan, in display order. */
export async function loadPlans(tx: TxClient): Promise<SubscriptionPlan[]> {
  const rows = await tx.platformPlan.findMany({
    include: planInclude,
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
  return rows.map(planView);
}

// ---------- Subscriptions ----------

export const subscriptionInclude = {
  plan: { include: planInclude },
} satisfies Prisma.PlatformFirmSubscriptionInclude;
export type SubscriptionDbRow = Prisma.PlatformFirmSubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

/** A subscription with what its row is built from. */
export interface Loaded {
  sub: SubscriptionDbRow;
  plan: SubscriptionPlan;
  /** Billing's view of the firm: its contact, terms and whether it can get documents. */
  firm: BillingFirm;
  row: SubscriptionRow;
  /** When it started: paid start, else trial start, else creation. */
  startedOn: string;
  /** When it ended (closed, or the trial expired); null while it runs. */
  endedOn: string | null;
}

/** The days the subscription's own columns hold, as UTC days. */
export function factsOf(sub: SubscriptionDbRow) {
  return {
    status: sub.status,
    billingCycle: sub.billingCycle,
    seatsIncluded: sub.seatsIncluded,
    seatsPurchased: sub.seatsPurchased,
    locationsIncluded: sub.locationsIncluded,
    locationsPurchased: sub.locationsPurchased,
    priceCentsOverride: sub.priceCentsOverride,
    autoRenew: sub.autoRenew,
    trialEndsOn: dayOrNull(sub.trialEndsAt),
    nextBillingOn: dayOrNull(sub.nextBillingDate),
    periodEnd: dayOrNull(sub.currentPeriodEnd),
    paidThroughOn: dayOrNull(sub.paidThroughDate),
    closedOn: dayOrNull(sub.closedAt),
  };
}

const ApplicationSite = z.object({
  business: z.object({ website: z.string().nullish() }),
});

/**
 * The subscriptions (all, or those `where` picks; at most 5,000) as the table shows them: the firm
 * (its billing contact, else its first active owner; its application's website host), the seats in
 * use from the latest daily firm rollup, the credit left on its notes and an open support grant.
 */
export async function loadSubscriptions(
  tx: TxClient,
  where: Prisma.PlatformFirmSubscriptionWhereInput = {},
  now = Date.now(),
): Promise<Loaded[]> {
  const subs = await tx.platformFirmSubscription.findMany({
    where,
    include: subscriptionInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 5000,
  });
  if (subs.length === 0) return [];
  const firmIds = [...new Set(subs.map((s) => s.businessId))];
  const one = firmIds.length === 1 ? firmIds[0] : undefined;
  const inFirms = { in: firmIds };
  const [firms, applications, metrics, credits, grants] = await Promise.all([
    loadFirms(tx, one),
    tx.firmApplication.findMany({
      where: { businessId: inFirms },
      select: { businessId: true, data: true },
    }),
    tx.platformFirmMetricsDaily.findMany({
      where: { businessId: inFirms },
      orderBy: [{ businessId: 'asc' }, { day: 'desc' }],
      distinct: ['businessId'],
      select: { businessId: true, totalUsers: true },
    }),
    tx.platformCreditNote.findMany({
      where: { businessId: inFirms, status: { in: ['AVAILABLE', 'PARTIALLY_APPLIED'] } },
      select: { businessId: true, totalCents: true, appliedCents: true, refundedCents: true },
    }),
    tx.supportAccessGrant.findMany({
      where: {
        businessId: inFirms,
        grantedByUserId: { not: null },
        revokedAt: null,
        expiresAt: { gt: new Date(now) },
      },
      select: { businessId: true, expiresAt: true },
    }),
  ]);
  const domainOf = new Map<string, string | null>();
  for (const a of applications) {
    if (!a.businessId) continue;
    const site = ApplicationSite.safeParse(a.data).data?.business.website;
    domainOf.set(a.businessId, site ? websiteHost(site) : null);
  }
  const usedOf = new Map(metrics.map((m) => [m.businessId, m.totalUsers]));
  const creditOf = new Map<string, number>();
  for (const c of credits)
    creditOf.set(
      c.businessId,
      (creditOf.get(c.businessId) ?? 0) +
        Math.max(0, c.totalCents - c.appliedCents - c.refundedCents),
    );
  const grantOf = new Map<string, Date>();
  for (const g of grants) {
    const until = g.expiresAt!;
    const kept = grantOf.get(g.businessId);
    if (!kept || until > kept) grantOf.set(g.businessId, until);
  }
  const out: Loaded[] = [];
  for (const sub of subs) {
    const firm = firms.get(sub.businessId);
    if (!firm) continue;
    const plan = planView(sub.plan);
    const facts = factsOf(sub);
    const prices = pricesOf(plan, facts);
    const seatsUsed = usedOf.get(sub.businessId) ?? null;
    const row: SubscriptionRow = {
      id: sub.id,
      firm: {
        id: firm.id,
        name: firm.name,
        slug: firm.slug,
        status: firm.status,
        email: firm.contactEmail || null,
        domain: domainOf.get(firm.id) ?? null,
      },
      plan: { id: plan.id, code: plan.code, name: plan.name },
      billingCycle: sub.billingCycle,
      status: sub.status,
      seatsIncluded: sub.seatsIncluded,
      extraSeats: sub.seatsPurchased,
      seatsAllowed: prices.seatsAllowed,
      seatsUsed,
      usagePercent: usageOf(seatsUsed, prices.seatsAllowed),
      locationsIncluded: sub.locationsIncluded,
      extraLocations: sub.locationsPurchased,
      locationsAllowed: prices.locationsAllowed,
      listPriceCents: prices.listPriceCents,
      baseOverrideCents: sub.priceCentsOverride,
      priceCents: prices.priceCents,
      monthlyCents: prices.monthlyCents,
      creditCents: creditOf.get(sub.businessId) ?? 0,
      autoRenew: sub.autoRenew,
      nextBillingOn: nextBillingOf(facts),
      accessEndsOn: accessEndsOf(facts),
      trialEndsOn: sub.status === 'TRIAL' ? facts.trialEndsOn : null,
      supportAccessUntil: grantOf.get(sub.businessId)?.toISOString() ?? null,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
    const startedOn = dayOf(sub.startedAt ?? sub.trialStartedAt ?? sub.createdAt);
    const endedOn =
      sub.status === 'CANCELLED'
        ? dayOf(sub.closedAt ?? sub.updatedAt)
        : sub.status === 'EXPIRED'
          ? (facts.trialEndsOn ?? dayOf(sub.updatedAt))
          : null;
    out.push({ sub, plan, firm, row, startedOn, endedOn });
  }
  return out;
}

/** One subscription, or 404. */
export async function loadOne(tx: TxClient, id: string, now = Date.now()): Promise<Loaded> {
  const [loaded] = await loadSubscriptions(tx, { id }, now);
  if (!loaded) throw notFound();
  return loaded;
}

/**
 * Holds the subscription's row until the transaction ends, so a change reads and writes one state
 * (two dialogs confirming at once apply one after the other); 404 when there is none.
 */
export async function lockSubscription(tx: TxClient, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM platform_firm_subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}

/** What the firm still owes on its open invoices (sent, part paid). */
export async function amountDue(tx: TxClient, firmId: string): Promise<number> {
  const open = await tx.platformInvoice.findMany({
    where: { businessId: firmId, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
    select: { totalCents: true, paidCents: true, creditedCents: true },
  });
  return open.reduce((s, i) => s + Math.max(0, i.totalCents - i.paidCents - i.creditedCents), 0);
}

/** 409 FIRM_NOT_BILLABLE unless the firm can get billing documents (Billing's rule). */
export function billable(firm: BillingFirm): void {
  if (!firm.canBill) throw refuse('FIRM_NOT_BILLABLE');
  if (!firm.contactEmail)
    throw refuse(
      'FIRM_NOT_BILLABLE',
      'The firm has no billing contact. Save its billing profile in Billing first.',
    );
}

/** The firm's staff logins from the latest daily firm rollup; null until the job writes one. */
export async function seatsInUse(tx: TxClient, firmId: string): Promise<number | null> {
  const latest = await tx.platformFirmMetricsDaily.findFirst({
    where: { businessId: firmId },
    orderBy: { day: 'desc' },
    select: { totalUsers: true },
  });
  return latest?.totalUsers ?? null;
}

/** One admin-scope transaction, its database refusals as this module's errors. */
export async function inTransaction<T>(
  admin: AdminPrisma,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  try {
    return await admin.transaction(fn);
  } catch (error) {
    throw asSubscriptionError(error);
  }
}

/** Audit rows of this module are the platform's, about one subscription. */
export const ENTITY = 'subscription';
