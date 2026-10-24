import { describe, expect, it } from 'vitest';
import { lineCents, serviceTotalCents } from './service-total';

// Octavia's S6: the editors' Total Price follows the API's rule for line items.
describe('serviceTotalCents', () => {
  const base = { pricingType: 'FIXED' as const, basePriceCents: 10_050 };
  const line = { quantity: 1, rateCents: 7_500 };

  it('adds ADDITIVE line items to the base price: $100.50 + $75.00 = $175.50', () => {
    expect(serviceTotalCents({ ...base, lineItemsMode: 'ADDITIVE', lineItems: [line] })).toBe(
      17_550,
    );
  });

  it('never charges INCLUDED line items twice', () => {
    expect(serviceTotalCents({ ...base, lineItemsMode: 'INCLUDED', lineItems: [line] })).toBe(
      10_050,
    );
    expect(serviceTotalCents({ ...base, lineItemsMode: 'ADDITIVE', lineItems: [] })).toBe(10_050);
  });

  it('has no price for a Custom Quote', () => {
    expect(
      serviceTotalCents({
        pricingType: 'CUSTOM_QUOTE',
        lineItemsMode: 'ADDITIVE',
        lineItems: [line],
      }),
    ).toBeNull();
  });

  it('works out a line from its quantity, and an unfinished quantity as nothing', () => {
    expect(lineCents({ quantity: 2.5, rateCents: 4_000 })).toBe(10_000);
    expect(lineCents({ quantity: Number.NaN, rateCents: 4_000 })).toBe(0);
  });
});
