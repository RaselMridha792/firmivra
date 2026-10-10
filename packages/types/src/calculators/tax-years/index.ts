import type { SupportedTaxYear } from '../schemas.js';
import { TAX_YEAR_2026 } from './2026.js';
import type { TaxYearConstants } from './schema.js';

export { BracketConstant, BracketSchedule, TaxYearConstants } from './schema.js';
export { TAX_YEAR_2026 } from './2026.js';

/** Every year with figures, keyed by tax year. */
export const TAX_YEARS: Readonly<Record<SupportedTaxYear, TaxYearConstants>> = {
  2026: TAX_YEAR_2026,
};

/** One year's figures; throws for a year without them (the schemas accept supported years only). */
export function taxYearConstants(year: SupportedTaxYear): TaxYearConstants {
  const found = (TAX_YEARS as Partial<Record<number, TaxYearConstants>>)[year];
  if (!found) throw new Error(`No federal figures for tax year ${String(year)}`);
  return found;
}
