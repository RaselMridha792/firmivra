'use client';

import { Button, DateRangePicker, type DateRange } from '@firmivra/ui';
import { CalendarBlank, CaretDown } from '@phosphor-icons/react';

function formatDate(value: string) {
  if (!value) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US').format(new Date(year, month - 1, day));
}

function rangeLabel(value: DateRange) {
  if (!value.from && !value.to) return 'Date Range';
  if (value.from && value.to) return `${formatDate(value.from)} – ${formatDate(value.to)}`;
  return value.from ? `From ${formatDate(value.from)}` : `To ${formatDate(value.to)}`;
}

export function LeadsDateFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  return (
    <div className="relative w-full min-w-44 flex-1 sm:w-auto sm:flex-none">
      <details className="group">
        <summary
          aria-label={`Date range: ${rangeLabel(value)}`}
          className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm text-text hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
        >
          <CalendarBlank aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{rangeLabel(value)}</span>
          <CaretDown
            aria-hidden
            weight="bold"
            className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="absolute top-full right-0 z-30 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-divider bg-surface p-4 shadow-lg">
          <DateRangePicker label="Date Range" value={value} onChange={onChange} />
          <div className="mt-3 flex justify-end">
            <Button
              variant="secondary"
              className="min-h-9 px-3 py-1"
              onClick={(event) => {
                const disclosure = event.currentTarget.closest('details');
                if (disclosure) disclosure.open = false;
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
