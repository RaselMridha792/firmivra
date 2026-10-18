'use client';

import { CaretDown } from '@phosphor-icons/react';
import { Avatar, Input } from '@firmivra/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';

export interface PickerOption {
  id: string;
  name: string;
  /** The second line: "email | phone". */
  detail?: string;
}

const MOVES: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * A person chooser: the chosen person (avatar, name, contact line) in a field-like button that
 * opens a list, with an optional search box. Arrow keys move through the list, Enter picks,
 * Escape closes.
 */
export function PersonPicker({
  labelId,
  buttonId,
  listLabel,
  placeholder,
  value,
  options,
  onSelect,
  search,
  status,
  noneLabel,
  error,
  errorId,
  compact,
}: {
  /** The visible label's id: the button is named by it and by the chosen person. */
  labelId: string;
  buttonId: string;
  listLabel: string;
  placeholder: string;
  value: PickerOption | undefined;
  options: PickerOption[];
  onSelect: (option: PickerOption | undefined) => void;
  search?: { label: string; value: string; onChange: (value: string) => void };
  /** A line above the list: "Searching…", "No clients match", "Could not search right now". */
  status?: ReactNode;
  /** A first choice that clears the field ("Not assigned"). */
  noneLabel?: string;
  error?: string;
  errorId?: string;
  /** One line high (Assign To) instead of two (the recipient). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const valueId = useId();

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const first =
      root?.querySelector<HTMLElement>('input') ??
      root?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      root?.querySelector<HTMLElement>('[role="option"]');
    first?.focus();
    const away = (event: MouseEvent) => {
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: PickerOption | undefined) {
    onSelect(option);
    close();
  }

  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const step = MOVES[event.key];
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    if (step === undefined || items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = at === -1 ? (step > 0 ? 0 : items.length - 1) : at + step;
    items[(next + items.length) % items.length]?.focus();
  }

  function onOptionKey(event: KeyboardEvent<HTMLLIElement>, option: PickerOption | undefined) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(option);
    }
  }

  const optionClass =
    'flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-canvas focus:bg-folder-surface focus:outline-none aria-selected:bg-folder-surface';

  return (
    <div ref={rootRef} className="relative min-w-0" onKeyDown={onKey}>
      <button
        ref={triggerRef}
        id={buttonId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => setOpen(!open)}
        className={`flex w-full min-w-0 items-center gap-3 rounded-control border bg-surface px-3 text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus ${compact ? 'min-h-11 py-1.5' : 'min-h-14 py-2'} ${error ? 'border-danger' : 'border-border'}`}
      >
        {value ? (
          <span aria-hidden className="shrink-0">
            <Avatar name={value.name} size={compact ? 'md' : 'lg'} />
          </span>
        ) : null}
        <span id={valueId} className="flex min-w-0 flex-1 flex-col">
          <span className={`truncate ${value ? 'font-semibold text-heading' : 'text-muted'}`}>
            {value?.name ?? placeholder}
          </span>
          {value?.detail && !compact ? (
            <span className="truncate text-sm text-muted">{value.detail}</span>
          ) : null}
        </span>
        <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-20 mt-1 flex flex-col gap-2 rounded-lg border border-divider bg-surface p-2 shadow-lg">
          {search ? (
            <Input
              label={search.label}
              hideLabel
              type="search"
              placeholder={search.label}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
            />
          ) : null}
          {status ? <div className="px-2 text-sm text-muted">{status}</div> : null}
          <ul
            id={listId}
            role="listbox"
            aria-label={listLabel}
            className="flex max-h-72 flex-col gap-0.5 overflow-y-auto"
          >
            {noneLabel ? (
              <li
                role="option"
                aria-selected={!value}
                tabIndex={-1}
                onClick={() => choose(undefined)}
                onKeyDown={(event) => onOptionKey(event, undefined)}
                className={`${optionClass} text-sm text-muted`}
              >
                {noneLabel}
              </li>
            ) : null}
            {options.map((option) => (
              <li
                key={option.id}
                role="option"
                aria-selected={value?.id === option.id}
                tabIndex={-1}
                onClick={() => choose(option)}
                onKeyDown={(event) => onOptionKey(event, option)}
                className={optionClass}
              >
                <span aria-hidden className="shrink-0">
                  <Avatar name={option.name} size="md" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">{option.name}</span>
                  {option.detail ? (
                    <span className="truncate text-xs text-muted">{option.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
