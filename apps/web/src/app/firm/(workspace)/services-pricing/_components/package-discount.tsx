'use client';

import type { PackagePricing } from '@firmivra/types';
import { WarningCircle } from '@phosphor-icons/react';
import { money, percent } from './catalog-shared';

export interface FieldProblem {
  /** The control's id: the summary focuses it. */
  id: string;
  message: string;
}

/** R2: "Fix these fields before saving", each line focusing its field. */
export function FixFields({ problems }: { problems: FieldProblem[] }) {
  if (!problems.length) return null;
  return (
    <div
      role="alert"
      data-testid="package-errors"
      className="flex gap-3 rounded-lg bg-danger-soft p-4 text-sm text-danger"
    >
      <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">
          Fix {problems.length === 1 ? 'this field' : `these ${problems.length} fields`} before
          saving. Everything else you entered is kept.
        </p>
        <ul className="list-disc pl-5">
          {problems.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="text-left underline hover:no-underline"
                onClick={() => document.getElementById(p.id)?.focus()}
              >
                {p.message}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Focuses the first field to fix, after a save is stopped. */
export const focusFirst = (problems: FieldProblem[]) => {
  const first = problems[0];
  if (first) document.getElementById(first.id)?.focus();
};

/**
 * R10: how the package price is reached, in order: the included services' total, then the
 * discount or the price set by the firm, then the package price ($0 shown as free). Add-ons are
 * extra and tax is added on the invoice; a Custom Quote service leaves the total to the quote.
 */
export function PriceBreakdown({
  pricing,
  addOnCount,
}: {
  pricing: PackagePricing | null | undefined;
  addOnCount: number;
}) {
  const rows: [string, string][] = [];
  if (!pricing) {
    rows.push(['Included services', 'Add services to see the total']);
  } else {
    rows.push([
      'Included services',
      pricing.quoteRequired
        ? 'Quote required'
        : pricing.totalSelectedCents === null
          ? '—'
          : money(pricing.totalSelectedCents),
    ]);
    if (pricing.priceFrom === 'DISCOUNT' && pricing.discountValue !== null) {
      const off =
        pricing.totalSelectedCents !== null && pricing.packagePriceCents !== null
          ? pricing.totalSelectedCents - pricing.packagePriceCents
          : null;
      rows.push([
        pricing.discountType === 'PERCENTAGE'
          ? `Discount (${percent(pricing.discountValue)})`
          : 'Discount',
        off === null ? '—' : `− ${money(off)}`,
      ]);
    } else if (pricing.priceFrom === 'TYPED') {
      rows.push(['Price set by you', 'Any discount is already in it']);
    }
    rows.push([
      'Package price',
      pricing.packagePriceCents === null
        ? pricing.quoteRequired
          ? 'Quote required'
          : 'Not set yet'
        : pricing.packagePriceCents === 0
          ? `${money(0)} (free)`
          : money(pricing.packagePriceCents),
    ]);
  }
  rows.push([
    'Optional add-ons',
    addOnCount === 0 ? 'None offered' : `${addOnCount} offered, each extra, chosen by the client`,
  ]);
  rows.push(['Tax', 'Added on the invoice, from your tax rates']);
  return (
    <div data-testid="price-breakdown" className="rounded-lg bg-canvas p-3 text-sm">
      <p className="font-semibold text-heading">How the price is worked out</p>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-heading">{value}</dd>
          </div>
        ))}
      </dl>
      {pricing?.quoteRequired ? (
        <p className="mt-2 text-xs text-muted">
          A Custom Quote service is included, so the total and the savings are known only once it is
          quoted.
        </p>
      ) : null}
    </div>
  );
}
