'use client';

import type { NamedItem } from '@firmivra/types';
import { FilterChip, Input } from '@firmivra/ui';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { SCHEDULING } from './appointments-parts';

/** The API's limit (Appointments A1). */
export const MAX_ATTENDEES = 20;

/**
 * Appointments A1: Other Attendees, the firm's other clients in a group appointment. Searched as
 * the client is (clients only, never the appointment's own client or one already on it). Each one
 * is booked and told on their own; in their portal they never see who else attends.
 */
export function AttendeePicker({
  clientId,
  value,
  onChange,
}: {
  /** The appointment's own client, never an attendee. */
  clientId: string | null;
  value: NamedItem[];
  onChange: (next: NamedItem[]) => void;
}) {
  const [search, setSearch] = useState('');
  const term = search.trim();
  const found = useApiQuery([...SCHEDULING, 'contacts', term], () =>
    term.length >= 2 ? api.scheduling.contacts({ search: term }) : Promise.resolve([]),
  );
  const taken = new Set([clientId, ...value.map((a) => a.id)]);
  const choices = (found.data ?? []).flatMap((c) =>
    c.kind === 'CLIENT' && c.id && !taken.has(c.id) ? [{ ...c, id: c.id }] : [],
  );
  const full = value.length >= MAX_ATTENDEES;

  return (
    <div className="flex flex-col gap-2" data-testid="attendees">
      <div className="relative flex min-w-0 flex-col gap-1">
        <Input
          label="Other Attendees"
          placeholder={
            full
              ? `At most ${MAX_ATTENDEES} other attendees`
              : 'Add another client by name or email...'
          }
          value={search}
          disabled={full}
          autoComplete="off"
          className="pl-9"
          onChange={(e) => setSearch(e.target.value)}
        />
        <MagnifyingGlass
          aria-hidden
          weight="bold"
          className="pointer-events-none absolute bottom-3.5 left-3 size-4 text-muted"
        />
        {term.length >= 2 ? (
          <ul
            data-testid="attendee-results"
            className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-card"
          >
            {found.isPending ? (
              <li className="p-2 text-sm text-muted">Searching…</li>
            ) : choices.length ? (
              choices.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...value, { id: c.id, name: c.name }]);
                      setSearch('');
                    }}
                    className="flex w-full flex-col items-start rounded-control px-2 py-1.5 text-left text-sm hover:bg-canvas"
                  >
                    <span className="font-semibold text-heading">{c.name}</span>
                    <span className="text-xs text-muted">Client · {c.email ?? c.phone ?? ''}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="p-2 text-sm text-muted">No other client matches.</li>
            )}
          </ul>
        ) : null}
      </div>
      {value.length ? (
        <ul aria-label="Other attendees" className="flex flex-wrap gap-2">
          {value.map((a) => (
            <li key={a.id}>
              <FilterChip
                label={a.name}
                onRemove={() => onChange(value.filter((x) => x.id !== a.id))}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted">
        Each attendee gets their own notices and sees the appointment in their portal, never who
        else attends.
      </p>
    </div>
  );
}
