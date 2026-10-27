// Rasel's tap of Oct 27 (R56; migration r56_ledger_clearing_closed_period): a ledger line dated in
// a closed period may still be cleared, or uncleared, by a later month's reconciliation (a cheque
// that clears late); nothing else on it changes, and a closed period's reconciliation keeps its
// lines. Runs as the app role.
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
let card = '';
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
      description: `Fake cheque ${++n}`,
      amountCents: 12_500,
      direction: 'DEBIT',
      source: 'MANUAL',
      ...data,
    },
  });
const period = (label: string, start: string, end: string) =>
  A().bookkeepingPeriod.create({
    data: {
      businessId: f.firmA,
      engagementId: eng,
      label,
      periodStart: day(start),
      periodEnd: day(end),
    },
  });
const recon = (periodId: string, accountId: string, start: string, end: string) =>
  A().bookkeepingReconciliation.create({
    data: {
      businessId: f.firmA,
      periodId,
      accountId,
      statementStart: day(start),
      statementEnd: day(end),
      beginningBalanceCents: 100_000,
      endingBalanceCents: 100_000,
      clearedBalanceCents: 100_000,
      differenceCents: 0,
    },
  });
const close = async (id: string) => {
  const set = (data: Record<string, unknown>) =>
    A().bookkeepingPeriod.update({ where: { id }, data });
  await set({ status: 'IN_PROGRESS' });
  await set({ status: 'READY_FOR_REVIEW', readyForReviewAt: new Date() });
  await set({ status: 'APPROVED', approvedAt: new Date() });
  await set({ status: 'CLOSED', closedAt: new Date() });
};
const edit = (id: string, data: Record<string, unknown>) =>
  A().bookkeepingTransaction.update({ where: { id }, data });

const ids = {
  cheque: '',
  clearedInJune: '',
  julyLine: '',
  juneRecon: '',
  julyRecon: '',
  cardRecon: '',
};

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56clr');
  eng = await createEngagement(owner, f.firmA, f.clientA);
  await A().bookkeepingProfile.create({ data: { businessId: f.firmA, engagementId: eng } });
  const account = async (name: string, type: 'BANK' | 'CREDIT_CARD') =>
    (
      await A().bookkeepingAccount.create({
        data: { businessId: f.firmA, engagementId: eng, name, type },
      })
    ).id;
  checking = await account('Checking', 'BANK');
  card = await account('Card', 'CREDIT_CARD');
  const june = await period('June 2026', '2026-06-01', '2026-06-30');
  const july = await period('July 2026', '2026-07-01', '2026-07-31');
  ids.juneRecon = (await recon(june.id, checking, '2026-06-01', '2026-06-30')).id;
  ids.julyRecon = (await recon(july.id, checking, '2026-07-01', '2026-07-31')).id;
  ids.cardRecon = (await recon(july.id, card, '2026-07-01', '2026-07-31')).id;
  // Written in June, still outstanding when June closes.
  ids.cheque = (await txn('2026-06-28')).id;
  // Cleared in June's reconciliation before June closed.
  ids.clearedInJune = (await txn('2026-06-10')).id;
  await edit(ids.clearedInJune, { clearedReconciliationId: ids.juneRecon });
  ids.julyLine = (await txn('2026-07-05')).id;
  await close(june.id);
});

describe('a line dated in a closed period', () => {
  it('is cleared and uncleared by a later reconciliation', async () => {
    const cleared = await edit(ids.cheque, { clearedReconciliationId: ids.julyRecon });
    expect(cleared.clearedReconciliationId).toBe(ids.julyRecon);
    expect(cleared.clearedAt).toBeInstanceOf(Date);
    const uncleared = await edit(ids.cheque, { clearedReconciliationId: null });
    expect(uncleared).toMatchObject({ clearedReconciliationId: null, clearedAt: null });
    await expect(
      edit(ids.cheque, { clearedReconciliationId: ids.julyRecon }),
    ).resolves.toMatchObject({ clearedReconciliationId: ids.julyRecon, amountCents: 12_500 });
  });

  it('keeps every other column locked, alone or with a clearing', async () => {
    for (const data of [
      { amountCents: 1 },
      { transactionDate: day('2026-07-02') },
      { direction: 'CREDIT' },
      { payee: 'Fake changed payee' },
      { description: 'Fake changed description' },
      { kind: 'FEE' },
      { status: 'EXCLUDED', excludedReason: 'Fake reason' },
      { classLabel: 'Fake class' },
      { clearedReconciliationId: null, amountCents: 99 },
    ]) {
      expect(await failure(edit(ids.cheque, data))).toMatch(locked);
    }
    expect(await failure(edit(ids.cheque, { accountId: card }))).toMatch(
      /keeps its client, account and source/,
    );
    const row = await A().bookkeepingTransaction.findUniqueOrThrow({ where: { id: ids.cheque } });
    expect(row).toMatchObject({
      amountCents: 12_500,
      direction: 'DEBIT',
      transactionDate: day('2026-06-28'),
      accountId: checking,
      clearedReconciliationId: ids.julyRecon,
    });
    // Nothing new is dated into the closed period.
    expect(await failure(txn('2026-06-29'))).toMatch(locked);
  });

  it("is cleared only in its own account's reconciliation", async () => {
    expect(await failure(edit(ids.cheque, { clearedReconciliationId: ids.cardRecon }))).toMatch(
      /cleared in its own account's reconciliation/,
    );
  });
});

describe("a closed period's reconciliation keeps its lines", () => {
  it('no line leaves it or joins it', async () => {
    expect(await failure(edit(ids.clearedInJune, { clearedReconciliationId: null }))).toMatch(
      locked,
    );
    expect(
      await failure(edit(ids.clearedInJune, { clearedReconciliationId: ids.julyRecon })),
    ).toMatch(locked);
    expect(await failure(edit(ids.julyLine, { clearedReconciliationId: ids.juneRecon }))).toMatch(
      locked,
    );
    expect(await failure(txn('2026-07-06', { clearedReconciliationId: ids.juneRecon }))).toMatch(
      locked,
    );
    // A line of an open period still clears in its own month.
    await expect(
      edit(ids.julyLine, { clearedReconciliationId: ids.julyRecon }),
    ).resolves.toMatchObject({ clearedReconciliationId: ids.julyRecon });
  });
});

describe('row-level security and grants are unchanged', () => {
  it("firm B cannot see or clear firm A's lines, and no line is deleted", async () => {
    expect(await B().bookkeepingTransaction.findMany({ where: { engagementId: eng } })).toEqual([]);
    expect(
      await B().bookkeepingTransaction.updateMany({
        where: { id: ids.cheque },
        data: { clearedReconciliationId: null },
      }),
    ).toEqual({ count: 0 });
    expect(
      await failure(A().bookkeepingTransaction.deleteMany({ where: { id: ids.cheque } })),
    ).toMatch(/permission denied/i);
  });
});
