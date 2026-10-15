import { z } from 'zod';
import { minusFloor0, toCents, divRoundHalfUp } from './engine/money.js';
import { progressiveTax } from './engine/brackets.js';
import { selfEmploymentTax } from './engine/self-employment.js';
import {
  CURRENT_TAX_YEAR,
  CalculatorMoney,
  FilingStatus,
  type SupportedTaxYear,
} from './schemas.js';
import { taxYearConstants } from './tax-years/index.js';

// The 2026 Federal Tax Return Estimator, core version (Octavia's
// Calculator_Tax_Return_Estimator_Guide.pdf §6 order, steps 1-7 and 9 of the calculation). From the
// year's income, the standard or itemized deduction, withholding and estimated payments it gives
// the federal tax and the estimated refund or amount due. It runs in the browser; nothing is
// stored. Not included (the result says so): credits (child, dependent, earned income and the
// rest), the additional deductions of guide §2 (HSA, student loan, tips, overtime, senior,
// car-loan interest), qualified business income, capital gains and other taxes.

/** What the person enters, in dollars (the screen sends a blank as 0). */
export const TaxReturnInput = z.strictObject({
  filingStatus: FilingStatus,
  wages: CalculatorMoney.default(0),
  otherIncome: CalculatorMoney.default(0),
  /** Self-employment: gross receipts and business expenses (both 0 when not self-employed). */
  businessIncome: CalculatorMoney.default(0),
  businessExpenses: CalculatorMoney.default(0),
  deductionType: z.enum(['STANDARD', 'ITEMIZED']).default('STANDARD'),
  itemizedDeductions: CalculatorMoney.default(0),
  /** Married Filing Separately only: a spouse who itemizes leaves no standard deduction. */
  mfsSpouseItemizes: z.boolean().default(false),
  /** "Federal Income Tax Withheld" and "2026 Estimated Federal Tax Payments". */
  withholding: CalculatorMoney.default(0),
  estimatedPayments: CalculatorMoney.default(0),
});
export type TaxReturnInput = z.input<typeof TaxReturnInput>;

/**
 * - NOT_INCLUDED: credits, the special deductions, QBI, capital gains and other taxes are not in
 *   the estimate.
 * - MFS_STANDARD_NOT_ALLOWED: MFS and the spouse itemizes: the standard deduction is $0.
 * - BUSINESS_LOSS_NOT_USED: expenses above receipts count as no business income and no loss.
 * - STANDARD_LARGER: itemized deductions chosen, but the standard deduction is larger, so it was used.
 */
export type TaxReturnNotice =
  'NOT_INCLUDED' | 'MFS_STANDARD_NOT_ALLOWED' | 'BUSINESS_LOSS_NOT_USED' | 'STANDARD_LARGER';

/** Amounts in cents, rounded to whole dollars where tax is. `refundOrDue` is negative when owed. */
export interface TaxReturnResult {
  taxYear: SupportedTaxYear;
  totalIncome: number;
  /** The deduction used plus the deductible half of self-employment tax. */
  totalDeductions: number;
  deduction: { type: 'STANDARD' | 'ITEMIZED'; amount: number };
  taxableIncome: number;
  incomeTax: number;
  selfEmploymentTax: number;
  totalTax: number;
  taxPayments: number;
  /** Always 0 in the core version. */
  refundableCredits: number;
  /** Payments less total tax: positive is a refund, negative an amount due. */
  refundOrDue: number;
  notices: TaxReturnNotice[];
}

const roundDollar = (cents: number): number => divRoundHalfUp(cents, 100) * 100;

export function estimateTaxReturn(
  rawInput: TaxReturnInput,
  year: SupportedTaxYear = CURRENT_TAX_YEAR,
): TaxReturnResult {
  const input = TaxReturnInput.parse(rawInput);
  const c = taxYearConstants(year);
  const status = input.filingStatus;
  const notices: TaxReturnNotice[] = ['NOT_INCLUDED'];

  const wages = toCents(input.wages);
  const gross = toCents(input.businessIncome);
  const expenses = toCents(input.businessExpenses);
  if (expenses > gross) notices.push('BUSINESS_LOSS_NOT_USED');
  const net = minusFloor0(gross, expenses);
  const se = selfEmploymentTax(net, wages, c);

  const totalIncome = wages + toCents(input.otherIncome) + net;
  const agi = minusFloor0(totalIncome, se.deductibleHalfCents);

  const standardAllowed = !(status === 'MARRIED_SEPARATE' && input.mfsSpouseItemizes);
  const standard = standardAllowed ? c.standardDeductionCents[status] : 0;
  const itemized = toCents(input.itemizedDeductions);
  let deduction: TaxReturnResult['deduction'];
  if (input.deductionType === 'STANDARD') {
    if (!standardAllowed) notices.push('MFS_STANDARD_NOT_ALLOWED');
    deduction = { type: 'STANDARD', amount: standard };
  } else if (standard > itemized) {
    // Guide §6 step 5: the larger of the two when the standard deduction is allowed.
    notices.push('STANDARD_LARGER');
    deduction = { type: 'STANDARD', amount: standard };
  } else {
    deduction = { type: 'ITEMIZED', amount: itemized };
  }

  const taxableIncome = minusFloor0(agi, deduction.amount);
  const incomeTax = progressiveTax(taxableIncome, c.brackets[status], c.taxRounding).totalCents;
  const totalTax = roundDollar(incomeTax + se.taxCents);
  const taxPayments = toCents(input.withholding) + toCents(input.estimatedPayments);
  return {
    taxYear: year,
    totalIncome,
    totalDeductions: se.deductibleHalfCents + deduction.amount,
    deduction,
    taxableIncome,
    incomeTax,
    selfEmploymentTax: roundDollar(se.taxCents),
    totalTax,
    taxPayments,
    refundableCredits: 0,
    refundOrDue: taxPayments - totalTax,
    notices,
  };
}
