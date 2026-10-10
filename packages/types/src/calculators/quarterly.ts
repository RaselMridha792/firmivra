import { z } from 'zod';
import { minusFloor0, toCents, BPS, divRoundHalfUp } from './engine/money.js';
import { progressiveTax } from './engine/brackets.js';
import {
  type CalculatorCents,
  CURRENT_TAX_YEAR,
  CalculatorMoney,
  FilingStatus,
  type SupportedTaxYear,
} from './schemas.js';
import { taxYearConstants } from './tax-years/index.js';

// The Quarterly Estimated Tax Calculator, "My Income Is Fairly Steady" path (Octavia's
// Calculator_Quarterly_Estimated_Tax_Guide.pdf §5, the regular installment method). It estimates
// the year's federal income tax and self-employment tax from projected full-year amounts, then the
// safe-harbor payment. It runs in the browser; nothing is stored. Not included (the result says
// so): credits, qualified business income and Schedule 1-A deductions, capital gains and
// dividends, other taxes. The "income varies" path is a separate engine.

/** What the person enters, in dollars (the screen sends a blank as 0). */
export const QuarterlySteadyInput = z.strictObject({
  filingStatus: FilingStatus,
  /** Expected W-2 wages for the year. */
  wages: CalculatorMoney.default(0),
  /** Self-employment: projected gross receipts and deductible business expenses. */
  businessIncome: CalculatorMoney.default(0),
  businessExpenses: CalculatorMoney.default(0),
  /** Other ordinary taxable income (interest, rent and so on). */
  otherIncome: CalculatorMoney.default(0),
  deductionType: z.enum(['STANDARD', 'ITEMIZED']).default('STANDARD'),
  itemizedDeductions: CalculatorMoney.default(0),
  /** Married Filing Separately only: a spouse who itemizes leaves no standard deduction. */
  mfsSpouseItemizes: z.boolean().default(false),
  /** Expected federal income tax withholding for the year. */
  withholding: CalculatorMoney.default(0),
  /** Last year's return, when it covered 12 months, for the prior-year safe harbor. */
  priorYear: z
    .strictObject({
      totalTax: CalculatorMoney,
      agi: CalculatorMoney,
      coveredTwelveMonths: z.boolean(),
    })
    .optional(),
});
export type QuarterlySteadyInput = z.input<typeof QuarterlySteadyInput>;

/**
 * - NO_PAYMENT_REQUIRED: under the minimum is owed after withholding, so no payment is due.
 * - MFS_STANDARD_NOT_ALLOWED: MFS and the spouse itemizes: the standard deduction is $0.
 * - BUSINESS_LOSS_NOT_USED: expenses above receipts count as no business income and no loss.
 * - NOT_INCLUDED: credits, QBI, Schedule 1-A deductions and other taxes are not in the estimate.
 */
export type QuarterlySteadyNotice =
  'NO_PAYMENT_REQUIRED' | 'MFS_STANDARD_NOT_ALLOWED' | 'BUSINESS_LOSS_NOT_USED' | 'NOT_INCLUDED';

/** Every amount is cents rounded to whole dollars; the guide's letters are in the comments. */
export interface QuarterlySteadyResult {
  taxYear: SupportedTaxYear;
  /** Taxable income after the deduction. */
  taxableIncome: CalculatorCents;
  incomeTax: CalculatorCents;
  selfEmploymentTax: CalculatorCents;
  /** A: projected total tax. */
  projectedTotalTax: CalculatorCents;
  /** B: 90% of A. */
  currentYearAmount: CalculatorCents;
  /** C: 100% (110% above the AGI line) of last year's tax; null without an eligible prior year. */
  priorYearAmount: CalculatorCents | null;
  /** D: the smaller of B and C (B alone without C). */
  requiredAnnualPayment: CalculatorCents;
  /** E: D less withholding, never below 0 (0 when under the minimum is owed). */
  requiredAfterWithholding: CalculatorCents;
  /** F: "Safe-Harbor Estimated Payment" per payment (E / 4). */
  safeHarborPayment: CalculatorCents;
  /** G: "Suggested Estimated Payment" per payment (A less withholding, / 4). */
  suggestedPayment: CalculatorCents;
  notices: QuarterlySteadyNotice[];
}

const roundDollar = (cents: number): number => divRoundHalfUp(cents, 100) * 100;
const share = (cents: number, bps: number): number => divRoundHalfUp(cents * bps, BPS);

export function estimateQuarterlySteady(
  rawInput: QuarterlySteadyInput,
  year: SupportedTaxYear = CURRENT_TAX_YEAR,
): QuarterlySteadyResult {
  const input = QuarterlySteadyInput.parse(rawInput);
  const c = taxYearConstants(year);
  const status = input.filingStatus;
  const notices: QuarterlySteadyNotice[] = ['NOT_INCLUDED'];

  const wages = toCents(input.wages);
  const gross = toCents(input.businessIncome);
  const expenses = toCents(input.businessExpenses);
  if (expenses > gross) notices.push('BUSINESS_LOSS_NOT_USED');
  const net = minusFloor0(gross, expenses);

  // Schedule SE: 92.35% of net business income; Social Security tax only up to the wage base less
  // W-2 wages; Medicare tax on all of it. Under the floor, none.
  const se = c.selfEmployment;
  const netEarnings = share(net, se.netEarningsBps);
  const seTax =
    netEarnings < se.minNetEarningsCents
      ? 0
      : share(
          Math.min(netEarnings, minusFloor0(se.socialSecurityWageBaseCents, wages)),
          se.socialSecurityBps,
        ) + share(netEarnings, se.medicareBps);
  const halfSeTax = divRoundHalfUp(seTax, 2);

  const agi = minusFloor0(wages + net + toCents(input.otherIncome), halfSeTax);
  const standardAllowed = !(status === 'MARRIED_SEPARATE' && input.mfsSpouseItemizes);
  if (!standardAllowed && input.deductionType === 'STANDARD')
    notices.push('MFS_STANDARD_NOT_ALLOWED');
  const deduction =
    input.deductionType === 'STANDARD'
      ? standardAllowed
        ? c.standardDeductionCents[status]
        : 0
      : toCents(input.itemizedDeductions);
  const taxableIncome = minusFloor0(agi, deduction);
  const incomeTax = progressiveTax(taxableIncome, c.brackets[status], c.taxRounding).totalCents;

  const a = roundDollar(incomeTax + seTax);
  const e = c.estimatedTax;
  const b = roundDollar(share(a, e.currentYearBps));
  const prior = input.priorYear;
  let priorYearAmount: number | null = null;
  if (prior?.coveredTwelveMonths) {
    const line =
      status === 'MARRIED_SEPARATE' ? e.highIncomeAgiMarriedSeparateCents : e.highIncomeAgiCents;
    const bps = toCents(prior.agi) > line ? e.priorYearHighIncomeBps : e.priorYearBps;
    priorYearAmount = roundDollar(share(toCents(prior.totalTax), bps));
  }
  const required = priorYearAmount === null ? b : Math.min(b, priorYearAmount);
  const withholding = toCents(input.withholding);
  const owed = minusFloor0(a, withholding);
  const none = owed < e.minimumOwedCents;
  if (none) notices.push('NO_PAYMENT_REQUIRED');
  const afterWithholding = none ? 0 : minusFloor0(required, withholding);
  return {
    taxYear: year,
    taxableIncome,
    incomeTax,
    selfEmploymentTax: roundDollar(seTax),
    projectedTotalTax: a,
    currentYearAmount: b,
    priorYearAmount,
    requiredAnnualPayment: required,
    requiredAfterWithholding: afterWithholding,
    safeHarborPayment: roundDollar(afterWithholding / 4),
    suggestedPayment: roundDollar(owed / 4),
    notices,
  };
}
