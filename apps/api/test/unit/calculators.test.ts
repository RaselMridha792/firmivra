// Unit tests for the calculators' definitions as data (R12 step 5, R14 K1): the three defaults for
// a firm with no row, a stored config that is ignored, the client's view (enabled only), and the
// update body's refusal of half a surrogate pair. No figures and no estimates on the server.
import { describe, expect, it } from 'vitest';
import {
  Calculator,
  CALCULATOR_DEFAULT_TEXT,
  CalculatorKey,
  FirmCalculator,
} from '@firmivra/types';
import {
  CALCULATOR_DEFAULTS,
  clientCalculators,
  type DefinitionRow,
  firmCalculators,
} from '../../src/calculators/calculator-definitions.js';
import { UpdateBody } from '../../src/calculators/calculators.input.js';

const KEYS = ['tax_return', 'quarterly_estimate', 'tax_bracket'];

const row = (extra: Partial<DefinitionRow> = {}): DefinitionRow => ({
  key: 'tax_return',
  title: 'Estimate your return (fake)',
  disclaimer: 'Estimate only (fake).',
  enabled: true,
  sortOrder: 3,
  ...extra,
});

describe('default definitions', () => {
  it('a firm with no row gets the three calculators, on, in order, for 2026', () => {
    const all = firmCalculators([]);
    expect(all.map((c) => c.key)).toEqual(KEYS);
    for (const c of all) {
      expect(FirmCalculator.parse(c)).toEqual(c);
      expect(c).toEqual({ key: c.key, taxYear: 2026, ...CALCULATOR_DEFAULTS[c.key] });
      expect(c).not.toHaveProperty('config');
    }
    expect(all.map((c) => c.sortOrder)).toEqual([0, 1, 2]);
    expect(clientCalculators([]).map((c) => c.key)).toEqual(KEYS);
  });

  it("uses the plan's titles and Octavia's disclaimers", () => {
    expect(CALCULATOR_DEFAULTS.tax_return.title).toBe('Federal Tax Return Estimator');
    expect(CALCULATOR_DEFAULTS.quarterly_estimate.title).toBe('Quarterly Estimated Tax Calculator');
    expect(CALCULATOR_DEFAULTS.tax_bracket.title).toBe('Federal Tax Bracket Calculator');
    for (const key of CalculatorKey.options) {
      const d = CALCULATOR_DEFAULTS[key];
      expect(d).toMatchObject({
        disclaimer: CALCULATOR_DEFAULT_TEXT[key].disclaimer,
        enabled: true,
      });
      // An Owner could send the default text back unchanged.
      expect(UpdateBody.safeParse({ title: d.title, disclaimer: d.disclaimer }).success).toBe(true);
    }
  });
});

describe('stored rows', () => {
  it('a row gives its own title, disclaimer, on/off and order', () => {
    const c = firmCalculators([row()]).find((x) => x.key === 'tax_return');
    expect(c).toEqual({
      key: 'tax_return',
      title: 'Estimate your return (fake)',
      disclaimer: 'Estimate only (fake).',
      taxYear: 2026,
      enabled: true,
      sortOrder: 3,
    });
  });

  it('a stored config is ignored: no figures leave the server', () => {
    for (const config of [{}, null, { taxYear: 2025, note: 'Sample figures (fake).' }]) {
      const withConfig = { ...row(), config } as DefinitionRow;
      const c = firmCalculators([withConfig]).find((x) => x.key === 'tax_return');
      expect(c).not.toHaveProperty('config');
      expect(c?.taxYear).toBe(2026);
    }
  });

  it('a row changes only its own key; the others keep their defaults', () => {
    const all = firmCalculators([row({ key: 'tax_bracket', enabled: false, sortOrder: -1 })]);
    expect(all.map((c) => c.key)).toEqual(['tax_bracket', 'tax_return', 'quarterly_estimate']);
    expect(all[0]).toMatchObject({ title: 'Estimate your return (fake)', enabled: false });
    expect(all[1]).toMatchObject({ title: 'Federal Tax Return Estimator', enabled: true });
    expect(
      clientCalculators([row({ key: 'tax_bracket', enabled: false })]).map((c) => c.key),
    ).toEqual(['tax_return', 'quarterly_estimate']);
  });

  it('rows with a key the API does not know are left out', () => {
    expect(firmCalculators([row(), row({ key: 'mortgage' })]).map((c) => c.key)).toEqual([
      'quarterly_estimate',
      'tax_bracket',
      'tax_return',
    ]);
  });

  it('clients see enabled calculators only, without the firm fields', () => {
    expect(clientCalculators([row({ enabled: false })]).map((c) => c.key)).toEqual([
      'quarterly_estimate',
      'tax_bracket',
    ]);
    const mine = clientCalculators([row()]).find((c) => c.key === 'tax_return');
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
      { taxYear: 2027 },
      { title: '   ' },
      { title: 'x'.repeat(81) },
      { enabled: 'yes' },
    ]) {
      expect(UpdateBody.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
