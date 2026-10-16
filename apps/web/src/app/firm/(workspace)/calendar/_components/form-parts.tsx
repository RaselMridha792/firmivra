'use client';

import type { AppointmentContact } from '@firmivra/types';
import { Avatar } from '@firmivra/ui';
import { CaretDown, MagnifyingGlass, UserPlus } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useDeferredValue, useId, useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** A card of the form: a blue tile with the section's icon, its title, and the fields below. */
export function SectionCard({
  icon: Glyph,
  title,
  note,
  aside,
  children,
  className = '',
}: {
  icon: Icon;
  title: string;
  /** "(Optional)" after the title. */
  note?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl bg-surface p-4 shadow-md ${className}`}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-action text-on-action"
          >
            <Glyph weight="fill" className="size-5" />
          </span>
          <h2 className="text-lg font-bold whitespace-nowrap text-heading">
            {title}
            {note ? <span className="ml-1 text-sm font-normal text-muted">{note}</span> : null}
          </h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** One label over a control, with the star of a required field and an error line. */
export function Field({
  label,
  required,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-text">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
        {hint}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A joined row of choices (Individual | Business, In Person | Phone | …). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full overflow-hidden rounded-lg border border-divider"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`min-h-10 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${value === option.value ? 'bg-action text-on-action' : 'bg-surface text-heading hover:bg-canvas'} ${option.value === options[0]?.value ? '' : 'border-l border-divider'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The control box every plain field shares (a native select or input in the form's style). */
export const CONTROL =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';

const KIND_LABEL = { CLIENT: 'Client', LEAD: 'Lead', CONTACT: 'Contact' } as const;

/**
 * Client / Lead: search the clients and leads the person may see, pick one; "Add as a new
 * contact" keeps what was typed for the name (Name, Business Name, Phone and Email follow).
 */
export function ContactPicker({
  picked,
  newName,
  onPick,
  onNew,
  error,
}: {
  picked: AppointmentContact | null;
  newName: string;
  onPick: (contact: AppointmentContact | null) => void;
  onNew: (name: string) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDeferredValue(text.trim());
  const results = useApiQuery(['appointments-ws', 'contacts', term], async () =>
    term.length >= 2 ? api.scheduling.contacts({ search: term }) : [],
  );
  const shown = picked ? picked.name : open ? text : newName || text;
  return (
    <div className="relative">
      <div
        className={`flex min-h-10 items-center gap-2 rounded-control border bg-surface px-3 ${error ? 'border-danger' : 'border-border'} focus-within:outline-2 focus-within:outline-accent-500`}
      >
        <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          data-testid="contact-search"
          value={shown}
          placeholder="Search by name, email, phone, or ID…"
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            if (picked) onPick(null);
            onNew('');
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
      </div>
      {open && term.length >= 2 ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-divider bg-surface p-1 shadow-lg"
        >
          {(results.data ?? []).map((contact) => (
            <li key={`${contact.kind}-${contact.id}`} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(contact);
                  onNew('');
                  setText(contact.name);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-canvas"
              >
                <Avatar name={contact.name} size="md" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-heading">
                    {contact.name}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {KIND_LABEL[contact.kind]}
                    {contact.email ? ` · ${contact.email}` : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {results.isPending ? (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          ) : results.data?.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No client or lead matches.</li>
          ) : null}
          <li role="option" aria-selected={false}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onPick(null);
                onNew(text.trim());
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-action hover:bg-canvas"
            >
              <UserPlus aria-hidden weight="fill" className="size-5" />
              Add “{text.trim()}” as a new contact
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
