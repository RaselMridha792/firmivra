'use client';

import type { ReportResult, ReportTableRow } from '@firmivra/types';
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { dateTimeText, formatCell } from './reports-shared';

// RP-Y09 (Octavia's Reports review, Oct 28): a report prints as a document, not as the screen.
// The print copy sits beside the app under <body>; in print only it shows, so the sidebar, the
// header, the controls and the row menus are left out. It carries the title, the range and
// comparison, the filters and search in effect, when it was printed, the KPIs and every row (the
// Print button gathers the pages first; a browser's own print has the page on screen and says so).

const noop = () => () => {};
/** True once in the browser (the print copy goes under <body>, which the server has not). */
const useBrowser = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

export function ReportPrint({
  title,
  result,
  rows,
  columns,
  scope,
  printedAt,
  onPrinted,
}: {
  title: string;
  result: ReportResult;
  /** All rows (the Print button) or null: the page on screen (the browser's own print). */
  rows: ReportTableRow[] | null;
  columns: ReportResult['table']['columns'];
  scope: string[];
  /** When the Print button asked; else the run's own time is given. */
  printedAt?: string;
  /** Set when the Print button asked: prints once the copy is drawn, then clears the request. */
  onPrinted?: (none: undefined) => void;
}) {
  const browser = useBrowser();
  useEffect(() => {
    if (!onPrinted || !rows) return;
    const done = () => onPrinted(undefined);
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [onPrinted, rows]);
  if (!browser) return null;
  const t = result.table;
  const shown = rows ?? t.rows;
  const first = rows ? 1 : (t.page - 1) * t.pageSize + 1;
  const cell = (row: ReportTableRow, key: string, type: string) =>
    key === '_count' || key === '_pct'
      ? formatCell(row.cells[key], key === '_pct' ? 'PERCENT' : 'NUMBER')
      : formatCell(row.cells[key], type);
  return createPortal(
    <div data-print-report className="hidden bg-surface p-6 text-text print:block">
      <style>
        {'@media print { body > *:not([data-print-report]) { display: none !important; } }'}
      </style>
      <article className="flex flex-col gap-4" data-testid="report-print">
        <header className="flex flex-col gap-1 border-b border-border pb-3">
          <h1 className="font-display text-2xl font-bold text-heading">{title}</h1>
          {scope.map((s) => (
            <p key={s} className="text-sm text-text">
              {s}
            </p>
          ))}
          <p className="text-xs text-muted">
            {printedAt
              ? `Printed ${dateTimeText(printedAt)}`
              : `Run ${dateTimeText(result.generatedAt)}`}
          </p>
        </header>
        {result.kpis.length ? (
          <dl className="grid grid-cols-4 gap-3">
            {result.kpis.map((k) => (
              <div key={k.key} className="rounded-control border border-border p-2">
                <dt className="text-xs text-muted">{k.label}</dt>
                <dd className="text-base font-semibold text-heading">
                  {typeof k.value === 'number' ? formatCell(k.value, k.type) : (k.value ?? 'N/A')}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="border-b border-border py-1 pr-2 text-left">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="break-inside-avoid">
                {columns.map((c) => (
                  <td key={c.key} className="border-b border-border py-1 pr-2 align-top">
                    {cell(row, c.key, c.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {t.totals ? (
            <tfoot>
              <tr className="font-semibold">
                {columns.map((c, i) => (
                  <td key={c.key} className="py-1 pr-2">
                    {i === 0
                      ? 'Total'
                      : t.totals?.[c.key] !== undefined
                        ? formatCell(t.totals[c.key], c.type)
                        : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        <p className="text-xs text-muted" data-testid="print-rows">
          {shown.length === t.total
            ? `All ${t.total.toLocaleString('en-US')} rows.`
            : rows
              ? `The first ${shown.length.toLocaleString('en-US')} of ${t.total.toLocaleString('en-US')} rows: export the PDF for every row.`
              : `Rows ${first.toLocaleString('en-US')} to ${(first + shown.length - 1).toLocaleString('en-US')} of ${t.total.toLocaleString('en-US')}: the report's Print button prints every row.`}
        </p>
      </article>
    </div>,
    document.body,
  );
}
