import { describe, expect, it } from 'vitest';
import {
  type FigureLine,
  figuresCsv,
  reportFigures,
} from '../../src/bookkeeping/report-figures.js';
import {
  type FigureAccount,
  type FigureContext,
  type FigureReconciliation,
  statementsMissing,
} from '../../src/bookkeeping/report-figures-more.js';

// BK-RPT part 2: the statement, status and missing-documents reports.

const bank = { id: 'a1', name: 'Fake Checking', type: 'BANK' };
const card = { id: 'a2', name: 'Fake Card', type: 'CREDIT_CARD' };
const sales = { id: 'c1', name: 'Fake Sales', type: 'INCOME' };
const goods = { id: 'c2', name: 'Fake Materials', type: 'COST_OF_GOODS' };
const rent = { id: 'c3', name: 'Fake Rent', type: 'EXPENSE' };
const supplies = { id: 'c4', name: 'Fake Supplies', type: 'EXPENSE' };
const equipment = { id: 'c5', name: 'Fake Equipment', type: 'ASSET' };
const owner = { id: 'c6', name: 'Fake Owner Contribution', type: 'EQUITY' };

const accounts: FigureAccount[] = [
  { id: 'a1', name: 'Fake Checking', type: 'BANK', reconcile: true },
  { id: 'a2', name: 'Fake Card', type: 'CREDIT_CARD', reconcile: true },
  { id: 'a3', name: 'Fake Loan', type: 'LOAN', reconcile: true },
  { id: 'a4', name: 'Fake Petty Cash', type: 'OTHER', reconcile: false },
];
const rec = (
  account: FigureAccount,
  over: Partial<FigureReconciliation> = {},
): FigureReconciliation => ({
  account,
  beginningBalanceCents: 0,
  endingBalanceCents: 0,
  clearedBalanceCents: 0,
  clearedCount: 0,
  differenceCents: 0,
  exceptionsCount: 0,
  status: 'APPROVED',
  hasStatement: true,
  ...over,
});
const ctx = (over: Partial<FigureContext> = {}): FigureContext => ({
  accounts,
  reconciliations: [
    rec(accounts[0]!, { beginningBalanceCents: 200_000, endingBalanceCents: 173_500 }),
    rec(accounts[1]!, {
      endingBalanceCents: -40_000,
      status: 'IN_PROGRESS',
      hasStatement: false,
    }),
    rec(accounts[2]!, { endingBalanceCents: 500_000 }),
  ],
  refunds: [],
  settlements: [],
  period: { status: 'IN_PROGRESS', closeDone: 3, closeTotal: 8 },
  ...over,
});

const line = (over: Partial<FigureLine>): FigureLine => ({
  amountCents: 0,
  direction: 'DEBIT',
  status: 'CATEGORIZED',
  kind: 'STANDARD',
  account: bank,
  category: null,
  splits: [],
  ...over,
});
const lines: FigureLine[] = [
  line({ amountCents: 100_000, direction: 'CREDIT', category: sales }),
  line({ amountCents: 20_000, category: goods, hasReceipt: true }),
  line({ amountCents: 30_000, category: rent, hasReceipt: false }),
  line({
    amountCents: 8_000,
    hasReceipt: false,
    splits: [
      { amountCents: 5_000, category: rent },
      { amountCents: 3_000, category: supplies },
    ],
  }),
  // A refund received on an expense.
  line({ amountCents: 1_000, direction: 'CREDIT', category: supplies }),
  line({ amountCents: 4_500, status: 'UNCATEGORIZED', hasReceipt: false }),
  line({ amountCents: 25_000, category: equipment, hasReceipt: true }),
  line({ amountCents: 10_000, direction: 'CREDIT', category: owner }),
  // The card payment: both sides, each naming the other's account type.
  line({ amountCents: 50_000, kind: 'TRANSFER', transferPairAccountType: 'CREDIT_CARD' }),
  line({
    amountCents: 50_000,
    kind: 'TRANSFER',
    direction: 'CREDIT',
    account: card,
    transferPairAccountType: 'BANK',
  }),
  line({ amountCents: 9_999, status: 'EXCLUDED', category: rent }),
  line({
    amountCents: 700,
    status: 'NEEDS_REVIEW',
    category: rent,
    account: card,
    hasReceipt: false,
  }),
];

describe('reportFigures, part 2', () => {
  it('General Ledger: both sides by kind of account, with counts; debits equal credits', () => {
    const f = reportFigures('GENERAL_LEDGER', 'CASH', lines);
    expect(f.sections.map((s) => s.title)).toEqual([
      'Bank and Card Accounts',
      'Income',
      'Cost of Goods Sold',
      'Expenses',
      'Assets',
      'Equity',
      'Uncategorized',
      'Transfers',
    ]);
    expect(f.sections[3]!.rows.find((r) => r.label === 'Fake Rent')).toEqual({
      label: 'Fake Rent',
      debitCents: 35_700,
      creditCents: 0,
      count: 3,
    });
    expect(f.totals['debitsCents']).toBe(f.totals['creditsCents']);
    expect(f.notes).toEqual([]);
  });

  it('Balance Sheet: statement balances only, a card owed whichever sign it shows', () => {
    const f = reportFigures('BALANCE_SHEET', 'CASH', lines, ctx());
    expect(f.sections.map((s) => [s.title, s.totalCents])).toEqual([
      ['Assets', 173_500],
      ['Liabilities', 540_000],
    ]);
    expect(f.totals).toEqual({
      assetsCents: 173_500,
      liabilitiesCents: 540_000,
      netAssetsCents: -366_500,
    });
    expect(f.notes.join(' ')).toMatch(/opening balances/);
    expect(f.notes).toContain('Not reconciled and approved yet: Fake Card.');
  });

  it('names the accounts a Balance Sheet or Cash Flow has no statement for', () => {
    const without = ctx({ reconciliations: ctx().reconciliations.slice(0, 1) });
    expect(statementsMissing('BALANCE_SHEET', without).map((a) => a.name)).toEqual([
      'Fake Card',
      'Fake Loan',
    ]);
    // A Cash Flow needs only the bank statements; the other reports none.
    expect(statementsMissing('CASH_FLOW', without)).toEqual([]);
    expect(statementsMissing('CASH_FLOW', ctx({ reconciliations: [] })).map((a) => a.name)).toEqual(
      ['Fake Checking'],
    );
    expect(statementsMissing('PROFIT_LOSS', without)).toEqual([]);
    expect(reportFigures('BALANCE_SHEET', 'CASH', lines, without).notes).toContain(
      'No statement balance yet for Fake Card, Fake Loan.',
    );
  });

  it('Cash Flow: each bank line in one place, adding up to the statement change', () => {
    const f = reportFigures('CASH_FLOW', 'CASH', lines, ctx());
    expect(f.sections.map((s) => [s.title, s.totalCents])).toEqual([
      ['Operating Activities', 38_500],
      ['Investing Activities', -25_000],
      ['Financing Activities', -40_000],
    ]);
    expect(f.sections[2]!.rows).toEqual([
      { label: 'Card payments', amountCents: -50_000, count: 1 },
      { label: 'Fake Owner Contribution', amountCents: 10_000, count: 1 },
    ]);
    expect(f.totals).toMatchObject({
      beginningCashCents: 200_000,
      netChangeCents: -26_500,
      endingCashCents: 173_500,
      statementEndingCents: 173_500,
      differenceCents: 0,
    });
    expect(f.notes).toEqual([]);
  });

  it('Cash Flow says when the lines do not explain the statement, never smoothing it over', () => {
    const f = reportFigures(
      'CASH_FLOW',
      'CASH',
      lines,
      ctx({
        reconciliations: [
          rec(accounts[0]!, { beginningBalanceCents: 200_000, endingBalanceCents: 180_000 }),
        ],
      }),
    );
    expect(f.totals['differenceCents']).toBe(6_500);
    expect(f.notes.join(' ')).toMatch(/do not account for|don't account for/);
  });

  it('Reconciliation: each statement, then refunds and settlements broken down', () => {
    const f = reportFigures(
      'RECONCILIATION',
      'CASH',
      lines,
      ctx({
        reconciliations: [
          rec(accounts[0]!, {
            beginningBalanceCents: 200_000,
            endingBalanceCents: 173_500,
            clearedBalanceCents: 170_000,
            clearedCount: 9,
            differenceCents: 3_500,
            exceptionsCount: 1,
            status: 'IN_PROGRESS',
          }),
        ],
        refunds: [
          { kind: 'REFUND_ISSUED', status: 'COMPLETED', amountCents: 2_000 },
          { kind: 'CHARGEBACK', status: 'PENDING', amountCents: 3_000 },
        ],
        settlements: [
          {
            grossCents: 100_000,
            refundsCents: 2_000,
            chargebacksCents: 3_000,
            feesCents: 2_900,
            adjustmentsCents: 0,
            netPayoutCents: 92_100,
            status: 'UNMATCHED',
          },
        ],
      }),
    );
    expect(f.sections[0]).toEqual({
      title: 'Fake Checking (in progress)',
      totalCents: 3_500,
      rows: [
        { label: 'Statement beginning balance', amountCents: 200_000 },
        { label: 'Statement ending balance', amountCents: 173_500 },
        { label: 'Cleared balance', amountCents: 170_000, count: 9 },
        { label: 'Difference', amountCents: 3_500 },
        { label: 'Open exceptions', count: 1 },
      ],
    });
    expect(f.sections[1]!.rows.map((r) => r.label)).toEqual([
      'Chargeback (pending)',
      'Refund issued (completed)',
    ]);
    expect(f.sections[2]!.totalCents).toBe(92_100);
    expect(f.sections[2]!.rows.at(-1)).toEqual({ label: 'Not matched to a deposit', count: 1 });
    expect(f.totals).toEqual({
      accountsCount: 1,
      approvedCount: 0,
      openCount: 3,
      differenceCents: 3_500,
      refundsCents: 5_000,
      settlementsNetCents: 92_100,
    });
    expect(f.notes).toEqual(['No reconciliation started yet for Fake Card, Fake Loan.']);
  });

  it('Refund Report: refunds and chargebacks by kind and status, then by reason (Review 2, RP01)', () => {
    const f = reportFigures(
      'REFUND',
      'CASH',
      lines,
      ctx({
        refunds: [
          {
            kind: 'REFUND_ISSUED',
            status: 'COMPLETED',
            amountCents: 2_000,
            reason: 'Fake damaged',
          },
          { kind: 'REFUND_ISSUED', status: 'COMPLETED', amountCents: 1_000, reason: null },
          { kind: 'REFUND_RECEIVED', status: 'PENDING', amountCents: 500, reason: ' ' },
          { kind: 'CHARGEBACK', status: 'PENDING', amountCents: 3_000, reason: 'Fake damaged' },
        ],
      }),
    );
    expect(f.lineCount).toBe(4);
    expect(f.sections).toEqual([
      {
        title: 'Refunds Issued to Customers',
        rows: [{ label: 'Completed', amountCents: 3_000, count: 2 }],
        totalCents: 3_000,
      },
      {
        title: 'Refunds Received from Vendors',
        rows: [{ label: 'Pending', amountCents: 500, count: 1 }],
        totalCents: 500,
      },
      {
        title: 'Chargebacks',
        rows: [{ label: 'Pending', amountCents: 3_000, count: 1 }],
        totalCents: 3_000,
      },
      {
        title: 'By Reason',
        rows: [
          { label: 'Fake damaged', amountCents: 5_000, count: 2 },
          { label: 'No reason given', amountCents: 1_500, count: 2 },
        ],
        totalCents: 6_500,
      },
    ]);
    expect(f.totals).toEqual({
      refundsIssuedCents: 3_000,
      refundsReceivedCents: 500,
      chargebacksCents: 3_000,
      pendingCount: 2,
    });
    // Nothing recorded is no rows, not a row of zeros.
    expect(reportFigures('REFUND', 'CASH', lines, ctx()).lineCount).toBe(0);
  });

  it('Settlement Report: each payout, then gross less refunds, chargebacks and fees (Review 2, RP01)', () => {
    const payout = {
      grossCents: 100_000,
      refundsCents: 2_000,
      chargebacksCents: 3_000,
      feesCents: 2_900,
      adjustmentsCents: -100,
      netPayoutCents: 92_000,
    };
    const f = reportFigures(
      'SETTLEMENT',
      'CASH',
      lines,
      ctx({
        settlements: [
          { ...payout, processor: 'stripe', payoutOn: '2026-09-30', status: 'MATCHED' },
          {
            ...payout,
            grossCents: 10_000,
            refundsCents: 0,
            chargebacksCents: 0,
            feesCents: 300,
            adjustmentsCents: 0,
            netPayoutCents: 9_700,
            processor: 'square',
            payoutOn: '2026-09-15',
            status: 'NEEDS_REVIEW',
          },
        ],
      }),
    );
    expect(f.sections[0]).toEqual({
      title: 'Payouts',
      rows: [
        { label: 'Square 2026-09-15 (needs review)', amountCents: 9_700 },
        { label: 'Stripe 2026-09-30 (matched)', amountCents: 92_000 },
      ],
      totalCents: 101_700,
    });
    expect(f.sections[1]!.rows).toEqual([
      { label: 'Gross', amountCents: 110_000, count: 2 },
      { label: 'Refunds', amountCents: -2_000 },
      { label: 'Chargebacks', amountCents: -3_000 },
      { label: 'Fees', amountCents: -3_200 },
      { label: 'Adjustments', amountCents: -100 },
      { label: 'Not matched to a deposit', count: 1 },
    ]);
    expect(f.totals).toEqual({
      grossCents: 110_000,
      feesCents: 3_200,
      netPayoutCents: 101_700,
      unmatchedCount: 1,
    });
  });

  it('Missing Documents: money out without a receipt, and statements not attached', () => {
    const f = reportFigures('MISSING_DOCUMENTS', 'CASH', lines, ctx());
    expect(f.sections[0]!.rows).toEqual([
      { label: 'Fake Rent', amountCents: 30_700, count: 2 },
      { label: 'Split', amountCents: 8_000, count: 1 },
      { label: 'Uncategorized', amountCents: 4_500, count: 1 },
    ]);
    expect(f.sections[1]!.rows).toEqual([{ label: 'Fake Card', count: 1 }]);
    expect(f.totals).toEqual({
      receiptsMissing: 4,
      amountWithoutReceiptCents: 43_200,
      statementsMissing: 1,
    });
  });

  it('Bookkeeping Status: the close, the ledger and the reconciliations in counts', () => {
    const f = reportFigures(
      'BOOKKEEPING_STATUS',
      'CASH',
      lines,
      ctx({ refunds: [{ kind: 'REFUND_RECEIVED', status: 'PENDING', amountCents: 100 }] }),
    );
    expect(f.totals).toEqual({
      closeStepsDone: 3,
      closeStepsOpen: 5,
      uncategorized: 1,
      needsReview: 1,
      excluded: 1,
      withoutReceipt: 4,
      reconciliationsApproved: 2,
      reconciliationsOpen: 1,
      reconciliationsNotStarted: 0,
      refundsPending: 1,
      settlementsUnmatched: 0,
    });
    expect(f.sections[0]!.rows[0]).toEqual({ label: 'Period: in progress' });
    expect(f.lineCount).toBe(lines.length);
  });

  it('the CSV carries the notes', () => {
    const csv = figuresCsv(reportFigures('BALANCE_SHEET', 'CASH', lines, ctx()), (v) =>
      v === null ? '' : `"${String(v)}"`,
    );
    expect(csv).toContain('"Note","Not reconciled and approved yet: Fake Card."');
  });
});
