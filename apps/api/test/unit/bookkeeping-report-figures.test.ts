import { describe, expect, it } from 'vitest';
import {
  type FigureLine,
  figuresCsv,
  reportFigures,
  totalLabel,
} from '../../src/bookkeeping/report-figures.js';

// BK-RPT part 1: a report's figures from the period's ledger lines (cash basis).

const bank = { id: 'a1', name: 'Fake Checking' };
const card = { id: 'a2', name: 'Fake Card' };
const sales = { id: 'c1', name: 'Fake Sales', type: 'INCOME' };
const goods = { id: 'c2', name: 'Fake Materials', type: 'COST_OF_GOODS' };
const rent = { id: 'c3', name: 'Fake Rent', type: 'EXPENSE' };
const supplies = { id: 'c4', name: 'Fake Supplies', type: 'EXPENSE' };

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
  line({ amountCents: 20_000, category: goods }),
  line({ amountCents: 30_000, category: rent }),
  // A split: 5,000 rent and 3,000 supplies.
  line({
    amountCents: 8_000,
    splits: [
      { amountCents: 5_000, category: rent },
      { amountCents: 3_000, category: supplies },
    ],
  }),
  // A refund received on an expense lowers it.
  line({ amountCents: 1_000, direction: 'CREDIT', category: supplies }),
  // Waiting for a category, a transfer, and an excluded line.
  line({ amountCents: 4_500, status: 'UNCATEGORIZED' }),
  line({ amountCents: 50_000, kind: 'TRANSFER', account: bank }),
  line({ amountCents: 50_000, kind: 'TRANSFER', direction: 'CREDIT', account: card }),
  line({ amountCents: 9_999, status: 'EXCLUDED', category: rent }),
];

describe('reportFigures', () => {
  it('profit and loss: income, cost of goods and expenses by category, splits by their parts', () => {
    const f = reportFigures('PROFIT_LOSS', 'CASH', lines);
    expect(f.sections.map((s) => [s.title, s.totalCents])).toEqual([
      ['Income', 100_000],
      ['Cost of Goods Sold', 20_000],
      ['Expenses', 37_000],
    ]);
    expect(f.sections[2]!.rows).toEqual([
      { label: 'Fake Rent', amountCents: 35_000 },
      { label: 'Fake Supplies', amountCents: 2_000 },
    ]);
    expect(f.totals.netIncomeCents).toBe(43_000);
    // Excluded lines never count.
    expect(f.lineCount).toBe(8);
    expect(f.basisNote).toBeNull();
  });

  it('trial balance: each line two-sided, so debits equal credits', () => {
    const f = reportFigures('TRIAL_BALANCE', 'CASH', lines);
    expect(f.totals.debitsCents).toBe(f.totals.creditsCents);
    const row = (label: string) => f.sections[0]!.rows.find((r) => r.label === label);
    expect(row('Uncategorized')).toMatchObject({ debitCents: 4_500, creditCents: 0 });
    expect(row('Transfers between accounts')).toMatchObject({
      debitCents: 50_000,
      creditCents: 50_000,
    });
    expect(row('Fake Checking')).toMatchObject({ debitCents: 101_000 });
  });

  it('uncategorized and transaction detail: counts and signed totals; accrual says it is cash', () => {
    const u = reportFigures('UNCATEGORIZED', 'ACCRUAL', lines);
    expect(u.lineCount).toBe(1);
    expect(u.sections[0]!.rows).toEqual([
      { label: 'Uncategorized', amountCents: -4_500, count: 1 },
    ]);
    expect(u.basisNote).toMatch(/cash basis/);
    const d = reportFigures('TRANSACTION_DETAIL', 'CASH', lines);
    expect(d.sections[0]!.rows.find((r) => r.label === 'Split')).toEqual({
      label: 'Split',
      amountCents: -8_000,
      count: 1,
    });
    expect(d.totals).toMatchObject({ inCents: 151_000, outCents: 112_500 });
  });

  it('the CSV has every row and the totals, and quotes what it is given', () => {
    const csv = figuresCsv(reportFigures('PROFIT_LOSS', 'ACCRUAL', lines), (v) =>
      v === null ? '' : `"${String(v)}"`,
    );
    expect(csv.split('\r\n')[0]).toBe('"Section","Line","Debit","Credit","Amount","Count"');
    expect(csv).toContain('"Expenses","Fake Rent",,,"350.00",');
    expect(csv).toContain('"Total","Net income",,,"430.00",');
    expect(csv).toContain('"Note","Shown on the cash basis');
  });

  it('says whose figures they are, and leaves totals blank when nothing is recorded (Review 2, RP03)', () => {
    const q = (v: string | number | null) => (v === null ? '' : `"${String(v)}"`);
    const context = {
      client: 'Fake Client',
      period: '2026-09-01 to 2026-09-30',
      basis: 'Cash',
      source: "This client's Firmivra ledger",
    };
    const full = figuresCsv(reportFigures('PROFIT_LOSS', 'CASH', lines), q, context).split('\r\n');
    expect(full.slice(0, 5)).toEqual([
      '"Client","Fake Client"',
      '"Period","2026-09-01 to 2026-09-30"',
      '"Basis","Cash"',
      '"Source","This client\'s Firmivra ledger"',
      expect.stringMatching(/^"Data","\d+ recorded lines"$/),
    ]);
    expect(full[6]).toBe('"Section","Line","Debit","Credit","Amount","Count"');
    const none = figuresCsv(reportFigures('PROFIT_LOSS', 'CASH', []), q, context);
    expect(none).toContain('"Data","Nothing is recorded for this period');
    expect(none).toContain('"Total","Net income",,,,');
    expect(none).not.toMatch(/"0\.00"/);
  });

  it('names each total in words', () => {
    expect(totalLabel('incomeCents')).toBe('Income');
    expect(totalLabel('costOfGoodsCents')).toBe('Cost of goods sold');
    expect(totalLabel('openingBalanceCents')).toBe('Opening balance');
  });
});
