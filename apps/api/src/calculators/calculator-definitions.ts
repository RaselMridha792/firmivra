import {
  type Calculator,
  CalculatorKey,
  type FirmCalculator,
  type TaxReturnConfig,
  TaxReturnConfig as TaxReturnConfigSchema,
} from '@firmivra/types';

// The calculators' definitions as data (R12 step 5; contract in packages/types/src/calculators).
// Each firm has at most one `calculator_definitions` row per key. A firm without a row gets the
// default definition below (on, first in the list); the row is created only when an Owner or
// Admin first changes it. The figures are PLACEHOLDERS (`config.placeholder: true`) until Octavia
// sends the list, and they change only with that list, never through the API.

/** One filing status's placeholder figures: the seven brackets' rates and the tops of the first six. */
const status = (
  key: TaxReturnConfig['filingStatuses'][number]['status'],
  label: string,
  standardDeduction: number,
  tops: number[],
) => {
  const rates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
  return {
    status: key,
    label,
    standardDeduction,
    brackets: rates.map((rate, i) => ({ rate, upTo: tops[i] ?? null })),
  };
};

/** The Tax Return Calculator's placeholder figures (the same as the web mock's). */
export const DEFAULT_TAX_RETURN_CONFIG: TaxReturnConfig = TaxReturnConfigSchema.parse({
  taxYear: 2025,
  placeholder: true,
  filingStatuses: [
    status('SINGLE', 'Single', 15_750, [11_925, 48_475, 103_350, 197_300, 250_525, 626_350]),
    status(
      'MARRIED_JOINT',
      'Married filing jointly',
      31_500,
      [23_850, 96_950, 206_700, 394_600, 501_050, 751_600],
    ),
    status(
      'MARRIED_SEPARATE',
      'Married filing separately',
      15_750,
      [11_925, 48_475, 103_350, 197_300, 250_525, 375_800],
    ),
    status(
      'HEAD_OF_HOUSEHOLD',
      'Head of household',
      23_625,
      [17_000, 64_850, 103_350, 197_300, 250_500, 626_350],
    ),
  ],
});

export interface CalculatorDefaults {
  title: string;
  disclaimer: string;
  enabled: boolean;
  sortOrder: number;
  config: TaxReturnConfig;
}

/** What a firm gets for each key before it changes anything. */
export const CALCULATOR_DEFAULTS: Record<CalculatorKey, CalculatorDefaults> = {
  tax_return: {
    title: 'Tax Return Calculator',
    disclaimer:
      'This calculator gives an estimate only and is not tax advice. Your actual tax may differ. Contact us for help with your return.',
    enabled: true,
    sortOrder: 0,
    config: DEFAULT_TAX_RETURN_CONFIG,
  },
};

/** The stored columns the API reads. */
export interface DefinitionRow {
  key: string;
  title: string;
  disclaimer: string;
  enabled: boolean;
  sortOrder: number;
  config: unknown;
}

/**
 * The figures to show: the stored config when it is a valid Tax Return configuration, otherwise
 * the default placeholder figures (a row created before the figures existed holds `{}` or a
 * note, and must never reach a screen as a broken definition).
 */
export function taxReturnConfigOf(stored: unknown): TaxReturnConfig {
  const parsed = TaxReturnConfigSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_TAX_RETURN_CONFIG;
}

/**
 * Every calculator the firm has, in list order: each known key's row, or its default when the
 * firm has no row. Rows with a key the API does not know are left out.
 */
export function firmCalculators(rows: readonly DefinitionRow[]): FirmCalculator[] {
  return CalculatorKey.options
    .map((key): FirmCalculator => {
      const row = rows.find((r) => r.key === key);
      const d = CALCULATOR_DEFAULTS[key];
      if (!row) return { key, ...d };
      return {
        key,
        title: row.title,
        disclaimer: row.disclaimer,
        enabled: row.enabled,
        sortOrder: row.sortOrder,
        config: taxReturnConfigOf(row.config),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** The client's view: enabled calculators only, without the firm's fields. */
export function clientCalculators(rows: readonly DefinitionRow[]): Calculator[] {
  return firmCalculators(rows)
    .filter((c) => c.enabled)
    .map(({ enabled: _enabled, sortOrder: _sortOrder, ...rest }) => rest);
}
