'use client';

import type { ServiceKind } from '@firmivra/types';
import Link from 'next/link';
import { api } from '../lib/api';
import { useApiQuery } from '../lib/query';

/** The active Services & Pricing services of one kind, by id (SH9): the plans to choose from. */
export function useCatalogPlans(kind: ServiceKind) {
  const list = useApiQuery(['catalog-plans', kind], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const plans = (list.data?.items ?? [])
    .filter((s) => s.kind === kind)
    .map((s) => ({ id: s.id, name: s.name }));
  return { plans, pending: list.isPending, failed: list.isError };
}

const KIND_LABEL: Partial<Record<ServiceKind, string>> = {
  PAYROLL: 'payroll',
  BOOKKEEPING: 'bookkeeping',
  ANNUAL_TAX: 'tax',
  QUARTERLY_TAX: 'tax',
};

/**
 * Plan or service (Octavia's SH9): a choice from Services & Pricing, never free text or a second
 * list. Says when the plans are loading, could not be loaded, or none are set up, and keeps a
 * saved plan that is no longer in the catalog visible as such. Choosing a plan bills nothing.
 * The value is the plan's name, as the service record keeps it.
 */
export function CatalogPlanSelect({
  kind,
  value,
  onChange,
  label = 'Plan or service',
}: {
  kind: ServiceKind;
  value: string;
  onChange: (name: string) => void;
  label?: string;
}) {
  const { plans, pending, failed } = useCatalogPlans(kind);
  const known = plans.find((p) => p.name === value);
  const what = KIND_LABEL[kind] ?? 'service';
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        {label}
        <select
          value={known?.id ?? (value ? 'saved' : '')}
          disabled={pending || failed}
          onChange={(e) => onChange(plans.find((p) => p.id === e.target.value)?.name ?? '')}
          className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text disabled:bg-disabled"
        >
          <option value="">
            {pending ? 'Loading plans…' : failed ? 'Plans are not available' : 'No plan'}
          </option>
          {value && !known ? (
            <option value="saved" disabled>
              {value} (not in Services &amp; Pricing)
            </option>
          ) : null}
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        {failed ? (
          'The plans could not be loaded. Try again in a moment.'
        ) : !pending && plans.length === 0 ? (
          <>
            No {what} plans are set up in Services &amp; Pricing yet.{' '}
            <Link href="/services-pricing" className="font-medium text-link hover:underline">
              Set them up
            </Link>
          </>
        ) : (
          'From Services & Pricing. Choosing a plan does not bill the client.'
        )}
      </p>
    </div>
  );
}
