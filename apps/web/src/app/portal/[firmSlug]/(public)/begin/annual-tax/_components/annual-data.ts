export const filingStatuses = [
  'Single',
  'Married Filing Jointly',
  'Married Filing Separately',
  'Head of Household',
  'Qualifying Surviving Spouse',
];
export const returnTypes = [
  'Personal (1040)',
  'Business (1120, 1120-S, 1065, etc.)',
  'Both Personal & Business',
];
export const legalStatuses = [
  'U.S. Citizen',
  'Permanent Resident (Green Card)',
  'Non-Resident Alien',
  'Other',
];
export const businessStructures = [
  'LLC',
  'S Corporation',
  'C Corporation',
  'Sole Proprietorship',
  'Other',
];
export const dependentFlags = [
  'Lives with you',
  'Full-time student',
  'Disabled',
  'Qualifies for Child Tax Credit',
];
export const relationships = [
  'Son',
  'Daughter',
  'Stepchild',
  'Foster child',
  'Sibling',
  'Parent',
  'Grandchild',
  'Other',
];
export const states = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

export const deductionQuestions = [
  'Did you pay student loan interest?',
  'Did you make contributions to a retirement account (IRA, 401(k), etc.)?',
  'Did you make contributions to a Health Savings Account (HSA)?',
  'Did you pay eligible education expenses (e.g., tuition)?',
  'Did you pay mortgage interest?',
  'Did you pay real estate taxes (property taxes)?',
  'Did you make charitable contributions (cash or non-cash)?',
  'Did you pay medical or dental expenses?',
  'Did you pay for child or dependent care expenses?',
  'Did you make energy efficient home improvements?',
  'Do you have any other deductions or credits not listed above?',
];
export const incomeQuestions = [
  'Did you receive wages from an employer (W-2)?',
  'Did you have self-employment or independent contractor income (1099-NEC, 1099-MISC)?',
  'Did you own a business (Schedule C, S-Corp, Partnership, LLC)?',
  'Did you receive interest income (1099-INT)?',
  'Did you receive dividend income (1099-DIV)?',
  'Did you receive retirement income (1099-R, SSA-1099)?',
  'Did you receive unemployment benefits (1099-G)?',
  'Did you receive rental or real estate income (Schedule E)?',
  'Did you receive alimony income?',
  'Did you receive any other income not listed above?',
];

export const financialSections = [
  {
    key: 'businessIncome',
    title: 'Business Income',
    subtitle: 'Enter all sources of business income received during the tax year.',
    icon: 'income',
    rows: [
      ['Sales of Products', 'e.g., physical products'],
      ['Services / Consulting', 'e.g., consulting fees'],
      ['Rental Income', 'e.g., equipment, property'],
      ['Investment Income', 'e.g., interest, dividends'],
      ['Subcontractor Income (1099)', 'e.g., contract work'],
      ['Refunds / Reimbursements', 'e.g., insurance, tax refunds'],
      ['Other Business Income', 'e.g., grants, misc.'],
    ],
  },
  {
    key: 'payroll',
    title: 'Wages, Payroll & Employment Taxes',
    subtitle:
      'Enter total wages paid and payroll taxes for the year (if you had employees or paid yourself through payroll).',
    icon: 'people',
    rows: [
      ['Total Wages Paid (W-2)', 'Gross wages paid to employees'],
      ['Owner/Officer Compensation', 'Owner draws, salary, wages'],
      ['Social Security Tax (FICA)', 'Employer portion'],
      ['Medicare Tax', 'Employer portion'],
      ['Federal Unemployment (FUTA)', 'Employer portion'],
      ['State Unemployment (SUTA)', 'Employer portion'],
      ['Other Payroll Taxes', 'e.g., local payroll taxes'],
    ],
  },
  {
    key: 'taxPayments',
    title: 'Income Taxes Paid',
    subtitle: 'Enter any business or owner income tax payments made during the year.',
    icon: 'tax',
    rows: [
      ['Federal Estimated Tax Payments', 'Form 1040-ES / 1120-ES'],
      ['State Estimated Tax Payments', 'e.g., GA Form 500 ES'],
      ['Other State Income Tax Payments', 'If operating in multiple states'],
      ['Local Income Tax Payments', 'e.g., city or county'],
      ['Other Income Tax Payments', 'e.g., prior year, extensions'],
    ],
  },
] as const;
export const expenseRows = [
  ['Advertising & Marketing', 'e.g., online ads, flyers'],
  ['Bank Fees', 'e.g., monthly service fees'],
  ['Car & Truck Expenses', 'e.g., fuel, maintenance'],
  ['Contract Labor (1099)', 'e.g., subcontractors'],
  ['Depreciation & Amortization', 'e.g., equipment, furniture'],
  ['Insurance', 'e.g., liability, property, WC'],
  ['Legal & Professional Fees', 'e.g., legal, accounting'],
  ['Meals & Entertainment', 'e.g., client meals (50%)'],
  ['Office Expenses', 'e.g., supplies, postage'],
  ['Rent / Lease', 'e.g., office, equipment'],
  ['Repairs & Maintenance', 'e.g., equipment, property'],
  ['Software & Subscriptions', 'e.g., QuickBooks, Adobe'],
  ['Telephone & Internet', 'e.g., cell phone, internet'],
  ['Utilities', 'e.g., electric, water, gas'],
  ['Travel Expenses', 'e.g., airfare, hotels, mileage'],
  ['Dues & Memberships', 'e.g., professional organizations'],
  ['Education & Training', 'e.g., courses, seminars'],
  ['Taxes & Licenses', 'e.g., business licenses'],
  ['Interest Expense', 'e.g., loan interest'],
  ['Equipment & Tools', 'e.g., computers, machinery'],
  ['Inventory / Cost of Goods Sold', 'e.g., materials, inventory'],
  ['Supplies', 'e.g., cleaning, office supplies'],
  ['Other Expenses', 'e.g., bank charges, misc.'],
] as const;

export const identitySlots = [
  {
    id: 'governmentId',
    title: 'Your Government ID',
    description: 'e.g., Driver’s License, State ID, or Passport',
  },
  { id: 'spouseGovernmentId', title: 'Spouse Government ID', description: '(if applicable)' },
  { id: 'socialSecurityCard', title: 'Your Social Security Card', description: '' },
  {
    id: 'spouseSocialSecurityCard',
    title: 'Spouse Social Security Card',
    description: '(if applicable)',
  },
  {
    id: 'dependentDocuments',
    title: 'Dependent(s) Qualifying Documents',
    description: 'e.g., Birth Certificate, Adoption Papers',
  },
] as const;
export const documentCategories = [
  {
    id: 'incomeDocuments',
    title: 'Income Documents',
    subtitle: 'Upload all income documents that apply to you.',
    icon: 'document',
    examples: [
      'W-2 (Wages)',
      '1099-NEC (Self-Employment)',
      '1099-MISC',
      '1099-INT (Interest)',
      '1099-DIV (Dividends)',
      '1099-R (Retirement)',
      'K-1 (Partnership, S-Corp, Trust)',
      'SSA-1099 (Social Security)',
      '1095-A (Health Insurance)',
      'Unemployment (1099-G)',
      'Rental Income (1099)',
      'Alimony Income',
      'Other income documents',
    ],
  },
  {
    id: 'deductionsDocuments',
    title: 'Deductions & Credits Documentation',
    subtitle: 'Upload any documents to support your eligible deductions and credits.',
    icon: 'document',
    examples: [
      'Mortgage Interest (Form 1098)',
      'Student Loan Interest (Form 1098-E)',
      'Property Taxes (1098)',
      'Charitable Contributions (receipts)',
      'Medical & Dental Expenses',
      'Education Expenses (1098-T)',
      'Child/Dependent Care Expenses',
      'Energy Efficient Home Improvements',
      'Retirement Contributions (IRA, 401(k), etc.)',
      'Health Savings Account (HSA)',
      'Other supporting documents',
    ],
  },
  {
    id: 'businessDocuments',
    title: 'Business Income & Expenses Documentation',
    subtitle: 'Upload business-related documents if applicable.',
    icon: 'business',
    examples: [
      'Profit & Loss Statement',
      'Balance Sheet',
      'Business Income (1099-NEC, 1099-MISC, etc.)',
      'Business Expense Receipts',
      'Mileage Logs',
      'Bank Statements (Business)',
      'Invoices',
      'Client Contracts',
      'Equipment Purchases',
      'Payroll Reports',
      'Quarterly Tax Payments',
      'Other business records',
    ],
  },
  {
    id: 'formationDocuments',
    title: 'Business EIN & Formation Documents',
    subtitle: 'Upload your business EIN confirmation and formation documents (if applicable).',
    icon: 'building',
    examples: [
      'EIN Confirmation Letter (CP 575)',
      'Articles of Organization (LLC)',
      'Incorporation Documents (S-Corp or C-Corp)',
      'Operating Agreement',
      'Business License',
      'Other formation documents',
    ],
  },
] as const;
export type DocumentId =
  (typeof identitySlots)[number]['id'] | (typeof documentCategories)[number]['id'];
export const paymentOptions = [
  {
    value: 'refund',
    label: 'I want to pay from my refund',
    detail: '(For W-2 personal taxes only) This option attracts an additional bank product fee.',
  },
  {
    value: 'now',
    label: 'I want to pay now with a 10% discount',
    detail:
      'Payment is due before preparation commences. Invoice will be sent to your email on file.',
  },
  {
    value: 'after',
    label: 'I want to pay after preparation is completed',
    detail:
      'Once preparation is complete, your preparer will send you an email to pay the invoice before documents for review are emailed to you.',
  },
] as const;

export function hasBusiness(types: string[]) {
  return types.some((value) => value === returnTypes[1] || value === returnTypes[2]);
}
export function hasSpouse(status: string) {
  return status.startsWith('Married');
}
export function maskLastFour(value: string, kind: 'SSN' | 'EIN' = 'SSN') {
  return value
    ? `${kind === 'SSN' ? '•••-••-' : '••-•••'}${value.replace(/\D/g, '').slice(-4)}`
    : 'Not provided';
}
export function cents(value: string) {
  return /^\d+(\.\d{0,2})?$/.test(value) ? Math.round(Number(value) * 100) : 0;
}
export function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
}
