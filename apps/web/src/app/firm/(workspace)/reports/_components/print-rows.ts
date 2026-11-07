import type { ReportResult, ReportTableRow } from '@firmivra/types';

// RP-Y09 (Octavia's Reports review, Oct 28): what a printed report holds, apart from how it is
// drawn (report-print.tsx): every row, gathered a page at a time, and the lines saying what it covers.

/** Rows a print gathers at most: more is for the PDF export. */
export const PRINT_ROWS = 1_000;
const RUN_PAGE = 100;

/** Every row of the run, a hundred at a time, up to PRINT_ROWS. */
export async function rowsToPrint(
  run: (page: number, pageSize: number) => Promise<ReportResult>,
): Promise<ReportTableRow[]> {
  const rows: ReportTableRow[] = [];
  for (let page = 1; rows.length < PRINT_ROWS; page += 1) {
    const r = await run(page, RUN_PAGE);
    rows.push(...r.table.rows);
    if (r.table.rows.length < RUN_PAGE || rows.length >= r.table.total) break;
  }
  return rows.slice(0, PRINT_ROWS);
}

/** What the printed report says it covers (its chips hold More Filters too), in reading order. */
export function printScope(
  r: Pick<ReportResult, 'range' | 'comparisonRange' | 'chips'>,
  search: string,
  rangeText: (r: { from: string; to: string }) => string,
): string[] {
  return [
    `${r.range.label}: ${rangeText(r.range)} (${r.range.timezone})`,
    ...(r.comparisonRange ? [`Compared with ${rangeText(r.comparisonRange)}`] : []),
    ...(r.chips.length
      ? [`Filters: ${r.chips.map((c) => `${c.label} ${c.value}`).join('; ')}`]
      : ['No filters']),
    ...(search ? [`Search: “${search}”`] : []),
  ];
}
