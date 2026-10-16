'use client';
import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { Pagination } from './pagination';
import { EmptyState, Skeleton } from './states';

export interface Column<T> {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  sortable?: boolean;
  className?: string;
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
  /** With offset paging: numbered pages and "Showing 1 – 8 of 127". */
  total?: number;
  onPage?: (page: number) => void;
}
/** Row checkboxes. The header box selects or clears the rows on screen. */
export interface TableSelection {
  selected: string[];
  onChange: (keys: string[]) => void;
}
export interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  pageSize?: number;
  server?: TableServerControl;
  showPagination?: boolean;
  tableClassName?: string;
  emptyTitle?: string;
  emptyText?: string;
  emptyAction?: ReactNode;
  selection?: TableSelection;
  /** The last "Actions" column: icon buttons and the row's menu. */
  rowActions?: (row: T) => ReactNode;
  /** The plural in "Showing 1 – 8 of 127 clients". */
  noun?: string;
  /** The firm workspace lists' 12px text and slim header band. */
  dense?: boolean;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
}
const cellX = 'px-3 first:pl-4 last:pr-4';
export function Table<T>({
  rows,
  columns,
  rowKey,
  caption,
  loading,
  pageSize = 10,
  server,
  showPagination = true,
  tableClassName = '',
  emptyTitle = 'No records yet',
  emptyText = 'Records will appear here when available.',
  emptyAction,
  selection,
  rowActions,
  noun = 'records',
  dense,
  pageSizes,
  onPageSize,
}: TableProps<T>) {
  const [localSort, setLocalSort] = useState<TableSort>();
  const sort = server ? server.sort : localSort;
  const [page, setPage] = useState(0);
  const size = Math.max(1, Math.floor(pageSize));
  const total = server ? server.total : rows.length;
  const pages = Math.max(1, Math.ceil((total ?? 0) / size));
  const current = server ? server.page - 1 : Math.min(page, pages - 1);
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
  const shown = server ? rows : ordered.slice(current * size, (current + 1) * size);
  const keys = shown.map(rowKey);
  const picked = new Set(selection?.selected);
  const all = keys.length > 0 && keys.every((key) => picked.has(key));
  function toggle(id: string) {
    const next = { id, descending: sort?.id === id && !sort.descending };
    if (server) {
      server.onSort(next);
      return;
    }
    setLocalSort(next);
    setPage(0);
  }
  function pick(next: string[], on: boolean) {
    if (!selection) return;
    const rest = selection.selected.filter((key) => !next.includes(key));
    selection.onChange(on ? [...rest, ...next] : rest);
  }
  function goTo(next: number) {
    if (!server) setPage(next - 1);
    else if (server.onPage) server.onPage(next);
    else (next > server.page ? server.onNext : server.onPrevious)();
  }
  if (!loading && !rows.length)
    return <EmptyState title={emptyTitle} description={emptyText} action={emptyAction} />;
  const check = 'size-4 cursor-pointer rounded-sm';
  const head = dense ? 'py-2 font-medium' : 'py-3 font-semibold';
  const from = current * size + 1;
  const table = (
    <div className="overflow-x-auto">
      <table
        className={`w-full text-left text-text ${dense ? 'text-xs' : 'text-sm'} ${tableClassName}`}
      >
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-table-head text-text">
          <tr className="[&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg">
            {selection ? (
              <th scope="col" className={`w-10 ${dense ? 'py-2' : 'py-3'} ${cellX}`}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  className={check}
                  checked={all}
                  ref={(box) => {
                    if (box) box.indeterminate = !all && keys.some((key) => picked.has(key));
                  }}
                  onChange={(event) => pick(keys, event.target.checked)}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const sorted = sort?.id === column.id;
              const Caret = sorted ? (sort.descending ? CaretDown : CaretUp) : CaretUpDown;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={sorted ? (sort.descending ? 'descending' : 'ascending') : undefined}
                  className={`${head} whitespace-nowrap ${cellX} ${column.className ?? ''}`}
                >
                  {column.sortValue || (server && column.sortable) ? (
                    <button
                      type="button"
                      onClick={() => toggle(column.id)}
                      className="inline-flex items-center gap-1.5 rounded-sm font-[inherit] hover:text-action"
                    >
                      {column.label}
                      <Caret
                        aria-hidden
                        weight="bold"
                        className={`size-3.5 ${sorted ? 'text-heading' : 'text-muted'}`}
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
            {rowActions ? (
              <th scope="col" className={`${head} text-right ${cellX}`}>
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {loading
            ? ['a', 'b', 'c', 'd', 'e'].map((row) => (
                <tr key={row} className="border-b border-divider">
                  {[
                    ...(selection ? ['select'] : []),
                    ...columns.map((column) => column.id),
                    ...(rowActions ? ['actions'] : []),
                  ].map((cell) => (
                    <td key={cell} className={`py-4 ${cellX}`}>
                      <Skeleton />
                    </td>
                  ))}
                </tr>
              ))
            : shown.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    data-selected={picked.has(key) || undefined}
                    className="border-b border-divider hover:bg-subtle data-selected:bg-info-soft"
                  >
                    {selection ? (
                      <td className={`py-2.5 ${cellX}`}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${key}`}
                          className={check}
                          checked={picked.has(key)}
                          onChange={(event) => pick([key], event.target.checked)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td key={column.id} className={`py-2.5 ${cellX} ${column.className ?? ''}`}>
                        {column.cell(row)}
                      </td>
                    ))}
                    {rowActions ? (
                      <td className={`py-2.5 ${cellX}`}>
                        <div className="flex items-center justify-end gap-2">{rowActions(row)}</div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {loading ? (
        <div role="status" aria-label={`Loading ${caption}`}>
          {table}
        </div>
      ) : (
        table
      )}
      {showPagination && !loading ? (
        <Pagination
          page={current + 1}
          pageCount={total === undefined ? undefined : pages}
          hasNext={server?.hasNext}
          onPage={goTo}
          summary={
            total === undefined
              ? undefined
              : `Showing ${from} – ${Math.min(from + shown.length - 1, total)} of ${total} ${noun}`
          }
          pageSize={size}
          pageSizes={pageSizes}
          onPageSize={onPageSize}
        />
      ) : null}
    </div>
  );
}
