// Bookkeeping, part 3 (R38): periods and their close workflow, the close checklist and account
// reconciliations. Isolation between firms and the rules of migration r38_bookkeeping_close.
// Runs as the app role under RLS.
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
let eng: string; // a bookkeeping engagement of firm A with a profile and two accounts
let account1: string;
let account2: string;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
let month = 0;
const period = (data: Record<string, unknown> = {}) => {
  const m = String(++month % 12 || 12).padStart(2, '0');
  const y = 2020 + Math.floor((month - 1) / 12);
  return A().bookkeepingPeriod.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      label: `${y}-${m}`,
      periodStart: day(`${y}-${m}-01`),
      periodEnd: day(`${y}-${m}-28`),
      ...data,
    },
  });
};
const item = (periodId: string, itemKey: string, data: Record<string, unknown> = {}) =>
  A().bookkeepingCloseItem.create({
    data: { businessId: f.firmA, periodId, itemKey, label: 'Step (fake)', position: 0, ...data },
  });
const recon = (periodId: string, accountId = account1, data: Record<string, unknown> = {}) =>
  A().bookkeepingReconciliation.create({
    data: {
      businessId: f.firmA,
      periodId,
      accountId,
      statementStart: day('2026-09-01'),
      statementEnd: day('2026-09-30'),
      beginningBalanceCents: 100000,
      endingBalanceCents: 150000,
      clearedBalanceCents: 150000,
      differenceCents: 0,
      ...data,
    },
  });
const setPeriod = (id: string, data: Record<string, unknown>) =>
  A().bookkeepingPeriod.update({ where: { id }, data });
const now = () => new Date();

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38bk');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
  const acc = (name: string) =>
    A().bookkeepingAccount.create({
      data: { businessId: f.firmA, engagementId: eng, name, type: 'BANK' },
    });
  account1 = (await acc('Checking (fake)')).id;
  account2 = (await acc('Savings (fake)')).id;
});

describe('isolation', () => {
  it('another firm sees no period, close step or reconciliation', async () => {
    const p = await period();
    await item(p.id, 'categorization');
    await recon(p.id);
    const B = db.forBusiness(f.firmB);
    expect(await B.bookkeepingPeriod.findMany()).toEqual([]);
    expect(await B.bookkeepingCloseItem.findMany()).toEqual([]);
    expect(await B.bookkeepingReconciliation.findMany()).toEqual([]);
    expect(
      await failure(
        B.bookkeepingPeriod.create({
          data: {
            businessId: f.firmA,
            engagementId: eng,
            label: 'x',
            periodStart: day('2026-01-01'),
            periodEnd: day('2026-01-31'),
          },
        }),
      ),
    ).toMatch(/row-level security|violates|bookkeeping profile/i);
  });

  it("a reconciliation cannot use another client's account", async () => {
    const otherEng = await createEngagement(owner, f.firmA, f.clientA);
    await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: otherEng } });
    const other = await A().bookkeepingAccount.create({
      data: { businessId: f.firmA, engagementId: otherEng, name: 'Other (fake)', type: 'BANK' },
    });
    const p = await period();
    expect(await failure(recon(p.id, other.id))).toMatch(/period's client's/);
  });
});

describe('periods', () => {
  it('belong to a client with a profile, once per dates, with totals together or not at all', async () => {
    const bare = await createEngagement(owner, f.firmA, f.clientA);
    expect(await failure(period({ engagementId: bare }))).toMatch(/bookkeeping profile/);
    const p = await period();
    expect(
      await failure(
        A().bookkeepingPeriod.create({
          data: {
            businessId: f.firmA,
            engagementId: eng,
            label: 'dup',
            periodStart: p.periodStart,
            periodEnd: p.periodEnd,
          },
        }),
      ),
    ).toMatch(/unique/i);
    for (const data of [
      { periodEnd: day('2000-01-01') },
      { label: ' ' },
      { incomeCents: 100 },
      { incomeCents: 100, expensesCents: 50 },
      { incomeCents: 100, expensesCents: 50, figuresSource: 'MANUAL' },
      { incomeCents: -1, expensesCents: 0, figuresSource: 'MANUAL', figuresAsOf: now() },
      { uncategorizedCount: -1 },
    ]) {
      expect(await failure(period(data))).toMatch(/check constraint/i);
    }
    await expect(
      period({
        incomeCents: 2458000,
        expensesCents: 1622000,
        figuresSource: 'IMPORTED',
        figuresAsOf: now(),
        uncategorizedCount: 12,
      }),
    ).resolves.toBeTruthy();
  });

  it('go through the close in order and nothing skips a step', async () => {
    const p = await period();
    expect(await failure(setPeriod(p.id, { status: 'APPROVED', approvedAt: now() }))).toMatch(
      /cannot become/,
    );
    await setPeriod(p.id, { status: 'IN_PROGRESS' });
    expect(await failure(setPeriod(p.id, { status: 'READY_FOR_REVIEW' }))).toMatch(
      /check constraint/i,
    ); // needs its time
    await setPeriod(p.id, {
      status: 'READY_FOR_REVIEW',
      readyForReviewAt: now(),
      readyForReviewBy: f.memberA,
    });
    expect(await failure(setPeriod(p.id, { status: 'CLOSED', closedAt: now() }))).toMatch(
      /cannot become/,
    );
    await setPeriod(p.id, { status: 'APPROVED', approvedAt: now(), approvedBy: f.memberA });
    await expect(
      setPeriod(p.id, { status: 'CLOSED', closedAt: now(), closedBy: f.memberA }),
    ).resolves.toMatchObject({
      status: 'CLOSED',
    });
  });

  it('a send-back clears the review time', async () => {
    const p = await period({ status: 'READY_FOR_REVIEW', readyForReviewAt: now() });
    await expect(setPeriod(p.id, { status: 'IN_PROGRESS' })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
      readyForReviewAt: null,
    });
  });

  it('closes only with its required steps done', async () => {
    const p = await period({
      status: 'APPROVED',
      readyForReviewAt: now(),
      approvedAt: now(),
    });
    const required = await item(p.id, 'reports');
    await item(p.id, 'delivery', { required: false, position: 1 });
    const close = () => setPeriod(p.id, { status: 'CLOSED', closedAt: now() });
    expect(await failure(close())).toMatch(/required close steps/);
    await A().bookkeepingCloseItem.update({
      where: { id: required.id },
      data: { completedAt: now() },
    });
    await expect(close()).resolves.toMatchObject({ status: 'CLOSED', closeVersion: 1 });
  });

  it('a closed period is locked, with its steps and reconciliations, until reopened with a reason', async () => {
    const p = await period({ status: 'APPROVED', readyForReviewAt: now(), approvedAt: now() });
    const step = await item(p.id, 'approval');
    const r = await recon(p.id);
    await A().bookkeepingCloseItem.update({ where: { id: step.id }, data: { completedAt: now() } });
    await setPeriod(p.id, { status: 'CLOSED', closedAt: now() });
    expect(await failure(setPeriod(p.id, { label: 'Edited' }))).toMatch(/closed period is locked/);
    expect(await failure(item(p.id, 'late'))).toMatch(/closed and locked/);
    expect(
      await failure(
        A().bookkeepingCloseItem.update({ where: { id: step.id }, data: { note: 'x' } }),
      ),
    ).toMatch(/closed and locked/);
    expect(
      await failure(
        A().bookkeepingReconciliation.update({ where: { id: r.id }, data: { exceptionsCount: 1 } }),
      ),
    ).toMatch(/closed and locked/);
    expect(await failure(recon(p.id, account2))).toMatch(/closed and locked/);
    // Reopen: a new time and a reason, a new close version, the approval cleared.
    expect(await failure(setPeriod(p.id, { status: 'IN_PROGRESS' }))).toMatch(/new reopen time/);
    expect(await failure(setPeriod(p.id, { status: 'IN_PROGRESS', reopenedAt: now() }))).toMatch(
      /check constraint/i,
    );
    const reopened = await setPeriod(p.id, {
      status: 'IN_PROGRESS',
      reopenedAt: now(),
      reopenedBy: f.memberA,
      reopenReason: 'A late invoice came in',
    });
    expect(reopened).toMatchObject({ closeVersion: 2, approvedAt: null, closedAt: null });
    await expect(item(p.id, 'late')).resolves.toBeTruthy();
  });

  it('keeps its client and dates', async () => {
    const p = await period();
    expect(await failure(setPeriod(p.id, { periodStart: day('2019-01-01') }))).toMatch(
      /keeps its client/,
    );
  });
});

describe('close steps', () => {
  it('have a key, a label, one row per key and a completion that names a time', async () => {
    const p = await period();
    await item(p.id, 'categorization');
    expect(await failure(item(p.id, 'categorization'))).toMatch(/unique/i);
    for (const data of [
      { label: ' ' },
      { position: -1 },
      { completedByUserId: f.memberA },
      { note: 'x'.repeat(501) },
    ]) {
      expect(await failure(item(p.id, `k${Math.random().toString(36).slice(2, 8)}`, data))).toMatch(
        /check constraint/i,
      );
    }
    expect(await failure(item(p.id, 'Bad Key'))).toMatch(/check constraint/i);
  });
});

describe('reconciliations', () => {
  it('check the difference against the balances, one per period and account', async () => {
    const p = await period();
    await recon(p.id);
    expect(await failure(recon(p.id))).toMatch(/unique/i);
    for (const data of [
      { differenceCents: 5 },
      { statementEnd: day('2026-08-01') },
      { clearedCount: -1 },
      { toleranceCents: -1 },
      { reopenedAt: now() },
    ]) {
      expect(await failure(recon(p.id, account2, data))).toMatch(/check constraint/i);
    }
    await expect(
      recon(p.id, account2, {
        clearedBalanceCents: 140000,
        differenceCents: 10000,
        exceptionsCount: 3,
      }),
    ).resolves.toBeTruthy();
  });

  it('are approved only within the tolerance and with no open exceptions', async () => {
    const p = await period();
    const r = await recon(p.id, account1, {
      clearedBalanceCents: 149000,
      differenceCents: 1000,
      toleranceCents: 500,
    });
    const approve = (data: Record<string, unknown> = {}) =>
      A().bookkeepingReconciliation.update({
        where: { id: r.id },
        data: {
          status: 'APPROVED',
          readyForReviewAt: now(),
          approvedAt: now(),
          approvedBy: f.memberA,
          ...data,
        },
      });
    expect(await failure(approve())).toMatch(/check constraint/i); // 1000 over a 500 tolerance
    expect(await failure(approve({ toleranceCents: 1000, exceptionsCount: 1 }))).toMatch(
      /check constraint/i,
    );
    expect(await failure(approve({ toleranceCents: 1000, approvedAt: null }))).toMatch(
      /check constraint/i,
    );
    await expect(approve({ toleranceCents: 1000 })).resolves.toMatchObject({ status: 'APPROVED' });
    // Reopen with a reason; the reason is required.
    const reopen = (data: Record<string, unknown>) =>
      A().bookkeepingReconciliation.update({
        where: { id: r.id },
        data: { status: 'REOPENED', ...data },
      });
    expect(await failure(reopen({ reopenedAt: now() }))).toMatch(/check constraint/i);
    await expect(
      reopen({ reopenedAt: now(), reopenedBy: f.memberA, reopenReason: 'Wrong statement' }),
    ).resolves.toMatchObject({ status: 'REOPENED' });
  });

  it("keep their period and account, and the statement is the same client's document", async () => {
    const p = await period();
    const p2 = await period();
    const r = await recon(p.id);
    expect(
      await failure(
        A().bookkeepingReconciliation.update({ where: { id: r.id }, data: { periodId: p2.id } }),
      ),
    ).toMatch(/stays in its period/);
    expect(
      await failure(
        A().bookkeepingReconciliation.update({
          where: { id: r.id },
          data: { accountId: account2 },
        }),
      ),
    ).toMatch(/keeps its account/);
    const taxEng = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
    const doc = await (
      await import('../src/client.js')
    ).runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.document.create({
        data: {
          businessId: f.firmA,
          clientId: f.clientA,
          engagementId: taxEng,
          direction: 'INTERNAL',
          fileName: 'statement.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'd'.repeat(64),
          s3Key: `tenant/${f.firmA}/documents/${Math.random().toString(36).slice(2)}`,
        },
      }),
    );
    expect(
      await failure(
        A().bookkeepingReconciliation.update({
          where: { id: r.id },
          data: { statementDocumentId: doc.id },
        }),
      ),
    ).toMatch(/same client/);
  });
});
