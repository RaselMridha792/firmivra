// BK-RPT part 2 (Octavia's Oct 25 Bookkeeping review): the General Ledger, Balance Sheet, Cash
// Flow, Reconciliation (with the refund and settlement breakdowns), Bookkeeping Status and Missing
// Documents reports. Pure, like part 1: the service loads the period's lines, statements, refunds,
// settlements and close, and stores the result as an immutable version. Nothing is invented: a
// balance comes from a statement, and an account without one is named instead.

import type { FigureLine, FigureRow, FigureSection, ReportFigures } from './report-figures.js';

/** An account of the client, for the statement-based reports. */
export interface FigureAccount {
  id: string;
  name: string;
  /** BANK, CREDIT_CARD, LOAN, OTHER. */
  type: string;
  /** Whether the account is reconciled (and so has a statement each period). */
  reconcile: boolean;
}
/** One account's reconciliation for the period: its statement and what was cleared. */
export interface FigureReconciliation {
  account: FigureAccount;
  beginningBalanceCents: number;
  endingBalanceCents: number;
  clearedBalanceCents: number;
  clearedCount: number;
  differenceCents: number;
  exceptionsCount: number;
  status: string;
  hasStatement: boolean;
}
export interface FigureRefund {
  kind: string;
  status: string;
  amountCents: number;
  /** The reason given (Refund Report), when there is one. */
  reason?: string | null;
}
export interface FigureSettlement {
  /** The processor ("stripe") and payout day (YYYY-MM-DD), for the Settlement Report's rows. */
  processor?: string;
  payoutOn?: string;
  grossCents: number;
  refundsCents: number;
  chargebacksCents: number;
  feesCents: number;
  adjustmentsCents: number;
  netPayoutCents: number;
  status: string;
}
/** A settlement's amounts (in cents), the parts a report adds up. */
type SettlementCents = Exclude<keyof FigureSettlement, 'status' | 'processor' | 'payoutOn'>;

/** What the statement, status and missing-documents reports read besides the lines. */
export interface FigureContext {
  /** The client's accounts that are not archived. */
  accounts: FigureAccount[];
  reconciliations: FigureReconciliation[];
  /** Refunds and chargebacks dated in the period that the firm includes in reports. */
  refunds: FigureRefund[];
  /** Settlements paid out in the period. */
  settlements: FigureSettlement[];
  period: { status: string; closeDone: number; closeTotal: number } | null;
}
export const EMPTY_CONTEXT: FigureContext = {
  accounts: [],
  reconciliations: [],
  refunds: [],
  settlements: [],
  period: null,
};

export type MoreReportType =
  | 'GENERAL_LEDGER'
  | 'BALANCE_SHEET'
  | 'CASH_FLOW'
  | 'RECONCILIATION'
  | 'BOOKKEEPING_STATUS'
  | 'MISSING_DOCUMENTS'
  | 'REFUND'
  | 'SETTLEMENT';
export const MORE_REPORT_TYPES: readonly MoreReportType[] = [
  'GENERAL_LEDGER',
  'BALANCE_SHEET',
  'CASH_FLOW',
  'RECONCILIATION',
  'BOOKKEEPING_STATUS',
  'MISSING_DOCUMENTS',
  // Review 2 (RP01): the period's refunds and chargebacks, and its processor settlements.
  'REFUND',
  'SETTLEMENT',
];

const LIABILITY_ACCOUNTS = ['CREDIT_CARD', 'LOAN'];
const words = (code: string) => code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ');
const names = (list: readonly { name: string }[]) => list.map((a) => a.name).join(', ');
const byLabel = (a: FigureRow, b: FigureRow) => a.label.localeCompare(b.label);

/** The parts of a line that carry a category: its own, or each split part. */
const parts = (l: FigureLine) =>
  l.splits.length
    ? l.splits.map((s) => ({ amountCents: s.amountCents, category: s.category }))
    : [{ amountCents: l.amountCents, category: l.category }];

/**
 * The reconciled accounts a Balance Sheet (any) or Cash Flow (bank) needs a statement balance for
 * and has none: those are generated only once each has one (409 STATEMENTS_MISSING).
 */
export function statementsMissing(type: string, ctx: FigureContext): FigureAccount[] {
  if (type !== 'BALANCE_SHEET' && type !== 'CASH_FLOW') return [];
  return ctx.accounts.filter(
    (a) =>
      a.reconcile &&
      (type === 'BALANCE_SHEET' || a.type === 'BANK') &&
      !ctx.reconciliations.some((r) => r.account.id === a.id),
  );
}

const section = (title: string, rows: FigureRow[], totalCents?: number): FigureSection => ({
  title,
  rows,
  totalCents: totalCents ?? rows.reduce((n, r) => n + (r.amountCents ?? 0), 0),
});
const sorted = (m: Map<string, FigureRow>) => [...m.values()].sort(byLabel);
const bump = (m: Map<string, FigureRow>, label: string, cents: number) => {
  const row = m.get(label) ?? { label, amountCents: 0, count: 0 };
  row.amountCents = (row.amountCents ?? 0) + cents;
  row.count = (row.count ?? 0) + 1;
  m.set(label, row);
};

const GROUP: Record<string, string> = {
  INCOME: 'Income',
  COST_OF_GOODS: 'Cost of Goods Sold',
  EXPENSE: 'Expenses',
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  OTHER: 'Other',
};

/** The trial balance's two sides, grouped by kind of account, with each one's line count. */
function generalLedger(counted: readonly FigureLine[]) {
  const groups = new Map<string, Map<string, FigureRow>>();
  const add = (group: string, label: string, side: 'DEBIT' | 'CREDIT', cents: number) => {
    const g = groups.get(group) ?? new Map<string, FigureRow>();
    const row = g.get(label) ?? { label, debitCents: 0, creditCents: 0, count: 0 };
    if (side === 'DEBIT') row.debitCents = (row.debitCents ?? 0) + cents;
    else row.creditCents = (row.creditCents ?? 0) + cents;
    row.count = (row.count ?? 0) + 1;
    g.set(label, row);
    groups.set(group, g);
  };
  for (const l of counted) {
    // Money out (a debit line) debits the category and credits the account; money in the reverse.
    add(
      'Bank and Card Accounts',
      l.account.name,
      l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      l.amountCents,
    );
    if (l.kind === 'TRANSFER') {
      add('Transfers', 'Transfers between accounts', l.direction, l.amountCents);
      continue;
    }
    for (const p of parts(l)) {
      if (p.category)
        add(GROUP[p.category.type] ?? 'Other', p.category.name, l.direction, p.amountCents);
      else add('Uncategorized', 'Uncategorized', l.direction, p.amountCents);
    }
  }
  const order = ['Bank and Card Accounts', ...Object.values(GROUP), 'Uncategorized', 'Transfers'];
  const sections = order
    .filter((g) => groups.has(g))
    .map((g) => {
      const rows = sorted(groups.get(g)!);
      return section(
        g,
        rows,
        rows.reduce((n, r) => n + (r.debitCents ?? 0) - (r.creditCents ?? 0), 0),
      );
    });
  const rows = sections.flatMap((s) => s.rows);
  return {
    sections,
    totals: {
      debitsCents: rows.reduce((n, r) => n + (r.debitCents ?? 0), 0),
      creditsCents: rows.reduce((n, r) => n + (r.creditCents ?? 0), 0),
    },
  };
}

/** The bank accounts' lines, each in exactly one place, so the sections add up to the change. */
function cashFlow(counted: readonly FigureLine[], ctx: FigureContext, notes: string[]) {
  const bank = counted.filter((l) => l.account.type === 'BANK');
  const operating = new Map<string, FigureRow>();
  const investing = new Map<string, FigureRow>();
  const financing = new Map<string, FigureRow>();
  const between = new Map<string, FigureRow>();
  for (const l of bank) {
    const sign = l.direction === 'CREDIT' ? 1 : -1;
    if (l.kind === 'TRANSFER') {
      const other = l.transferPairAccountType ?? null;
      if (other === 'BANK')
        bump(between, "Between the client's bank accounts", sign * l.amountCents);
      else
        bump(
          financing,
          other === 'CREDIT_CARD'
            ? 'Card payments'
            : other === 'LOAN'
              ? 'Loan payments and draws'
              : 'Transfers to other accounts',
          sign * l.amountCents,
        );
      continue;
    }
    for (const p of parts(l)) {
      const t = p.category?.type;
      const target =
        t === 'ASSET' ? investing : t === 'LIABILITY' || t === 'EQUITY' ? financing : operating;
      bump(target, p.category?.name ?? 'Not yet categorized', sign * p.amountCents);
    }
  }
  const sections = [
    section('Operating Activities', sorted(operating)),
    section('Investing Activities', sorted(investing)),
    section('Financing Activities', sorted(financing)),
    ...(between.size ? [section("Between the Client's Bank Accounts", sorted(between))] : []),
  ];
  const net = sections.reduce((n, s) => n + s.totalCents, 0);
  const recs = ctx.reconciliations.filter((r) => r.account.type === 'BANK');
  const beginning = recs.reduce((n, r) => n + r.beginningBalanceCents, 0);
  const statementEnding = recs.reduce((n, r) => n + r.endingBalanceCents, 0);
  const missing = statementsMissing('CASH_FLOW', ctx);
  if (missing.length) notes.push(`No statement balance yet for ${names(missing)}.`);
  const difference = statementEnding - (beginning + net);
  if (!missing.length && difference !== 0)
    notes.push(
      "The bank lines don't account for the statements' change: some lines are missing or not imported yet.",
    );
  return {
    lineCount: bank.length,
    sections,
    totals: {
      beginningCashCents: beginning,
      operatingCents: sections[0]!.totalCents,
      investingCents: sections[1]!.totalCents,
      financingCents: sections[2]!.totalCents,
      netChangeCents: net,
      endingCashCents: beginning + net,
      statementEndingCents: statementEnding,
      differenceCents: difference,
    },
  };
}

/** Each account's statement, cleared balance and difference, then refunds and settlements. */
function reconciliation(ctx: FigureContext, notes: string[]) {
  const recs = [...ctx.reconciliations].sort((x, y) =>
    x.account.name.localeCompare(y.account.name),
  );
  const accounts = recs.map((r) =>
    section(
      `${r.account.name} (${words(r.status).toLowerCase()})`,
      [
        { label: 'Statement beginning balance', amountCents: r.beginningBalanceCents },
        { label: 'Statement ending balance', amountCents: r.endingBalanceCents },
        { label: 'Cleared balance', amountCents: r.clearedBalanceCents, count: r.clearedCount },
        { label: 'Difference', amountCents: r.differenceCents },
        { label: 'Open exceptions', count: r.exceptionsCount },
      ],
      r.differenceCents,
    ),
  );
  const refunds = new Map<string, FigureRow>();
  for (const f of ctx.refunds)
    bump(refunds, `${words(f.kind)} (${words(f.status).toLowerCase()})`, f.amountCents);
  const sum = (k: SettlementCents) => ctx.settlements.reduce((n, s) => n + s[k], 0);
  const settlements: FigureRow[] = ctx.settlements.length
    ? [
        { label: 'Gross', amountCents: sum('grossCents'), count: ctx.settlements.length },
        { label: 'Refunds', amountCents: -sum('refundsCents') },
        { label: 'Chargebacks', amountCents: -sum('chargebacksCents') },
        { label: 'Fees', amountCents: -sum('feesCents') },
        { label: 'Adjustments', amountCents: sum('adjustmentsCents') },
        {
          label: 'Not matched to a deposit',
          count: ctx.settlements.filter((s) => s.status !== 'MATCHED').length,
        },
      ]
    : [];
  const without = ctx.accounts.filter(
    (a) => a.reconcile && !ctx.reconciliations.some((r) => r.account.id === a.id),
  );
  if (without.length) notes.push(`No reconciliation started yet for ${names(without)}.`);
  return {
    lineCount: recs.length,
    sections: [
      ...accounts,
      section('Refunds and Chargebacks', sorted(refunds)),
      section('Settlements', settlements, sum('netPayoutCents')),
    ],
    totals: {
      accountsCount: recs.length,
      approvedCount: recs.filter((r) => r.status === 'APPROVED').length,
      openCount: recs.filter((r) => r.status !== 'APPROVED').length + without.length,
      differenceCents: recs.reduce((n, r) => n + r.differenceCents, 0),
      refundsCents: ctx.refunds.reduce((n, f) => n + f.amountCents, 0),
      settlementsNetCents: sum('netPayoutCents'),
    },
  };
}

const KIND_TITLE: Record<string, string> = {
  REFUND_ISSUED: 'Refunds Issued to Customers',
  REFUND_RECEIVED: 'Refunds Received from Vendors',
  CHARGEBACK: 'Chargebacks',
};

/**
 * Review 2 (RP01): the period's refunds and chargebacks the firm includes in reports, by kind and
 * status, then by reason. Each comes from the client's refund records, never from a guess.
 */
function refundReport(ctx: FigureContext) {
  const total = (kind: string) =>
    ctx.refunds.filter((f) => f.kind === kind).reduce((n, f) => n + f.amountCents, 0);
  const sections = Object.entries(KIND_TITLE).map(([kind, title]) => {
    const rows = new Map<string, FigureRow>();
    for (const f of ctx.refunds.filter((x) => x.kind === kind))
      bump(rows, words(f.status), f.amountCents);
    return section(title, sorted(rows));
  });
  const reasons = new Map<string, FigureRow>();
  for (const f of ctx.refunds) bump(reasons, f.reason?.trim() || 'No reason given', f.amountCents);
  return {
    lineCount: ctx.refunds.length,
    sections: [...sections, section('By Reason', sorted(reasons))],
    totals: {
      refundsIssuedCents: total('REFUND_ISSUED'),
      refundsReceivedCents: total('REFUND_RECEIVED'),
      chargebacksCents: total('CHARGEBACK'),
      pendingCount: ctx.refunds.filter((f) => f.status === 'PENDING').length,
    },
  };
}

/**
 * Review 2 (RP01): each processor payout of the period (gross less refunds, chargebacks and fees,
 * with adjustments), then the period's totals and how many are not matched to a bank deposit.
 */
function settlementReport(ctx: FigureContext) {
  const sum = (k: SettlementCents) => ctx.settlements.reduce((n, s) => n + s[k], 0);
  const payouts = [...ctx.settlements]
    .sort((a, b) => (a.payoutOn ?? '').localeCompare(b.payoutOn ?? ''))
    .map((s) => ({
      label: [
        s.processor ? words(s.processor) : 'Payout',
        s.payoutOn ?? null,
        `(${words(s.status).toLowerCase()})`,
      ]
        .filter(Boolean)
        .join(' '),
      amountCents: s.netPayoutCents,
    }));
  const unmatched = ctx.settlements.filter((s) => s.status !== 'MATCHED').length;
  return {
    lineCount: ctx.settlements.length,
    sections: [
      section('Payouts', payouts, sum('netPayoutCents')),
      section(
        'Totals',
        ctx.settlements.length
          ? [
              { label: 'Gross', amountCents: sum('grossCents'), count: ctx.settlements.length },
              { label: 'Refunds', amountCents: -sum('refundsCents') },
              { label: 'Chargebacks', amountCents: -sum('chargebacksCents') },
              { label: 'Fees', amountCents: -sum('feesCents') },
              { label: 'Adjustments', amountCents: sum('adjustmentsCents') },
              { label: 'Not matched to a deposit', count: unmatched },
            ]
          : [],
        sum('netPayoutCents'),
      ),
    ],
    totals: {
      grossCents: sum('grossCents'),
      feesCents: sum('feesCents'),
      netPayoutCents: sum('netPayoutCents'),
      unmatchedCount: unmatched,
    },
  };
}

/**
 * The figures of the part-2 types. `counted` are the period's lines less the excluded ones,
 * `all` every line of the period (the status report counts the excluded).
 */
export function moreFigures(
  type: MoreReportType,
  base: Omit<ReportFigures, 'sections' | 'totals' | 'type' | 'notes' | 'lineCount' | 'source'>,
  counted: readonly FigureLine[],
  all: readonly FigureLine[],
  ctx: FigureContext,
): ReportFigures {
  const notes: string[] = [];
  const out = (
    f: Pick<ReportFigures, 'sections' | 'totals'> & { lineCount?: number },
  ): ReportFigures => ({
    ...base,
    type,
    source: 'LEDGER',
    notes,
    lineCount: f.lineCount ?? counted.length,
    sections: f.sections,
    totals: f.totals,
  });

  if (type === 'GENERAL_LEDGER') return out(generalLedger(counted));
  if (type === 'CASH_FLOW') return out(cashFlow(counted, ctx, notes));
  if (type === 'RECONCILIATION') return out(reconciliation(ctx, notes));
  if (type === 'REFUND') return out(refundReport(ctx));
  if (type === 'SETTLEMENT') return out(settlementReport(ctx));

  if (type === 'BALANCE_SHEET') {
    const assets: FigureRow[] = [];
    const liabilities: FigureRow[] = [];
    for (const r of ctx.reconciliations) {
      // A card or loan is owed whichever way its statement shows the balance.
      if (LIABILITY_ACCOUNTS.includes(r.account.type))
        liabilities.push({ label: r.account.name, amountCents: Math.abs(r.endingBalanceCents) });
      else assets.push({ label: r.account.name, amountCents: r.endingBalanceCents });
    }
    const a = section('Assets', assets.sort(byLabel));
    const li = section('Liabilities', liabilities.sort(byLabel));
    notes.push(
      "Balances are each account's statement ending balance for the period. Other assets, liabilities and owner's equity need opening balances, which are not recorded yet, so net assets stand in for equity.",
    );
    const missing = statementsMissing(type, ctx);
    if (missing.length) notes.push(`No statement balance yet for ${names(missing)}.`);
    const unapproved = ctx.reconciliations.filter((r) => r.status !== 'APPROVED');
    if (unapproved.length)
      notes.push(`Not reconciled and approved yet: ${names(unapproved.map((r) => r.account))}.`);
    return out({
      lineCount: ctx.reconciliations.length,
      sections: [a, li],
      totals: {
        assetsCents: a.totalCents,
        liabilitiesCents: li.totalCents,
        netAssetsCents: a.totalCents - li.totalCents,
      },
    });
  }

  // Money out with no receipt (Missing Documents asks for these; Status counts them).
  const noReceipt = counted.filter(
    (l) => l.direction === 'DEBIT' && l.kind !== 'TRANSFER' && l.hasReceipt === false,
  );
  const noStatement = ctx.accounts.filter(
    (a) => a.reconcile && !ctx.reconciliations.some((r) => r.account.id === a.id && r.hasStatement),
  );

  if (type === 'MISSING_DOCUMENTS') {
    const receipts = new Map<string, FigureRow>();
    for (const l of noReceipt)
      bump(
        receipts,
        l.splits.length ? 'Split' : (l.category?.name ?? 'Uncategorized'),
        l.amountCents,
      );
    return out({
      lineCount: noReceipt.length,
      sections: [
        section('Receipts', sorted(receipts)),
        section(
          'Bank and Card Statements',
          noStatement.map((a) => ({ label: a.name, count: 1 })).sort(byLabel),
          0,
        ),
      ],
      totals: {
        receiptsMissing: noReceipt.length,
        amountWithoutReceiptCents: noReceipt.reduce((n, l) => n + l.amountCents, 0),
        statementsMissing: noStatement.length,
      },
    });
  }

  // BOOKKEEPING_STATUS: where the period's close stands, in counts.
  const p = ctx.period;
  const count = (status: string) => all.filter((l) => l.status === status).length;
  const approved = ctx.reconciliations.filter((r) => r.status === 'APPROVED').length;
  const notStarted = ctx.accounts.filter(
    (a) => a.reconcile && !ctx.reconciliations.some((r) => r.account.id === a.id),
  ).length;
  const totals = {
    closeStepsDone: p?.closeDone ?? 0,
    closeStepsOpen: p ? p.closeTotal - p.closeDone : 0,
    uncategorized: count('UNCATEGORIZED'),
    needsReview: count('NEEDS_REVIEW'),
    excluded: count('EXCLUDED'),
    withoutReceipt: noReceipt.length,
    reconciliationsApproved: approved,
    reconciliationsOpen: ctx.reconciliations.length - approved,
    reconciliationsNotStarted: notStarted,
    refundsPending: ctx.refunds.filter((f) => f.status === 'PENDING').length,
    settlementsUnmatched: ctx.settlements.filter((s) => s.status !== 'MATCHED').length,
  };
  return out({
    lineCount: all.length,
    sections: [
      section(
        'Close',
        [
          { label: `Period: ${p ? words(p.status).toLowerCase() : 'none'}` },
          { label: 'Close steps done', count: totals.closeStepsDone },
          { label: 'Close steps open', count: totals.closeStepsOpen },
        ],
        0,
      ),
      section(
        'Ledger',
        [
          { label: 'Lines', count: all.length },
          { label: 'Uncategorized', count: totals.uncategorized },
          { label: 'Needs review', count: totals.needsReview },
          { label: 'Excluded', count: totals.excluded },
          { label: 'Money out without a receipt', count: totals.withoutReceipt },
        ],
        0,
      ),
      section(
        'Reconciliations',
        [
          { label: 'Approved', count: approved },
          { label: 'Open', count: totals.reconciliationsOpen },
          { label: 'Not started', count: notStarted },
        ],
        0,
      ),
      section(
        'Refunds and Settlements',
        [
          { label: 'Refunds pending', count: totals.refundsPending },
          { label: 'Settlements not matched to a deposit', count: totals.settlementsUnmatched },
        ],
        0,
      ),
    ],
    totals,
  });
}
