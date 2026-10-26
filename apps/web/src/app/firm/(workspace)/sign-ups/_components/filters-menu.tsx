'use client';

import type { SignUpMatch } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { Funnel } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { SignUpsPlace } from './sign-ups-place';

type Draft = { from: string; to: string; match: SignUpMatch | '' };

/**
 * Filters (the design's button): the submitted date range, and on the Waiting tab the match
 * check. Apply sets them; Escape or Cancel leave them as they were.
 */
export function FiltersMenu({
  place,
  onApply,
}: {
  place: SignUpsPlace;
  onApply: (patch: Partial<SignUpsPlace>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({ from: '', to: '', match: '' });
  const [error, setError] = useState('');
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fromId = useId();
  const focusFrom = () => document.getElementById(fromId)?.focus();
  const waiting = place.status === 'PENDING_APPROVAL';
  const active = [place.from || place.to, waiting && place.match].filter(Boolean).length;

  useEffect(() => {
    if (open) document.getElementById(fromId)?.focus();
  }, [open, fromId]);
  const close = () => {
    setOpen(false);
    setError('');
    buttonRef.current?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (open) return close();
          setDraft({ from: place.from, to: place.to, match: place.match });
          setOpen(true);
        }}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
      >
        <Funnel aria-hidden weight="fill" className="size-4" />
        Filters
        {active ? (
          <span className="rounded-pill bg-action px-2 text-xs font-semibold text-on-action">
            {active}
          </span>
        ) : null}
      </button>
      {open ? (
        <form
          id={panelId}
          aria-label="Filters"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.from && draft.to && draft.from > draft.to) {
              setError('The start date is after the end date.');
              focusFrom();
              return;
            }
            onApply({ from: draft.from, to: draft.to, match: waiting ? draft.match : '' });
            close();
          }}
          className="absolute right-0 z-20 mt-2 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-lg"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-heading">Date submitted</legend>
            <Input
              id={fromId}
              type="date"
              label="From"
              value={draft.from}
              error={error || undefined}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
            <Input
              type="date"
              label="To"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </fieldset>
          {waiting ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text">
              Match check
              <select
                value={draft.match}
                onChange={(event) =>
                  setDraft({ ...draft, match: event.target.value as Draft['match'] })
                }
                className="h-10 rounded-lg border border-divider bg-surface px-3 text-sm font-normal"
              >
                <option value="">Any</option>
                <option value="POTENTIAL_MATCH">Potential match</option>
                <option value="NO_MATCH">No match found</option>
              </select>
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit">Apply</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
