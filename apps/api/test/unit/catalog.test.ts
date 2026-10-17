// The catalog's calculations and mappings (R55): package pricing and savings, discounts, category
// tones, promotion status from dates, and the audit diff.
import { describe, expect, it } from 'vitest';
import { promotionStatus } from '../../src/catalog/catalog-promotions.service.js';
import {
  discountColumns,
  discountOf,
  diff,
  packagePricing,
  priceOf,
  statusOf,
  toneOf,
  TONE_COLORS,
} from '../../src/catalog/catalog.shared.js';

const fixed = (cents: number) => ({ basePriceCents: cents, pricingType: 'FIXED' as const });
const none = { discountType: 'NONE' as const, discountValue: null };

describe('packagePricing', () => {
  it('totals the included services and works out the savings against the package price', () => {
    expect(
      packagePricing({
        included: [fixed(10_000), fixed(8_000)],
        packagePriceCents: 15_000,
        ...none,
      }),
    ).toEqual({
      totalSelectedCents: 18_000,
      packagePriceCents: 15_000,
      discountType: 'NONE',
      discountValue: null,
      savingsCents: 3_000,
      savingsPercent: 16.67,
      variablePrice: false,
    });
  });

  it('never reports negative savings when the package costs more than its services', () => {
    const p = packagePricing({ included: [fixed(1_000)], packagePriceCents: 2_000, ...none });
    expect(p.savingsCents).toBe(0);
    expect(p.savingsPercent).toBe(0);
  });

  it('works the price out from a percentage or a fixed discount when none is given', () => {
    const percent = packagePricing({
      included: [fixed(10_000), fixed(8_000)],
      packagePriceCents: null,
      discountType: 'PERCENTAGE',
      discountValue: 2_000,
    });
    expect([percent.packagePriceCents, percent.savingsCents]).toEqual([14_400, 3_600]);
    const cents = packagePricing({
      included: [fixed(10_000)],
      packagePriceCents: null,
      discountType: 'FIXED',
      discountValue: 2_500,
    });
    expect([cents.packagePriceCents, cents.savingsCents, cents.savingsPercent]).toEqual([
      7_500, 2_500, 25,
    ]);
  });

  it('keeps the price the firm set even when a discount is also given', () => {
    const p = packagePricing({
      included: [fixed(10_000)],
      packagePriceCents: 9_000,
      discountType: 'PERCENTAGE',
      discountValue: 500,
    });
    expect(p.packagePriceCents).toBe(9_000);
  });

  it('refuses a discount that makes the price negative or is above 100%', () => {
    const attempt = (discountType: 'PERCENTAGE' | 'FIXED', discountValue: number) => () =>
      packagePricing({
        included: [fixed(10_000)],
        packagePriceCents: null,
        discountType,
        discountValue,
      });
    expect(attempt('FIXED', 10_001)).toThrow(/more than the services cost/);
    expect(attempt('PERCENTAGE', 10_001)).toThrow();
    expect(attempt('FIXED', 10_000)).not.toThrow();
  });

  it('calls savings an estimate when a variable-priced service is included', () => {
    for (const pricingType of ['STARTING_AT', 'HOURLY', 'CUSTOM_QUOTE'] as const) {
      const p = packagePricing({
        included: [fixed(10_000), { basePriceCents: null, pricingType }],
        packagePriceCents: 9_000,
        ...none,
      });
      expect([p.variablePrice, p.savingsCents, p.savingsPercent]).toEqual([true, null, null]);
    }
  });

  it('has no savings without a price or without any service', () => {
    expect(
      packagePricing({ included: [fixed(1_000)], packagePriceCents: null, ...none }).savingsCents,
    ).toBeNull();
    expect(
      packagePricing({ included: [], packagePriceCents: 500, ...none }).savingsCents,
    ).toBeNull();
  });
});

describe('discount columns', () => {
  it('stores a percentage as a percent and reads it back as basis points', () => {
    const cols = discountColumns('PERCENTAGE', 1_250);
    expect(cols).toEqual({ discountType: 'PERCENT', discountPercent: 12.5, discountCents: null });
    expect(
      discountOf({
        discountType: 'PERCENT',
        discountPercent: 12.5 as never,
        discountCents: null,
      }),
    ).toEqual({ discountType: 'PERCENTAGE', discountValue: 1_250 });
  });

  it('stores a fixed amount in cents and no discount as nulls', () => {
    expect(discountColumns('FIXED', 2_500)).toEqual({
      discountType: 'FIXED',
      discountPercent: null,
      discountCents: 2_500,
    });
    expect(discountColumns('NONE', null)).toEqual({
      discountType: null,
      discountPercent: null,
      discountCents: null,
    });
    expect(discountOf({ discountType: null, discountPercent: null, discountCents: null })).toEqual({
      discountType: 'NONE',
      discountValue: null,
    });
  });
});

describe('tones, prices and statuses', () => {
  it('reads each stored tone colour back, in any case, and anything else as no tone', () => {
    for (const [tone, hex] of Object.entries(TONE_COLORS)) {
      expect(toneOf(hex)).toBe(tone);
      expect(toneOf(hex.toLowerCase())).toBe(tone);
    }
    expect(toneOf('#123456')).toBeNull();
    expect(toneOf(null)).toBeNull();
  });

  it('shows a custom quote with no amount, and a half-month billing as monthly', () => {
    expect(
      priceOf({ pricingType: 'CUSTOM_QUOTE', basePriceCents: 500, billingFrequency: null }),
    ).toEqual({ type: 'CUSTOM_QUOTE', amountCents: null, frequency: null });
    expect(
      priceOf({ pricingType: 'RECURRING', basePriceCents: 500, billingFrequency: 'SEMI_MONTHLY' })
        .frequency,
    ).toBe('MONTHLY');
  });

  it('archived hides every other status', () => {
    expect(statusOf({ status: 'ACTIVE', archivedAt: null })).toBe('ACTIVE');
    expect(statusOf({ status: 'ACTIVE', archivedAt: new Date() })).toBe('ARCHIVED');
  });
});

describe('promotionStatus', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const at = (s: string | null) => (s ? new Date(s) : null);
  const status = (
    state: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    startsAt: string | null,
    endsAt: string | null,
  ) => promotionStatus({ status: state, startsAt: at(startsAt), endsAt: at(endsAt) }, now);

  it('works Scheduled and Expired out from the dates of a live promotion', () => {
    expect(status('ACTIVE', null, null)).toBe('ACTIVE');
    expect(status('ACTIVE', '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z')).toBe('ACTIVE');
    expect(status('ACTIVE', '2026-07-01T00:00:00Z', null)).toBe('SCHEDULED');
    expect(status('ACTIVE', null, '2026-06-01T00:00:00Z')).toBe('EXPIRED');
  });

  it('leaves a draft and an ended promotion as they are, whatever the dates', () => {
    expect(status('DRAFT', '2026-07-01T00:00:00Z', null)).toBe('DRAFT');
    expect(status('INACTIVE', null, '2027-01-01T00:00:00Z')).toBe('INACTIVE');
  });
});

describe('diff', () => {
  it('lists only the fields that changed, with their old and new values', () => {
    expect(diff({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: 5 })).toEqual({
      fields: ['b', 'c'],
      from: { b: 'x', c: null },
      to: { b: 'y', c: 5 },
    });
    expect(diff({ list: ['a'] }, { list: ['a'] }).fields).toEqual([]);
  });
});
