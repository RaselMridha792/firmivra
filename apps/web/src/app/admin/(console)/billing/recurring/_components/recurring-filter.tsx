'use client';

import { Button, DateRangePicker, FormField, type DateRange } from '@firmivra/ui';
import { Funnel } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import { SelectControl } from '../../_components/billing-fields';
import { adminBilling } from '../../_components/billing-api';

/**
 * The Recurring list's "Filter" button (the design's label; the kit's FilterBar says "More
 * Filters") and its panel: firm, client and the next invoice dates.
 */

export interface RecurringFilters {
  firmId: string;
  clientId: string;
  next: DateRange;
}
export const NO_FILTERS: RecurringFilters = {
  firmId: '',
  clientId: '',
  next: { from: '', to: '' },
};

/** How many of the panel's filters are set. */
export const filterCount = (value: RecurringFilters) =>
  [value.firmId, value.clientId, value.next.from || value.next.to].filter(Boolean).length;

export function RecurringFilter({
  value,
  onApply,
}: {
  value: RecurringFilters;
  onApply: (next: RecurringFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const firms = useApiQuery(['admin-billing', 'firms'], () => adminBilling.firms());
  const clients = useApiQuery(['admin-billing', 'clients', draft.firmId || 'all'], () =>
    adminBilling.clients(draft.firmId ? { firmId: draft.firmId } : {}),
  );
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const count = filterCount(value);

  function apply(next: RecurringFilters) {
    setDraft(next);
    onApply(next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="sm:relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          setDraft(value);
          setOpen(!open);
        }}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-divider bg-surface px-4 text-base font-semibold text-heading hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus sm:w-auto"
      >
        <Funnel aria-hidden weight="fill" className="size-5" />
        Filter
        {count ? (
          <span className="rounded-pill bg-action px-2 text-xs font-semibold text-on-action">
            {count}
            <span className="sr-only"> on</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={`${id}-panel`}
          role="region"
          aria-label="Filter recurring invoices"
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col gap-4 rounded-xl border border-divider bg-surface p-5 shadow-lg sm:right-0 sm:left-auto sm:w-96"
        >
          <FormField label="Firm" htmlFor={`${id}-firm`}>
            <SelectControl
              id={`${id}-firm`}
              value={draft.firmId}
              placeholder="All Firms"
              options={(firms.data ?? []).map((firm) => ({ value: firm.id, label: firm.name }))}
              onChange={(event) => setDraft({ ...draft, firmId: event.target.value, clientId: '' })}
            />
          </FormField>
          <FormField label="Client" htmlFor={`${id}-client`}>
            <SelectControl
              id={`${id}-client`}
              value={draft.clientId}
              placeholder="All Clients"
              options={(clients.data ?? []).map((client) => ({
                value: client.id,
                label: client.name,
              }))}
              onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
            />
          </FormField>
          <DateRangePicker
            label="Next Invoice Date"
            value={draft.next}
            onChange={(next) => setDraft({ ...draft, next })}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => apply(NO_FILTERS)}>
              Clear Filters
            </Button>
            <Button onClick={() => apply(draft)}>Apply Filters</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
