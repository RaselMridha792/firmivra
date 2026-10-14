'use client';

import { CaretDown, Funnel, MagnifyingGlass, X, type Icon } from '@phosphor-icons/react';
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Button } from './button';

/** The filled search box at the start of a filter bar. */
export function SearchField({
  label,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label
      className={`flex h-10 min-w-56 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus ${className}`}
    >
      <MagnifyingGlass aria-hidden weight="bold" className="size-4.5 shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        className="min-h-0 w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
        {...props}
      />
    </label>
  );
}

/** An applied filter under the bar ("Status: Active ×"). */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-soft pr-1 pl-2.5 text-xs font-medium text-accent">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="rounded-sm p-0.5 hover:bg-surface"
      >
        <X aria-hidden weight="bold" className="size-3" />
      </button>
    </span>
  );
}

/** One titled column of the "More Filters" panel (checkboxes, selects). */
export function FilterGroup({
  title,
  icon: Glyph,
  children,
}: {
  title: string;
  icon?: Icon;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-heading">
        {Glyph ? <Glyph aria-hidden weight="fill" className="size-4" /> : null}
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export interface FilterBarProps {
  /** SearchField, filter Selects and a DateRangePicker, in the design's order. */
  children: ReactNode;
  /** FilterGroups for the "More Filters" panel; Apply and Clear sit under them. */
  more?: ReactNode;
  onApply?: () => void;
  onClear?: () => void;
  onReset?: () => void;
  resetLabel?: string;
}

/** The list filters: search, selects, "More Filters" with its panel, and Reset. */
export function FilterBar({
  children,
  more,
  onApply,
  onClear,
  onReset,
  resetLabel = 'Reset',
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="relative flex flex-wrap items-end gap-3">
      {children}
      {more ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-semibold text-heading hover:bg-canvas"
        >
          <Funnel aria-hidden weight="fill" className="size-4.5" />
          More Filters
          <CaretDown aria-hidden weight="bold" className="size-3.5" />
        </button>
      ) : null}
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="h-10 px-1 text-sm font-medium text-link underline hover:text-action-hover"
        >
          {resetLabel}
        </button>
      ) : null}
      {more && open ? (
        <div
          id={panelId}
          role="region"
          aria-label="More filters"
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          className="absolute top-full right-0 z-20 mt-2 w-full max-w-5xl rounded-xl border border-divider bg-surface p-5 shadow-lg"
        >
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-divider [&>*]:lg:pr-6">
            {more}
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClear}>
              Clear Filters
            </Button>
            <Button
              onClick={() => {
                onApply?.();
                setOpen(false);
              }}
            >
              Apply Filters
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
