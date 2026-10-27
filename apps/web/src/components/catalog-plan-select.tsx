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
 * Plan or service (Octavia's SH9): a Services & Pricing service, chosen and saved by its id
 * (`engagements.catalog_service_id`), never free text or a second list. Says when the plans are
 * loading, could not be loaded, or none are set up. A plan saved by name only, or one no longer
 * in the catalog, shows as such and cannot be picked again. Choosing a plan bills nothing.
 */
export function CatalogPlanSelect({
  kind,
  value,
  savedName,
  onChange,
  label = 'Plan or service',
}: {
  kind: ServiceKind;
  /** The chosen service's id, or '' for no plan. */
  value: string;
  /** The plan's saved name (shown when it is not, or no longer, a catalog service). */
  savedName?: string | null;
  onChange: (catalogServiceId: string) => void;
  label?: string;
}) {
  const { plans, pending, failed } = useCatalogPlans(kind);
  const known = plans.some((p) => p.id === value);
  const what = KIND_LABEL[kind] ?? 'service';
  const stale = !pending && !failed && ((value && !known) || (!value && savedName));
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-sm font-medium text-heading">
        {label}
        <select
          value={stale ? 'saved' : value}
          disabled={pending || failed}
          onChange={(e) => onChange(e.target.value === 'saved' ? value : e.target.value)}
          className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text disabled:bg-disabled"
        >
          <option value="">
            {pending ? 'Loading plans…' : failed ? 'Plans are not available' : 'No plan'}
          </option>
          {stale ? (
            <option value="saved" disabled>
              {savedName ?? 'Saved plan'} (not in Services &amp; Pricing)
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
