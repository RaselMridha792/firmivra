import { describe, expect, it } from 'vitest';
import {
  createMyCalculatorsClient,
  createRequest,
  estimateTaxReturn,
  TaxReturnConfig,
} from '../../src/index.js';

/** Made-up figures for the arithmetic only. */
const config = TaxReturnConfig.parse({
  taxYear: 2025,
  placeholder: true,
  filingStatuses: [
    {
      status: 'SINGLE',
      label: 'Single',
      standardDeduction: 10_000,
      brackets: [
        { upTo: 10_000, rate: 0.1 },
        { upTo: 40_000, rate: 0.2 },
        { upTo: null, rate: 0.3 },
      ],
    },
  ],
});

describe('estimateTaxReturn', () => {
  it('applies the larger deduction, then the brackets, credits and withholding', () => {
    // 60,000 - 10,000 = 50,000 taxable: 1,000 + 6,000 + 3,000 = 10,000.
    expect(
      estimateTaxReturn(config, { filingStatus: 'SINGLE', income: 60_000, withheld: 12_000 }),
    ).toEqual({
      deduction: 10_000,
      taxableIncome: 50_000,
      tax: 10_000,
      totalTax: 10_000,
      balance: -2_000,
      effectiveRate: 0.1667,
    });
    const itemized = estimateTaxReturn(config, {
      filingStatus: 'SINGLE',
      income: 60_000,
      itemizedDeductions: 15_000,
      credits: 500,
    });
    // 45,000 taxable: 1,000 + 6,000 + 1,500 = 8,500, minus 500 credits.
    expect(itemized).toMatchObject({
      deduction: 15_000,
      tax: 8_500,
      totalTax: 8_000,
      balance: 8_000,
    });
  });

  it('never goes below zero, and refuses a filing status it has no figures for', () => {
    const low = estimateTaxReturn(config, { filingStatus: 'SINGLE', income: 5_000, credits: 900 });
    expect(low).toMatchObject({ taxableIncome: 0, tax: 0, totalTax: 0, effectiveRate: 0 });
    expect(() => estimateTaxReturn(config, { filingStatus: 'MARRIED_JOINT', income: 1 })).toThrow();
  });

  it('refuses brackets out of order or with a second open top', () => {
    const status = config.filingStatuses[0]!;
    const broken = (brackets: unknown) =>
      TaxReturnConfig.safeParse({ ...config, filingStatuses: [{ ...status, brackets }] }).success;
    expect(
      broken([
        { upTo: 40_000, rate: 0.1 },
        { upTo: 10_000, rate: 0.2 },
        { upTo: null, rate: 0.3 },
      ]),
    ).toBe(false);
    expect(
      broken([
        { upTo: null, rate: 0.1 },
        { upTo: null, rate: 0.2 },
      ]),
    ).toBe(false);
  });
});

describe('calculator clients', () => {
  it("reads the firm's calculators in the portal", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    await createMyCalculatorsClient(createRequest({ baseUrl: '', fetch: fetchFn }), 'lvp').list();
    expect(calls).toEqual(['/portal/lvp/me/calculators']);
  });
});
