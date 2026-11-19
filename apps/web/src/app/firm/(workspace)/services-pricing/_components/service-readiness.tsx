'use client';

import type { CatalogStatus, PricingType } from '@firmivra/types';
import { ChecklistCard } from '@firmivra/ui';
import { ListChecks } from '@phosphor-icons/react';

/**
 * Services & Pricing Review Two R11: what a service still needs before Save & Activate (the same
 * rule as the API's, catalog-shared `activationGap`), and what Draft and Active mean for clients.
 */
export function ServiceReadiness({
  value,
  status,
}: {
  value: {
    name?: string | null | undefined;
    categoryId?: string | null | undefined;
    shortDescription?: string | null | undefined;
    pricingType?: PricingType | undefined;
    basePriceCents?: number | null | undefined;
    billingFrequency?: string | null | undefined;
  };
  status: CatalogStatus | null;
}) {
  const quote = value.pricingType === 'CUSTOM_QUOTE';
  const recurring = value.pricingType === 'RECURRING';
  const items = [
    {
      id: 'details',
      label: 'Name, category and short description',
      done: !!value.name?.trim() && !!value.categoryId && !!value.shortDescription?.trim(),
    },
    {
      id: 'price',
      label: quote ? 'Custom Quote: priced when you quote it' : 'A base price',
      done: quote || (value.basePriceCents !== null && value.basePriceCents !== undefined),
    },
    ...(recurring
      ? [
          {
            id: 'frequency',
            label: 'How often it bills',
            done: !!value.billingFrequency && value.billingFrequency !== 'ONE_TIME',
          },
        ]
      : []),
  ];
  const state =
    status === 'ACTIVE'
      ? 'Active: it can be offered, added to packages and invoiced.'
      : status === 'INACTIVE'
        ? 'Inactive: not offered. Activate it to offer it again.'
        : status === 'ARCHIVED'
          ? 'Archived: not offered. Restore it to offer it again.'
          : 'Draft: only your team sees it. Save & Activate once everything above is done.';
  return (
    <div className="space-y-2" data-testid="service-readiness">
      <ChecklistCard title="Ready to Activate?" icon={ListChecks} iconTone="blue" items={items} />
      <p className="rounded-lg bg-canvas p-3 text-sm text-text">{state}</p>
    </div>
  );
}
