'use client';

import { Button, DateRangePicker, type DateRange } from '@firmivra/ui';
import { CalendarDots } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * A list filter's date range in a small panel under its button (Clients Review 2, C2-018 and
 * C2-019: the Last Activity filter). It closes on Escape, on a click outside it and on Done, and
 * Escape and Done give focus back to the button. The From and To days have their own names
 * ("Last activity: From, start date"), and an end before the start is held back with a reason.
 */
export function DateRangePopover({
  label,
  value,
  onChange,
  summary,
  className = '',
}: {
  /** "Last activity": the button's and the fields' name. */
  label: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** The button's words for the range in force ("Nov 1, 2026 – Nov 8, 2026"), '' for none. */
  summary: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div
      ref={rootRef}
      className={`relative ${className}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${summary || 'any time'}`}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-xs text-text hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="min-w-0 flex-1 truncate text-left">{summary || label}</span>
        <CalendarDots aria-hidden weight="fill" className="size-5 shrink-0 text-heading" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className="absolute top-full right-0 left-0 z-30 mt-2 rounded-xl border border-divider bg-surface p-4 shadow-lg sm:left-auto sm:w-md"
        >
          <DateRangePicker label={label} value={value} onChange={onChange} strict />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              className="min-h-9 px-3 py-1"
              disabled={!value.from && !value.to}
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={() => onChange({ from: '', to: '' })}
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 px-3 py-1"
              aria-label={`Done: close ${label.toLowerCase()}`}
              onClick={() => close(true)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
