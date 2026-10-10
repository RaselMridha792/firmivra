import { z } from 'zod';
import { BPS, minusFloor0, toCents } from './engine/money.js';
import { progressiveTax } from './engine/brackets.js';
import {
  type CalculatorCents,
  CURRENT_TAX_YEAR,
  FilingStatus,
  CalculatorMoney,
  type SupportedTaxYear,
} from './schemas.js';
import { taxYearConstants } from './tax-years/index.js';

// The Tax Bracket Calculator (Octavia's Calculator_Tax_Bracket_Guide.pdf): annual income, minus
// adjustments = AGI, minus the standard or itemized deduction = taxable income (never below 0),
// then the filing status's progressive brackets = federal income tax before credits. No credits,
// no self-employment tax, no refund (guide §2, §13). Runs in the browser; nothing is stored.

const Person = z.strictObject({
  age65OrOlder: z.boolean().default(false),
  blind: z.boolean().default(false),
});

/** What the person enters, in dollars (at most 2 decimals; the screen sends a blank as 0). */
export const TaxBracketInput = z
  .strictObject({
    filingStatus: FilingStatus,
    annualIncome: CalculatorMoney,
    /** "Adjustments to Income" (optional, §4 D). */
    adjustments: CalculatorMoney.default(0),
    deductionType: z.enum(['STANDARD', 'ITEMIZED']),
    /** "Estimated Itemized Deductions"; used only with ITEMIZED. */
    itemizedDeductions: CalculatorMoney.default(0),
    /** 65 or older at the end of the tax year, and blind under IRS rules (§6). */
    taxpayer: Person.default({ age65OrOlder: false, blind: false }),
    /** Married Filing Jointly only. */
    spouse: Person.optional(),
    /** Married Filing Separately only: "Will your spouse itemize deductions?" (§6). */
    mfsSpouseItemizes: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    if (input.spouse && input.filingStatus !== 'MARRIED_JOINT') {
      ctx.addIssue({
        code: 'custom',
        path: ['spouse'],
        message: 'Only for Married Filing Jointly',
      });
    }
    if (input.mfsSpouseItemizes && input.filingStatus !== 'MARRIED_SEPARATE') {
      ctx.addIssue({
        code: 'custom',
        path: ['mfsSpouseItemizes'],
        message: 'Only for Married Filing Separately',
      });
    }
  });
export type TaxBracketInput = z.input<typeof TaxBracketInput>;

/**
 * Notes for the screen:
 * - MFS_STANDARD_NOT_ALLOWED: MFS and the spouse itemizes, so the standard deduction is $0; ask
 *   for itemized deductions.
 * - ITEMIZED_BELOW_STANDARD: the entered itemized amount is used (the bracket guide), but the
 *   standard deduction would be larger.
 */
export type TaxBracketNotice = 'MFS_STANDARD_NOT_ALLOWED' | 'ITEMIZED_BELOW_STANDARD';

/** One row of the "How Your Tax Is Calculated" table. Amounts in cents, rate as a fraction. */
export interface TaxBracketSlice {
  from: CalculatorCents;
  to: CalculatorCents | null;
  /** 0.22 for 22%. */
  rate: number;
  amount: CalculatorCents;
  tax: CalculatorCents;
}

/**
 * The result. Every amount is integer cents (`12_345` is $123.45); rates are fractions for
 * display only (0.22 is 22%). The tax is rounded per the year's `taxRounding` (whole dollars in
 * 2026), and the slices add up to it exactly.
 */
export interface TaxBracketResult {
  taxYear: SupportedTaxYear;
  filingStatus: FilingStatus;
  annualIncome: CalculatorCents;
  adjustments: CalculatorCents;
  /** Annual income minus adjustments, never below 0. */
  agi: CalculatorCents;
  /** "2026 Standard Deduction Applied": the base amount plus the age/blind add-on (0 when not allowed). */
  standardDeduction: {
    base: CalculatorCents;
    ageBlindAddOn: CalculatorCents;
    amount: CalculatorCents;
  };
  /** The deduction used. */
  deduction: { type: 'STANDARD' | 'ITEMIZED'; amount: CalculatorCents };
  standardDeductionApplied: boolean;
  taxableIncome: CalculatorCents;
  /** The rate on the highest portion of taxable income (the first bracket's at $0). */
  marginalRate: number;
  taxBeforeCredits: CalculatorCents;
  /** taxBeforeCredits / taxableIncome; null ("N/A") when taxable income is $0. */
  effectiveRate: number | null;
  slices: TaxBracketSlice[];
  /** The filing status's whole table, for the bracket chart (§12). */
  brackets: { from: CalculatorCents; to: CalculatorCents | null; rate: number }[];
  notices: TaxBracketNotice[];
}

const MARRIED_ADD_ON: ReadonlySet<FilingStatus> = new Set([
  'MARRIED_JOINT',
  'MARRIED_SEPARATE',
  'QUALIFYING_SURVIVING_SPOUSE',
]);

/**
 * The Tax Bracket Calculator's estimate. Throws a ZodError for input the schema refuses (the
 * screen validates first with `TaxBracketInput.safeParse`). Show the firm's disclaimer with it.
 */
export function estimateTaxBracket(
  rawInput: TaxBracketInput,
  year: SupportedTaxYear = CURRENT_TAX_YEAR,
): TaxBracketResult {
  const input = TaxBracketInput.parse(rawInput);
  const c = taxYearConstants(year);
  const status = input.filingStatus;
  const notices: TaxBracketNotice[] = [];

  const annualIncome = toCents(input.annualIncome);
  const adjustments = toCents(input.adjustments);
  const agi = minusFloor0(annualIncome, adjustments);

  const standardAllowed = !(status === 'MARRIED_SEPARATE' && input.mfsSpouseItemizes);
  const conditions = [input.taxpayer, ...(input.spouse ? [input.spouse] : [])].reduce(
    (n, p) => n + Number(p.age65OrOlder) + Number(p.blind),
    0,
  );
  const perCondition = MARRIED_ADD_ON.has(status)
    ? c.ageBlindAddOnCents.married
    : c.ageBlindAddOnCents.unmarried;
  const base = standardAllowed ? c.standardDeductionCents[status] : 0;
  const ageBlindAddOn = standardAllowed ? conditions * perCondition : 0;
  const standardDeduction = { base, ageBlindAddOn, amount: base + ageBlindAddOn };

  const itemized = toCents(input.itemizedDeductions);
  const useStandard = input.deductionType === 'STANDARD';
  if (!standardAllowed && useStandard) notices.push('MFS_STANDARD_NOT_ALLOWED');
  if (!useStandard && itemized < standardDeduction.amount) notices.push('ITEMIZED_BELOW_STANDARD');
  const deduction = {
    type: input.deductionType,
    amount: useStandard ? standardDeduction.amount : itemized,
  };

  const taxableIncome = minusFloor0(agi, deduction.amount);
  const schedule = c.brackets[status];
  const tax = progressiveTax(taxableIncome, schedule, c.taxRounding);
  const rate = (bps: number) => bps / BPS;

  let from = 0;
  const brackets = schedule.map((b) => {
    const row = { from, to: b.upToCents, rate: rate(b.rateBps) };
    from = b.upToCents ?? from;
    return row;
  });

  return {
    taxYear: year,
    filingStatus: status,
    annualIncome,
    adjustments,
    agi,
    standardDeduction,
    deduction,
    standardDeductionApplied: useStandard,
    taxableIncome,
    marginalRate: rate(tax.marginalRateBps),
    taxBeforeCredits: tax.totalCents,
    effectiveRate: taxableIncome === 0 ? null : tax.totalCents / taxableIncome,
    slices: tax.slices.map((s) => ({
      from: s.fromCents,
      to: s.toCents,
      rate: rate(s.rateBps),
      amount: s.amountCents,
      tax: s.taxCents,
    })),
    brackets,
    notices,
  };
}
