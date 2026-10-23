'use client';

import { TAG_NAME_MAX } from '@firmivra/types';
import { FilterChip } from '@firmivra/ui';
import { type KeyboardEvent, useId, useState } from 'react';
import { tagKey as key, uniqueTags } from './tag-names';

export { uniqueTags } from './tag-names';

// The firm's tags, picked (L5 of Octavia's Leads review): type to search the firm's one tag
// list (shared by Leads and Clients) and choose; a name in another case is that tag, never a
// second one, and a tag is chosen once. Owner and Admin may add a name the firm does not have
// yet; others are told to ask for it. Used by the Leads tag dialog, Edit Lead and a client's
// Tags card.

interface TagPickerProps {
  label: string;
  /** The chosen tag names. */
  value: readonly string[];
  onChange: (names: string[]) => void;
  /** The firm's tag names to choose from. */
  options: readonly string[];
  /** Owner and Admin: a name the firm does not have can be added. */
  canCreate: boolean;
  /** The most that can be chosen (the API's limit for this place). */
  max?: number;
  hint?: string;
  error?: string;
  disabled?: boolean;
  /** The firm's list is still loading: nothing new is offered until it is known. */
  loading?: boolean;
}

type Choice = { kind: 'tag'; name: string } | { kind: 'new'; name: string };

export function TagPicker({
  label,
  value,
  onChange,
  options,
  canCreate,
  max = 20,
  hint,
  error,
  disabled,
  loading,
}: TagPickerProps) {
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const typed = text.trim();
  const chosen = new Set(value.map(key));
  const full = value.length >= max;
  const matches = options
    .filter((o) => !chosen.has(key(o)) && key(o).includes(key(typed)))
    .slice(0, 50);
  const exact = options.some((o) => key(o) === key(typed)) || chosen.has(key(typed));
  const choices: Choice[] = [
    ...matches.map((name) => ({ kind: 'tag' as const, name })),
    ...(typed && !exact && canCreate && !loading && typed.length <= TAG_NAME_MAX
      ? [{ kind: 'new' as const, name: typed }]
      : []),
  ];
  const shown = open && !full && !disabled;
  const at = Math.min(active, Math.max(choices.length - 1, 0));
  const pick = (choice: Choice | undefined) => {
    if (!choice || full) return;
    onChange(uniqueTags([...value, choice.name], options));
    setText('');
    setActive(0);
    // Closed after each pick, so it never covers the buttons under it; typing opens it again.
    setOpen(false);
  };
  const remove = (name: string) => onChange(value.filter((v) => key(v) !== key(name)));
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive(choices.length ? (at + 1) % choices.length : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(choices.length ? (at - 1 + choices.length) % choices.length : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // The highlighted choice, or the firm's tag with exactly this name.
      pick(choices[at] ?? (exact ? { kind: 'tag', name: typed } : undefined));
    } else if (event.key === 'Escape') {
      if (open) event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };
  const optionId = (i: number) => `${id}-option-${i}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-input`} className="text-sm font-semibold text-heading">
        {label}
      </label>
      <div className="relative" data-testid="tag-picker">
        <div
          className={`flex flex-wrap items-center gap-2 rounded-control border bg-surface px-3 py-2 ${error ? 'border-danger' : 'border-control-border'} ${disabled ? 'opacity-50' : ''}`}
        >
          {value.length > 0 ? (
            <ul aria-label={`${label}: chosen`} className="flex flex-wrap gap-2">
              {value.map((name) => (
                <li key={key(name)}>
                  <FilterChip label={name} onRemove={() => remove(name)} />
                </li>
              ))}
            </ul>
          ) : null}
          <input
            id={`${id}-input`}
            role="combobox"
            aria-expanded={shown}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={shown && choices.length ? optionId(at) : undefined}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            disabled={disabled || full}
            maxLength={TAG_NAME_MAX}
            value={text}
            placeholder={full ? `Up to ${max} tags` : 'Search tags'}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={keyDown}
            className="min-w-32 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </div>
        {shown ? (
          <ul
            id={`${id}-list`}
            role="listbox"
            aria-label={`${label} choices`}
            className="absolute top-full right-0 left-0 z-10 mt-1 max-h-56 overflow-y-auto rounded-control border border-border bg-surface py-1 shadow-sm"
          >
            {choices.map((choice, i) => (
              <li
                key={`${choice.kind}-${key(choice.name)}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === at}
                // Chosen on mouse down, before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(choice);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2 text-sm ${i === at ? 'bg-folder-surface text-heading' : 'text-text'}`}
              >
                {choice.kind === 'new' ? `Add “${choice.name}” as a new tag` : choice.name}
              </li>
            ))}
            {choices.length === 0 ? (
              <li role="presentation" className="px-3 py-2 text-sm text-muted">
                {loading
                  ? 'Loading the firm’s tags…'
                  : typed
                    ? exact
                      ? `“${typed}” is already chosen.`
                      : canCreate
                        ? `Tag names are up to ${TAG_NAME_MAX} characters.`
                        : `No tag matches “${typed}”. An Owner or Admin can add it.`
                    : options.length === 0
                      ? canCreate
                        ? 'The firm has no tags yet. Type a name to add one.'
                        : 'The firm has no tags yet. An Owner or Admin can add them.'
                      : 'Every tag is chosen.'}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <span id={`${id}-help`} className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>
        {error ?? hint ?? `Choose up to ${max}. Type to search the firm's tags.`}
      </span>
    </div>
  );
}
