import type { TxClient } from '@firmivra/db';
import {
  type BillingRevenue,
  type BillingRevenuePeriod,
  type BillingRevenueType,
  billingMonthOf,
  billingRevenuePrevious,
} from '@firmivra/types';
import { addDays, asDate, BILLING_ZONE, today } from './billing-common.js';

// SA-BIL-A1 and SA-DSH-F05: one revenue query for the Billing > Revenue tab and the Dashboard's
// Monthly Revenue tile, so both show the same total. Basis (A1a): collected payments, gross, by
// payment date (a billing day, America/New_York). Refunds completed in the period are their own
// line and never netted. An invoice from a subscription or a recurring schedule is recurring;
// every other invoice is one-time. Not MRR.

/** Payments that were collected (a later refund does not undo the collection: gross). */
const COLLECTED = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;

const recurringInvoice = (i: { subscriptionId: string | null; recurringId: string | null }) =>
  i.subscriptionId !== null || i.recurringId !== null;

const wanted = (type: BillingRevenueType, recurring: boolean) =>
  type === 'ALL' || (type === 'RECURRING') === recurring;

/** The UTC instant a billing day starts (midnight America/New_York). */
function zoneStart(dayText: string): Date {
  const noonUtc = new Date(`${dayText}T12:00:00.000Z`);
  const zoned = new Date(noonUtc.toLocaleString('en-US', { timeZone: BILLING_ZONE }));
  const utc = new Date(noonUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offset = utc.getTime() - zoned.getTime();
  return new Date(asDate(dayText).getTime() + offset);
}

/** One period's revenue for the type, `from` to `to` inclusive. */
export async function revenuePeriod(
  tx: TxClient,
  from: string,
  to: string,
  type: BillingRevenueType,
): Promise<BillingRevenuePeriod> {
  const invoice = { select: { subscriptionId: true, recurringId: true } } as const;
  const [payments, refunds] = await Promise.all([
    tx.platformPayment.findMany({
      where: { status: { in: [...COLLECTED] }, paidOn: { gte: asDate(from), lte: asDate(to) } },
      select: { amountCents: true, invoice },
    }),
    tx.platformRefund.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: zoneStart(from), lt: zoneStart(addDays(to, 1)) },
      },
      select: { amountCents: true, payment: { select: { invoice } } },
    }),
  ]);
  let oneTimeCents = 0;
  let recurringCents = 0;
  let count = 0;
  for (const p of payments) {
    const recurring = recurringInvoice(p.invoice);
    if (!wanted(type, recurring)) continue;
    count += 1;
    if (recurring) recurringCents += p.amountCents;
    else oneTimeCents += p.amountCents;
  }
  let refundedCents = 0;
  let refundCount = 0;
  for (const r of refunds) {
    if (!wanted(type, recurringInvoice(r.payment.invoice))) continue;
    refundCount += 1;
    refundedCents += r.amountCents;
  }
  return {
    from,
    to,
    collectedCents: oneTimeCents + recurringCents,
    oneTimeCents,
    recurringCents,
    payments: count,
    refundedCents,
    refunds: refundCount,
  };
}

export async function revenueReport(
  tx: TxClient,
  query: { from: string; to: string; type: BillingRevenueType; compare: boolean },
): Promise<BillingRevenue> {
  const before = query.compare ? billingRevenuePrevious(query.from, query.to) : null;
  const [current, previous] = await Promise.all([
    revenuePeriod(tx, query.from, query.to, query.type),
    before ? revenuePeriod(tx, before.from, before.to, query.type) : Promise.resolve(null),
  ]);
  return { type: query.type, current, previous };
}

/** The Dashboard's Monthly Revenue: this calendar month so far, both types (SA-DSH-F05). */
export async function monthRevenueCents(tx: TxClient, now = Date.now()): Promise<number> {
  const { from, to } = billingMonthOf(today(now));
  return (await revenuePeriod(tx, from, to, 'ALL')).collectedCents;
}
