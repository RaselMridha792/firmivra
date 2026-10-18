'use client';

import { ActionMenu, Skeleton, type ActionMenuSection } from '@firmivra/ui';
import { CaretDown, CaretLeft, CaretRight, CaretUp, DotsThree } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { QuietLine, quietErrorText } from './billing-parts';

/** The Billing lists' table, pager and row menu, after the dashboard design. */

/** A column: header text, the cell, and the sort key it sorts by (if any). */
export interface BillingColumn<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** The query's sort value; the header becomes a sort button. */
  sort?: string;
  align?: 'left' | 'right' | 'center';
  /** Extra classes for the column's cells, e.g. `hidden 2xl:table-cell`. */
  className?: string;
}
/** The current sort: a column's `sort` value and its direction. */
export interface BillingSort {
  sort: string;
  descending: boolean;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/**
 * A bordered list table. Loading draws skeleton rows; `error` and an empty list draw one quiet
 * line inside the same frame, so the table's header always shows. `dense` and `flush` are opt-in
 * for a wide list in a card (Credit Notes).
 */
export function BillingTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyText,
  sort,
  onSort,
  actions,
  selection,
  testId,
  dense = false,
  flush = false,
}: {
  caption: string;
  columns: BillingColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  emptyText: string;
  sort?: BillingSort;
  onSort?: (sort: BillingSort) => void;
  /** The last "Actions" cell (a RowMenu). */
  actions?: (row: T) => ReactNode;
  /** Row checkboxes (Recurring). */
  selection?: { selected: string[]; onChange: (keys: string[]) => void; label: (row: T) => string };
  testId?: string;
  /** Denser cells (px-3), so a wide list keeps every column inside its card at 1440 px. */
  dense?: boolean;
  /**
   * The table sits flush in its card: no border or rounded box of its own, a line under the last
   * row, and a sideways scroll inside the card below 1440 px (where it fits, row menus are not
   * clipped), so a wide list never widens the page.
   */
  flush?: boolean;
}) {
  const span = columns.length + (actions ? 1 : 0) + (selection ? 1 : 0);
  const keys = rows.map(rowKey);
  const picked = new Set(selection?.selected ?? []);
  const all = keys.length > 0 && keys.every((key) => picked.has(key));
  const inset = dense ? 'px-3' : 'px-4';
  const cell = `${inset} py-3`;
  return (
    <div
      data-testid={testId}
      className={
        flush
          ? 'min-w-0 overflow-x-auto rounded-t-xl border-b border-divider min-[1440px]:overflow-visible'
          : 'min-w-0 overflow-x-auto rounded-xl border border-divider bg-surface xl:overflow-visible'
      }
    >
      <table className="w-full min-w-3xl border-collapse text-sm text-text">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-heading">
          <tr>
            {selection ? (
              <th scope="col" className={`w-12 rounded-tl-xl bg-table-head ${cell}`}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  className="size-5 rounded-sm align-middle"
                  checked={all}
                  onChange={(event) =>
                    selection.onChange(
                      event.target.checked
                        ? [...new Set([...selection.selected, ...keys])]
                        : selection.selected.filter((key) => !keys.includes(key)),
                    )
                  }
                />
              </th>
            ) : null}
            {columns.map((column, index) => {
              const sorted = sort !== undefined && column.sort === sort.sort;
              const descending = sorted && (sort?.descending ?? false);
              const Caret = descending ? CaretDown : CaretUp;
              const first = index === 0 && !selection;
              const last = index === columns.length - 1 && !actions;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sorted ? (descending ? 'descending' : 'ascending') : undefined}
                  className={`bg-table-head font-semibold whitespace-nowrap ${cell} ${alignClass[column.align ?? 'left']} ${first ? 'rounded-tl-xl' : ''} ${last ? 'rounded-tr-xl' : ''} ${column.className ?? ''}`}
                >
                  {column.sort && onSort ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSort({
                          sort: column.sort ?? '',
                          descending: sorted ? !descending : false,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-sm font-semibold hover:text-action"
                    >
                      {column.label}
                      {sorted ? <Caret aria-hidden weight="bold" className="size-3.5" /> : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            {actions ? (
              <th
                scope="col"
                className={`rounded-tr-xl bg-table-head text-center font-semibold ${cell}`}
              >
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            ['a', 'b', 'c', 'd', 'e'].map((key) => (
              <tr key={key} className="border-t border-divider">
                <td colSpan={span} className={cell}>
                  <Skeleton />
                </td>
              </tr>
            ))
          ) : error || rows.length === 0 ? (
            <tr className="border-t border-divider">
              <td colSpan={span} className={inset}>
                <QuietLine testId={error ? 'table-error' : 'table-empty'}>
                  {error ? quietErrorText(error) : emptyText}
                </QuietLine>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  data-selected={picked.has(key) || undefined}
                  className="border-t border-divider hover:bg-subtle data-selected:bg-info-soft"
                >
                  {selection ? (
                    <td className={cell}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${selection.label(row)}`}
                        className="size-5 rounded-sm align-middle"
                        checked={picked.has(key)}
                        onChange={(event) =>
                          selection.onChange(
                            event.target.checked
                              ? [...selection.selected, key]
                              : selection.selected.filter((value) => value !== key),
                          )
                        }
                      />
                    </td>
                  ) : null}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={`${cell} ${alignClass[column.align ?? 'left']} ${column.className ?? ''}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  {actions ? <td className={`${cell} text-center`}>{actions(row)}</td> : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/** "Showing 1–10 of 12 invoices" and the square page buttons under a list. */
export function BillingPager({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  onPage,
  loading,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** The plural ("invoices"); also names the buttons ("Next invoices page"). */
  noun: string;
  onPage: (page: number) => void;
  loading?: boolean;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (value) => Math.abs(value - page) <= 2 || value === 1 || value === pageCount,
  );
  const box =
    'inline-flex size-10 items-center justify-center rounded-lg border text-sm disabled:cursor-not-allowed disabled:text-disabled-text';
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite" className="text-sm text-muted md:text-base">
        {loading
          ? ' '
          : total === 0
            ? `Showing 0 ${noun}`
            : `Showing ${first}–${last} of ${total} ${noun}`}
      </p>
      <nav
        aria-label={`${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} pages`}
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-label={`Previous ${noun} page`}
          disabled={loading || page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${box} border-divider bg-surface text-heading hover:bg-canvas`}
        >
          <CaretLeft aria-hidden weight="bold" className="size-4" />
        </button>
        {pages.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`Page ${value}`}
            aria-current={value === page ? 'page' : undefined}
            disabled={loading}
            onClick={() => onPage(value)}
            className={`${box} ${value === page ? 'border-action bg-action font-semibold text-on-action' : 'border-divider bg-surface text-heading hover:bg-canvas'}`}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          aria-label={`Next ${noun} page`}
          disabled={loading || page >= pageCount}
          onClick={() => onPage(page + 1)}
          className={`${box} border-divider bg-surface text-heading hover:bg-canvas`}
        >
          <CaretRight aria-hidden weight="bold" className="size-4" />
        </button>
      </nav>
    </div>
  );
}

/** The "•••" button of a row and its grouped menu (the kit's ActionMenu, borderless). */
export function RowMenu({ label, sections }: { label: string; sections: ActionMenuSection[] }) {
  return (
    <ActionMenu
      label={label}
      align="right"
      sections={sections}
      trigger={<DotsThree aria-hidden weight="bold" className="size-6 text-heading" />}
      className="text-left [&>button]:border-transparent [&>button]:bg-transparent [&>button>svg:last-child]:hidden"
    />
  );
}
