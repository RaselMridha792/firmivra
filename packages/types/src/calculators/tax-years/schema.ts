import { z } from 'zod';
import { FilingStatus } from '../schemas.js';

// The shape of one tax year's federal figures. Every amount is integer cents and every rate is
// integer basis points (2_200 = 22%), so the engines never multiply money by a float. A year's
// file parses itself with this schema when it loads: a typo stops the build's tests and the page,
// never a client's estimate.

const Cents = z.int().min(0).max(100_000_000_00);
const RateBps = z.int().min(0).max(10_000);
/** A share that may pass 100% (110% of last year's tax). */
const ShareBps = z.int().min(0).max(20_000);

/** `rateBps` applies to taxable income above the previous top up to `upToCents` (inclusive). */
export const BracketConstant = z.strictObject({
  upToCents: Cents.nullable(),
  rateBps: RateBps,
});
export type BracketConstant = z.infer<typeof BracketConstant>;

/** Seven brackets: tops strictly rising, rates strictly rising, only the last one open. */
export const BracketSchedule = z
  .array(BracketConstant)
  .length(7)
  .refine(
    (brackets) =>
      brackets.every((b, i) => {
        const last = i === brackets.length - 1;
        if (last !== (b.upToCents === null)) return false;
        const prev = brackets[i - 1];
        if (!prev) return b.upToCents !== 0;
        if (prev.upToCents === null || prev.rateBps >= b.rateBps) return false;
        return b.upToCents === null || prev.upToCents < b.upToCents;
      }),
    'Tops and rates go up, and only the last bracket has no top',
  );
export type BracketSchedule = z.infer<typeof BracketSchedule>;

const perStatus = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    SINGLE: value,
    MARRIED_JOINT: value,
    MARRIED_SEPARATE: value,
    HEAD_OF_HOUSEHOLD: value,
    QUALIFYING_SURVIVING_SPOUSE: value,
  });

export const TaxYearConstants = z
  .strictObject({
    taxYear: z.int().min(2026).max(2100),
    /** Where the figures come from, for the reviewer. */
    sources: z.array(z.string().min(1)).min(1),
    standardDeductionCents: perStatus(Cents),
    /**
     * The additional standard deduction per condition (65 or older, blind), per person:
     * `married` for MFJ, MFS and QSS; `unmarried` for Single and HOH. Standard deduction only.
     */
    ageBlindAddOnCents: z.strictObject({ married: Cents, unmarried: Cents }),
    brackets: perStatus(BracketSchedule),
    /**
     * How the bracket calculator rounds the tax it shows. DOLLAR: the guide's default (bracket
     * guide §17, "nearest whole dollar unless the product team chooses cents"). Each slice is
     * rounded so the slices add up to the rounded total. A data change if Octavia answers otherwise.
     */
    taxRounding: z.enum(['DOLLAR', 'CENT']),
    /** Self-employment tax (Schedule SE) and the Social Security wage base, for the estimators. */
    selfEmployment: z.strictObject({
      socialSecurityWageBaseCents: Cents,
      /** The share of net business income that is net earnings from self-employment (92.35%). */
      netEarningsBps: RateBps,
      socialSecurityBps: RateBps,
      medicareBps: RateBps,
      /** Net earnings below this owe no self-employment tax. */
      minNetEarningsCents: Cents,
    }),
    /** The estimated-tax safe harbors (Form 1040-ES, Publication 505). */
    estimatedTax: z.strictObject({
      currentYearBps: RateBps,
      priorYearBps: RateBps,
      /** The prior-year share when the prior year's AGI was above the threshold. */
      priorYearHighIncomeBps: ShareBps,
      highIncomeAgiCents: Cents,
      highIncomeAgiMarriedSeparateCents: Cents,
      /** Under this much owed after withholding, no estimated payment is required. */
      minimumOwedCents: Cents,
    }),
  })
  .refine(
    (c) => FilingStatus.options.every((s) => c.standardDeductionCents[s] > 0),
    'Every filing status has a standard deduction',
  );
export type TaxYearConstants = z.infer<typeof TaxYearConstants>;
