import type { CalculatorKey } from './schemas.js';

// What a firm's calculators say before an Owner or Admin changes them: the API's defaults and the
// web mock's fixtures both come from here. Titles from the area plan (the screen prefixes the tax
// year: "2026 Federal Tax Bracket Calculator"). Disclaimers are Octavia's exact texts from her
// three guides (Oct 8, 2026), without their "Public disclaimer:" / "Important:" labels.

export interface CalculatorDefaultText {
  title: string;
  disclaimer: string;
  sortOrder: number;
}

export const CALCULATOR_DEFAULT_TEXT = {
  tax_return: {
    title: 'Federal Tax Return Estimator',
    // Calculator_Tax_Return_Estimator_Guide.pdf §7.
    disclaimer:
      'This calculator provides an estimate based on information entered and current 2026 federal tax rules. It is not a filed tax return and is not tax, legal, or financial advice. Actual results can differ because of additional income, deductions, credits, documentation, eligibility rules, IRS guidance, or law changes.',
    sortOrder: 0,
  },
  quarterly_estimate: {
    title: 'Quarterly Estimated Tax Calculator',
    // Calculator_Quarterly_Estimated_Tax_Guide.pdf, last page.
    disclaimer:
      'This calculator provides an estimate based on information entered and current 2026 federal tax rules. It is not a filed tax return, Form 2210 penalty computation, or tax, legal, or financial advice. Actual estimated-tax requirements can differ because of income timing, deductions, credits, withholding timing, prior-year facts, specialized taxes, eligibility rules, IRS guidance, or law changes.',
    sortOrder: 1,
  },
  tax_bracket: {
    title: 'Federal Tax Bracket Calculator',
    // Calculator_Tax_Bracket_Guide.pdf §16.
    disclaimer:
      'This calculator provides an estimate of 2026 federal individual income tax based on the information entered. Your actual tax may differ based on tax credits, additional deductions, self-employment tax, investment income, capital gains, Alternative Minimum Tax, additional Medicare taxes, dependents, special filing rules, and other tax circumstances. This calculator does not calculate state or local income taxes and should not be considered tax advice.',
    sortOrder: 2,
  },
} as const satisfies Record<CalculatorKey, CalculatorDefaultText>;
