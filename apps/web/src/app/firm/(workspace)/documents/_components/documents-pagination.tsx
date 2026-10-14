import { Select } from '@firmivra/ui';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

const PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * The design's numbered pager (1 2 3 4 5 ... 25) assumes random-access paging and a known total;
 * the API gives neither (a cursor and `nextCursor` only, no total count). Previous/Next and "N per
 * page" are real; the page number is a local count of pages actually visited, not a fixed total
 * (R34 PR: no invented "of 248" or "25" page count).
 */
export function DocumentsPagination({
  count,
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageSize,
  onPageSizeChange,
}: {
  count: number;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-text"
      data-testid="documents-pagination"
    >
      <p aria-live="polite">
        Showing {count} document{count === 1 ? '' : 's'} on this page
      </p>
      <nav aria-label="Document pages" className="flex items-center gap-2">
        <button
          type="button"
          disabled={!hasPrevious}
          onClick={onPrevious}
          aria-label="Previous page"
          data-testid="documents-previous"
          className="inline-flex size-9 items-center justify-center rounded-control border border-border text-text disabled:text-muted"
        >
          <CaretLeft weight="bold" className="size-4" aria-hidden="true" />
        </button>
        <span
          className="inline-flex size-9 items-center justify-center rounded-control bg-folder-surface font-semibold text-action"
          data-testid="documents-page-number"
        >
          {page}
        </span>
        <button
          type="button"
          disabled={!hasNext}
          onClick={onNext}
          aria-label="Next page"
          data-testid="documents-next"
          className="inline-flex size-9 items-center justify-center rounded-control border border-border text-text disabled:text-muted"
        >
          <CaretRight weight="bold" className="size-4" aria-hidden="true" />
        </button>
      </nav>
      <div className="w-40">
        <Select
          label="Rows per page"
          data-testid="documents-page-size"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n} per page` }))}
        />
      </div>
    </div>
  );
}
