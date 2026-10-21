'use client';

import type { ClientListItem } from '@firmivra/types';
import { Avatar, Skeleton } from '@firmivra/ui';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api } from '../../../../../../lib/api';

/** The typed text once it has been still for a moment (one request per pause). */
function useSettled(text: string, ms = 250) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

/**
 * Frame 1's Client / Lead field: the chosen client's avatar, name, email and phone; opens a search
 * over the clients this person may see (the clients API scopes Staff to their own).
 */
export function ClientPicker({
  value,
  onChange,
  error,
  disabled,
}: {
  value: ClientListItem | null;
  onChange: (client: ClientListItem) => void;
  error?: string;
  disabled: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const term = useSettled(text.trim());
  const clients = useQuery({
    queryKey: ['upload-document', 'clients', term],
    queryFn: () => api.clients.list({ search: term || undefined, limit: 8 }),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const contact = (client: ClientListItem) =>
    [client.email, client.phone].filter(Boolean).join('  |  ');

  return (
    <div
      className="relative flex flex-col gap-1.5"
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}
    >
      <span id={`${id}-label`} className="text-sm font-semibold text-heading">
        Client / Lead<span className="text-danger"> *</span>
      </span>
      <button
        type="button"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-14 w-full items-center gap-3 rounded-control border bg-surface px-3 py-2 text-left shadow-sm disabled:cursor-not-allowed disabled:bg-disabled ${error ? 'border-danger' : 'border-border hover:border-control-border'}`}
      >
        {value ? (
          <>
            <Avatar name={value.displayName} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-heading">{value.displayName}</span>
              <span className="block truncate text-sm text-muted">{contact(value)}</span>
            </span>
          </>
        ) : (
          <span className="flex-1 text-muted">Choose a client</span>
        )}
        <CaretDown aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
      </button>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a client"
          className="absolute top-full right-0 left-0 z-30 mt-1 rounded-card border border-border bg-surface p-2 shadow-card"
        >
          <label className="flex h-10 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-sm">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 text-muted" />
            <span className="sr-only">Search clients</span>
            <input
              type="search"
              autoFocus
              maxLength={100}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Search by name, email or phone…"
              className="min-h-0 w-full bg-transparent text-text outline-none"
            />
          </label>
          <ul aria-label="Clients" className="mt-2 max-h-72 overflow-y-auto">
            {clients.isPending ? (
              <li>
                <Skeleton className="m-2 h-10" />
              </li>
            ) : clients.isError ? (
              <li className="px-3 py-2 text-sm text-muted">Could not load clients right now.</li>
            ) : clients.data.items.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No matching clients.</li>
            ) : (
              clients.data.items.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(client);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-canvas focus-visible:bg-canvas"
                  >
                    <Avatar name={client.displayName} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-heading">
                        {client.displayName}
                      </span>
                      <span className="block truncate text-xs text-muted">{contact(client)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
