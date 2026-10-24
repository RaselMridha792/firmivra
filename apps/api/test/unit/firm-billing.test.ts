import { describe, expect, it } from 'vitest';
import type { FirmBillingPlan } from '@firmivra/types';
import { blockersOf, estimateCents } from '../../src/settings/firm-billing.service.js';

const plan = (over: Partial<FirmBillingPlan> = {}): FirmBillingPlan => ({
  code: 'TEAM',
  name: 'Team',
  priceCents: 9_900,
  billingCycle: 'MONTHLY',
  includedSeats: 5,
  maxSeats: null,
  seatPriceCents: 1_500,
  includedLocations: 1,
  locationPriceCents: 2_500,
  features: [],
  ...over,
});

describe('blockersOf: what stops a plan change today', () => {
  it('seats: the ceiling, or the included seats when the plan sells none', () => {
    expect(blockersOf(plan({ maxSeats: 6 }), 7, 0)).toEqual([
      '7 active staff users; Team allows 6',
    ]);
    expect(blockersOf(plan({ maxSeats: 6 }), 6, 0)).toEqual([]);
    expect(blockersOf(plan({ seatPriceCents: null }), 6, 0)).toEqual([
      '6 active staff users; Team allows 5',
    ]);
    // It sells seats and has no ceiling: any number fits (extra seats are billed).
    expect(blockersOf(plan(), 40, 0)).toEqual([]);
  });

  it('locations: only when the plan sells none above what it includes', () => {
    expect(blockersOf(plan({ locationPriceCents: null }), 1, 2)).toEqual([
      '2 active locations; Team includes 1',
    ]);
    expect(blockersOf(plan(), 1, 4)).toEqual([]);
  });
});

describe("estimateCents: the plan's price at today's usage", () => {
  it('adds the extra seats and locations it sells, per the cycle asked for', () => {
    expect(estimateCents(plan(), 'MONTHLY', 3, 1)).toBe(9_900);
    // 2 seats and 1 location above what it includes.
    expect(estimateCents(plan(), 'MONTHLY', 7, 2)).toBe(9_900 + 2 * 1_500 + 2_500);
    // A plan that sells none never charges for them.
    expect(
      estimateCents(plan({ seatPriceCents: null, locationPriceCents: null }), 'MONTHLY', 9, 3),
    ).toBe(9_900);
    expect(estimateCents(plan(), 'ANNUAL', 3, 1)).toBe(9_900 * 12);
  });
});
