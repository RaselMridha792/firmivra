import { type TaxReturnConfig, type TaxReturnEstimate, TaxReturnInput } from './schemas.js';

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The Tax Return Calculator's estimate, in the browser (results are never stored): the larger of
 * the standard and itemized deduction, the brackets for the filing status, then credits and what
 * was withheld. Throws for a filing status the configuration does not have; screens offer only
 * the configured ones. Show the calculator's disclaimer with every result.
 */
export function estimateTaxReturn(
  config: TaxReturnConfig,
  rawInput: TaxReturnInput,
): TaxReturnEstimate {
  const input = TaxReturnInput.parse(rawInput);
  const status = config.filingStatuses.find((s) => s.status === input.filingStatus);
  if (!status) throw new Error(`No ${input.filingStatus} figures for ${config.taxYear}`);

  const deduction = Math.max(status.standardDeduction, input.itemizedDeductions ?? 0);
  const taxableIncome = Math.max(0, input.income - deduction);
  let tax = 0;
  let lower = 0;
  for (const bracket of status.brackets) {
    const upper = bracket.upTo ?? Infinity;
    if (taxableIncome > lower) tax += (Math.min(taxableIncome, upper) - lower) * bracket.rate;
    if (taxableIncome <= upper) break;
    lower = upper;
  }
  const totalTax = Math.max(0, cents(tax) - input.credits);
  return {
    deduction: cents(deduction),
    taxableIncome: cents(taxableIncome),
    tax: cents(tax),
    totalTax: cents(totalTax),
    balance: cents(totalTax - input.withheld),
    effectiveRate: input.income > 0 ? Math.round((totalTax / input.income) * 10_000) / 10_000 : 0,
  };
}
