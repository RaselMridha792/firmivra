'use client';

import { Skeleton, type ActionMenuSection } from '@firmivra/ui';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type { BillingEstimate, EstimateSort } from '../../../../../../mocks/admin-billing';
import { formatDate, formatMoney } from '../../_components/billing-format';
import { EstimateStatusBadge, QuietLine, quietErrorText } from '../../_components/billing-parts';
import { RowMenu, type BillingSort } from '../../_components/billing-table';

/**
 * The estimate list (firmivra-estimates-dashboard.jpg). A local variant of the Billing table:
 * the design's tighter cells, so the eight columns fit beside the details panel at 1440 px, and
 * the row whose details are open is highlighted.
 */

interface Column {
  id: string;
  label: string;
  sort: EstimateSort;
  cell: (row: BillingEstimate) => ReactNode;
}

export function EstimateTable({
  rows,
  loading,
  error,
  emptyText,
  sort,
  onSort,
  selectedId,
  onSelect,
  menu,
}: {
  rows: BillingEstimate[];
  loading: boolean;
  error: unknown;
  emptyText: string;
  sort: BillingSort | undefined;
  onSort: (sort: BillingSort) => void;
  /** The estimate in the details panel. */
  selectedId: string | null;
  onSelect: (row: BillingEstimate) => void;
  menu: (row: BillingEstimate) => ActionMenuSection[];
}) {
  const columns: Column[] = [
    {
      id: 'number',
      label: 'Estimate #',
      sort: 'number',
      cell: (row) => (
        <button
          type="button"
          aria-label={`${row.number}, show details`}
          aria-current={row.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(row)}
          className="rounded-sm text-left whitespace-nowrap text-heading hover:text-action hover:underline"
        >
          {row.number}
        </button>
      ),
    },
    // At most two lines each beside the details panel; the full name on hover.
    {
      id: 'client',
      label: 'Client / Event',
      sort: 'client',
      cell: (row) => (
        <span title={row.clientName} className="line-clamp-2 break-words">
          {row.clientName}
        </span>
      ),
    },
    {
      id: 'firm',
      label: 'Firm',
      sort: 'firm',
      cell: (row) => (
        <span title={row.firmName} className="line-clamp-2 break-words">
          {row.firmName}
        </span>
      ),
    },
    {
      id: 'issueDate',
      label: 'Issue Date',
      sort: 'issueDate',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.issueDate)}</span>,
    },
    {
      id: 'expirationDate',
      label: 'Expiration Date',
      sort: 'expirationDate',
      cell: (row) => <span className="whitespace-nowrap">{formatDate(row.expirationDate)}</span>,
    },
    {
      id: 'amount',
      label: 'Amount',
      sort: 'amount',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatMoney(row.totalCents, row.currency)}</span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sort: 'status',
      cell: (row) => <EstimateStatusBadge status={row.status} />,
    },
  ];
  const cell = 'px-3 py-2';
  const span = columns.length + 1;
  return (
    <div
      data-testid="estimate-table"
      className="min-w-0 overflow-x-auto rounded-xl border border-divider bg-surface xl:overflow-visible"
    >
      <table className="w-full min-w-3xl border-collapse text-sm text-text">
        <caption className="sr-only">Estimates</caption>
        <thead className="text-heading">
          <tr>
            {columns.map((column, index) => {
              const sorted = sort?.sort === column.sort;
              const descending = sorted && (sort?.descending ?? false);
              const Caret = descending ? CaretDown : CaretUp;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sorted ? (descending ? 'descending' : 'ascending') : undefined}
                  className={`bg-table-head px-3 py-3 text-left font-semibold whitespace-nowrap ${index === 0 ? 'rounded-tl-xl' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      onSort({ sort: column.sort, descending: sorted ? !descending : false })
                    }
                    className="inline-flex items-center gap-1 rounded-sm font-semibold hover:text-action"
                  >
                    {column.label}
                    {sorted ? <Caret aria-hidden weight="bold" className="size-3.5" /> : null}
                  </button>
                </th>
              );
            })}
            <th
              scope="col"
              className="rounded-tr-xl bg-table-head px-3 py-3 text-center font-semibold"
            >
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            ['a', 'b', 'c', 'd', 'e'].map((key) => (
              <tr key={key} className="border-t border-divider">
                <td colSpan={span} className="px-3 py-3">
                  <Skeleton />
                </td>
              </tr>
            ))
          ) : error || rows.length === 0 ? (
            <tr className="border-t border-divider">
              <td colSpan={span} className="px-3">
                <QuietLine testId={error ? 'table-error' : 'table-empty'}>
                  {error ? quietErrorText(error) : emptyText}
                </QuietLine>
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                data-selected={row.id === selectedId || undefined}
                className="border-t border-divider hover:bg-subtle data-selected:bg-info-soft"
              >
                {columns.map((column) => (
                  <td key={column.id} className={cell}>
                    {column.cell(row)}
                  </td>
                ))}
                <td className={`${cell} text-center`}>
                  <RowMenu label={`Actions for ${row.number}`} sections={menu(row)} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
