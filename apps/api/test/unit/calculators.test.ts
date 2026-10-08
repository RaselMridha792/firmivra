// Unit tests for R12 step 5, the calculators' definitions as data: the default for a firm with no
// row, the placeholder figures standing in for a stored config that is not a valid definition,
// the client's view (enabled only), and the update body's refusal of half a surrogate pair.
import { describe, expect, it } from 'vitest';
import { Calculator, estimateTaxReturn, FirmCalculator, TaxReturnConfig } from '@firmivra/types';
import {
  CALCULATOR_DEFAULTS,
  clientCalculators,
  DEFAULT_TAX_RETURN_CONFIG,
  type DefinitionRow,
  firmCalculators,
  taxReturnConfigOf,
} from '../../src/calculators/calculator-definitions.js';
import { UpdateBody } from '../../src/calculators/calculators.input.js';

const row = (extra: Partial<DefinitionRow> = {}): DefinitionRow => ({
  key: 'tax_return',
  title: 'Estimate your return (fake)',
  disclaimer: 'Estimate only (fake).',
  enabled: true,
  sortOrder: 3,
  config: DEFAULT_TAX_RETURN_CONFIG,
  ...extra,
});

describe('default definition', () => {
  it('is a valid placeholder Tax Return definition for every filing status', () => {
    expect(TaxReturnConfig.parse(DEFAULT_TAX_RETURN_CONFIG)).toEqual(DEFAULT_TAX_RETURN_CONFIG);
    expect(DEFAULT_TAX_RETURN_CONFIG.placeholder).toBe(true);
    expect(DEFAULT_TAX_RETURN_CONFIG.filingStatuses.map((s) => s.status)).toEqual([
      'SINGLE',
      'MARRIED_JOINT',
      'MARRIED_SEPARATE',
      'HEAD_OF_HOUSEHOLD',
    ]);
    // A worked example on the shared estimate: 60,000 single, standard deduction 15,750.
    const estimate = estimateTaxReturn(DEFAULT_TAX_RETURN_CONFIG, {
      filingStatus: 'SINGLE',
      income: 60_000,
      withheld: 6_000,
    });
    expect(estimate.taxableIncome).toBe(44_250);
    expect(estimate.tax).toBe(5071.5); // 11,925 at 10% and 32,325 at 12%
    expect(estimate.balance).toBeLessThan(0);
  });

  it('a firm with no row gets the default, on and first', () => {
    const [only, ...rest] = firmCalculators([]);
    expect(rest).toEqual([]);
    expect(FirmCalculator.parse(only)).toEqual({
      key: 'tax_return',
      ...CALCULATOR_DEFAULTS.tax_return,
    });
    expect(clientCalculators([]).map((c) => c.key)).toEqual(['tax_return']);
  });
});

describe('stored rows', () => {
  it('a row gives its own title, disclaimer, on/off and order', () => {
    const [c] = firmCalculators([row()]);
    expect(c).toMatchObject({
      title: 'Estimate your return (fake)',
      disclaimer: 'Estimate only (fake).',
      enabled: true,
      sortOrder: 3,
    });
  });

  it('a config that is not a valid definition shows the placeholder figures', () => {
    for (const bad of [
      {},
      null,
      'x',
      { taxYear: 2025, note: 'Sample figures for local development only.' },
      { ...DEFAULT_TAX_RETURN_CONFIG, filingStatuses: [] },
    ]) {
      expect(taxReturnConfigOf(bad)).toBe(DEFAULT_TAX_RETURN_CONFIG);
      expect(firmCalculators([row({ config: bad })])[0]?.config).toBe(DEFAULT_TAX_RETURN_CONFIG);
    }
    const real = { ...DEFAULT_TAX_RETURN_CONFIG, taxYear: 2026, placeholder: false };
    expect(taxReturnConfigOf(real)).toEqual(real);
  });

  it('rows with a key the API does not know are left out', () => {
    expect(firmCalculators([row(), row({ key: 'mortgage' })]).map((c) => c.key)).toEqual([
      'tax_return',
    ]);
  });

  it('clients see enabled calculators only, without the firm fields', () => {
    expect(clientCalculators([row({ enabled: false })])).toEqual([]);
    const [mine] = clientCalculators([row()]);
    expect(mine).not.toHaveProperty('enabled');
    expect(mine).not.toHaveProperty('sortOrder');
    expect(Calculator.parse(mine)).toEqual(mine);
  });
});

describe('UpdateBody', () => {
  it('takes what the contract takes', () => {
    expect(UpdateBody.parse({ enabled: false })).toEqual({ enabled: false });
    expect(UpdateBody.parse({ title: '  Tax estimate 🧾 ' })).toEqual({ title: 'Tax estimate 🧾' });
    expect(UpdateBody.parse({ disclaimer: 'Line one\nLine two' })).toEqual({
      disclaimer: 'Line one\nLine two',
    });
  });

  it('refuses half a surrogate pair, NUL, nothing to change and unknown fields', () => {
    for (const bad of [
      { title: 'Tax \ud800 estimate' },
      { disclaimer: 'Estimate \udc00' },
      { title: 'Tax\u0000' },
      { disclaimer: 'Estimate\u0000only' },
      {},
      { config: {} },
      { title: '   ' },
      { title: 'x'.repeat(81) },
      { enabled: 'yes' },
    ]) {
      expect(UpdateBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
