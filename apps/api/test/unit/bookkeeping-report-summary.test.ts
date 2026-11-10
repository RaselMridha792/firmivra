import { describe, expect, it } from 'vitest';
import { type FigureLine, reportFigures } from '../../src/bookkeeping/report-figures.js';
import { summaryFigures, summaryRange } from '../../src/bookkeeping/report-figures-summary.js';

// BK-RPT (Rasel, Nov 10): the Quarterly Review and the Year to Date Summary, from the ledger.

const bank = { id: 'a1', name: 'Fake Checking', type: 'BANK' };
const sales = { id: 'c1', name: 'Fake Sales', type: 'INCOME' };
const rent = { id: 'c2', name: 'Fake Rent', type: 'EXPENSE' };
const goods = { id: 'c3', name: 'Fake Materials', type: 'COST_OF_GOODS' };
const line = (on: string, over: Partial<FigureLine>): FigureLine => ({
  amountCents: 0,
  direction: 'DEBIT',
  status: 'CATEGORIZED',
  kind: 'STANDARD',
  account: bank,
  category: null,
  splits: [],
  on,
  ...over,
});

describe('summaryRange', () => {
  it('a quarter by its period, or by its label either way round', () => {
    const period = { start: '2026-07-01', end: '2026-09-30' };
    expect(summaryRange('QUARTERLY_REVIEW', period, 'anything', '2026-11-10')).toEqual(period);
    expect(summaryRange('QUARTERLY_REVIEW', null, 'Q3 2026', '2026-11-10')).toEqual(period);
    expect(summaryRange('QUARTERLY_REVIEW', null, '2026 q1', '2026-11-10')).toEqual({
      start: '2026-01-01',
      end: '2026-03-31',
    });
    expect(summaryRange('QUARTERLY_REVIEW', null, 'Q4 2024', '2026-11-10')?.end).toBe('2024-12-31');
    expect(summaryRange('QUARTERLY_REVIEW', null, 'Third quarter', '2026-11-10')).toBeNull();
  });

  it('the year to date by its period, or by its label (this year up to today)', () => {
    expect(
      summaryRange(
        'YEAR_TO_DATE_SUMMARY',
        { start: '2026-12-01', end: '2026-12-31' },
        '',
        '2026-11-10',
      ),
    ).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(summaryRange('YEAR_TO_DATE_SUMMARY', null, '2026', '2026-11-10')).toEqual({
      start: '2026-01-01',
      end: '2026-11-10',
    });
    expect(summaryRange('YEAR_TO_DATE_SUMMARY', null, 'FY 2025', '2026-11-10')).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(summaryRange('YEAR_TO_DATE_SUMMARY', null, '2027', '2026-11-10')).toEqual({
      start: '2027-01-01',
      end: '2027-12-31',
    });
    expect(summaryRange('YEAR_TO_DATE_SUMMARY', null, 'This year', '2026-11-10')).toBeNull();
  });
});

describe('summaryFigures', () => {
  const lines = [
    line('2026-07-03', { amountCents: 100_000, direction: 'CREDIT', category: sales }),
    line('2026-07-20', { amountCents: 30_000, category: rent }),
    line('2026-08-02', { amountCents: 10_000, category: goods }),
    line('2026-08-15', { amountCents: 5_000, status: 'UNCATEGORIZED' }),
    line('2026-09-01', { amountCents: 999, status: 'EXCLUDED', category: rent }),
    line('2026-09-09', { amountCents: 20_000, kind: 'TRANSFER' }),
  ];
  const range = { start: '2026-07-01', end: '2026-09-30' };
  const f = summaryFigures(
    'QUARTERLY_REVIEW',
    range,
    reportFigures('PROFIT_LOSS', 'CASH', lines),
    lines,
  );

  it('agrees with the Profit & Loss for the same days', () => {
    expect(f.totals).toMatchObject({
      incomeCents: 100_000,
      costOfGoodsCents: 10_000,
      expensesCents: 30_000,
      netIncomeCents: 60_000,
      months: 3,
      uncategorized: 1,
    });
    expect(f.sections[0]!.rows.at(-1)).toEqual({ label: 'Net Income', amountCents: 60_000 });
  });

  it('nets each month, and the months add up to the period', () => {
    const months = f.sections[1]!.rows;
    expect(months).toEqual([
      { label: 'Jul 2026', amountCents: 70_000, count: 2 },
      { label: 'Aug 2026', amountCents: -10_000, count: 2 },
      { label: 'Sep 2026', amountCents: 0, count: 1 },
    ]);
    expect(months.reduce((n, m) => n + (m.amountCents ?? 0), 0)).toBe(60_000);
  });

  it('counts what the ledger still needs', () => {
    expect(f.sections[2]!.rows).toEqual([
      { label: 'Lines', count: 6 },
      { label: 'Uncategorized', count: 1 },
      { label: 'Needs review', count: 0 },
      { label: 'Excluded', count: 1 },
    ]);
    expect(f.notes).toEqual([]);
    expect(f.type).toBe('QUARTERLY_REVIEW');
  });
});
