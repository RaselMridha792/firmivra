'use client';

import { Button, Modal, Select, Toast } from '@firmivra/ui';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BA_KEY, errorText } from './ba-shared';

/** The search field of a list's filter row. */
export function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus sm:w-64 sm:flex-none">
      <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${label}...`}
        className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
      />
    </label>
  );
}

/** A filter dropdown: its first option ("All …") clears the filter. */
export function FilterSelect({
  label,
  all,
  value,
  onChange,
  options,
  width = 'w-44',
}: {
  label: string;
  all: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  width?: string;
}) {
  return (
    <div className={width}>
      <Select
        label={label}
        hideLabel
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[{ value: '', label: all }, ...options]}
      />
    </div>
  );
}

/** The Table's server paging for an offset page from the API. */
export const serverPaging = (
  d: { page: number; total: number } | undefined,
  size: number,
  page: number,
  setPage: (n: number) => void,
) => ({
  page: d?.page ?? 1,
  total: d?.total ?? 0,
  hasNext: (d?.page ?? 1) * size < (d?.total ?? 0),
  hasPrevious: (d?.page ?? 1) > 1,
  onNext: () => setPage(page + 1),
  onPrevious: () => setPage(Math.max(1, page - 1)),
  onPage: (n: number) => setPage(n),
  onSort: () => undefined,
});

/**
 * A row action: run it, refresh the module's queries, and say how it went in a toast.
 * Returns the toast to render and `act(work, done)`.
 */
/** Advisory Review 2 A-X05 (B30): what an in-app confirmation asks before an action runs. */
export interface Confirm {
  title: string;
  message: string;
  /** The confirming button, e.g. "Mark Implemented", "Show to Client". */
  confirm: string;
  danger?: boolean;
}

export function useAct() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [asking, setAsking] = useState<Confirm & { run: () => void }>();
  const act = async <T,>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const r = await work();
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      setMsg({ text: done, tone: 'success' });
      return r;
    } catch (e) {
      setMsg({ text: errorText(e), tone: 'error' });
      return undefined;
    }
  };
  /**
   * A-X05 (Octavia's B30): status changes, cancels, archive and restore, and showing or hiding
   * on the client portal ask first, in the app (never by email); nothing runs until confirmed.
   */
  const ask = <T,>(q: Confirm, work: () => Promise<T>, done: string) =>
    setAsking({ ...q, run: () => void act(work, done) });
  // The toast slot also holds the confirmation, so every screen that shows one shows both.
  const toast = (
    <>
      {msg ? (
        <Toast message={msg.text} tone={msg.tone} onDismiss={() => setMsg(undefined)} />
      ) : null}
      {asking ? (
        <Modal
          open
          title={asking.title}
          onClose={() => setAsking(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(undefined)}>
                Cancel
              </Button>
              <Button
                variant={asking.danger ? 'danger' : 'primary'}
                data-testid="confirm-action"
                onClick={() => {
                  const run = asking.run;
                  setAsking(undefined);
                  run();
                }}
              >
                {asking.confirm}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">{asking.message}</p>
        </Modal>
      ) : null}
    </>
  );
  return { act, ask, toast, say: (text: string) => setMsg({ text, tone: 'success' }) };
}
