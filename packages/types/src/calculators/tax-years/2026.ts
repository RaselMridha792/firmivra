import { type BracketSchedule, TaxYearConstants } from './schema.js';

// Tax year 2026 (returns filed in 2027). Source: IRS Rev. Proc. 2025-32 (the 2026 inflation
// adjustments, as amended by Public Law 119-21 of July 4, 2025): the tax rate tables, the standard
// deduction and the additional standard deduction for age 65 or blindness. Cross-checked on Oct 9
// against Octavia's three guides (client-info/2026-10-08-octavia/Calculator_*.pdf): the Tax
// Bracket guide §5 and §8, the Tax Return Estimator §3 and §4, and the Quarterly guide §2 and §3
// list the same figures, with no difference. The bracket guide prints the lower ends as "$12,401"
// and so on; the tops below are the IRS's ("not over $12,400"), which is the same schedule.
// Amounts are integer cents; rates are basis points.

const $ = (dollars: number) => dollars * 100;
const RATES = [1_000, 1_200, 2_200, 2_400, 3_200, 3_500, 3_700] as const;
/** The seven brackets from the tops of the first six (whole dollars). */
const schedule = (tops: readonly [number, number, number, number, number, number]) =>
  RATES.map((rateBps, i) => ({ rateBps, upToCents: i < tops.length ? $(tops[i]!) : null }));

const SINGLE: BracketSchedule = schedule([12_400, 50_400, 105_700, 201_775, 256_225, 640_600]);
const MARRIED_JOINT: BracketSchedule = schedule([
  24_800, 100_800, 211_400, 403_550, 512_450, 768_700,
]);
const MARRIED_SEPARATE: BracketSchedule = schedule([
  12_400, 50_400, 105_700, 201_775, 256_225, 384_350,
]);
const HEAD_OF_HOUSEHOLD: BracketSchedule = schedule([
  17_700, 67_450, 105_700, 201_750, 256_200, 640_600,
]);

/** Parsed when this file loads, so a broken figure fails every test and every page at once. */
export const TAX_YEAR_2026: TaxYearConstants = TaxYearConstants.parse({
  taxYear: 2026,
  sources: [
    'IRS Rev. Proc. 2025-32 (2026 tax rate tables, standard deduction, age 65 or blind amount)',
    'Octavia, Calculator_Tax_Bracket_Guide.pdf §5 and §8 (Oct 8, 2026): same figures',
  ],
  standardDeductionCents: {
    SINGLE: $(16_100),
    MARRIED_JOINT: $(32_200),
    MARRIED_SEPARATE: $(16_100),
    HEAD_OF_HOUSEHOLD: $(24_150),
    QUALIFYING_SURVIVING_SPOUSE: $(32_200),
  },
  ageBlindAddOnCents: { married: $(1_650), unmarried: $(2_050) },
  brackets: {
    SINGLE,
    MARRIED_JOINT,
    MARRIED_SEPARATE,
    HEAD_OF_HOUSEHOLD,
    // QSS uses the MFJ table (every guide says so, as does the IRS joint-return table).
    QUALIFYING_SURVIVING_SPOUSE: MARRIED_JOINT,
  },
  taxRounding: 'DOLLAR',
});
