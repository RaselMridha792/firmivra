import { z } from 'zod';
import { text } from '../clients/text.js';

// Calculators (R12): the calculators a firm offers in its portal, the Tax Return Calculator
// first. A definition is data (rates, brackets per tax year); the estimate runs in the browser
// with `estimateTaxReturn` (./tax-return.ts) and is never stored. Every calculator shows its
// disclaimer. The values are placeholders until Octavia sends the list (`config.placeholder`).
// Firm routes: /api/v1/business/calculators (everyone reads; Owner and Admin turn calculators on
// or off and edit the title and disclaimer). Portal routes: /api/v1/portal/{firmSlug}/me/
// calculators (enabled ones, for every client).
// Responses are plain objects; requests are strict.

export const CalculatorKey = z.enum(['tax_return']);
export type CalculatorKey = z.infer<typeof CalculatorKey>;
export const FilingStatus = z.enum([
  'SINGLE',
  'MARRIED_JOINT',
  'MARRIED_SEPARATE',
  'HEAD_OF_HOUSEHOLD',
]);
export type FilingStatus = z.infer<typeof FilingStatus>;

/** A bracket: `rate` applies to income above the previous bracket up to `upTo` (null: no top). */
export const TaxBracket = z.object({
  upTo: z.number().positive().nullable(),
  rate: z.number().min(0).max(1),
});
export type TaxBracket = z.infer<typeof TaxBracket>;

/** Brackets go up, and only the last one is open-ended. */
const ascending = (brackets: TaxBracket[]) =>
  brackets.every((b, i) => {
    const last = i === brackets.length - 1;
    if (last) return b.upTo === null;
    const next = brackets[i + 1]?.upTo ?? Infinity;
    return b.upTo !== null && b.upTo < next;
  });

export const TaxReturnConfig = z.object({
  taxYear: z.number().int().min(2000).max(2100),
  filingStatuses: z
    .array(
      z.object({
        status: FilingStatus,
        label: z.string(),
        standardDeduction: z.number().nonnegative(),
        brackets: z
          .array(TaxBracket)
          .min(1)
          .refine(ascending, 'Brackets go up, and only the last has no top'),
      }),
    )
    .min(1),
  /** True while the figures are placeholders (not for real estimates). */
  placeholder: z.boolean(),
});
export type TaxReturnConfig = z.infer<typeof TaxReturnConfig>;

export const TaxReturnCalculator = z.object({
  key: z.literal('tax_return'),
  title: z.string(),
  /** Always shown with the result: an estimate, not tax advice. */
  disclaimer: z.string(),
  config: TaxReturnConfig,
});
export type TaxReturnCalculator = z.infer<typeof TaxReturnCalculator>;

/** One calculator, by key (more keys come with Octavia's list). */
export const Calculator = z.discriminatedUnion('key', [TaxReturnCalculator]);
export type Calculator = z.infer<typeof Calculator>;

export const CalculatorList = z.object({ items: z.array(Calculator) });
export type CalculatorList = z.infer<typeof CalculatorList>;

/** The firm's view adds whether clients see it, and its place in the list. */
export const FirmCalculator = z.discriminatedUnion('key', [
  TaxReturnCalculator.extend({ enabled: z.boolean(), sortOrder: z.number().int() }),
]);
export type FirmCalculator = z.infer<typeof FirmCalculator>;

export const FirmCalculatorList = z.object({ items: z.array(FirmCalculator) });
export type FirmCalculatorList = z.infer<typeof FirmCalculatorList>;

/** Owner and Admin; send only what changes. The figures change only with Octavia's list. */
export const UpdateCalculatorRequest = z
  .strictObject({
    enabled: z.boolean().optional(),
    title: text(80).optional(),
    disclaimer: text(2_000, 'many').optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateCalculatorRequest = z.input<typeof UpdateCalculatorRequest>;

// ---------- The Tax Return Calculator's inputs and result (in the browser) ----------
const Money = z.number().min(0).max(100_000_000);

/** What the client enters. Itemized deductions count only when above the standard deduction. */
export const TaxReturnInput = z.strictObject({
  filingStatus: FilingStatus,
  /** Total income for the year, in dollars. */
  income: Money,
  /** Federal tax already withheld or paid. */
  withheld: Money.default(0),
  itemizedDeductions: Money.optional(),
  credits: Money.default(0),
});
export type TaxReturnInput = z.input<typeof TaxReturnInput>;

export const TaxReturnEstimate = z.object({
  deduction: z.number(),
  taxableIncome: z.number(),
  /** Tax before credits. */
  tax: z.number(),
  /** Tax after credits, never below zero. */
  totalTax: z.number(),
  /** Positive: the client owes this; negative: an estimated refund. */
  balance: z.number(),
  /** totalTax / income, 0 to 1. */
  effectiveRate: z.number(),
});
export type TaxReturnEstimate = z.infer<typeof TaxReturnEstimate>;
