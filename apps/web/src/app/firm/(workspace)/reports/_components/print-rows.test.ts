import type { ReportResult, ReportTableRow } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { PRINT_ROWS, printScope, rowsToPrint } from './print-rows';

// RP-Y09 (Octavia, Oct 28): a printed report has every row and says what it covers.

const row = (n: number): ReportTableRow => ({ cells: { name: `Fake ${n}` }, links: [] });
/** A run of `total` rows, answered a page at a time as the API does. */
const runOf = (total: number) => {
  const asked: number[] = [];
  const run = (page: number, pageSize: number) => {
    asked.push(page);
    const from = (page - 1) * pageSize;
    const rows = Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) =>
      row(from + i + 1),
    );
    return Promise.resolve({ table: { rows, total, page, pageSize } } as unknown as ReportResult);
  };
  return { run, asked };
};

describe('rowsToPrint', () => {
  it('gathers every page, a hundred rows at a time', async () => {
    const { run, asked } = runOf(250);
    const rows = await rowsToPrint(run);
    expect(rows).toHaveLength(250);
    expect(rows.at(-1)?.cells['name']).toBe('Fake 250');
    expect(asked).toEqual([1, 2, 3]);
  });

  it('asks once for a short report, and once for an empty one', async () => {
    for (const total of [7, 0]) {
      const { run, asked } = runOf(total);
      expect(await rowsToPrint(run)).toHaveLength(total);
      expect(asked).toEqual([1]);
    }
  });

  it('stops at an exact page and at the print limit', async () => {
    const exact = runOf(200);
    expect(await rowsToPrint(exact.run)).toHaveLength(200);
    expect(exact.asked).toEqual([1, 2]);
    const big = runOf(5_000);
    expect(await rowsToPrint(big.run)).toHaveLength(PRINT_ROWS);
    expect(big.asked).toHaveLength(PRINT_ROWS / 100);
  });
});

describe('printScope', () => {
  const text = (r: { from: string; to: string }) => `${r.from} to ${r.to}`;
  const range = {
    from: '2026-01-01',
    to: '2026-03-31',
    timezone: 'America/New_York',
    label: 'This Quarter',
  };

  it('names the range with its zone, the comparison, the filters and the search', () => {
    expect(
      printScope(
        {
          range,
          comparisonRange: { ...range, from: '2025-10-01', to: '2025-12-31', label: 'Previous' },
          chips: [
            { field: 'status', label: 'Status:', value: 'Paid' },
            { field: 'client', label: 'Client contains', value: 'Jamie' },
          ],
        },
        'INV-1',
        text,
      ),
    ).toEqual([
      'This Quarter: 2026-01-01 to 2026-03-31 (America/New_York)',
      'Compared with 2025-10-01 to 2025-12-31',
      'Filters: Status: Paid; Client contains Jamie',
      'Search: “INV-1”',
    ]);
  });

  it('says when nothing narrows it', () => {
    expect(printScope({ range, comparisonRange: null, chips: [] }, '', text)).toEqual([
      'This Quarter: 2026-01-01 to 2026-03-31 (America/New_York)',
      'No filters',
    ]);
  });
});
