import {
  type Calculator,
  CALCULATOR_DEFAULT_TEXT,
  CalculatorKey,
  CURRENT_TAX_YEAR,
  type FirmCalculator,
} from '@firmivra/types';

// The calculators' definitions as data (R12 step 5, then R14 K1; contract in
// packages/types/src/calculators). Each firm has at most one `calculator_definitions` row per key.
// A firm without a row gets the default below (on, in the list order); the row is created only
// when an Owner or Admin first changes it. No figures go over the wire: the 2026 figures live in
// packages/types and every estimate runs in the browser. The stored `config` column is ignored.

export interface CalculatorDefaults {
  title: string;
  disclaimer: string;
  enabled: boolean;
  sortOrder: number;
}

/** What a firm gets for each key before it changes anything: Octavia's texts, all on. */
export const CALCULATOR_DEFAULTS: Record<CalculatorKey, CalculatorDefaults> = Object.fromEntries(
  CalculatorKey.options.map((key) => {
    const { title, disclaimer, sortOrder } = CALCULATOR_DEFAULT_TEXT[key];
    return [key, { title, disclaimer, enabled: true, sortOrder }];
  }),
) as Record<CalculatorKey, CalculatorDefaults>;

/** The stored columns the API reads. */
export interface DefinitionRow {
  key: string;
  title: string;
  disclaimer: string;
  enabled: boolean;
  sortOrder: number;
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
      const own = row
        ? {
            title: row.title,
            disclaimer: row.disclaimer,
            enabled: row.enabled,
            sortOrder: row.sortOrder,
          }
        : d;
      return {
        key,
        title: own.title,
        disclaimer: own.disclaimer,
        taxYear: CURRENT_TAX_YEAR,
        enabled: own.enabled,
        sortOrder: own.sortOrder,
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
