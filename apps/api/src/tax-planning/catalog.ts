import type { PlanInputCatalog, PlanningResource } from '@firmivra/types';

/** The figures the plan's financial overview takes and the model reads (GET .../input-catalog). */
export const INPUT_CATALOG: PlanInputCatalog['items'] = [
  { key: 'agi', label: 'Adjusted gross income', type: 'MONEY', group: 'Income' },
  { key: 'taxable_income', label: 'Taxable income', type: 'MONEY', group: 'Income' },
  { key: 'wages', label: 'Wages (W-2)', type: 'MONEY', group: 'Income' },
  {
    key: 'self_employment_income',
    label: 'Self-employment income',
    type: 'MONEY',
    group: 'Income',
  },
  { key: 'business_income', label: 'Business income', type: 'MONEY', group: 'Income' },
  { key: 'interest_dividends', label: 'Interest and dividends', type: 'MONEY', group: 'Income' },
  { key: 'capital_gains', label: 'Capital gains', type: 'MONEY', group: 'Income' },
  { key: 'other_income', label: 'Other income', type: 'MONEY', group: 'Income' },
  { key: 'itemized_deductions', label: 'Itemized deductions', type: 'MONEY', group: 'Deductions' },
  {
    key: 'retirement_contributions',
    label: 'Retirement contributions',
    type: 'MONEY',
    group: 'Savings',
  },
  { key: 'hsa_contributions', label: 'HSA contributions', type: 'MONEY', group: 'Savings' },
  { key: 'credits', label: 'Tax credits', type: 'MONEY', group: 'Tax' },
  { key: 'total_tax', label: 'Total tax', type: 'MONEY', group: 'Tax' },
  { key: 'state', label: 'State of residence', type: 'TEXT', group: 'Profile' },
  { key: 'dependents', label: 'Dependents', type: 'TEXT', group: 'Profile' },
];
export const INPUT_KEYS = new Map(INPUT_CATALOG.map((i) => [i.key, i]));

/**
 * C06 (Review 2): the firm's own additional figures, beyond the catalog: an amount under a key
 * `custom_<name>` ("custom_home_office_costs"), labelled from its name ("Home office costs"). No
 * estimate model reads them; they are kept, shown and versioned with the plan's other figures.
 */
export const CUSTOM_INPUT = /^custom_[a-z0-9_]{1,52}$/;
export function inputDef(
  key: string,
): { key: string; label: string; type: 'MONEY' | 'TEXT'; group: string } | undefined {
  const known = INPUT_KEYS.get(key);
  if (known) return known;
  if (!CUSTOM_INPUT.test(key)) return undefined;
  const words = key.slice('custom_'.length).replace(/_+/g, ' ').trim();
  return {
    key,
    label: words.charAt(0).toUpperCase() + words.slice(1),
    type: 'MONEY',
    group: 'Additional items',
  };
}

interface ResourceDef extends PlanningResource {
  /** The words sent to a client with it. */
  summary: string;
}

/** The approved catalog of guides and checklists (no table yet: see the notes). */
export const RESOURCES: readonly ResourceDef[] = [
  {
    key: 'year-end-planning-checklist',
    title: 'Year-End Tax Planning Checklist',
    category: 'Checklists',
    kind: 'CHECKLIST',
    clientFacing: true,
    url: null,
    summary: 'A checklist of the moves worth considering before the year ends.',
  },
  {
    key: 'retirement-contribution-guide',
    title: 'Retirement Contribution Guide',
    category: 'Guides',
    kind: 'GUIDE',
    clientFacing: true,
    url: null,
    summary: 'How retirement contributions can lower your taxable income.',
  },
  {
    key: 'small-business-deductions-guide',
    title: 'Small Business Deductions Guide',
    category: 'Guides',
    kind: 'GUIDE',
    clientFacing: true,
    url: null,
    summary: 'The deductions small businesses most often miss.',
  },
  {
    key: 'estimated-tax-payments-explained',
    title: 'Estimated Tax Payments Explained',
    category: 'Articles',
    kind: 'ARTICLE',
    clientFacing: true,
    url: null,
    summary: 'Who pays estimated taxes, when, and how much.',
  },
  {
    key: 'planning-meeting-prep-checklist',
    title: 'Planning Meeting Preparation Checklist',
    category: 'Checklists',
    kind: 'CHECKLIST',
    clientFacing: true,
    url: null,
    summary: 'What to gather before your tax planning meeting.',
  },
  {
    key: 'staff-screening-rules-reference',
    title: 'Opportunity Screening Rules (staff reference)',
    category: 'Staff references',
    kind: 'GUIDE',
    clientFacing: false,
    url: null,
    summary: 'The rules the screening applies.',
  },
];
export const resourceOf = (key: string) => RESOURCES.find((r) => r.key === key);
export const toResource = ({ summary: _summary, ...r }: ResourceDef): PlanningResource => r;
