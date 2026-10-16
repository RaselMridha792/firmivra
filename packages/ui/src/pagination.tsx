'use client';

import { CaretDown, CaretLeft, CaretRight } from '@phosphor-icons/react';

export interface PaginationProps {
  /** 1-based. */
  page: number;
  onPage: (page: number) => void;
  /** Unknown with cursor paging: "Page n" sits between the arrows and `hasNext` drives Next. */
  pageCount?: number;
  hasNext?: boolean;
  /** "Showing 1 – 8 of 127 clients". */
  summary?: string;
  pageSize?: number;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
}

const boxBase =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-sm';
const box = `${boxBase} border-divider bg-surface text-text hover:bg-canvas disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-surface`;

/** First, last and the five pages around the current one, with gaps between (1 2 3 4 5 … 16). */
export function pageList(page: number, count: number): (number | null)[] {
  const start = Math.max(1, Math.min(page - 2, count - 4));
  const end = Math.min(count, start + 4);
  const middle = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  return [
    ...(start > 1 ? [1, ...(start > 2 ? [null] : [])] : []),
    ...middle,
    ...(end < count ? [...(end < count - 1 ? [null] : []), count] : []),
  ];
}

/** The list footer: summary on the left; arrows, page numbers and "Show n per page" on the right. */
export function Pagination(props: PaginationProps) {
  const { page, onPage, pageCount, hasNext, summary, pageSize, pageSizes, onPageSize } = props;
  const last = pageCount ? page >= pageCount : !hasNext;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3 text-sm text-muted">
      {summary ? <p aria-live="polite">{summary}</p> : null}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous"
          className={box}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <CaretLeft aria-hidden weight="bold" className="size-3.5" />
        </button>
        {pageCount ? (
          pageList(page, pageCount).map((item, i, list) =>
            item === null ? (
              <span
                key={i < list.length / 2 ? 'gap-start' : 'gap-end'}
                aria-hidden
                className="px-1"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={`Page ${item}`}
                aria-current={item === page ? 'page' : undefined}
                className={
                  item === page
                    ? `${boxBase} border-action bg-action font-semibold text-on-action`
                    : box
                }
                onClick={() => onPage(item)}
              >
                {item}
              </button>
            ),
          )
        ) : (
          <span aria-live="polite" className="px-2 text-text">
            Page {page}
          </span>
        )}
        <button
          type="button"
          aria-label="Next"
          className={box}
          disabled={last}
          onClick={() => onPage(page + 1)}
        >
          <CaretRight aria-hidden weight="bold" className="size-3.5" />
        </button>
      </div>
      {pageSizes && onPageSize ? (
        <label className="flex items-center gap-2">
          Show
          <span className="relative">
            <select
              value={pageSize}
              onChange={(event) => onPageSize(Number(event.target.value))}
              className={`${box} min-h-0 appearance-none pr-6`}
            >
              {pageSizes.map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
            <CaretDown
              aria-hidden
              weight="bold"
              className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2"
            />
          </span>
          per page
        </label>
      ) : null}
    </nav>
  );
}
