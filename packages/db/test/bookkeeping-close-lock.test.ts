// Rasel's Bookkeeping tap of Oct 26 (R1; migrations r1_bookkeeping_close_lock and
// r1_reconciliation_zero_tolerance): a closed period also locks its refunds and chargebacks, the
// settlements paid out in it and their items (a chargeback's dispute outcome may still be
// recorded), and a reconciliation is approved only with a zero difference. Runs as the app role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let eng = '';
let checking = '';
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const day = (d: string) => new Date(d);
const locked = /closed and locked/;

let n = 0;
const txn = (date: string, data: Record<string, unknown> = {}) =>
  A().bookkeepingTransaction.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      accountId: checking,
      transactionDate: day(date),
      description: `Fake payment ${++n}`,
      amountCents: 10_000,
      direction: 'CREDIT',
      source: 'MANUAL',
      kind: 'PAYMENT',
      ...data,
    },
  });
const refund = (date: string, data: Record<string, unknown> = {}) =>
  A().bookkeepingRefund.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      kind: 'REFUND_ISSUED',
      refundDate: day(date),
      amountCents: 2_500,
      ...data,
    },
  });
const settlement = (payoutDate: string) =>
  A().bookkeepingSettlement.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      processor: 'stripe',
      periodStart: day('2026-06-27'),
      periodEnd: day('2026-06-29'),
      payoutDate: day(payoutDate),
      grossCents: 100_000,
      feesCents: 3_000,
      netPayoutCents: 97_000,
      netSource: 'CALCULATED',
    },
  });
const closeJune = async () => {
  const p = await A().bookkeepingPeriod.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      label: 'June 2026',
      periodStart: day('2026-06-01'),
      periodEnd: day('2026-06-30'),
    },
  });
  const set = (data: Record<string, unknown>) =>
    A().bookkeepingPeriod.update({ where: { id: p.id }, data });
  await set({ status: 'IN_PROGRESS' });
  await set({ status: 'READY_FOR_REVIEW', readyForReviewAt: new Date() });
  await set({ status: 'APPROVED', approvedAt: new Date() });
  await set({ status: 'CLOSED', closedAt: new Date() });
  return p.id;
};

const before = { refund: '', chargeback: '', settlement: '', julySettlement: '', payment: '' };

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1bkl');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
  checking = (
    await A().bookkeepingAccount.create({
      data: { businessId: f.firmA, engagementId: eng, name: 'Checking', type: 'BANK' },
    })
  ).id;
  // Made while June is open; then June closes.
  before.payment = (await txn('2026-06-28')).id;
  before.refund = (await refund('2026-06-15')).id;
  before.chargeback = (
    await refund('2026-06-20', { kind: 'CHARGEBACK', disputeStatus: 'OPEN' })
  ).id;
  before.settlement = (await settlement('2026-06-30')).id;
  // Batch days in June, paid out in July: July's.
  before.julySettlement = (await settlement('2026-07-01')).id;
  await A().bookkeepingSettlementItem.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      settlementId: before.settlement,
      transactionId: before.payment,
    },
  });
  await closeJune();
});

describe('a closed period locks its refunds and chargebacks', () => {
  it('none is added, changed or moved out of it', async () => {
    expect(await failure(refund('2026-06-25'))).toMatch(locked);
    const edit = (data: Record<string, unknown>) =>
      A().bookkeepingRefund.update({ where: { id: before.refund }, data });
    expect(await failure(edit({ amountCents: 2_000 }))).toMatch(locked);
    expect(await failure(edit({ refundDate: day('2026-07-02') }))).toMatch(locked);
    expect(await failure(edit({ includeInReport: false }))).toMatch(locked);
    await expect(refund('2026-07-02')).resolves.toMatchObject({ amountCents: 2_500 });
  });

  it("a chargeback's dispute outcome may still be recorded, nothing else", async () => {
    const edit = (data: Record<string, unknown>) =>
      A().bookkeepingRefund.update({ where: { id: before.chargeback }, data });
    await expect(
      edit({ disputeStatus: 'WON', resolution: 'The processor returned the funds.' }),
    ).resolves.toMatchObject({ disputeStatus: 'WON' });
    expect(await failure(edit({ disputeStatus: 'LOST', amountCents: 1 }))).toMatch(locked);
    expect(await failure(edit({ status: 'COMPLETED' }))).toMatch(locked);
  });
});

describe('a closed period locks the settlements paid out in it', () => {
  it('none is added or changed; a payout in the next month stays open', async () => {
    expect(await failure(settlement('2026-06-29'))).toMatch(locked);
    expect(
      await failure(
        A().bookkeepingSettlement.update({
          where: { id: before.settlement },
          data: { status: 'NEEDS_REVIEW' },
        }),
      ),
    ).toMatch(locked);
    expect(
      await failure(
        A().bookkeepingSettlement.update({
          where: { id: before.julySettlement },
          data: { payoutDate: day('2026-06-30') },
        }),
      ),
    ).toMatch(locked);
    await expect(
      A().bookkeepingSettlement.update({
        where: { id: before.julySettlement },
        data: { note: 'Checked against the processor report.' },
      }),
    ).resolves.toMatchObject({ status: 'UNMATCHED' });
  });

  it('and their items: none added or removed', async () => {
    const payment = await txn('2026-07-03');
    const item = (settlementId: string) => ({
      businessId: f.firmA,
      engagementId: eng,
      settlementId,
      transactionId: payment.id,
    });
    expect(
      await failure(A().bookkeepingSettlementItem.create({ data: item(before.settlement) })),
    ).toMatch(locked);
    expect(
      await failure(
        A().bookkeepingSettlementItem.deleteMany({ where: { settlementId: before.settlement } }),
      ),
    ).toMatch(locked);
    await expect(
      A().bookkeepingSettlementItem.create({ data: item(before.julySettlement) }),
    ).resolves.toMatchObject({ settlementId: before.julySettlement });
  });
});

describe('zero tolerance', () => {
  it('a reconciliation is approved only with a zero difference', async () => {
    const p = await A().bookkeepingPeriod.create({
      data: {
        businessId: f.firmA,
        engagementId: eng,
        label: 'August 2026',
        periodStart: day('2026-08-01'),
        periodEnd: day('2026-08-31'),
        status: 'IN_PROGRESS',
      },
    });
    const r = await A().bookkeepingReconciliation.create({
      data: {
        businessId: f.firmA,
        periodId: p.id,
        accountId: checking,
        statementStart: day('2026-08-01'),
        statementEnd: day('2026-08-31'),
        beginningBalanceCents: 100_000,
        endingBalanceCents: 150_000,
        clearedBalanceCents: 149_999,
        differenceCents: 1,
        toleranceCents: 500,
      },
    });
    const approve = (data: Record<string, unknown> = {}) =>
      A().bookkeepingReconciliation.update({
        where: { id: r.id },
        data: {
          status: 'APPROVED',
          readyForReviewAt: new Date(),
          approvedAt: new Date(),
          approvedBy: f.memberA,
          ...data,
        },
      });
    expect(await failure(approve())).toMatch(/zero_difference/);
    await expect(
      approve({ clearedBalanceCents: 150_000, differenceCents: 0 }),
    ).resolves.toMatchObject({ status: 'APPROVED', differenceCents: 0 });
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's refunds, settlements or items", async () => {
    expect(await B().bookkeepingRefund.findMany({ where: { engagementId: eng } })).toEqual([]);
    expect(await B().bookkeepingSettlement.findMany({ where: { engagementId: eng } })).toEqual([]);
    expect(
      await B().bookkeepingSettlementItem.deleteMany({ where: { engagementId: eng } }),
    ).toEqual({ count: 0 });
    expect(
      await B().bookkeepingRefund.updateMany({
        where: { id: before.chargeback },
        data: { disputeStatus: 'LOST' },
      }),
    ).toEqual({ count: 0 });
  });
});
