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

/**
 * Invoices Review 2 I-N01: for a catalog service the client isn't enrolled in yet, the plans it
 * offers, by name (from Services & Pricing), and how often it is billed. The plan goes on the
 * Requested engagement the save adds; its price comes from the invoice's own lines.
 */
export function InvoiceServicePlan({
  serviceId,
  value,
  onChange,
}: {
  serviceId: string;
  value: string;
  onChange: (plan: string) => void;
}) {
  const detail = useApiQuery(['catalog-services', 'one', serviceId], () =>
    api.servicesPricing.service(serviceId),
  );
  const d = detail.data;
  const billed = d?.billingFrequency ?? d?.price.frequency ?? null;
  return (
    <div className="flex flex-col gap-1" data-testid="invoice-service-plan">
      {d && d.packageNames.length > 0 ? (
        <Select
          label="Plan"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: 'No plan' },
            ...d.packageNames.map((n) => ({ value: n, label: n })),
          ]}
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
