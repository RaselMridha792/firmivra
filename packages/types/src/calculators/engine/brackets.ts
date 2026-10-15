import type { BracketSchedule } from '../tax-years/schema.js';
import { assertWhole, divRoundHalfUp, PER_CENT, PER_DOLLAR } from './money.js';

// The progressive bracket engine (internal). Tax is computed one bracket at a time, never as
// taxable income x the top rate (bracket guide §9). Each slice's exact tax is an integer in
// cent-basis-points; the total and the slices are rounded together: slice k's tax is the rounded
// running total after k minus the rounded running total before it, so the slices always add up to
// the rounded total and none is negative.

export type TaxRounding = 'DOLLAR' | 'CENT';

export interface EngineSlice {
  /** The slice's lower end (the previous bracket's top), in cents. */
  fromCents: number;
  /** The bracket's top in cents; null for the open top bracket. */
  toCents: number | null;
  rateBps: number;
  /** Taxable income inside this bracket, in cents. */
  amountCents: number;
  /** The slice's tax, in cents, rounded as above. */
  taxCents: number;
}

export interface ProgressiveTax {
  /** The total tax in cents, rounded to `rounding`. */
  totalCents: number;
  /** The exact total in cent-basis-points (1/10,000 of a cent), before rounding. */
  exactCentBps: number;
  /** One slice per bracket the income reaches (none for zero taxable income). */
  slices: EngineSlice[];
  /** The rate on the highest portion: the bracket holding the last cent (tops inclusive); the first bracket at zero. */
  marginalRateBps: number;
}

const roundTo = (centBps: number, rounding: TaxRounding): number =>
  rounding === 'CENT'
    ? divRoundHalfUp(centBps, PER_CENT)
    : divRoundHalfUp(centBps, PER_DOLLAR) * 100;

export function progressiveTax(
  taxableCents: number,
  schedule: BracketSchedule,
  rounding: TaxRounding,
): ProgressiveTax {
  assertWhole(taxableCents);
  const slices: EngineSlice[] = [];
  let marginalRateBps = schedule[0]?.rateBps ?? 0;
  let lower = 0;
  let exact = 0;
  let roundedBefore = 0;
  for (const bracket of schedule) {
    if (taxableCents <= lower) break;
    const top = bracket.upToCents;
    const amountCents = Math.min(taxableCents, top ?? taxableCents) - lower;
    exact += amountCents * bracket.rateBps;
    const roundedAfter = roundTo(exact, rounding);
    slices.push({
      fromCents: lower,
      toCents: top,
      rateBps: bracket.rateBps,
      amountCents,
      taxCents: roundedAfter - roundedBefore,
    });
    roundedBefore = roundedAfter;
    marginalRateBps = bracket.rateBps;
    if (top === null) break;
    lower = top;
  }
  assertWhole(exact);
  return { totalCents: roundedBefore, exactCentBps: exact, slices, marginalRateBps };
}
