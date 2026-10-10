import { z } from 'zod';
import { text } from '../clients/text.js';

// Calculators (R12, then R14): LVP's three federal tax calculators, in the signed-in portal and
// (from K5) as public pages. The API carries only each firm's on/off, title and disclaimer plus
// the tax year; the figures live in ./tax-years (integer cents, checked by zod at load) and every
// estimate runs in the browser (`estimateTaxBracket`, ./tax-bracket.ts). Nothing is computed on
// the server and no estimate is stored.
// Firm routes: /api/v1/business/calculators (everyone reads; Owner and Admin turn calculators on
// or off and edit the title and disclaimer). Portal routes: /api/v1/portal/{firmSlug}/me/
// calculators (enabled ones, for every client).
// Responses are plain objects; requests are strict.

export const CalculatorKey = z.enum(['tax_return', 'quarterly_estimate', 'tax_bracket']);
export type CalculatorKey = z.infer<typeof CalculatorKey>;

/** Each key's URL segment: /{firm}/calculators/{slug} (public), /{firm}/calculator/{slug} (signed in). */
export const CALCULATOR_SLUGS = {
  tax_return: 'tax-return',
  quarterly_estimate: 'quarterly-estimate',
  tax_bracket: 'tax-bracket',
} as const satisfies Record<CalculatorKey, string>;
export type CalculatorSlug = (typeof CALCULATOR_SLUGS)[CalculatorKey];

/** The key for a URL segment, or null for anything else (exact match, lower case). */
export function calculatorKeyFromSlug(slug: string): CalculatorKey | null {
  return CalculatorKey.options.find((key) => CALCULATOR_SLUGS[key] === slug) ?? null;
}

export const FilingStatus = z.enum([
  'SINGLE',
  'MARRIED_JOINT',
  'MARRIED_SEPARATE',
  'HEAD_OF_HOUSEHOLD',
  'QUALIFYING_SURVIVING_SPOUSE',
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/** The guides' labels, in the guides' order. */
export const FILING_STATUS_LABELS = {
  SINGLE: 'Single',
  MARRIED_JOINT: 'Married Filing Jointly',
  MARRIED_SEPARATE: 'Married Filing Separately',
  HEAD_OF_HOUSEHOLD: 'Head of Household',
  QUALIFYING_SURVIVING_SPOUSE: 'Qualifying Surviving Spouse',
} as const satisfies Record<FilingStatus, string>;

/** The tax years that have figures (./tax-years). 2027 joins as a union when the IRS publishes it. */
export const SupportedTaxYear = z.literal(2026);
export type SupportedTaxYear = z.infer<typeof SupportedTaxYear>;
/** The year every calculator shows today. */
export const CURRENT_TAX_YEAR: SupportedTaxYear = 2026;

/** One calculator: no figures on the wire. The screen's heading is `${taxYear} ${title}`. */
export const Calculator = z.object({
  key: CalculatorKey,
  title: z.string(),
  /** Always shown with the result: an estimate, not tax advice. */
  disclaimer: z.string(),
  taxYear: SupportedTaxYear,
});
export type Calculator = z.infer<typeof Calculator>;

export const CalculatorList = z.object({ items: z.array(Calculator) });
export type CalculatorList = z.infer<typeof CalculatorList>;

/** The firm's view adds whether clients see it, and its place in the list. */
export const FirmCalculator = Calculator.extend({
  enabled: z.boolean(),
  sortOrder: z.number().int(),
});
export type FirmCalculator = z.infer<typeof FirmCalculator>;

export const FirmCalculatorList = z.object({ items: z.array(FirmCalculator) });
export type FirmCalculatorList = z.infer<typeof FirmCalculatorList>;

/** Owner and Admin; send only what changes. The figures never change through the API. */
export const UpdateCalculatorRequest = z
  .strictObject({
    enabled: z.boolean().optional(),
    title: text(80).optional(),
    disclaimer: text(2_000, 'many').optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateCalculatorRequest = z.input<typeof UpdateCalculatorRequest>;

/**
 * A dollar amount someone types: 0 to 100,000,000 with at most 2 decimals. The screen turns a
 * blank into 0. The engines turn it into integer cents before any arithmetic.
 */
export const CalculatorMoney = z
  .number()
  .min(0, 'Enter 0 or more')
  .max(100_000_000, 'Enter at most $100,000,000')
  // A third decimal is at least 0.1 of a cent off; float noise at $100M is far below 1e-4 cents.
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-4, 'Use at most 2 decimals');
export type CalculatorMoney = z.infer<typeof CalculatorMoney>;

/** Integer cents in a result (never negative). `12_345` is $123.45. */
export type CalculatorCents = number;
