// BK-RPT part 1 (Octavia's Oct 25 Bookkeeping review): a report's figures, worked out from the
// client's ledger lines for its period. Pure: the service loads the lines and stores the result as
// an immutable report version. The ledger holds bank and card lines, so every figure is on the
// cash basis; an accrual report says so instead of pretending (invoices and bills are not in it).
// Part 2's six types (statements, status, missing documents) are in report-figures-more.ts.

import {
  EMPTY_CONTEXT,
  type FigureContext,
  MORE_REPORT_TYPES,
  type MoreReportType,
  moreFigures,
} from './report-figures-more.js';
import { SUMMARY_REPORT_TYPES, type SummaryReportType } from './report-figures-summary.js';

export type FigureReportType =
  | 'PROFIT_LOSS'
  | 'TRIAL_BALANCE'
  | 'TRANSACTION_DETAIL'
  | 'UNCATEGORIZED'
  | MoreReportType
  | SummaryReportType;
export const FIGURE_REPORT_TYPES: readonly FigureReportType[] = [
  'PROFIT_LOSS',
  'TRIAL_BALANCE',
  'TRANSACTION_DETAIL',
  'UNCATEGORIZED',
  ...MORE_REPORT_TYPES,
  ...SUMMARY_REPORT_TYPES,
];

export interface FigureLine {
  amountCents: number;
  direction: 'DEBIT' | 'CREDIT';
  status: string;
  kind: string;
  /** The account's type (BANK, CREDIT_CARD, LOAN, OTHER), for the Cash Flow. */
  account: { id: string; name: string; type?: string };
  category: { id: string; name: string; type: string } | null;
  splits: { amountCents: number; category: { id: string; name: string; type: string } }[];
  /** A transfer's other side's account type (Cash Flow: a card payment, a loan, another bank). */
  transferPairAccountType?: string | null;
  /** Whether a receipt is attached (Missing Documents and Status). */
  hasReceipt?: boolean;
  /** The line's day (YYYY-MM-DD): the summaries' months. */
  on?: string;
}

export interface FigureRow {
  label: string;
  /** Debits and credits (trial balance) or the signed amount (profit and loss), in cents. */
  debitCents?: number;
  creditCents?: number;
  amountCents?: number;
  count?: number;
}
export interface FigureSection {
  title: string;
  rows: FigureRow[];
  totalCents: number;
}
export interface ReportFigures {
  type: FigureReportType;
  basis: 'CASH';
  /** Said when the report asked for accrual: these figures are the cash basis. */
  basisNote: string | null;
  /** What the figures leave out or rest on (a statement missing, balances from statements). */
  notes: string[];
  sections: FigureSection[];
  /** Net income (P&L), the equal totals (trial balance), or the lines' total. */
  totals: Record<string, number>;
  lineCount: number;
  /**
   * Review 2 (RP03): where the figures come from. LEDGER, the client's Firmivra ledger (synced or
   * entered transactions); MANUAL, a P&L made from the income and expenses entered for a period.
   * Never both. Absent on versions made before Review 2 (they are the ledger's).
   */
  source: 'LEDGER' | 'MANUAL';
}

/** A period's income and expenses as entered in Firmivra (Review 2, RP03: a MANUAL P&L). */
export interface EnteredFigures {
  /** The period's first day (YYYY-MM-DD). */
  start: string;
  incomeCents: number;
  expensesCents: number;
}

/**
 * Review 2 (RP03): a P&L made in Firmivra from the income and expenses entered for the period(s),
 * for a client whose P&L source is MANUAL. The ledger's lines are never added in.
 */
export function enteredProfitAndLoss(
  basis: 'CASH' | 'ACCRUAL' | null,
  periods: readonly EnteredFigures[],
): ReportFigures {
  const income = periods.reduce((n, p) => n + p.incomeCents, 0);
  const expenses = periods.reduce((n, p) => n + p.expensesCents, 0);
  const many = periods.length > 1;
  return {
    type: 'PROFIT_LOSS',
    basis: 'CASH',
    basisNote:
      basis === 'ACCRUAL'
        ? 'Shown as entered: the income and expenses were entered for the period, not worked out from invoices and bills.'
        : null,
    notes: [
      `Made in Firmivra from the income and expenses entered for ${many ? 'each period' : 'the period'}. The ledger's transactions are not added in, so nothing is counted twice.`,
    ],
    sections: [
      {
        title: 'Income',
        rows: [{ label: 'Income (entered)', amountCents: income }],
        totalCents: income,
      },
      { title: 'Cost of Goods Sold', rows: [], totalCents: 0 },
      {
        title: 'Expenses',
        rows: [{ label: 'Expenses (entered)', amountCents: expenses }],
        totalCents: expenses,
      },
    ],
    totals: {
      incomeCents: income,
      costOfGoodsCents: 0,
      expensesCents: expenses,
      netIncomeCents: income - expenses,
    },
    lineCount: periods.length,
    source: 'MANUAL',
  };
}

/** The parts of a line that carry a category: its own, or each split part. */
function parts(l: FigureLine) {
  if (l.splits.length)
    return l.splits.map((s) => ({ amountCents: s.amountCents, category: s.category }));
  return [{ amountCents: l.amountCents, category: l.category }];
}

const bySection = (rows: Map<string, FigureRow>, title: string): FigureSection => {
  const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
  return {
    title,
    rows: list,
    totalCents: list.reduce((n, r) => n + (r.amountCents ?? 0), 0),
  };
};

/**
 * The figures of one report type from the period's lines. Excluded lines never count; a split
 * counts by its parts; a transfer moves money between the client's own accounts and is no income
 * or expense.
 */
export function reportFigures(
  type: FigureReportType,
  basis: 'CASH' | 'ACCRUAL' | null,
  lines: readonly FigureLine[],
  ctx: FigureContext = EMPTY_CONTEXT,
): ReportFigures {
  const counted = lines.filter((l) => l.status !== 'EXCLUDED');
  const basisNote =
    basis === 'ACCRUAL'
      ? 'Shown on the cash basis: the ledger holds bank and card lines, not invoices and bills.'
      : null;
  if ((SUMMARY_REPORT_TYPES as readonly string[]).includes(type)) {
    // A summary needs its range: report-figures-summary.ts (summaryFigures) works it out.
    throw new Error(`${type} figures come from summaryFigures`);
  }
  if ((MORE_REPORT_TYPES as readonly string[]).includes(type)) {
    return moreFigures(type as MoreReportType, { basis: 'CASH', basisNote }, counted, lines, ctx);
  }
  const base = {
    type,
    basis: 'CASH' as const,
    basisNote,
    notes: [],
    lineCount: counted.length,
    source: 'LEDGER' as const,
  };

  if (type === 'PROFIT_LOSS') {
    const income = new Map<string, FigureRow>();
    const cogs = new Map<string, FigureRow>();
    const expense = new Map<string, FigureRow>();
    for (const l of counted) {
      if (l.kind === 'TRANSFER') continue;
      for (const p of parts(l)) {
        if (!p.category) continue;
        const signed = l.direction === 'CREDIT' ? p.amountCents : -p.amountCents;
        const target =
          p.category.type === 'INCOME'
            ? { map: income, value: signed }
            : p.category.type === 'COST_OF_GOODS'
              ? { map: cogs, value: -signed }
              : p.category.type === 'EXPENSE'
                ? { map: expense, value: -signed }
                : null;
        if (!target) continue;
        const row = target.map.get(p.category.id) ?? { label: p.category.name, amountCents: 0 };
        row.amountCents = (row.amountCents ?? 0) + target.value;
        target.map.set(p.category.id, row);
      }
    }
    const sections = [
      bySection(income, 'Income'),
      bySection(cogs, 'Cost of Goods Sold'),
      bySection(expense, 'Expenses'),
    ];
    const [i, c, e] = sections.map((s) => s.totalCents) as [number, number, number];
    return {
      ...base,
      sections,
      totals: { incomeCents: i, costOfGoodsCents: c, expensesCents: e, netIncomeCents: i - c - e },
    };
  }

  if (type === 'TRIAL_BALANCE') {
    // Each line is two-sided: its category (or Uncategorized, or Transfers) one way, its bank or
    // card account the other, so the debit and credit totals agree.
    const rows = new Map<string, FigureRow>();
    const add = (key: string, label: string, side: 'DEBIT' | 'CREDIT', cents: number) => {
      const row = rows.get(key) ?? { label, debitCents: 0, creditCents: 0 };
      if (side === 'DEBIT') row.debitCents = (row.debitCents ?? 0) + cents;
      else row.creditCents = (row.creditCents ?? 0) + cents;
      rows.set(key, row);
    };
    for (const l of counted) {
      // Money out (a debit line) debits the category and credits the account; money in the reverse.
      const accountSide = l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
      add(`account:${l.account.id}`, l.account.name, accountSide, l.amountCents);
      if (l.kind === 'TRANSFER') {
        add('transfers', 'Transfers between accounts', l.direction, l.amountCents);
        continue;
      }
      for (const p of parts(l)) {
        if (p.category)
          add(`category:${p.category.id}`, p.category.name, l.direction, p.amountCents);
        else add('uncategorized', 'Uncategorized', l.direction, p.amountCents);
      }
    }
    const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
    const debits = list.reduce((n, r) => n + (r.debitCents ?? 0), 0);
    const credits = list.reduce((n, r) => n + (r.creditCents ?? 0), 0);
    return {
      ...base,
      sections: [{ title: 'Trial Balance', rows: list, totalCents: debits - credits }],
      totals: { debitsCents: debits, creditsCents: credits },
    };
  }

  // Transaction Detail: the lines by category; Uncategorized: only those waiting for one.
  const wanted =
    type === 'UNCATEGORIZED'
      ? counted.filter((l) => l.kind !== 'TRANSFER' && !l.category && l.splits.length === 0)
      : counted;
  const rows = new Map<string, FigureRow>();
  for (const l of wanted) {
    const signed = l.direction === 'CREDIT' ? l.amountCents : -l.amountCents;
    const label =
      l.kind === 'TRANSFER'
        ? 'Transfers between accounts'
        : l.splits.length
          ? 'Split'
          : (l.category?.name ?? 'Uncategorized');
    const row = rows.get(label) ?? { label, amountCents: 0, count: 0 };
    row.amountCents = (row.amountCents ?? 0) + signed;
    row.count = (row.count ?? 0) + 1;
    rows.set(label, row);
  }
  const section = bySection(rows, type === 'UNCATEGORIZED' ? 'Uncategorized' : 'By category');
  return {
    ...base,
    lineCount: wanted.length,
    sections: [section],
    totals: {
      netCents: section.totalCents,
      inCents: wanted
        .filter((l) => l.direction === 'CREDIT')
        .reduce((n, l) => n + l.amountCents, 0),
      outCents: wanted
        .filter((l) => l.direction === 'DEBIT')
        .reduce((n, l) => n + l.amountCents, 0),
    },
  };
}

/** A version's figures as CSV rows (section, label, debit, credit, amount, count), with totals. */
/** What a CSV is about (Review 2, RP03): its client, period, basis and the figures' source. */
export interface CsvContext {
  client: string;
  period: string;
  basis: string;
  source: string;
}

const TOTAL_LABEL: Record<string, string> = {
  incomeCents: 'Income',
  expensesCents: 'Expenses',
  netIncomeCents: 'Net income',
  costOfGoodsCents: 'Cost of goods sold',
};
/** A total's key in words: incomeCents is "Income", anyOtherCents is "Any other". */
export function totalLabel(key: string): string {
  const known = TOTAL_LABEL[key];
  if (known) return known;
  const words = key
    .replace(/Cents$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function figuresCsv(
  f: ReportFigures,
  cell: (v: string | number | null) => string,
  context?: CsvContext,
): string {
  const money = (c: number | undefined) => (c === undefined ? null : (c / 100).toFixed(2));
  // Review 2 (RP03): nothing recorded for the period is not a set of verified zero totals.
  // (The status and missing-documents reports count clients and items, not ledger lines.)
  const empty =
    f.lineCount === 0 && f.type !== 'BOOKKEEPING_STATUS' && f.type !== 'MISSING_DOCUMENTS';
  const lines: string[] = [];
  if (context) {
    for (const [k, v] of [
      ['Client', context.client],
      ['Period', context.period],
      ['Basis', context.basis],
      ['Source', context.source],
      [
        'Data',
        empty
          ? 'Nothing is recorded for this period, so there are no totals (not verified zeros).'
          : `${f.lineCount} recorded lines`,
      ],
    ] as [string, string][])
      lines.push([k, v].map(cell).join(','));
    lines.push('');
  }
  lines.push(['Section', 'Line', 'Debit', 'Credit', 'Amount', 'Count'].map(cell).join(','));
  for (const s of f.sections) {
    for (const r of s.rows) {
      lines.push(
        [
          s.title,
          r.label,
          money(r.debitCents),
          money(r.creditCents),
          money(r.amountCents),
          r.count ?? null,
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  for (const [k, v] of Object.entries(f.totals))
    lines.push(
      ['Total', totalLabel(k), null, null, empty ? null : money(v), null].map(cell).join(','),
    );
  if (f.basisNote) lines.push(['Note', f.basisNote, null, null, null, null].map(cell).join(','));
  for (const n of f.notes ?? [])
    lines.push(['Note', n, null, null, null, null].map(cell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
