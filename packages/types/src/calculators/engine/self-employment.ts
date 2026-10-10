import { BPS, divRoundHalfUp, minusFloor0 } from './money.js';
import type { TaxYearConstants } from '../tax-years/schema.js';

// Schedule SE for the estimators (internal): self-employment tax on a year's net business income,
// and its deductible half. Integer cents and basis points throughout.

const share = (cents: number, bps: number): number => divRoundHalfUp(cents * bps, BPS);

/**
 * 92.35% of net business income is net earnings; under the floor there is no tax. Social Security
 * tax applies only up to the wage base less W-2 wages, Medicare tax to all of it.
 */
export function selfEmploymentTax(
  netBusinessCents: number,
  w2WagesCents: number,
  c: TaxYearConstants,
): { taxCents: number; deductibleHalfCents: number } {
  const se = c.selfEmployment;
  const netEarnings = share(netBusinessCents, se.netEarningsBps);
  if (netEarnings < se.minNetEarningsCents) return { taxCents: 0, deductibleHalfCents: 0 };
  const taxCents =
    share(
      Math.min(netEarnings, minusFloor0(se.socialSecurityWageBaseCents, w2WagesCents)),
      se.socialSecurityBps,
    ) + share(netEarnings, se.medicareBps);
  return { taxCents, deductibleHalfCents: divRoundHalfUp(taxCents, 2) };
}
