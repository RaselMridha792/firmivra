'use client';

import { Card } from '@firmivra/ui';
import { ArrowRight, ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export { formatPhone } from '../applications/_components/application-cards';

/** Shared parts of the Super Admin lists (Firm Applications, Firms), after the mockups. */

export type StatTone = 'info' | 'success' | 'warning' | 'danger' | 'purple';

const tones: Record<StatTone, string> = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  purple: 'bg-purple-soft text-purple',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  action,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: StatTone;
  /** The card's "View … →" link. */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Card
      variant="elevated"
      className="flex items-center gap-4 !p-5 xl:items-start 2xl:items-center 2xl:gap-5"
    >
      <span
        className={`flex size-13 shrink-0 items-center justify-center rounded-xl 2xl:size-15 ${tones[tone]}`}
      >
        <Icon aria-hidden className="size-7 2xl:size-8" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold text-heading">{value}</span>
        <span className="block text-base text-muted">{label}</span>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-link hover:underline"
          >
            {action.label}
            <ArrowRight aria-hidden className="size-4" />
          </button>
        ) : null}
      </span>
    </Card>
  );
}

/** The header's search box: a magnifier inside, the label read by screen readers only. */
export function SearchBox({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        maxLength={100}
        className="h-11 w-full rounded-control border border-border bg-surface pl-11 pr-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-focus"
        {...props}
      />
    </label>
  );
}

export const selectClass =
  'h-11 rounded-control border border-border bg-surface px-3 text-sm text-text focus:outline-2 focus:outline-focus';

/** A column: its header text, and whether its cells are centred. */
export type ListColumn = { label: string; center?: boolean };

/** The table's frame: header row on bg-canvas, a divider between cells. `#` is the row number. */
export function ListTable({ head, children }: { head: ListColumn[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-4xl border-collapse text-left text-sm text-text">
        <thead className="bg-canvas text-heading">
          <tr>
            {head.map(({ label, center }) => (
              <th
                key={label}
                scope="col"
                className={`whitespace-nowrap px-3 py-4 font-medium ${label === '#' ? 'w-12' : ''} ${center ? 'text-center' : ''}`}
              >
                {label === '#' ? (
                  <>
                    <span aria-hidden>#</span>
                    <span className="sr-only">Row</span>
                  </>
                ) : (
                  label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/** An email that may break only before the @ or, for a very long address, anywhere. */
export function EmailText({ value }: { value: string }) {
  const at = value.lastIndexOf('@');
  if (at <= 0) return <>{value}</>;
  return (
    <>
      {value.slice(0, at)}
      <wbr />
      {value.slice(at)}
    </>
  );
}

/** Email cells: one line when it fits, never wider than the column. */
export const emailCellClass = 'min-w-44 wrap-anywhere';

/** A body cell; every cell after the first draws the divider on its left. */
export const cellClass = 'border-l border-border px-3 py-4';
export const firstCellClass = 'px-3 py-4 text-center';

/** "Showing 1–5 of 8 …" and the chevron pager under a list. */
export function ListPager({
  noun,
  first,
  last,
  total,
  page,
  pageCount,
  onPage,
}: {
  /** "applications" or "firms": also names the buttons ("Next firms page"). */
  noun: string;
  first: number;
  last: number;
  total: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (value) => Math.abs(value - page) <= 2,
  );
  const button =
    'inline-flex size-10 items-center justify-center rounded-control border text-sm disabled:cursor-not-allowed disabled:text-disabled-text';
  return (
    <footer className="flex flex-col gap-3 px-2 sm:flex-row sm:items-center sm:justify-between">
      <p aria-live="polite" className="text-sm text-muted">
        Showing {total === 1 ? 1 : `${first}–${last}`} of {total} {noun}
      </p>
      <nav aria-label={`${noun[0]?.toUpperCase()}${noun.slice(1)} pages`} className="flex gap-2">
        <button
          type="button"
          aria-label={`Previous ${noun} page`}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className={`${button} border-border bg-surface text-text`}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        {pages.map((value) => (
          <button
            key={value}
            type="button"
            aria-current={value === page ? 'page' : undefined}
            aria-label={`Page ${value}`}
            onClick={() => onPage(value)}
            className={`${button} ${value === page ? 'border-action bg-info-soft font-semibold text-action' : 'border-border bg-surface text-text'}`}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          aria-label={`Next ${noun} page`}
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          className={`${button} border-border bg-surface text-text`}
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </nav>
    </footer>
  );
}
