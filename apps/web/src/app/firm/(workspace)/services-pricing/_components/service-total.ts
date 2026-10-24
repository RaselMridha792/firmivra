import type { PricingType } from '@firmivra/types';

/** Quantity × rate of one line, in cents (spec §6: calculated automatically). */
export const lineCents = (line?: { quantity?: number; rateCents?: number }) =>
  Math.round(
    (typeof line?.quantity === 'number' && Number.isFinite(line.quantity) ? line.quantity : 0) *
      (line?.rateCents ?? 0),
  );

/**
 * What the service costs, as the API works it out (`serviceTotalCents` in the catalog, Octavia's
 * S6): no price for a Custom Quote; ADDITIVE line items add to the base price ($100.50 and a
 * $75.00 line make $175.50); INCLUDED ones only explain it, so nothing is charged twice. The
 * editors show it as Total Price and in the client preview while the form is being filled in.
 */
export function serviceTotalCents(v: {
  pricingType?: PricingType;
  basePriceCents?: number | null;
  lineItemsMode?: 'INCLUDED' | 'ADDITIVE';
  lineItems?: { quantity?: number; rateCents?: number }[];
}): number | null {
  if (v.pricingType === 'CUSTOM_QUOTE') return null;
  const base = v.basePriceCents ?? null;
  if (v.lineItemsMode !== 'ADDITIVE' || !v.lineItems?.length) return base;
  return (base ?? 0) + v.lineItems.reduce((sum, line) => sum + lineCents(line), 0);
}
