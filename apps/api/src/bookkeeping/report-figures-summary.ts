// BK-RPT (Rasel, Nov 10): the Quarterly Review and the Year to Date Summary, from the ledger (no
// schema). Pure, like the other report figures. A summary's range is its bookkeeping period when it
// has one; otherwise its label says it ("Q3 2026", "2026"). The figures are the range's profit and
// loss, the net income month by month, and what the ledger still needs (uncategorized, excluded).

import type { FigureLine, FigureRow, ReportFigures } from './report-figures.js';

export type SummaryReportType = 'QUARTERLY_REVIEW' | 'YEAR_TO_DATE_SUMMARY';
export const SUMMARY_REPORT_TYPES: readonly SummaryReportType[] = [
  'QUARTERLY_REVIEW',
  'YEAR_TO_DATE_SUMMARY',
];

export interface DayRange {
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The days a summary covers, or null when neither its period nor its label says. A quarter: the
 * period, or the label's quarter ("Q3 2026", "2026 Q3"). Year to date: from 1 January of the year
 * to the period's end; by its label, the whole year, or this year up to `today`.
 */
export function summaryRange(
  type: SummaryReportType,
  period: DayRange | null,
  label: string,
  today: string,
): DayRange | null {
  if (type === 'QUARTERLY_REVIEW') {
    if (period) return period;
    const m = /\bQ([1-4])\b\D*(\d{4})|(\d{4})\D*\bQ([1-4])\b/i.exec(label);
    if (!m) return null;
    const q = Number(m[1] ?? m[4]);
    const year = Number(m[2] ?? m[3]);
    const first = (q - 1) * 3 + 1;
    return {
      start: `${year}-${pad(first)}-01`,
      end: `${year}-${pad(first + 2)}-${pad(lastDay(year, first + 2))}`,
    };
  }
  // By its period: 1 January to the period's end. By its label: the year, so far when it is this one.
  if (period) return { start: `${period.end.slice(0, 4)}-01-01`, end: period.end };
  const yearOf = Number(/\b(\d{4})\b/.exec(label)?.[1]);
  if (!yearOf) return null;
  const end = today.startsWith(`${yearOf}-`) ? today : `${yearOf}-12-31`;
  return { start: `${yearOf}-01-01`, end };
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A line's signed effect on net income: income in, cost of goods and expenses out. */
function netOf(l: FigureLine): number {
  if (l.status === 'EXCLUDED' || l.kind === 'TRANSFER') return 0;
  const parts = l.splits.length
    ? l.splits.map((s) => ({ amountCents: s.amountCents, type: s.category.type }))
    : [{ amountCents: l.amountCents, type: l.category?.type }];
  const sign = l.direction === 'CREDIT' ? 1 : -1;
  return parts.reduce(
    (n, p) =>
      p.type === 'INCOME' || p.type === 'COST_OF_GOODS' || p.type === 'EXPENSE'
        ? n + sign * p.amountCents
        : n,
    0,
  );
}

/**
 * A summary's figures. `profitAndLoss` is the range's Profit & Loss (the shared engine), so the
 * totals agree with that report for the same days; `lines` carry their day (`on`).
 */
export function summaryFigures(
  type: SummaryReportType,
  range: DayRange,
  profitAndLoss: ReportFigures,
  lines: readonly FigureLine[],
  /** Review 2 (RP03): a MANUAL P&L's entered net by month (YYYY-MM), in place of the ledger's. */
  entered?: ReadonlyMap<string, number>,
): ReportFigures {
  const t = profitAndLoss.totals;
  const months = new Map<string, FigureRow>();
  for (let d = new Date(`${range.start.slice(0, 7)}-01T00:00:00Z`); ;) {
    const key = d.toISOString().slice(0, 7);
    if (key > range.end.slice(0, 7)) break;
    months.set(key, {
      label: `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      amountCents: 0,
      count: 0,
    });
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }
  if (entered) {
    for (const [key, cents] of entered) {
      const row = months.get(key);
      if (row) row.amountCents = (row.amountCents ?? 0) + cents;
    }
  }
  for (const l of entered ? [] : lines) {
    const row = l.on ? months.get(l.on.slice(0, 7)) : undefined;
    if (!row || l.status === 'EXCLUDED') continue;
    row.amountCents = (row.amountCents ?? 0) + netOf(l);
    row.count = (row.count ?? 0) + 1;
  }
  const count = (status: string) => lines.filter((l) => l.status === status).length;
  const net = t['netIncomeCents'] ?? 0;
  return {
    type,
    basis: 'CASH',
    basisNote: profitAndLoss.basisNote,
    // The days are the period the preview and each version carry, so no note repeats them.
    notes: profitAndLoss.notes,
    source: profitAndLoss.source,
    lineCount: profitAndLoss.lineCount,
    sections: [
      {
        title: 'Profit & Loss',
        rows: [
          { label: 'Income', amountCents: t['incomeCents'] ?? 0 },
          { label: 'Cost of Goods Sold', amountCents: t['costOfGoodsCents'] ?? 0 },
          { label: 'Expenses', amountCents: t['expensesCents'] ?? 0 },
          { label: 'Net Income', amountCents: net },
        ],
        totalCents: net,
      },
      { title: 'Net Income by Month', rows: [...months.values()], totalCents: net },
      {
        title: 'Ledger',
        rows: [
          { label: 'Lines', count: lines.length },
          { label: 'Uncategorized', count: count('UNCATEGORIZED') },
          { label: 'Needs review', count: count('NEEDS_REVIEW') },
          { label: 'Excluded', count: count('EXCLUDED') },
        ],
        totalCents: 0,
      },
    ],
    totals: {
      incomeCents: t['incomeCents'] ?? 0,
      costOfGoodsCents: t['costOfGoodsCents'] ?? 0,
      expensesCents: t['expensesCents'] ?? 0,
      netIncomeCents: net,
      months: months.size,
      uncategorized: count('UNCATEGORIZED'),
    },
  };
}
