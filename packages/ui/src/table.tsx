'use client';

import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { EmptyState, Skeleton } from './states';

export interface Column<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
}
export function Table<T>({
  rows,
  columns,
  rowKey,
  caption,
  loading = false,
  pageSize = 10,
  emptyTitle = 'No records yet',
  emptyDescription = 'Records will appear here when they are available.',
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [sort, setSort] = useState<{ id: string; direction: 1 | -1 }>();
  const [page, setPage] = useState(0);
  const column = columns.find((c) => c.id === sort?.id);
  const sorter = column?.sortValue;
  const sorted =
    sorter && sort
      ? [...rows].sort((a, b) => {
          const av = sorter(a);
          const bv = sorter(b);
          return (
            (typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv))) * sort.direction
          );
        })
      : rows;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  if (loading)
    return (
      <div role="status" aria-label={`Loading ${caption}`} className="space-y-4 p-6">
        {['a', 'b', 'c'].map((id) => (
          <Skeleton key={id} className="h-11" />
        ))}
      </div>
    );
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-folder-surface text-heading">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={
                    sort?.id === c.id
                      ? sort.direction === 1
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className="whitespace-nowrap px-4 py-3"
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className="min-h-11 font-semibold"
                      onClick={() => {
                        setSort({
                          id: c.id,
                          direction: sort?.id === c.id && sort.direction === 1 ? -1 : 1,
                        });
                        setPage(0);
                      }}
                    >
                      {c.label}{' '}
                      <span aria-hidden="true">
                        {sort?.id === c.id ? (sort.direction === 1 ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row) => (
              <tr
                key={rowKey(row)}
                className="border-t border-border even:bg-subtle hover:bg-folder-surface"
              >
                {columns.map((c) => (
                  <td key={c.id} className="px-4 py-3">
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
        <p aria-live="polite">
          Page {currentPage + 1} of {pages} · {rows.length} records
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={currentPage >= pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
