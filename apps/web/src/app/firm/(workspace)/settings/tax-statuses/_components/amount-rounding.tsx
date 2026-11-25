'use client';

import type { TaxAmountRounding } from '@firmivra/types';
import { Select } from '@firmivra/ui';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { FIRM_SETTINGS } from '../../../../setup/_components/shared';

// Tax Returns Review 2 (Rounding): her own words for the two choices.
const OPTIONS: { value: TaxAmountRounding; label: string }[] = [
  { value: 'EXACT', label: 'Keep exactly as entered' },
  { value: 'ROUND_TO_DOLLAR', label: 'Round up figures' },
];

/**
 * Tax Returns Review 2: how the firm keeps a return's refund and amount due. Round up figures
 * stores each amount saved from now on with any cents taken up to the next whole dollar (never
 * down); the audit keeps the figure as entered. Amounts are kept to the cent either way.
 * Owner and Admin (the firm settings API checks the role again).
 */
export function AmountRounding() {
  const firm = useApiQuery(FIRM_SETTINGS, () => api.settings.get());
  const save = useApiMutation(
    (taxAmountRounding: TaxAmountRounding) => api.settings.update({ taxAmountRounding }),
    { invalidate: FIRM_SETTINGS },
  );
  return (
    <section
      aria-labelledby="amount-rounding-title"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
      data-testid="amount-rounding"
    >
      <h2 id="amount-rounding-title" className="text-base font-semibold text-text">
        Tax amounts
      </h2>
      <div className="sm:w-72">
        <Select
          label="Refunds and amounts due"
          hint="Amounts are kept to the cent. Round up figures takes any cents up to the next whole dollar ($1,482.01 becomes $1,483). Applies to amounts saved from now on; the audit keeps each figure as entered."
          value={firm.data?.taxAmountRounding ?? ''}
          disabled={!firm.data || save.isPending}
          options={
            firm.data
              ? OPTIONS
              : [{ value: '', label: firm.isError ? 'Not available' : 'Loading…' }]
          }
          onChange={(e) => save.mutate(e.target.value as TaxAmountRounding)}
        />
      </div>
      {save.isSuccess ? (
        <p role="status" className="text-sm text-success">
          Saved.
        </p>
      ) : null}
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
    </section>
  );
}
