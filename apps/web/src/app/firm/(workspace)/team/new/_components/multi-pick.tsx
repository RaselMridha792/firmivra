'use client';

import { Avatar } from '@firmivra/ui';
import { CaretDown, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * A select that keeps several values (Department(s), Service Area(s)). The kit has no multi-select
 * yet, so this small one lives here: a button like the kit's Select that opens a list of
 * checkboxes; Escape or a click outside closes it. `chips` shows each chosen person as a chip
 * with their initials and a remove button (Assigned Staff in Schedule Appointment).
 */
export function MultiPick({
  label,
  placeholder,
  options,
  value,
  onChange,
  error,
  emptyText = 'Nothing to choose yet.',
  chips,
}: {
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  emptyText?: string;
  chips?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const chosen = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const toggle = (option: string, on: boolean) =>
    onChange(on ? [...value, option] : value.filter((v) => v !== option));
  return (
    <div
      ref={rootRef}
      className="relative flex min-w-0 flex-col gap-1"
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
    >
      <span id={`${id}-label`} className="text-sm font-medium text-text">
        {label}
      </span>
      {chips ? (
        <div
          className={`flex min-h-11 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-control border bg-surface py-1 pr-1 pl-1.5 ${error ? 'border-danger' : 'border-border'}`}
        >
          {options
            .filter((o) => value.includes(o.value))
            .map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1.5 rounded-pill bg-subtle py-0.5 pr-1 pl-0.5 text-sm text-heading"
              >
                <Avatar name={o.label} size="sm" />
                {o.label}
                <button
                  type="button"
                  aria-label={`Remove ${o.label}`}
                  onClick={() => toggle(o.value, false)}
                  className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-canvas hover:text-heading"
                >
                  <X aria-hidden weight="bold" className="size-3" />
                </button>
              </span>
            ))}
          <span id={`${id}-value`} className="sr-only">
            {chosen.join(', ')}
          </span>
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={open}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onClick={() => setOpen((v) => !v)}
            className="ml-auto flex min-h-9 flex-1 items-center justify-end gap-2 rounded-control px-2 text-left text-base text-muted hover:bg-canvas"
          >
            {chosen.length ? null : <span className="flex-1 truncate">{placeholder}</span>}
            <CaretDown aria-hidden weight="bold" className="size-4 shrink-0" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-haspopup="true"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onClick={() => setOpen((v) => !v)}
          className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-control border bg-surface py-2 pr-3 pl-3 text-left text-base ${error ? 'border-danger' : 'border-border'}`}
        >
          <span
            id={`${id}-value`}
            className={`truncate ${chosen.length ? 'text-text' : 'text-muted'}`}
          >
            {chosen.length ? chosen.join(', ') : placeholder}
          </span>
          <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
        </button>
      )}
      {open ? (
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-card"
        >
          {options.length ? (
            options.map((o) => (
              <label
                key={o.value}
                className="flex min-h-10 cursor-pointer items-center gap-3 rounded-control px-2 text-sm text-text hover:bg-canvas"
              >
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-action"
                  checked={value.includes(o.value)}
                  onChange={(event) => toggle(o.value, event.target.checked)}
                />
                {o.label}
              </label>
            ))
          ) : (
            <p className="p-2 text-sm text-muted">{emptyText}</p>
          )}
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
