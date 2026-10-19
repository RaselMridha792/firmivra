import type { TxClient } from '@firmivra/db';

// Shared by the Super Admin reports (R55): ranges, months, and the figures several reports use.

const DAY = 86_400_000;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const dayStart = (s: string) => new Date(`${s}T00:00:00.000Z`);
export const dayEnd = (s: string) => new Date(`${s}T23:59:59.999Z`);

export interface Range {
  from: string;
  to: string;
  /** The range of equal length just before. */
  previousFrom: string;
  previousTo: string;
}

/** The asked range (default: the last 30 days ending today, UTC) and the one before it. */
export function rangeOf(q: { from?: string; to?: string }, today = new Date()): Range {
  const to = q.to ?? isoDay(today);
  const from = q.from ?? isoDay(new Date(dayStart(to).getTime() - 29 * DAY));
  const days = Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY) + 1;
  const previousTo = isoDay(new Date(dayStart(from).getTime() - DAY));
  const previousFrom = isoDay(new Date(dayStart(previousTo).getTime() - (days - 1) * DAY));
  return { from, to, previousFrom, previousTo };
}

/** The `n` months ending with the range's last month: "2026-05" … "2026-10". */
export function monthsTo(to: string, n = 6): string[] {
  const end = dayStart(to);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
export const monthStart = (m: string) => new Date(`${m}-01T00:00:00.000Z`);

/** Sums by month over `months`, zero where nothing happened. */
export function series<T>(
  months: string[],
  rows: T[],
  at: (r: T) => Date,
  value: (r: T) => number = () => 1,
) {
  const by = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    const m = monthOf(at(r));
    if (by.has(m)) by.set(m, by.get(m)! + value(r));
  }
  return months.map((month) => ({ month, value: by.get(month)! }));
}

/** A recurring bill's monthly equivalent in cents. */
export function monthlyCents(r: {
  frequency: string;
  intervalDays: number | null;
  amountCents: number;
}): number {
  switch (r.frequency) {
    case 'WEEKLY':
      return Math.round((r.amountCents * 52) / 12);
    case 'MONTHLY':
      return r.amountCents;
    case 'QUARTERLY':
      return Math.round(r.amountCents / 3);
    case 'SEMIANNUAL':
      return Math.round(r.amountCents / 6);
    case 'ANNUAL':
      return Math.round(r.amountCents / 12);
    default:
      return r.intervalDays && r.intervalDays > 0
        ? Math.round((r.amountCents * 30) / r.intervalDays)
        : 0;
  }
}

/** MRR on a day: the active recurring billing in force then (billing records, never plan prices). */
export async function mrrOn(tx: TxClient, day: string): Promise<number> {
  const at = dayEnd(day);
  const rows = await tx.platformRecurringInvoice.findMany({
    where: {
      status: 'ACTIVE',
      startDate: { lte: at },
      OR: [{ endDate: null }, { endDate: { gte: at } }],
    },
    select: { frequency: true, intervalDays: true, amountCents: true },
  });
  return rows.reduce((a, r) => a + monthlyCents(r), 0);
}

/** Payments received in a range (completed, less refunds), by firm. */
export async function collectedByFirm(
  tx: TxClient,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const rows = await tx.platformPayment.groupBy({
    by: ['businessId'],
    where: {
      status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
      paidOn: { gte: dayStart(from), lte: dayEnd(to) },
    },
    _sum: { amountCents: true, refundedCents: true },
  });
  return new Map(
    rows.map((r) => [r.businessId, (r._sum.amountCents ?? 0) - (r._sum.refundedCents ?? 0)]),
  );
}

/** Each firm's plan name (its subscription's), by firm. */
export async function plansByFirm(
  tx: TxClient,
): Promise<Map<string, { code: string; name: string; status: string }>> {
  const subs = await tx.platformFirmSubscription.findMany({
    select: { businessId: true, status: true, plan: { select: { code: true, name: true } } },
  });
  return new Map(
    subs.map((s) => [s.businessId, { code: s.plan.code, name: s.plan.name, status: s.status }]),
  );
}

/** Each firm's contact from its application (who applied), by firm. */
export async function contactsByFirm(
  tx: TxClient,
): Promise<Map<string, { name: string; email: string; phone: string | null }>> {
  const apps = await tx.firmApplication.findMany({
    where: { businessId: { not: null } },
    select: { businessId: true, contactName: true, contactEmail: true, contactPhone: true },
  });
  return new Map(
    apps.map((a) => [
      a.businessId!,
      { name: a.contactName, email: a.contactEmail, phone: a.contactPhone },
    ]),
  );
}

/** The latest rollup day per firm up to `to` (users, last login), by firm. */
export async function latestMetrics(tx: TxClient, to: string, businessIds?: string[]) {
  const rows = await tx.platformFirmMetricsDaily.findMany({
    where: {
      day: { lte: dayStart(to) },
      ...(businessIds ? { businessId: { in: businessIds } } : {}),
    },
    orderBy: { day: 'desc' },
    distinct: ['businessId'],
    select: {
      businessId: true,
      day: true,
      totalUsers: true,
      activeUsers: true,
      activeDocuments: true,
      lastLoginAt: true,
    },
  });
  return new Map(rows.map((r) => [r.businessId, r]));
}
