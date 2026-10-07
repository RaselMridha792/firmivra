'use client';
import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { EmptyState, Skeleton } from './states';

export interface Column<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  sortable?: boolean;
}
export interface TableSort {
  id: string;
  descending: boolean;
}
export interface TableServerControl {
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  sort?: TableSort;
  onSort: (sort: TableSort) => void;
}
export interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  pageSize?: number;
  server?: TableServerControl;
  emptyTitle?: string;
  emptyText?: string;
}
export function Table<T>({
  rows,
  columns,
  rowKey,
  caption,
  loading,
  pageSize = 10,
  server,
  emptyTitle = 'No records yet',
  emptyText = 'Records will appear here when available.',
}: TableProps<T>) {
  const [localSort, setLocalSort] = useState<TableSort>();
  const sort = server ? server.sort : localSort;
  const [page, setPage] = useState(0);
  const size = Math.max(1, Math.floor(pageSize));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const sorter = columns.find((column) => column.id === sort?.id)?.sortValue;
  const ordered =
    !server && sorter
      ? [...rows].sort((a, b) => {
          const left = sorter(a),
            right = sorter(b);
          const compared =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right));
          return compared * (sort?.descending ? -1 : 1);
        })
      : rows;
  const direction = sort?.descending ? 'descending' : 'ascending';
  function toggle(id: string) {
    const next = { id, descending: sort?.id === id && !sort.descending };
    if (server) {
      server.onSort(next);
      return;
    }
    setLocalSort(next);
    setPage(0);
  }
  if (loading)
    return (
      <div role="status" aria-label={`Loading ${caption}`}>
        <Skeleton />
      </div>
    );
  if (!rows.length) return <EmptyState title={emptyTitle} description={emptyText} />;
  return (
    <div>
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-folder-surface text-heading">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sort?.id === column.id ? direction : undefined}
                  className="px-4 py-3"
                >
                  {column.sortValue || (server && column.sortable) ? (
                    <Button variant="ghost" onClick={() => toggle(column.id)}>
                      {column.label}
                    </Button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(server ? rows : ordered.slice(current * size, (current + 1) * size)).map((row) => (
              <tr key={rowKey(row)} className="border-t border-border even:bg-subtle">
                {columns.map((column) => (
                  <td key={column.id} className="px-4 py-3">
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
        <p aria-live="polite">
          {server
            ? `Page ${server.page}`
            : `Page ${current + 1} of ${pages} · ${rows.length} records`}
        </p>
        <Button
          variant="secondary"
          disabled={server ? !server.hasPrevious : !current}
          onClick={server ? server.onPrevious : () => setPage(current - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={server ? !server.hasNext : current >= pages - 1}
          onClick={server ? server.onNext : () => setPage(current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
