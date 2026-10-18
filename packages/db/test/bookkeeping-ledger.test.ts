// Stage C1 (R0, Oct 18): the bookkeeping ledger. Transactions (categorize, split, transfer, match,
// exclude), refunds and chargebacks, settlements, report versions and the engagement terms.
// Isolation between firms and the rules of migration r0_bookkeeping_ledger. Runs as the app role
// under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import type { TxClient } from '../src/client.js';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let eng: string;
let checking: string;
let card: string;
let otherEngAccount: string;
let catSupplies: string;
let catSoftware: string;
let reportId: string;
const A = () => db.forBusiness(f.firmA);
const inA = <T>(fn: (tx: TxClient) => Promise<T>) =>
  db.withScope({ kind: 'business', businessId: f.firmA }, fn);
const day = (d: string) => new Date(d);
let n = 0;
const txn = (data: Record<string, unknown> = {}) =>
  A().bookkeepingTransaction.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      accountId: checking,
      transactionDate: day('2026-09-10'),
      description: `Purchase ${++n}`,
      amountCents: 10_000,
      direction: 'DEBIT',
      source: 'MANUAL',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'c1bk');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
  const acc = (engagementId: string, name: string, type: 'BANK' | 'CREDIT_CARD') =>
    A().bookkeepingAccount.create({ data: { businessId: f.firmA, engagementId, name, type } });
  checking = (await acc(eng, 'Checking', 'BANK')).id;
  card = (await acc(eng, 'Card', 'CREDIT_CARD')).id;
  const otherEng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: otherEng } });
  otherEngAccount = (await acc(otherEng, 'Other client checking', 'BANK')).id;
  const cat = (name: string, type: 'EXPENSE' | 'INCOME') =>
    A().bookkeepingCategory.create({
      data: { businessId: f.firmA, engagementId: eng, name, type },
    });
  catSupplies = (await cat('Office Supplies', 'EXPENSE')).id;
  catSoftware = (await cat('Software', 'EXPENSE')).id;
  reportId = (
    await A().bookkeepingReport.create({
      data: {
        businessId: f.firmA,
        engagementId: eng,
        reportType: 'PROFIT_LOSS',
        periodLabel: 'September 2026',
      },
    })
  ).id;
});

describe('isolation and the same client', () => {
  it('another firm sees none of it and cannot write to it; every link stays on one client', async () => {
    const t = await txn();
    const B = db.forBusiness(f.firmB);
    expect(await B.bookkeepingTransaction.count()).toBe(0);
    expect(await B.bookkeepingCategory.count()).toBe(0);
    expect(
      await failure(
        B.bookkeepingTransaction.create({
          data: {
            businessId: f.firmA,
            engagementId: eng,
            accountId: checking,
            transactionDate: day('2026-09-10'),
            description: 'From firm B',
            amountCents: 100,
            direction: 'DEBIT',
            source: 'MANUAL',
          },
        }),
      ),
    ).toMatch(/row-level security|engagement with a bookkeeping profile/);
    // Another client's account or category is refused by the composite keys.
    expect(await failure(txn({ accountId: otherEngAccount }))).toMatch(/Foreign key|foreign key/);
    expect(t.status).toBe('UNCATEGORIZED');
    expect(await failure(A().bookkeepingTransaction.deleteMany({ where: { id: t.id } }))).toMatch(
      /permission denied/i,
    );
  });

  it('keeps the shape: a positive amount, a reason to exclude, no category while uncategorized', async () => {
    for (const data of [
      { amountCents: 0 },
      { status: 'EXCLUDED' },
      { status: 'UNCATEGORIZED', categoryId: null, excludedReason: 'x' },
    ]) {
      expect(await failure(txn(data))).toMatch(/bookkeeping_transactions_shape/);
    }
    await expect(
      txn({ status: 'EXCLUDED', excludedReason: 'Personal expense' }),
    ).resolves.toMatchObject({
      status: 'EXCLUDED',
    });
  });
});

describe('categorize, split and transfer (checked at commit)', () => {
  it('split parts add up to the amount, with no category of its own; categorized needs a category or parts', async () => {
    expect(await failure(txn({ status: 'CATEGORIZED' }))).toMatch(
      /has a category, split parts or a transfer side/,
    );
    await expect(txn({ status: 'CATEGORIZED', categoryId: catSupplies })).resolves.toMatchObject({
      categoryId: catSupplies,
    });
    const split = (parts: number[]) =>
      inA(async (tx) => {
        const t = await tx.bookkeepingTransaction.create({
          data: {
            businessId: f.firmA,
            engagementId: eng,
            accountId: card,
            transactionDate: day('2026-09-12'),
            description: 'Office Depot',
            amountCents: 18_250,
            direction: 'DEBIT',
            source: 'MANUAL',
            status: 'CATEGORIZED',
          },
        });
        for (const [i, amountCents] of parts.entries()) {
          await tx.bookkeepingTransactionSplit.create({
            data: {
              businessId: f.firmA,
              engagementId: eng,
              transactionId: t.id,
              categoryId: i % 2 ? catSoftware : catSupplies,
              amountCents,
            },
          });
        }
        return t;
      });
    expect(await failure(split([12_000, 6_000]))).toMatch(/parts add up to its amount/);
    const ok = await split([12_000, 6_250]);
    expect(
      await failure(
        A().bookkeepingTransaction.update({
          where: { id: ok.id },
          data: { categoryId: catSupplies },
        }),
      ),
    ).toMatch(/parts add up to its amount, with no category of its own/);
  });

  it('a transfer is the same amount the other way on another account, and both sides name each other', async () => {
    const side = (accountId: string, direction: 'DEBIT' | 'CREDIT', amountCents = 150_000) =>
      txn({
        accountId,
        direction,
        amountCents,
        kind: 'TRANSFER',
        transactionDate: day('2026-09-15'),
      });
    const out = await side(checking, 'DEBIT');
    const wrongAmount = await side(card, 'CREDIT', 140_000);
    expect(
      await failure(
        A().bookkeepingTransaction.update({
          where: { id: out.id },
          data: { transferPairId: wrongAmount.id },
        }),
      ),
    ).toMatch(/same amount the other way on another account/);
    const back = await side(card, 'CREDIT');
    expect(
      await failure(
        A().bookkeepingTransaction.update({
          where: { id: out.id },
          data: { transferPairId: back.id, status: 'CATEGORIZED' },
        }),
      ),
    ).toMatch(/two sides name each other/);
    await inA(async (tx) => {
      await tx.bookkeepingTransaction.update({
        where: { id: out.id },
        data: { transferPairId: back.id, status: 'CATEGORIZED' },
      });
      await tx.bookkeepingTransaction.update({
        where: { id: back.id },
        data: { transferPairId: out.id, status: 'CATEGORIZED' },
      });
    });
  });
});

describe('the closed period lock', () => {
  it('a closed period locks the transactions dated inside it', async () => {
    const t = await txn({ transactionDate: day('2026-07-10') });
    const p = await A().bookkeepingPeriod.create({
      data: {
        businessId: f.firmA,
        engagementId: eng,
        label: 'July 2026',
        periodStart: day('2026-07-01'),
        periodEnd: day('2026-07-31'),
      },
    });
    const set = (data: Record<string, unknown>) =>
      A().bookkeepingPeriod.update({ where: { id: p.id }, data });
    await set({ status: 'IN_PROGRESS' });
    await set({ status: 'READY_FOR_REVIEW', readyForReviewAt: new Date() });
    await set({ status: 'APPROVED', approvedAt: new Date() });
    await set({ status: 'CLOSED', closedAt: new Date() });
    expect(await failure(txn({ transactionDate: day('2026-07-20') }))).toMatch(/closed and locked/);
    expect(
      await failure(
        A().bookkeepingTransaction.update({ where: { id: t.id }, data: { payee: 'Changed' } }),
      ),
    ).toMatch(/closed and locked/);
    expect(
      await failure(
        A().bookkeepingTransaction.update({
          where: { id: t.id },
          data: { transactionDate: day('2026-08-10') },
        }),
      ),
    ).toMatch(/closed and locked/);
  });
});

describe('refunds and settlements', () => {
  it('a chargeback has a dispute status; a settlement keeps its parts and nets correctly; its deposit is money in', async () => {
    const base = {
      businessId: f.firmA,
      engagementId: eng,
      refundDate: day('2026-09-20'),
      amountCents: 3_500,
    };
    expect(
      await failure(A().bookkeepingRefund.create({ data: { ...base, kind: 'CHARGEBACK' } })),
    ).toMatch(/bookkeeping_refunds_shape/);
    expect(
      await failure(
        A().bookkeepingRefund.create({
          data: { ...base, kind: 'REFUND_RECEIVED', disputeStatus: 'OPEN' },
        }),
      ),
    ).toMatch(/bookkeeping_refunds_shape/);
    await A().bookkeepingRefund.create({
      data: { ...base, kind: 'CHARGEBACK', disputeStatus: 'OPEN' },
    });
    const settlement = {
      businessId: f.firmA,
      engagementId: eng,
      processor: 'stripe',
      periodStart: day('2026-09-01'),
      periodEnd: day('2026-09-03'),
      payoutDate: day('2026-09-05'),
      grossCents: 500_000,
      refundsCents: 5_000,
      feesCents: 12_500,
      netSource: 'CALCULATED' as const,
    };
    expect(
      await failure(
        A().bookkeepingSettlement.create({ data: { ...settlement, netPayoutCents: 500_000 } }),
      ),
    ).toMatch(/bookkeeping_settlements_shape/);
    const s = await A().bookkeepingSettlement.create({
      data: { ...settlement, netPayoutCents: 482_500 },
    });
    const debit = await txn({ amountCents: 482_500 });
    expect(
      await failure(
        A().bookkeepingSettlement.update({
          where: { id: s.id },
          data: { depositTransactionId: debit.id, status: 'MATCHED' },
        }),
      ),
    ).toMatch(/matched to a deposit/);
    const deposit = await txn({ amountCents: 482_500, direction: 'CREDIT', kind: 'PAYOUT' });
    const matched = await A().bookkeepingSettlement.update({
      where: { id: s.id },
      data: {
        depositTransactionId: deposit.id,
        status: 'MATCHED',
        matchedAt: new Date('2020-01-01'),
      },
    });
    expect(matched.matchedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe('report versions', () => {
  it('are numbered by the database; what was generated never changes; a sent one stays sent', async () => {
    const v = (data: Record<string, unknown> = {}) =>
      A().bookkeepingReportVersion.create({
        data: { businessId: f.firmA, engagementId: eng, reportId, version: 99, ...data },
      });
    const v1 = await v({ summary: { netCents: 100 } });
    const v2 = await v();
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(
      await failure(
        A().bookkeepingReportVersion.update({
          where: { id: v1.id },
          data: { summary: { netCents: 999 } },
        }),
      ),
    ).toMatch(/never changes; generate a new one/);
    const sent = await A().bookkeepingReportVersion.update({
      where: { id: v1.id },
      data: { deliveryStatus: 'SENT' },
    });
    expect(sent.sentAt).not.toBeNull();
    expect(
      await failure(
        A().bookkeepingReportVersion.update({
          where: { id: v1.id },
          data: { deliveryStatus: 'NOT_SENT' },
        }),
      ),
    ).toMatch(/stays sent/);
  });
});

describe('engagement terms', () => {
  it('versions are numbered; only a draft is edited; activating one supersedes the last; terminating needs a reason', async () => {
    const terms = () =>
      A().bookkeepingTerms.create({
        data: {
          businessId: f.firmA,
          engagementId: eng,
          version: 1,
          startDate: day('2026-09-01'),
          effectiveFrom: day('2026-09-01'),
          monthlyFeeCents: 45_000,
          includedServices: ['Monthly reconciliation'],
        },
      });
    const t1 = await terms();
    const edited = await A().bookkeepingTerms.update({
      where: { id: t1.id },
      data: { monthlyFeeCents: 40_000 },
    });
    expect(edited.monthlyFeeCents).toBe(40_000);
    const sent = await A().bookkeepingTerms.update({
      where: { id: t1.id },
      data: { status: 'SENT' },
    });
    expect(sent.sentAt).not.toBeNull();
    expect(
      await failure(
        A().bookkeepingTerms.update({ where: { id: t1.id }, data: { monthlyFeeCents: 1 } }),
      ),
    ).toMatch(/only draft terms are edited/);
    await A().bookkeepingTerms.update({ where: { id: t1.id }, data: { status: 'ACTIVE' } });
    const t2 = await terms();
    expect(t2.version).toBe(2);
    await A().bookkeepingTerms.update({ where: { id: t2.id }, data: { status: 'ACTIVE' } });
    const [old, current] = await Promise.all([
      A().bookkeepingTerms.findUniqueOrThrow({ where: { id: t1.id } }),
      A().bookkeepingTerms.findUniqueOrThrow({ where: { id: t2.id } }),
    ]);
    expect([old.status, current.status]).toEqual(['SUPERSEDED', 'ACTIVE']);
    expect(old.supersededAt).not.toBeNull();
    expect(
      await failure(
        A().bookkeepingTerms.update({ where: { id: t1.id }, data: { internalNotes: 'Late note' } }),
      ),
    ).toMatch(/SUPERSEDED terms never change/);
    expect(
      await failure(
        A().bookkeepingTerms.update({ where: { id: t2.id }, data: { status: 'TERMINATED' } }),
      ),
    ).toMatch(/bookkeeping_terms_shape/);
    await A().bookkeepingTerms.update({
      where: { id: t2.id },
      data: { status: 'TERMINATED', terminationReason: 'Client moved to an in-house bookkeeper.' },
    });
    const event = await A().bookkeepingTermsEvent.create({
      data: {
        businessId: f.firmA,
        termsId: t2.id,
        kind: 'TERMINATED',
        reason: 'Client moved in-house.',
      },
    });
    expect(
      await failure(
        A().bookkeepingTermsEvent.updateMany({
          where: { id: event.id },
          data: { reason: 'Edited' },
        }),
      ),
    ).toMatch(/permission denied/i);
  });
});
