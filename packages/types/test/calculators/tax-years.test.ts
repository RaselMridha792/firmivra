import { describe, expect, it } from 'vitest';
import {
  FilingStatus,
  TAX_YEAR_2026,
  TAX_YEARS,
  TaxYearConstants,
  taxYearConstants,
  type SupportedTaxYear,
} from '../../src/index.js';

const c = TAX_YEAR_2026;
const tops = (s: FilingStatus) => c.brackets[s].map((b) => b.upToCents);
const $ = (d: number) => d * 100;

describe('2026 federal figures', () => {
  it('are keyed by tax year and valid', () => {
    expect(TAX_YEARS[2026]).toBe(c);
    expect(taxYearConstants(2026)).toBe(c);
    expect(() => taxYearConstants(2025 as SupportedTaxYear)).toThrow(/2025/);
    expect(TaxYearConstants.parse(c)).toEqual(c);
    expect(c.taxYear).toBe(2026);
  });

  it('match Rev. Proc. 2025-32 and the guides (standard deductions, add-on)', () => {
    expect(c.standardDeductionCents).toEqual({
      SINGLE: $(16_100),
      MARRIED_JOINT: $(32_200),
      MARRIED_SEPARATE: $(16_100),
      HEAD_OF_HOUSEHOLD: $(24_150),
      QUALIFYING_SURVIVING_SPOUSE: $(32_200),
    });
    expect(c.ageBlindAddOnCents).toEqual({ married: $(1_650), unmarried: $(2_050) });
  });

  it('match the bracket tables (bracket guide §8)', () => {
    const rates = [1_000, 1_200, 2_200, 2_400, 3_200, 3_500, 3_700];
    const table = (t: number[]) => [...t.map($), null];
    expect(tops('SINGLE')).toEqual(table([12_400, 50_400, 105_700, 201_775, 256_225, 640_600]));
    expect(tops('MARRIED_JOINT')).toEqual(
      table([24_800, 100_800, 211_400, 403_550, 512_450, 768_700]),
    );
    expect(tops('MARRIED_SEPARATE')).toEqual(
      table([12_400, 50_400, 105_700, 201_775, 256_225, 384_350]),
    );
    expect(tops('HEAD_OF_HOUSEHOLD')).toEqual(
      table([17_700, 67_450, 105_700, 201_750, 256_200, 640_600]),
    );
    for (const s of FilingStatus.options) {
      expect(c.brackets[s].map((b) => b.rateBps)).toEqual(rates);
    }
  });

  it('are consistent with each other', () => {
    // QSS uses the MFJ table and standard deduction.
    expect(c.brackets.QUALIFYING_SURVIVING_SPOUSE).toEqual(c.brackets.MARRIED_JOINT);
    expect(c.standardDeductionCents.QUALIFYING_SURVIVING_SPOUSE).toBe(
      c.standardDeductionCents.MARRIED_JOINT,
    );
    // MFJ tops are twice Single's up to the 32% bracket; MFS is half of MFJ in every bracket.
    const single = tops('SINGLE');
    const joint = tops('MARRIED_JOINT');
    for (let i = 0; i < 5; i += 1) expect(joint[i]).toBe(2 * single[i]!);
    expect(joint[5]).not.toBe(2 * single[5]!);
    tops('MARRIED_SEPARATE').forEach((top, i) => {
      expect(top === null ? null : 2 * top).toBe(joint[i]);
    });
    expect(c.standardDeductionCents.MARRIED_JOINT).toBe(2 * c.standardDeductionCents.SINGLE);
    expect(c.standardDeductionCents.MARRIED_SEPARATE).toBe(c.standardDeductionCents.SINGLE);
    expect(c.taxRounding).toBe('DOLLAR');
  });
});

describe('the TaxYearConstants schema refuses', () => {
  const broken = (change: (copy: Record<string, unknown>) => void) => {
    const copy = structuredClone(c) as unknown as Record<string, unknown>;
    change(copy);
    return TaxYearConstants.safeParse(copy).success;
  };
  const single = (copy: Record<string, unknown>) =>
    (copy.brackets as Record<string, { upToCents: number | null; rateBps: number }[]>).SINGLE!;

  it('the figures as they are pass (control)', () => {
    expect(broken(() => undefined)).toBe(true);
  });

  it('dollars with cents in floats, negatives and missing statuses', () => {
    expect(
      broken((x) => ((x.standardDeductionCents as Record<string, number>).SINGLE = 16_100.5)),
    ).toBe(false);
    expect(broken((x) => ((x.standardDeductionCents as Record<string, number>).SINGLE = -1))).toBe(
      false,
    );
    expect(broken((x) => ((x.standardDeductionCents as Record<string, number>).SINGLE = 0))).toBe(
      false,
    );
    expect(
      broken(
        (x) =>
          delete (x.standardDeductionCents as Record<string, number>).QUALIFYING_SURVIVING_SPOUSE,
      ),
    ).toBe(false);
    expect(
      broken((x) => delete (x.brackets as Record<string, unknown>).QUALIFYING_SURVIVING_SPOUSE),
    ).toBe(false);
    expect(broken((x) => ((x.ageBlindAddOnCents as Record<string, number>).married = NaN))).toBe(
      false,
    );
  });

  it('brackets out of order, open in the middle, missing, or with rates over 100%', () => {
    expect(broken((x) => single(x).reverse())).toBe(false);
    expect(broken((x) => (single(x)[2]!.upToCents = null))).toBe(false);
    expect(broken((x) => (single(x)[6]!.upToCents = $(1_000_000)))).toBe(false);
    expect(broken((x) => (single(x)[1]!.upToCents = $(12_400)))).toBe(false);
    expect(broken((x) => (single(x)[1]!.rateBps = 1_000))).toBe(false);
    expect(broken((x) => (single(x)[6]!.rateBps = 10_001))).toBe(false);
    expect(broken((x) => (single(x)[0]!.rateBps = 0.1))).toBe(false);
    expect(broken((x) => single(x).pop())).toBe(false);
    expect(broken((x) => (single(x)[0]!.upToCents = 0))).toBe(false);
  });

  it('unknown fields, an unknown rounding and a year before 2026', () => {
    expect(broken((x) => (x.placeholder = true))).toBe(false);
    expect(broken((x) => (x.taxRounding = 'BANKERS'))).toBe(false);
    expect(broken((x) => (x.taxYear = 2025))).toBe(false);
    expect(broken((x) => (x.sources = []))).toBe(false);
  });
});
