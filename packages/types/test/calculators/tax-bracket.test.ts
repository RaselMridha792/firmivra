import { describe, expect, it } from 'vitest';
import { progressiveTax } from '../../src/calculators/engine/brackets.js';
import {
  estimateTaxBracket,
  FilingStatus,
  TAX_YEAR_2026,
  TaxBracketInput,
  type SupportedTaxYear,
} from '../../src/index.js';

// Golden cases for the 2026 Tax Bracket Calculator (bracket guide §7-§11). Worked by hand from
// the IRS 2026 tables; every amount in a result is integer cents, and the tax shown is rounded to
// the whole dollar (half up) with slices that add up to it. Arfan re-checks these by hand (K10)
// and Octavia signs them off.

const $ = (d: number) => Math.round(d * 100);
const est = (input: TaxBracketInput) => estimateTaxBracket(input);
const std = (
  filingStatus: FilingStatus,
  annualIncome: number,
  extra: Partial<TaxBracketInput> = {},
) => est({ filingStatus, annualIncome, deductionType: 'STANDARD', ...extra });

/** The checks every result must pass. */
function wellFormed(r: ReturnType<typeof est>) {
  expect(r.slices.reduce((n, s) => n + s.tax, 0)).toBe(r.taxBeforeCredits);
  expect(r.slices.reduce((n, s) => n + s.amount, 0)).toBe(r.taxableIncome);
  for (const v of [r.taxBeforeCredits, r.taxableIncome, r.agi, r.deduction.amount]) {
    expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
  }
  expect(r.taxBeforeCredits % 100).toBe(0); // whole dollars in 2026
  expect(r.taxableIncome).toBe(Math.max(0, r.agi - r.deduction.amount));
}

interface Golden {
  name: string;
  input: TaxBracketInput;
  deduction: number;
  taxable: number;
  tax: number;
  marginal: number;
  sliceTaxes?: number[];
  notices?: string[];
}

const GOLDEN: Golden[] = [
  // ---- Single ----
  {
    // The guide's example (§15): 75,000 - 16,100 = 58,900; 1,240 + 4,560 + 1,870 = 7,670; 13.0%.
    name: 'Single $75,000, standard',
    input: { filingStatus: 'SINGLE', annualIncome: 75_000, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 58_900,
    tax: 7_670,
    marginal: 0.22,
    sliceTaxes: [1_240, 4_560, 1_870],
  },
  {
    name: 'Single at the top of the 10% bracket (tops are inclusive)',
    input: { filingStatus: 'SINGLE', annualIncome: 28_500, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 12_400,
    tax: 1_240,
    marginal: 0.1,
    sliceTaxes: [1_240],
  },
  {
    // One cent over: 12% marginal; its 0.12 cent of tax rounds away.
    name: 'Single one cent into the 12% bracket',
    input: { filingStatus: 'SINGLE', annualIncome: 28_500.01, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 12_400.01,
    tax: 1_240,
    marginal: 0.12,
    sliceTaxes: [1_240, 0],
  },
  {
    // 4.17 x 12% = 0.5004: 1,240.5004 rounds up to 1,241; the 12% slice shows the dollar.
    name: 'Single rounding up at half a dollar',
    input: { filingStatus: 'SINGLE', annualIncome: 28_504.17, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 12_404.17,
    tax: 1_241,
    marginal: 0.12,
    sliceTaxes: [1_240, 1],
  },
  {
    // 4.16 x 12% = 0.4992: 1,240.4992 rounds down.
    name: 'Single rounding down just under half a dollar',
    input: { filingStatus: 'SINGLE', annualIncome: 28_504.16, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 12_404.16,
    tax: 1_240,
    marginal: 0.12,
    sliceTaxes: [1_240, 0],
  },
  {
    // The 37% anchor: 192,979.25 exactly at 640,600 taxable, shown as 192,979.
    name: 'Single at the start of the 37% bracket',
    input: { filingStatus: 'SINGLE', annualIncome: 656_700, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 640_600,
    tax: 192_979,
    marginal: 0.35,
    sliceTaxes: [1_240, 4_560, 12_166, 23_058, 17_424, 134_531],
  },
  {
    // 192,979.25 + (99,983,900 - 640,600) x 37% = 192,979.25 + 36,757,021 = 36,950,000.25.
    name: 'Single $100,000,000 (the largest amount)',
    input: { filingStatus: 'SINGLE', annualIncome: 100_000_000, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 99_983_900,
    tax: 36_950_000,
    marginal: 0.37,
  },
  {
    // Both conditions: 16,100 + 2 x 2,050 = 20,200; 30,000 - 20,200 = 9,800 at 10%.
    name: 'Single, 65 or older and blind',
    input: {
      filingStatus: 'SINGLE',
      annualIncome: 30_000,
      deductionType: 'STANDARD',
      taxpayer: { age65OrOlder: true, blind: true },
    },
    deduction: 20_200,
    taxable: 9_800,
    tax: 980,
    marginal: 0.1,
  },
  // ---- Married Filing Jointly ----
  {
    // 150,000 - 32,200 = 117,800: 2,480 + 9,120 + 17,000 x 22% (3,740) = 15,340.
    name: 'MFJ $150,000, standard',
    input: { filingStatus: 'MARRIED_JOINT', annualIncome: 150_000, deductionType: 'STANDARD' },
    deduction: 32_200,
    taxable: 117_800,
    tax: 15_340,
    marginal: 0.22,
    sliceTaxes: [2_480, 9_120, 3_740],
  },
  {
    // Both 65 or older: 32,200 + 2 x 1,650 = 35,500; 64,500: 2,480 + 39,700 x 12% (4,764).
    name: 'MFJ, both 65 or older',
    input: {
      filingStatus: 'MARRIED_JOINT',
      annualIncome: 100_000,
      deductionType: 'STANDARD',
      taxpayer: { age65OrOlder: true },
      spouse: { age65OrOlder: true },
    },
    deduction: 35_500,
    taxable: 64_500,
    tax: 7_244,
    marginal: 0.12,
  },
  {
    // 206,583.50 exactly at 768,700: half a dollar rounds up.
    name: 'MFJ at the start of the 37% bracket (half a dollar rounds up)',
    input: { filingStatus: 'MARRIED_JOINT', annualIncome: 800_900, deductionType: 'STANDARD' },
    deduction: 32_200,
    taxable: 768_700,
    tax: 206_584,
    marginal: 0.35,
  },
  {
    // 300,000 - 40,000 = 260,000: 35,932 + 48,600 x 24% (11,664) = 47,596.
    name: 'MFJ itemized above the standard deduction',
    input: {
      filingStatus: 'MARRIED_JOINT',
      annualIncome: 300_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 40_000,
    },
    deduction: 40_000,
    taxable: 260_000,
    tax: 47_596,
    marginal: 0.24,
  },
  // ---- Married Filing Separately ----
  {
    // 60,000 - 16,100 = 43,900: 1,240 + 31,500 x 12% (3,780) = 5,020.
    name: 'MFS $60,000, standard',
    input: { filingStatus: 'MARRIED_SEPARATE', annualIncome: 60_000, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 43_900,
    tax: 5_020,
    marginal: 0.12,
  },
  {
    // The spouse itemizes: no standard deduction. 60,000: 1,240 + 4,560 + 9,600 x 22% (2,112).
    name: 'MFS, spouse itemizes, standard chosen: $0 and a notice',
    input: {
      filingStatus: 'MARRIED_SEPARATE',
      annualIncome: 60_000,
      deductionType: 'STANDARD',
      mfsSpouseItemizes: true,
    },
    deduction: 0,
    taxable: 60_000,
    tax: 7_912,
    marginal: 0.22,
    notices: ['MFS_STANDARD_NOT_ALLOWED'],
  },
  {
    // 60,000 - 10,000 = 50,000: 1,240 + 37,600 x 12% (4,512) = 5,752. No notice: standard is $0.
    name: 'MFS, spouse itemizes, itemized',
    input: {
      filingStatus: 'MARRIED_SEPARATE',
      annualIncome: 60_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 10_000,
      mfsSpouseItemizes: true,
    },
    deduction: 10_000,
    taxable: 50_000,
    tax: 5_752,
    marginal: 0.12,
  },
  {
    // 103,291.75 exactly at 384,350, shown as 103,292.
    name: 'MFS at the start of the 37% bracket',
    input: { filingStatus: 'MARRIED_SEPARATE', annualIncome: 400_450, deductionType: 'STANDARD' },
    deduction: 16_100,
    taxable: 384_350,
    tax: 103_292,
    marginal: 0.35,
  },
  {
    // Married add-on: 16,100 + 2 x 1,650 = 19,400; 20,600: 1,240 + 8,200 x 12% (984).
    name: 'MFS, 65 or older and blind (married add-on)',
    input: {
      filingStatus: 'MARRIED_SEPARATE',
      annualIncome: 40_000,
      deductionType: 'STANDARD',
      taxpayer: { age65OrOlder: true, blind: true },
    },
    deduction: 19_400,
    taxable: 20_600,
    tax: 2_224,
    marginal: 0.12,
  },
  // ---- Head of Household ----
  {
    // 80,000 - 5,000 = 75,000 AGI; - 24,150 = 50,850: 1,770 + 33,150 x 12% (3,978) = 5,748.
    name: 'HOH with adjustments',
    input: {
      filingStatus: 'HEAD_OF_HOUSEHOLD',
      annualIncome: 80_000,
      adjustments: 5_000,
      deductionType: 'STANDARD',
    },
    deduction: 24_150,
    taxable: 50_850,
    tax: 5_748,
    marginal: 0.12,
    sliceTaxes: [1_770, 3_978],
  },
  {
    // 191,171.00 exactly at 640,600 (the plan's anchor).
    name: 'HOH at the start of the 37% bracket',
    input: { filingStatus: 'HEAD_OF_HOUSEHOLD', annualIncome: 664_750, deductionType: 'STANDARD' },
    deduction: 24_150,
    taxable: 640_600,
    tax: 191_171,
    marginal: 0.35,
    sliceTaxes: [1_770, 5_970, 8_415, 23_052, 17_424, 134_540],
  },
  {
    // Unmarried add-on: 24,150 + 2,050 = 26,200; 3,800 at 10%.
    name: 'HOH, 65 or older',
    input: {
      filingStatus: 'HEAD_OF_HOUSEHOLD',
      annualIncome: 30_000,
      deductionType: 'STANDARD',
      taxpayer: { age65OrOlder: true },
    },
    deduction: 26_200,
    taxable: 3_800,
    tax: 380,
    marginal: 0.1,
  },
  {
    // The entered itemized amount is used (bracket guide), with a notice: 40,000 taxable.
    name: 'HOH itemized below the standard deduction',
    input: {
      filingStatus: 'HEAD_OF_HOUSEHOLD',
      annualIncome: 50_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 10_000,
    },
    deduction: 10_000,
    taxable: 40_000,
    tax: 4_446,
    marginal: 0.12,
    notices: ['ITEMIZED_BELOW_STANDARD'],
  },
  // ---- Qualifying Surviving Spouse ----
  {
    name: 'QSS $150,000 (the MFJ table and deduction)',
    input: {
      filingStatus: 'QUALIFYING_SURVIVING_SPOUSE',
      annualIncome: 150_000,
      deductionType: 'STANDARD',
    },
    deduction: 32_200,
    taxable: 117_800,
    tax: 15_340,
    marginal: 0.22,
  },
  {
    // QSS takes the married add-on: 32,200 + 1,650 = 33,850; 16,150 at 10%.
    name: 'QSS, 65 or older (married add-on)',
    input: {
      filingStatus: 'QUALIFYING_SURVIVING_SPOUSE',
      annualIncome: 50_000,
      deductionType: 'STANDARD',
      taxpayer: { age65OrOlder: true },
    },
    deduction: 33_850,
    taxable: 16_150,
    tax: 1_615,
    marginal: 0.1,
  },
  {
    // 600,000 taxable: 116,896 at 512,450 + 87,550 x 35% (30,642.50) = 147,538.50.
    name: 'QSS in the 35% bracket (half a dollar rounds up)',
    input: {
      filingStatus: 'QUALIFYING_SURVIVING_SPOUSE',
      annualIncome: 632_200,
      deductionType: 'STANDARD',
    },
    deduction: 32_200,
    taxable: 600_000,
    tax: 147_539,
    marginal: 0.35,
  },
];

describe('estimateTaxBracket golden cases', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      const r = est(g.input);
      expect(r.deduction.amount).toBe($(g.deduction));
      expect(r.taxableIncome).toBe($(g.taxable));
      expect(r.taxBeforeCredits).toBe($(g.tax));
      expect(r.marginalRate).toBe(g.marginal);
      expect(r.effectiveRate).toBe(r.taxBeforeCredits / r.taxableIncome);
      if (g.sliceTaxes) expect(r.slices.map((s) => s.tax)).toEqual(g.sliceTaxes.map($));
      expect(r.notices).toEqual(g.notices ?? []);
      wellFormed(r);
    });
  }

  it('the guide example in full', () => {
    const r = std('SINGLE', 75_000);
    expect(r).toMatchObject({
      taxYear: 2026,
      filingStatus: 'SINGLE',
      annualIncome: $(75_000),
      adjustments: 0,
      agi: $(75_000),
      standardDeduction: { base: $(16_100), ageBlindAddOn: 0, amount: $(16_100) },
      deduction: { type: 'STANDARD', amount: $(16_100) },
      standardDeductionApplied: true,
    });
    expect(r.slices).toEqual([
      { from: 0, to: $(12_400), rate: 0.1, amount: $(12_400), tax: $(1_240) },
      { from: $(12_400), to: $(50_400), rate: 0.12, amount: $(38_000), tax: $(4_560) },
      { from: $(50_400), to: $(105_700), rate: 0.22, amount: $(8_500), tax: $(1_870) },
    ]);
    expect((r.effectiveRate! * 100).toFixed(1)).toBe('13.0');
    expect(r.brackets).toHaveLength(7);
    expect(r.brackets[0]).toEqual({ from: 0, to: $(12_400), rate: 0.1 });
    expect(r.brackets[6]).toEqual({ from: $(640_600), to: null, rate: 0.37 });
  });

  it('zero income: $0 taxable, no slices, effective rate N/A', () => {
    for (const s of FilingStatus.options) {
      const r = std(s, 0);
      expect(r).toMatchObject({
        taxableIncome: 0,
        taxBeforeCredits: 0,
        effectiveRate: null,
        slices: [],
      });
      expect(r.marginalRate).toBe(0.1);
      wellFormed(r);
    }
  });

  it('income below the deduction or adjustments above income never go below $0', () => {
    expect(std('HEAD_OF_HOUSEHOLD', 24_149.99)).toMatchObject({
      taxableIncome: 0,
      effectiveRate: null,
    });
    const r = std('SINGLE', 10_000, { adjustments: 20_000 });
    expect(r).toMatchObject({ agi: 0, taxableIncome: 0, taxBeforeCredits: 0 });
  });

  it('the bracket table switches with the filing status (§12)', () => {
    expect(std('HEAD_OF_HOUSEHOLD', 1).brackets[0]?.to).toBe($(17_700));
    expect(std('SINGLE', 1).brackets[0]?.to).toBe($(12_400));
    expect(std('QUALIFYING_SURVIVING_SPOUSE', 1).brackets).toEqual(
      std('MARRIED_JOINT', 1).brackets,
    );
  });

  it('itemized amounts are ignored with the standard deduction', () => {
    const r = std('SINGLE', 75_000, { itemizedDeductions: 50_000 });
    expect(r.deduction).toEqual({ type: 'STANDARD', amount: $(16_100) });
  });

  it('an itemized deduction above the standard one gives no notice', () => {
    const r = est({
      filingStatus: 'SINGLE',
      annualIncome: 75_000,
      deductionType: 'ITEMIZED',
      itemizedDeductions: 16_100,
    });
    expect(r).toMatchObject({
      standardDeductionApplied: false,
      notices: [],
      taxableIncome: $(58_900),
    });
  });
});

/** An independent reference: BigInt, the IRS "tax at the bracket start plus rate x excess" form. */
function reference(taxableCents: number, status: FilingStatus): bigint {
  const schedule = TAX_YEAR_2026.brackets[status];
  let start = 0n;
  let baseCentBps = 0n;
  for (const b of schedule) {
    const top = b.upToCents === null ? null : BigInt(b.upToCents);
    const t = BigInt(taxableCents);
    if (top === null || t <= top) {
      const exact = baseCentBps + (t - start) * BigInt(b.rateBps);
      return ((exact * 2n + 1_000_000n) / 2_000_000n) * 100n; // half up to the dollar, in cents
    }
    baseCentBps += (top - start) * BigInt(b.rateBps);
    start = top;
  }
  throw new Error('unreachable');
}

describe('engine properties, 0 to $100,000,000', () => {
  // A fixed pseudo-random walk (no flaky seeds): every status, edges and random amounts.
  let seed = 20_261_018;
  const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const amounts: number[] = [0, 1, 99, 100, 101, 49, 50, 51];
  for (const s of FilingStatus.options) {
    for (const b of TAX_YEAR_2026.brackets[s]) {
      if (b.upToCents !== null) amounts.push(b.upToCents - 1, b.upToCents, b.upToCents + 1);
    }
  }
  for (let i = 0; i < 400; i += 1) amounts.push(Math.floor(next() * 10 ** (2 + next() * 8)));
  amounts.push(100_000_000_00);
  amounts.sort((a, b) => a - b);

  it('matches the reference, adds up, never negative or NaN, and rises with income', () => {
    for (const s of FilingStatus.options) {
      let previous = 0;
      for (const cents of amounts) {
        for (const rounding of ['DOLLAR', 'CENT'] as const) {
          const t = progressiveTax(cents, TAX_YEAR_2026.brackets[s], rounding);
          expect(t.slices.reduce((n, x) => n + x.taxCents, 0)).toBe(t.totalCents);
          expect(t.slices.reduce((n, x) => n + x.amountCents, 0)).toBe(cents);
          expect(t.slices.every((x) => x.taxCents >= 0 && Number.isSafeInteger(x.taxCents))).toBe(
            true,
          );
        }
        const tax = progressiveTax(cents, TAX_YEAR_2026.brackets[s], 'DOLLAR').totalCents;
        expect(BigInt(tax), `${s} ${cents}`).toBe(reference(cents, s));
        expect(tax).toBeGreaterThanOrEqual(previous);
        previous = tax;
      }
    }
  });

  it('gives the plan’s 37% anchors exactly, in cents', () => {
    const at = (s: FilingStatus, d: number) =>
      progressiveTax($(d), TAX_YEAR_2026.brackets[s], 'CENT').totalCents;
    expect(at('SINGLE', 640_600)).toBe($(192_979.25));
    expect(at('MARRIED_JOINT', 768_700)).toBe($(206_583.5));
    expect(at('HEAD_OF_HOUSEHOLD', 640_600)).toBe($(191_171));
    expect(at('MARRIED_SEPARATE', 384_350)).toBe($(103_291.75));
    expect(at('QUALIFYING_SURVIVING_SPOUSE', 768_700)).toBe($(206_583.5));
  });

  it('refuses money that is not whole cents (a bug, never user input)', () => {
    const single = TAX_YEAR_2026.brackets.SINGLE;
    for (const bad of [-1, 0.5, NaN, Infinity]) {
      expect(() => progressiveTax(bad, single, 'CENT')).toThrow(RangeError);
    }
  });
});

describe('TaxBracketInput refuses', () => {
  const ok: TaxBracketInput = {
    filingStatus: 'SINGLE',
    annualIncome: 75_000,
    deductionType: 'STANDARD',
  };
  const cases: [string, unknown][] = [
    ['a negative income', { ...ok, annualIncome: -1 }],
    ['more than $100,000,000', { ...ok, annualIncome: 100_000_000.01 }],
    ['a third decimal', { ...ok, annualIncome: 75_000.001 }],
    ['NaN', { ...ok, annualIncome: NaN }],
    ['Infinity', { ...ok, annualIncome: Infinity }],
    ['a string amount', { ...ok, annualIncome: '75000' }],
    ['a missing income', { filingStatus: 'SINGLE', deductionType: 'STANDARD' }],
    ['negative adjustments', { ...ok, adjustments: -5 }],
    ['negative itemized deductions', { ...ok, deductionType: 'ITEMIZED', itemizedDeductions: -1 }],
    ['an unknown filing status', { ...ok, filingStatus: 'WIDOWED' }],
    ['the old lower-case status', { ...ok, filingStatus: 'single' }],
    ['no deduction type', { filingStatus: 'SINGLE', annualIncome: 1 }],
    ['an unknown deduction type', { ...ok, deductionType: 'BOTH' }],
    ['an unknown field', { ...ok, credits: 500 }],
    ['an unknown person field', { ...ok, taxpayer: { age65OrOlder: true, dependent: true } }],
    ['a spouse when not filing jointly', { ...ok, spouse: { age65OrOlder: true } }],
    ['a spouse for QSS', { ...ok, filingStatus: 'QUALIFYING_SURVIVING_SPOUSE', spouse: {} }],
    ['mfsSpouseItemizes when not MFS', { ...ok, mfsSpouseItemizes: true }],
    ['a non-boolean flag', { ...ok, taxpayer: { blind: 'yes' } }],
  ];
  for (const [name, input] of cases) {
    it(name, () => {
      expect(TaxBracketInput.safeParse(input).success).toBe(false);
      expect(() => estimateTaxBracket(input as TaxBracketInput)).toThrow();
    });
  }

  it('a tax year without figures', () => {
    expect(() => estimateTaxBracket(ok, 2025 as SupportedTaxYear)).toThrow(/2025/);
  });

  it('but takes blanks as defaults and a spouse for MFJ', () => {
    expect(TaxBracketInput.parse(ok)).toEqual({
      ...ok,
      adjustments: 0,
      itemizedDeductions: 0,
      taxpayer: { age65OrOlder: false, blind: false },
      mfsSpouseItemizes: false,
    });
    expect(
      TaxBracketInput.safeParse({ ...ok, filingStatus: 'MARRIED_JOINT', spouse: {} }).success,
    ).toBe(true);
  });
});
