import type { CalculateSavingsRequest, TaxFilingStatus } from '@firmivra/types';

// The tax tables the planning estimates read, per tax year, kept in code (docs/work/R55-tax-planning.md).
// Federal ordinary income tax only. A year without a table is "unavailable" with the reason, never
// a guess from another year. Amounts here are whole dollars; everything else in the module is cents.

type Group = 'single' | 'joint' | 'separate' | 'head';
/** [upper limit of the band, rate in percent]; the last band has no limit. */
type Bands = readonly (readonly [number, number])[];

interface YearTable {
  standard: Record<Group, number>;
  bands: Record<Group, Bands>;
  /** Employee 401(k) deferral limit; catch-up amounts are not added. */
  retirementLimit: number;
  /** HSA limit for self-only coverage. */
  hsaLimit: number;
}

const bands = (limits: number[]): Bands => {
  const rates = [10, 12, 22, 24, 32, 35, 37];
  return rates.map((rate, i) => [limits[i] ?? Infinity, rate] as const);
};

const TABLES: Record<number, YearTable> = {
  2025: {
    standard: { single: 15_750, joint: 31_500, separate: 15_750, head: 23_625 },
    bands: {
      single: bands([11_925, 48_475, 103_350, 197_300, 250_525, 626_350]),
      joint: bands([23_850, 96_950, 206_700, 394_600, 501_050, 751_600]),
      separate: bands([11_925, 48_475, 103_350, 197_300, 250_525, 375_800]),
      head: bands([17_000, 64_850, 103_350, 197_300, 250_500, 626_350]),
    },
    retirementLimit: 23_500,
    hsaLimit: 4_300,
  },
  2026: {
    standard: { single: 16_100, joint: 32_200, separate: 16_100, head: 24_150 },
    bands: {
      single: bands([12_400, 50_400, 105_700, 201_775, 256_225, 640_600]),
      joint: bands([24_800, 100_800, 211_400, 403_550, 512_450, 768_700]),
      separate: bands([12_400, 50_400, 105_700, 201_775, 256_225, 384_350]),
      head: bands([17_700, 67_450, 105_700, 201_750, 256_200, 640_600]),
    },
    retirementLimit: 24_500,
    hsaLimit: 4_400,
  },
};

export const TAX_TABLE_YEARS = Object.keys(TABLES).map(Number);

export const tableFor = (year: number): YearTable | undefined => TABLES[year];

export function groupOf(status: TaxFilingStatus): Group {
  switch (status) {
    case 'SINGLE':
      return 'single';
    case 'MARRIED_FILING_JOINTLY':
    case 'QUALIFYING_SURVIVING_SPOUSE':
      return 'joint';
    case 'MARRIED_FILING_SEPARATELY':
      return 'separate';
    case 'HEAD_OF_HOUSEHOLD':
      return 'head';
  }
}

/** Tax on taxable income (cents), before credits. */
export function taxOn(table: YearTable, group: Group, taxableCents: number): number {
  let tax = 0;
  let floor = 0;
  for (const [limit, rate] of table.bands[group]) {
    const top = limit * 100;
    if (taxableCents > floor) tax += (Math.min(taxableCents, top) - floor) * (rate / 100);
    if (taxableCents <= top) break;
    floor = top;
  }
  return Math.round(tax);
}

export const standardDeductionCents = (table: YearTable, group: Group) =>
  table.standard[group] * 100;

export interface Calculation {
  baselineTaxCents: number | null;
  modeledTaxCents: number | null;
  differenceCents: number | null;
  unavailableReason: string | null;
  assumptions: string[];
}

const ASSUMPTIONS = [
  'Federal ordinary income tax only. Self-employment tax, the qualified business income deduction, the alternative minimum tax and state tax are not included.',
  'Deductions and contributions are taken as entered; annual limits and phase-outs are not checked.',
  'The larger of the standard deduction and the itemized deductions entered is used.',
  'Age and dependents do not change the figures.',
];

const unavailable = (reason: string, assumptions = ASSUMPTIONS): Calculation => ({
  baselineTaxCents: null,
  modeledTaxCents: null,
  differenceCents: null,
  unavailableReason: reason,
  assumptions,
});

/** The Tax Savings Calculator: nothing is guessed, and a missing piece makes the result unavailable. */
export function calculateSavings(req: CalculateSavingsRequest): Calculation {
  const b = req.baseline;
  const s = req.strategy;
  const income =
    (b.wagesCents ?? 0) +
    (b.selfEmploymentIncomeCents ?? 0) +
    (b.businessIncomeCents ?? 0) +
    (b.interestDividendsCents ?? 0) +
    (b.otherIncomeCents ?? 0);
  const assumptions = b.state
    ? [...ASSUMPTIONS, `State tax for ${b.state} is not modelled.`]
    : ASSUMPTIONS;
  if (!req.filingStatus) return unavailable('Choose a filing status.', assumptions);
  const table = tableFor(req.taxYear);
  if (!table) return unavailable(`Tax tables for ${req.taxYear} are not loaded.`, assumptions);
  if (
    b.wagesCents === undefined &&
    b.selfEmploymentIncomeCents === undefined &&
    b.businessIncomeCents === undefined &&
    b.interestDividendsCents === undefined &&
    b.otherIncomeCents === undefined
  )
    return unavailable('Enter at least one income figure.', assumptions);
  if ((b.capitalGainsCents ?? 0) > 0)
    return unavailable('Capital gains rates are not modelled yet.', assumptions);

  const group = groupOf(req.filingStatus);
  const deduction = Math.max(standardDeductionCents(table, group), b.itemizedDeductionsCents ?? 0);
  const adjustments = b.adjustmentsCents ?? 0;
  const extra =
    (s.retirementContributionCents ?? 0) +
    (s.hsaContributionCents ?? 0) +
    (s.section179Cents ?? 0) +
    (s.homeOfficeCents ?? 0) +
    (s.otherDeductionCents ?? 0);
  const credits = b.creditsCents ?? 0;
  const baselineTaxable = Math.max(0, income - adjustments - deduction);
  const modeledTaxable = Math.max(0, income - adjustments - extra - deduction);
  const baseline = Math.max(0, taxOn(table, group, baselineTaxable) - credits);
  const modeled = Math.max(
    0,
    taxOn(table, group, modeledTaxable) - credits - (s.additionalCreditCents ?? 0),
  );
  return {
    baselineTaxCents: baseline,
    modeledTaxCents: modeled,
    differenceCents: baseline - modeled,
    unavailableReason: null,
    assumptions,
  };
}

export interface PlanFigure {
  amountCents: number;
  taxYear: number;
  kind: 'HISTORICAL' | 'PROJECTED' | 'ADJUSTMENT';
}

export interface Estimate {
  cents: number | null;
  dataYear: number | null;
  basis: string | null;
  reason: string | null;
}

const NO_MODEL =
  'No estimate model covers this strategy. An authorized person can enter an estimate.';

/**
 * The model's estimate for a strategy in a plan: the savings from the room left under the
 * contribution limit, taxed at the marginal bands of the plan year. `figures` are the plan's
 * figures by key (an adjustment, then a projected figure of the plan year, then the latest
 * historical one); a figure the model needs and the plan lacks makes the estimate unavailable.
 */
export function estimateStrategy(input: {
  requiredInputs: readonly string[];
  planYear: number;
  filingStatus: TaxFilingStatus | null;
  figures: ReadonlyMap<string, PlanFigure>;
}): Estimate {
  const none = (reason: string): Estimate => ({
    cents: null,
    dataYear: null,
    basis: null,
    reason,
  });
  const kind = input.requiredInputs.includes('retirement_contributions')
    ? 'retirement'
    : input.requiredInputs.includes('hsa_contributions')
      ? 'hsa'
      : null;
  if (!kind) return none(NO_MODEL);
  if (!input.filingStatus) return none('Choose a filing status for the plan.');
  const table = tableFor(input.planYear);
  if (!table) return none(`Tax tables for ${input.planYear} are not loaded.`);
  const group = groupOf(input.filingStatus);
  const f = input.figures;
  const contributed = f.get(
    kind === 'retirement' ? 'retirement_contributions' : 'hsa_contributions',
  );
  if (!contributed)
    return none(
      `Add the ${kind === 'retirement' ? 'retirement' : 'HSA'} contributions to the financial overview.`,
    );
  let taxable = f.get('taxable_income');
  if (!taxable) {
    const agi = f.get('agi');
    if (!agi) return none('Add taxable income or adjusted gross income to the financial overview.');
    taxable = {
      ...agi,
      amountCents: Math.max(0, agi.amountCents - standardDeductionCents(table, group)),
    };
  }
  const limit = (kind === 'retirement' ? table.retirementLimit : table.hsaLimit) * 100;
  const room = Math.max(0, limit - contributed.amountCents);
  const used = Math.min(room, taxable.amountCents);
  const cents =
    taxOn(table, group, taxable.amountCents) - taxOn(table, group, taxable.amountCents - used);
  const dataYear = Math.min(taxable.taxYear, contributed.taxYear);
  return {
    cents,
    dataYear,
    basis: `Based on ${dataYear} figures and ${input.planYear} federal rates; the room under the ${kind === 'retirement' ? '401(k)' : 'HSA'} limit is taxed at the plan's marginal rates.`,
    reason: null,
  };
}

/** The room left under a limit (for the opportunity's impact), in cents. */
export function roomUnderLimit(
  planYear: number,
  kind: 'retirement' | 'hsa',
  contributedCents: number,
): number | null {
  const table = tableFor(planYear);
  if (!table) return null;
  return Math.max(
    0,
    (kind === 'retirement' ? table.retirementLimit : table.hsaLimit) * 100 - contributedCents,
  );
}

/** Effective rate in basis points of taxable income (null when there is none). */
export function effectiveRateBp(
  planYear: number,
  status: TaxFilingStatus,
  taxableCents: number,
): number | null {
  const table = tableFor(planYear);
  if (!table || taxableCents <= 0) return null;
  return Math.round((taxOn(table, groupOf(status), taxableCents) / taxableCents) * 10_000);
}
