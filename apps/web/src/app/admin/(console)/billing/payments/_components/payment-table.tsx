'use client';

import { Skeleton } from '@firmivra/ui';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { PaymentStatus } from '../../../../../../mocks/admin-billing';
import { PAYMENT_STATUS_LABELS } from '../../_components/billing-labels';
import {
  PAYMENT_STATUS_TONES,
  QuietLine,
  quietErrorText,
  type BadgeTone,
} from '../../_components/billing-parts';
import type { BillingColumn, BillingSort } from '../../_components/billing-table';

/**
 * The Payments list's table: the shared Billing table's look made denser (smaller text and
 * padding, headers that may wrap), as the design draws nine columns beside the details panel.
 * The row whose details are open is highlighted.
 */

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  purple: 'bg-purple-soft text-purple',
  neutral: 'bg-disabled text-muted',
};

/** The design's small status chip for this table. */
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap 2xl:text-sm ${TONE_CLASSES[PAYMENT_STATUS_TONES[status]]}`}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
}

export function PaymentTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  activeKey,
  loading,
  error,
  emptyText,
  sort,
  onSort,
  actions,
  testId,
}: {
  caption: string;
  columns: BillingColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** The row shown in the details panel. */
  activeKey?: string | null;
  loading?: boolean;
  error?: unknown;
  emptyText: string;
  sort?: BillingSort;
  onSort?: (sort: BillingSort) => void;
  actions: (row: T) => ReactNode;
  testId?: string;
}) {
  const span = columns.length + 1;
  const cell = 'px-2.5 py-2.5 2xl:px-3';
  return (
    <div
      data-testid={testId}
      className="min-w-0 overflow-x-auto rounded-xl border border-divider bg-surface xl:overflow-visible"
    >
      <table className="w-full min-w-3xl border-collapse text-xs text-text xl:min-w-0 2xl:text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-heading">
          <tr>
            {columns.map((column, index) => {
              const sorted = sort !== undefined && column.sort === sort.sort;
              const descending = sorted && (sort?.descending ?? false);
              const Caret = descending ? CaretDown : CaretUp;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sorted ? (descending ? 'descending' : 'ascending') : undefined}
                  className={`bg-table-head align-bottom font-semibold ${cell} ${alignClass[column.align ?? 'left']} ${index === 0 ? 'rounded-tl-xl' : ''} ${column.className ?? ''}`}
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
                      className="inline-flex items-center gap-1 rounded-sm text-left font-semibold hover:text-action"
                    >
                      {column.label}
                      {sorted ? <Caret aria-hidden weight="bold" className="size-3" /> : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            <th
              scope="col"
              className={`rounded-tr-xl bg-table-head text-center align-bottom font-semibold ${cell}`}
            >
              Actions
            </th>
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
              <td colSpan={span} className="px-4">
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
                  data-active={key === activeKey || undefined}
                  className="border-t border-divider hover:bg-subtle data-active:bg-info-soft"
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={`${cell} ${alignClass[column.align ?? 'left']} ${column.className ?? ''}`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                  <td className={`${cell} text-center`}>{actions(row)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
