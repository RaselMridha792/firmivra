'use client';

import type { CatalogService } from '@firmivra/types';
import { Select } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

const BILLED: Record<NonNullable<CatalogService['billingFrequency']>, string> = {
  ONE_TIME: 'Billed once',
  WEEKLY: 'Billed weekly',
  BIWEEKLY: 'Billed every two weeks',
  MONTHLY: 'Billed monthly',
  QUARTERLY: 'Billed quarterly',
  SEMIANNUAL: 'Billed every six months',
  ANNUAL: 'Billed yearly',
};

/** What a chosen plan puts on line 1: "Service — Plan", and the service's price when it has one. */
export interface PlanLine {
  description: string;
  amountCents: number | null;
}

/**
 * Invoices Review 2 I-N01 (the lead's (a), Nov 19): the plans a catalog service offers, by name
 * (from Services & Pricing), and how often it is billed. Shown for a service the client isn't
 * enrolled in yet (the plan goes on the Requested engagement the save adds) and for one they are
 * (the engagement's plan preselected). Choosing a plan fills line 1 with "Service — Plan" and the
 * service's price; there are no prices per plan.
 */
export function InvoiceServicePlan({
  serviceId,
  value,
  onChange,
}: {
  serviceId: string;
  value: string;
  onChange: (plan: string, line: PlanLine | null) => void;
}) {
  const detail = useApiQuery(['catalog-services', 'one', serviceId], () =>
    api.servicesPricing.service(serviceId),
  );
  const d = detail.data;
  const billed = d?.billingFrequency ?? d?.price.frequency ?? null;
  // A plan the catalog no longer lists (an engagement's older one) stays choosable.
  const names = d ? [...new Set([...(value ? [value] : []), ...d.packageNames])] : [];
  return (
    <div className="flex flex-col gap-1" data-testid="invoice-service-plan">
      {d && d.packageNames.length > 0 ? (
        <Select
          label="Plan"
          value={value}
          onChange={(e) => {
            const plan = e.target.value;
            onChange(
              plan,
              plan
                ? { description: `${d.name} — ${plan}`, amountCents: d.price.amountCents }
                : null,
            );
          }}
          options={[{ value: '', label: 'No plan' }, ...names.map((n) => ({ value: n, label: n }))]}
        />
      ) : null}
      {billed ? <p className="text-xs text-muted">{BILLED[billed]}</p> : null}
      {detail.isError ? (
        <p className="text-xs text-muted">
          This service&apos;s plans can&apos;t be shown right now.
        </p>
      ) : null}
    </div>
  );
}
