import { describe, expect, it } from 'vitest';
import {
  BOOKKEEPING_FORM,
  BUSINESS_DEVELOPMENT_FORM,
  checkIntakeAnswers,
  INTAKE_FORMS,
  intakeFields,
  intakeStepFields,
  IntakeFormKey,
  type IntakeFormDefinition,
  PAYROLL_FORM,
  QUARTERLY_TAX_FORM,
  shownIntakeKeys,
  TAX_PLANNING_FORM,
} from '../../src/index.js';

// The five forms of contract C (Annual Tax is in definitions.test.ts). Synthetic answers only.

const today = '2026-10-08';
const submit = (
  form: IntakeFormDefinition,
  answers: Record<string, unknown>,
  uploads: Record<string, number> = {},
) => checkIntakeAnswers(form, answers, { mode: 'submit', uploads, today });
const issuePaths = (result: { issues: { path: unknown[] }[] }) =>
  result.issues.map((i) => i.path.join('.'));
const shown = (form: IntakeFormDefinition, answers: Record<string, unknown>) =>
  shownIntakeKeys(form, answers).fields;

const address = { street: '100 Example Way', city: 'Auburn', state: 'GA', zip: '30011' };

/** The smallest complete submission of each form: every shown required field, nothing more. */
const minimal: Record<Exclude<IntakeFormKey, 'ANNUAL_TAX'>, Record<string, unknown>> = {
  QUARTERLY_TAX: {
    businessName: 'Example Cleaning LLC',
    fullName: 'Morgan Example',
    ein: '12-3456789',
    phone: '404-555-0100',
    email: 'owner@example.test',
    ...address,
    businessStructure: 'LLC_SINGLE_MEMBER',
    hasPartners: false,
    productsOrServices: 'Office cleaning',
    quarters: ['Q1'],
    firstTimeQuarterly: true,
    paidEstimated: false,
    filedBefore: false,
    expectedIncome: 5_000_000,
    expectsChanges: false,
    trackingMethod: 'Spreadsheets',
    recordsOrganized: 'SOMEWHAT',
    multipleLocations: false,
    multipleStates: false,
    taxYearStart: '2026-01-01',
    taxYearEnd: '2026-12-31',
    calendarYear: 'CALENDAR',
    multipleStreams: false,
    lastYearIncome: 0,
    lastYearLiability: 0,
    filedLastYear: false,
  },
  BOOKKEEPING: {
    firstName: 'Avery',
    lastName: 'Example',
    title: 'Owner',
    email: 'avery@example.test',
    phone: '404-555-0101',
    preferredContact: 'EMAIL',
    businessName: 'Example Goods LLC',
    ein: '12-3456789',
    ...address,
    industry: 'Retail',
    entityType: 'LLC',
    yearsInBusiness: 3,
    package: 'GROWTH',
    primaryBanks: 'Example Bank',
    hasBookkeeper: false,
    currentSituation: 'I handle it myself',
    reportFrequency: 'Monthly',
    goodsOrServices: 'Handmade candles',
    startDate: '2023-03-01',
    startMonth: '2026-11',
    needsCatchUp: false,
    hadBookkeeperBefore: false,
    checkingAccounts: 1,
    creditCards: 1,
    loans: 0,
    merchantAccounts: 1,
    institutions: 'Example Bank',
    paymentMethods: 'Card and cash',
    hasReceivables: false,
    invoiceTracking: 'Not yet',
    hasPayables: false,
    billTracking: 'Not yet',
    vendorPayments: 'Online banking',
    w2Employees: 0,
    contractors1099: 0,
    hasPayrollProvider: false,
    needsPayrollSetup: false,
    collectsSalesTax: false,
    salesTaxHelp: false,
    hasInventory: false,
    hasFinancing: false,
    businessFundsPersonal: false,
    personalFundsBusiness: false,
    hasCurrentReports: true,
    reportsDate: '2026-08',
    accountingMethod: 'CASH',
    reportingRequirements: 'None',
    businessGoals: 'Grow online sales',
    formationDocument: { notAvailable: true, reason: 'Filed with the state last month.' },
    confirmAccurate: true,
    confirmDocuments: true,
    confirmUnderstand: true,
  },
  PAYROLL: {
    businessName: 'Example Services Inc',
    ein: '12-3456789',
    stateOfFormation: 'GA',
    ...address,
    businessPhone: '404-555-0102',
    businessEmail: 'office@example.test',
    industry: 'Landscaping',
    businessFocus: 'SERVICE',
    description: 'Residential landscaping',
    businessStructure: 'S_CORP',
    isOwner: true,
    fullName: 'Jordan Example',
    phone: '404-555-0103',
    email: 'jordan@example.test',
    payrollSituation: ['FIRST_TIME'],
    heardAbout: 'REFERRAL',
    totalEmployees: 3,
    seasonalEmployees: false,
    payFrequency: 'BIWEEKLY',
    payDay: 'FRI',
    startDate: '2026-11-01',
    processesPayroll: false,
    usesPayrollSystem: false,
    transitioning: false,
    funding: 'BUSINESS_ACCOUNT',
    payrollTaxes: 'INCLUDED',
    payMethods: ['DIRECT_DEPOSIT'],
    multiplePayRates: false,
    tracksTime: true,
  },
  TAX_PLANNING: {
    fullName: 'Riley Example',
    phone: '404-555-0104',
    email: 'riley@example.test',
    planningFor: 'INDIVIDUAL',
    accountingMethod: 'CASH',
    planningTaxYear: 2026,
    hasBookkeeper: 'NO',
    services: ['INDIVIDUAL'],
    reasons: ['REDUCE_LIABILITY'],
    multipleStates: false,
    filedRecentReturn: 'YES',
    taxIssues: false,
    taxProfessional: 'NO',
  },
  BUSINESS_DEVELOPMENT: {
    fullName: 'Casey Example',
    phone: '404-555-0105',
    email: 'casey@example.test',
    services: ['FORMATION', 'EIN'],
    currentStatus: 'STARTING',
    businessType: 'LLC',
    hasNameInMind: false,
    accountingYear: 'CALENDAR',
    usesSoftware: 'NOT_YET',
    hasBookkeeper: 'NO',
    productsOrServices: 'Mobile coffee cart',
    targetMarket: 'Office parks',
    unique: 'Locally roasted beans',
    nearTermVision: 'Two carts',
    primaryState: 'GA',
    mainGoals: 'Launch by spring',
    timeframe: 'ASAP',
    longTermVision: 'A storefront',
    stage: 'IDEA',
  },
};
/** Files that count for the required upload slots of each minimal submission. */
const minimalUploads: Partial<Record<IntakeFormKey, Record<string, number>>> = {
  BOOKKEEPING: { einDocument: 1, lastYearReturn: 1 },
};

describe('INTAKE_FORMS', () => {
  it('holds all six services', () => {
    expect(Object.keys(INTAKE_FORMS).sort()).toEqual([...IntakeFormKey.options].sort());
    expect(INTAKE_FORMS.QUARTERLY_TAX).toBe(QUARTERLY_TAX_FORM);
    expect(INTAKE_FORMS.BOOKKEEPING).toBe(BOOKKEEPING_FORM);
    expect(INTAKE_FORMS.PAYROLL).toBe(PAYROLL_FORM);
    expect(INTAKE_FORMS.TAX_PLANNING).toBe(TAX_PLANNING_FORM);
    expect(INTAKE_FORMS.BUSINESS_DEVELOPMENT).toBe(BUSINESS_DEVELOPMENT_FORM);
  });

  it('every form asks on its first step for the contact the lead needs: email, phone, a name', () => {
    for (const form of Object.values(INTAKE_FORMS)) {
      const first = new Map(
        form.steps[0]!.sections.flatMap((s) => s.fields).map((f) => [f.key, f] as const),
      );
      expect(first.get('email'), form.key).toMatchObject({ type: 'email', required: true });
      expect(first.get('phone'), form.key).toMatchObject({ type: 'phone', required: true });
      const name = first.has('fullName')
        ? [first.get('fullName')]
        : [first.get('firstName'), first.get('lastName')];
      for (const f of name) expect(f, form.key).toMatchObject({ type: 'text', required: true });
      // Always shown, in a section that is always shown.
      for (const f of [first.get('email'), first.get('phone'), ...name]) {
        expect(f?.showIf, form.key).toBeUndefined();
        const holder = form.steps[0]!.sections.find((s) => s.fields.includes(f!));
        expect(holder?.showIf, form.key).toBeUndefined();
      }
    }
  });

  it('only Annual Tax asks for an SSN', () => {
    for (const form of Object.values(INTAKE_FORMS)) {
      const ssns = intakeFields(form).filter((f) => f.type === 'ssn');
      expect(ssns.length > 0, form.key).toBe(form.key === 'ANNUAL_TAX');
    }
  });
});

describe.each(Object.entries(minimal))('%s', (key, answers) => {
  const form = INTAKE_FORMS[key as IntakeFormKey]!;
  const uploads = minimalUploads[key as IntakeFormKey] ?? {};

  it('submits with only its required answers', () => {
    expect(submit(form, answers, uploads).issues).toEqual([]);
  });

  it('refuses an empty submission, naming the required fields on their steps', () => {
    const result = submit(form, {});
    expect(issuePaths(result)).toEqual(expect.arrayContaining(['email', 'phone']));
    expect(result.issues.every((i) => form.steps.some((s) => s.key === i.step))).toBe(true);
  });

  it('saves each step on its own: its part of the answers, or nothing at all', () => {
    for (const step of form.steps) {
      const keys = new Set(intakeStepFields(step).map((f) => f.key));
      const part = Object.fromEntries(Object.entries(answers).filter(([k]) => keys.has(k)));
      for (const values of [part, {}]) {
        const result = checkIntakeAnswers(form, values, { mode: 'save', step: step.key, today });
        expect(result.issues, step.key).toEqual([]);
      }
    }
  });
});

describe('the follow-up questions show only for the answer they follow', () => {
  it('Quarterly Tax: the fiscal start month only for a fiscal year, owners only with partners', () => {
    const q = minimal.QUARTERLY_TAX;
    expect(shown(QUARTERLY_TAX_FORM, q).has('fiscalStartMonth')).toBe(false);
    const fiscal = submit(QUARTERLY_TAX_FORM, { ...q, calendarYear: 'FISCAL' });
    expect(issuePaths(fiscal)).toEqual(['fiscalStartMonth']);
    expect(shown(QUARTERLY_TAX_FORM, { ...q, hasPartners: true }).has('ownerDetails')).toBe(true);
    const cleaned = submit(QUARTERLY_TAX_FORM, { ...q, ownerDetails: 'Kept only with partners' });
    expect(cleaned.answers).not.toHaveProperty('ownerDetails');
  });

  it('Quarterly Tax: one row of state payments per state, a state required', () => {
    const row = { id: 'r1', q1Amount: 50_000, q1Date: '2026-04-15' };
    const missing = submit(QUARTERLY_TAX_FORM, { ...minimal.QUARTERLY_TAX, statePayments: [row] });
    expect(issuePaths(missing)).toEqual(['statePayments.0.state']);
    const ok = submit(QUARTERLY_TAX_FORM, {
      ...minimal.QUARTERLY_TAX,
      statePayments: [{ ...row, state: 'GA' }],
    });
    expect(ok.issues).toEqual([]);
  });

  it('Bookkeeping: the inventory questions and slot only for a business with inventory', () => {
    const b = minimal.BOOKKEEPING;
    for (const k of ['inventoryType', 'skuCount', 'inventoryRecords']) {
      expect(shown(BOOKKEEPING_FORM, b).has(k), k).toBe(false);
    }
    const withInventory = submit(
      BOOKKEEPING_FORM,
      { ...b, hasInventory: true },
      {
        einDocument: 1,
        lastYearReturn: 1,
      },
    );
    expect(issuePaths(withInventory)).toEqual([
      'inventoryType',
      'inventoryTracking',
      'skuCount',
      'hasInventoryList',
    ]);
  });

  it('Bookkeeping: each owner-activity yes asks for its own explanation', () => {
    const uploads = { einDocument: 1, lastYearReturn: 1 };
    const b = { ...minimal.BOOKKEEPING, businessFundsPersonal: true, personalFundsBusiness: true };
    expect(issuePaths(submit(BOOKKEEPING_FORM, b, uploads))).toEqual([
      'businessFundsPersonalDetails',
      'ownerActivityDetails',
    ]);
  });

  it('Bookkeeping: each required document needs a file or a reason', () => {
    const result = submit(BOOKKEEPING_FORM, minimal.BOOKKEEPING, { einDocument: 1 });
    expect(issuePaths(result)).toEqual(['lastYearReturn']);
  });

  it('Payroll: the role only when the person is not the owner', () => {
    const p = minimal.PAYROLL;
    expect(issuePaths(submit(PAYROLL_FORM, { ...p, isOwner: false }))).toEqual(['role']);
    expect(submit(PAYROLL_FORM, { ...p, isOwner: false, role: 'BOOKKEEPER' }).issues).toEqual([]);
  });

  it('Tax Planning: the business sections only for business planning', () => {
    const t = minimal.TAX_PLANNING;
    expect(shown(TAX_PLANNING_FORM, t).has('businessStructure')).toBe(false);
    expect(shown(TAX_PLANNING_FORM, t).has('businessRevenue')).toBe(false);
    const both = submit(TAX_PLANNING_FORM, { ...t, planningFor: 'BOTH' });
    expect(issuePaths(both)).toEqual(['businessStructure', 'industry', 'operatingStates']);
  });

  it('Tax Planning: a prior-year amount owed is a negative amount', () => {
    const owed = submit(TAX_PLANNING_FORM, {
      ...minimal.TAX_PLANNING,
      priorRefundOrOwed: -120_000,
    });
    expect(owed.issues).toEqual([]);
    expect(owed.answers['priorRefundOrOwed']).toBe(-120_000);
  });

  it('Business Development: a proposed name only when one is in mind', () => {
    const d = minimal.BUSINESS_DEVELOPMENT;
    expect(issuePaths(submit(BUSINESS_DEVELOPMENT_FORM, { ...d, hasNameInMind: true }))).toEqual([
      'proposedName',
    ]);
    expect(
      issuePaths(submit(BUSINESS_DEVELOPMENT_FORM, { ...d, accountingYear: 'FISCAL' })),
    ).toEqual(['fiscalStartMonth']);
  });
});
