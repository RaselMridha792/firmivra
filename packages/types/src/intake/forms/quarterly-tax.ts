import type { IntakeFormDefinition } from '../definition.js';
import { BUSINESS_STRUCTURES, MONTHS, QUARTERS } from '../options.js';
import { address, f, is, opts, quarterColumns, R, rows, rowsWith, section, step } from './build.js';

// Quarterly Tax (the "File Business Quarterly Taxes" card): docs/specs/NOTES-begin-online.md
// section 4, mockups `business Information.png`, `Taxes & Income.png`, `Business Expenses.png`
// and `Review & Submit.png`. The quarters and last year's income are asked once (step 1 and step 2
// asked both twice; R11 question 3). The agreement, name, title and signature come from the firm's
// agreements (R14), not from this definition.

const quarterRows = rows({ q1: QUARTERS.Q1, q2: QUARTERS.Q2, q3: QUARTERS.Q3, q4: QUARTERS.Q4 });
const amountPaid = { key: 'amount', label: 'Amount Paid', type: 'currency' as const };

/** One state's estimated payments: the amount and date of each quarter. */
const statePayments = (['q1', 'q2', 'q3', 'q4'] as const).flatMap((q) => {
  const label = QUARTERS[q.toUpperCase() as keyof typeof QUARTERS];
  return [
    f.currency(`${q}Amount`, `${label} Amount Paid`),
    f.date(`${q}Date`, `${label} Date Paid`, { past: true }),
  ];
});

export const QUARTERLY_TAX_FORM: IntakeFormDefinition = {
  key: 'QUARTERLY_TAX',
  version: 1,
  title: 'Quarterly Tax Intake Form',
  subtitle:
    "Let's get started! Please provide the information below so we can prepare your business quarterly tax estimate or filing accurately.",
  steps: [
    step('business', 'Business Information', [
      section(
        'business',
        'Business Information',
        [
          f.text('businessName', 'Business Legal Name', {
            ...R,
            placeholder: 'Enter your business legal name (as registered with the state)',
          }),
          f.text('dba', 'Doing Business As (DBA) (if applicable)', {
            placeholder: 'Enter your DBA (if applicable)',
          }),
          f.ein('ein', 'Business EIN', R),
          f.phone('phone', 'Business Phone Number', R),
          f.email('email', 'Business Email Address', R),
          f.url('website', 'Business Website (if applicable)'),
          ...address('', 'Business Address', R),
        ],
        { subtitle: 'Tell us about your business.' },
      ),
      section(
        'ownership',
        'Business Structure & Ownership',
        [
          // Not on the step 1 mockup, but its review page shows "Owner Name" and a lead needs a
          // person to contact.
          f.text('fullName', 'Your Full Name', {
            ...R,
            placeholder: 'First and Last Name',
            help: 'The owner, or the person we should contact about this filing.',
          }),
          f.radio(
            'businessStructure',
            'Business Structure (Select one)',
            opts(BUSINESS_STRUCTURES),
            R,
          ),
          f.text('businessStructureOther', 'Please specify', {
            ...R,
            showIf: is('businessStructure', 'OTHER'),
          }),
          f.yesNo('hasPartners', 'Are there business partners or owners?', R),
          f.textarea(
            'ownerDetails',
            "If yes, please provide each owner/partner's name, title, and ownership percentage.",
            {
              placeholder: 'Enter owner/partner details (e.g., John Smith - 50%, Jane Doe - 50%).',
              showIf: is('hasPartners', true),
            },
          ),
          f.text('taxContact', 'Primary Contact for Tax Matters (if different from above)', {
            placeholder: 'Enter name, title, email, and phone number',
          }),
        ],
        { subtitle: 'Tell us about your business structure and ownership.' },
      ),
      section('industry', 'Business Industry & Services', [
        f.textarea(
          'productsOrServices',
          'What type of product(s) or service(s) does your business provide?',
          {
            ...R,
            placeholder:
              'e.g., retail sales, consulting, construction, real estate, food service, online products, professional services, etc.',
          },
        ),
      ]),
      section(
        'quarterly',
        'Quarterly Tax Information',
        [
          f.checkboxes(
            'quarters',
            'Which quarter(s) are you filing for? (Select all that apply)',
            opts(QUARTERS),
            R,
          ),
          f.yesNo(
            'firstTimeQuarterly',
            'Is this your first time filing business quarterly taxes?',
            R,
          ),
          f.yesNo(
            'paidEstimated',
            "Did you pay any estimated taxes for the quarter(s) you're filing?",
            R,
          ),
          f.textarea('estimatedDetails', 'If yes, please provide the amount(s) and date(s) paid.', {
            placeholder: 'e.g., Q1: $2,500 on 04/15/{taxYear}, Q2: $3,000 on 06/15/{taxYear}',
            showIf: is('paidEstimated', true),
          }),
        ],
        { subtitle: 'Help us understand your quarterly tax situation.' },
      ),
      section(
        'years',
        'Prior Year & Current Year Information',
        [
          f.yesNo('filedBefore', 'Have you filed business tax returns in the past?', R),
          f.currency(
            'expectedIncome',
            'What is your expected total business income for the current tax year?',
            R,
          ),
          f.yesNo(
            'expectsChanges',
            'Do you anticipate any significant changes to your income, expenses, or business structure this year?',
            R,
          ),
          f.textarea('changesDetails', 'If yes, please explain.', {
            placeholder:
              'e.g., expansion, new location, major equipment purchase, change in ownership, etc.',
            showIf: is('expectsChanges', true),
          }),
        ],
        { subtitle: 'Help us get a complete picture of your business.' },
      ),
      section(
        'records',
        'Accounting & Recordkeeping',
        [
          f.text('accountingSoftware', 'Which accounting software do you use? (if any)', {
            placeholder: 'e.g., QuickBooks, Xero, FreshBooks, Excel, or None',
          }),
          f.text('trackingMethod', 'How do you track your income and expenses?', {
            ...R,
            placeholder:
              'e.g., accounting software, spreadsheets, bank records, other (please specify)',
          }),
          f.radio(
            'recordsOrganized',
            'Are your financial records up to date and organized?',
            opts({
              YES: 'Yes',
              SOMEWHAT: 'Somewhat',
              NO: 'No',
              NEED_ASSISTANCE: 'Need assistance',
            }),
            R,
          ),
        ],
        { subtitle: 'Tell us about your financial records.' },
      ),
      section(
        'additional',
        'Additional Information',
        [
          f.yesNo('multipleLocations', 'Do you have multiple business locations?', R),
          f.yesNo('multipleStates', 'Do you operate in multiple states?', R),
          f.textarea('comments', 'Is there anything else you would like us to know?', {
            placeholder: 'e.g., seasonal business, upcoming changes, specific tax questions, etc.',
          }),
          f.info(
            'businessNote',
            'Why we ask',
            'Your information helps us prepare your quarterly taxes accurately and keep your business compliant.',
          ),
        ],
        { subtitle: 'Is there anything else we should know?' },
      ),
    ]),

    step(
      'taxesIncome',
      'Taxes & Income',
      [
        section('filingPeriod', 'Filing Period', [
          f.text('businessTaxYear', "What is your business's tax year?", {
            ...R,
            placeholder: 'e.g., Calendar Year (Jan-Dec) or Fiscal Year (MM/DD-MM/DD)',
          }),
          f.date('taxYearStart', 'Start date of your current tax year', R),
          f.date('taxYearEnd', 'End date of your current tax year', R),
          f.radio(
            'calendarYear',
            'Do you file your taxes on a calendar year (Jan-Dec)?',
            opts({ CALENDAR: 'Yes', FISCAL: 'No (I use a fiscal year)' }),
            R,
          ),
          f.select(
            'fiscalStartMonth',
            'If you use a fiscal year, please enter the start month.',
            opts(MONTHS),
            { ...R, showIf: is('calendarYear', 'FISCAL') },
          ),
        ]),
        section(
          'federalPayments',
          'Estimated Federal Tax Payments',
          [
            f.grid('federalPayments', 'Estimated Federal Tax Payments', quarterRows, [
              amountPaid,
              { key: 'date', label: 'Date Paid', type: 'date' },
            ]),
          ],
          {
            subtitle:
              'Enter any estimated federal tax payments you have already made for the current tax year.',
          },
        ),
        section(
          'grossReceipts',
          'Business Income (Gross Receipts)',
          [
            f.grid('grossReceipts', 'Business Income (Gross Receipts)', quarterRows, [
              { key: 'amount', label: 'Amount', type: 'currency' },
            ]),
            f.yesNo('multipleStreams', 'Does your business have multiple income streams?', R),
            f.textarea(
              'streamsDetails',
              'If yes, please describe (e.g., product sales, services, rental income, etc.).',
              {
                placeholder: 'Enter details about your income sources.',
                showIf: is('multipleStreams', true),
              },
            ),
          ],
          { subtitle: 'Enter your total business income (sales/receipts) for each quarter.' },
        ),
        section(
          'statePayments',
          'Estimated State Tax Payments',
          [
            f.group(
              'statePayments',
              'Estimated State Tax Payments',
              [f.state('state', 'State', R), ...statePayments],
              { itemLabel: 'State', addLabel: 'Add Another State', maxItems: 10 },
            ),
          ],
          {
            subtitle:
              'Enter any estimated state tax payments you have already made for the current tax year.',
          },
        ),
        section(
          'payrollWages',
          'Estimated Payroll (Wages) per Quarter',
          [
            f.grid('payrollWages', 'Estimated Payroll (Wages) per Quarter', quarterRows, [
              { key: 'amount', label: 'Total Wages Paid', type: 'currency' },
            ]),
          ],
          { subtitle: 'Enter total wages paid (or expected to be paid) for each quarter.' },
        ),
        section(
          'payrollTaxes',
          'Estimated Payroll Taxes Paid',
          [
            f.grid(
              'payrollTaxes',
              'Estimated Payroll Taxes Paid',
              rows({
                socialSecurity: 'Social Security (6.2%)',
                medicare: 'Medicare (1.45%)',
                futa: 'Federal Unemployment (FUTA)',
                suta: 'State Unemployment (SUTA)',
                other: 'Other Payroll Taxes',
              }),
              quarterColumns,
            ),
          ],
          { subtitle: 'Enter any payroll taxes you have already paid for the current tax year.' },
        ),
        section(
          'priorYear',
          'Prior Year Information',
          [
            f.currency(
              'lastYearIncome',
              'What was your total business income for your last completed tax year?',
              R,
            ),
            f.currency(
              'lastYearLiability',
              'What was your total business tax liability for your last completed tax year?',
              {
                ...R,
                help: '(This may be from your business return or your personal return, depending on your structure.)',
              },
            ),
            f.yesNo(
              'filedLastYear',
              'Did you file a business tax return for the last tax year?',
              R,
            ),
            f.text(
              'lastYearForm',
              'If yes, what form did you file? (e.g., 1120, 1120-S, 1065, Schedule C, etc.)',
              {
                placeholder: 'Enter form number (e.g., 1120, 1120-S, 1065, Schedule C)',
                showIf: is('filedLastYear', true),
              },
            ),
          ],
          { subtitle: 'This helps us ensure your estimated tax is calculated correctly.' },
        ),
        section(
          'additionalTax',
          'Additional Tax Information',
          [
            f.textarea('additionalTaxInfo', 'Additional Tax Information', {
              placeholder:
                'e.g., tax credits, industry-specific taxes, local taxes, or other relevant details.',
            }),
          ],
          {
            subtitle:
              'Please share any other information that may be relevant to your quarterly tax filing.',
          },
        ),
        section(
          'incomeDocuments',
          'Upload Supporting Documents for Business Income, Wages & Taxes',
          [
            f.upload('incomeDocuments', 'Supporting Documents for Business Income, Wages & Taxes', {
              help: 'Upload bank statements, payment confirmations, payroll reports, 940/941 receipts, estimated tax payment confirmations, and any other documents that support the information entered on this page. Please label each file with the quarter it relates to (e.g., Q1 {taxYear} Federal Payment).',
            }),
          ],
        ),
      ],
      {
        subtitle:
          "Provide your tax payment information and income details for the quarter(s) you're filing.",
      },
    ),

    step(
      'expenses',
      'Business Expenses',
      [
        section(
          'expenses',
          'Business Expenses for Each Quarter',
          [
            f.grid(
              'expenses',
              'Business Expenses for Each Quarter',
              rowsWith('help', [
                [
                  'cogs',
                  'Cost of Goods Sold (COGS)',
                  'Direct costs to produce or purchase products for resale',
                ],
                ['office', 'Office & Supplies', 'Office supplies, software, postage, etc.'],
                ['rent', 'Rent / Lease', 'Office, equipment, or property rent'],
                ['utilities', 'Utilities', 'Electricity, water, gas, internet, phone, etc.'],
                [
                  'vehicleTravel',
                  'Vehicle / Travel',
                  'Fuel, repairs, maintenance, travel expenses',
                ],
                ['meals', 'Meals & Entertainment', 'Business meals and client entertainment'],
                ['payroll', 'Payroll & Contractor Payments', 'Wages, salaries, 1099 contractors'],
                ['professional', 'Professional Services', 'Legal, accounting, consulting, etc.'],
                [
                  'marketing',
                  'Marketing & Advertising',
                  'Ads, promotions, website, social media, etc.',
                ],
                ['insurance', 'Insurance', "Business liability, workers' comp, etc."],
                ['repairs', 'Repairs & Maintenance', 'Equipment, vehicles, property repairs'],
                [
                  'taxesLicenses',
                  'Taxes & Licenses',
                  'Business licenses, permits, state/local taxes',
                ],
                ['interest', 'Interest', 'Business loan interest, credit card interest'],
                ['depreciation', 'Depreciation', 'Depreciation of equipment and assets'],
                ['other', 'Other Deductions & Expenses', 'Other business expenses (specify below)'],
              ]),
              quarterColumns,
              { totalLabel: 'Total Business Expenses' },
            ),
          ],
          {
            subtitle:
              'Enter your total deductible business expenses for each quarter. If a category does not apply, enter $0.',
          },
        ),
        section('expenseDocuments', 'Upload Supporting Documents for Expenses (All Quarters)', [
          f.upload('expenseDocuments', 'Supporting Documents for Expenses (All Quarters)', {
            help: 'Upload receipts, invoices, statements, and other documents that support the expenses entered above. Please label each file with the quarter it relates to (e.g., Q1 {taxYear} Office Supplies).',
          }),
        ]),
        section(
          'expenseNotes',
          'Additional Notes (Optional)',
          [
            f.textarea('expenseNotes', 'Additional Notes (Optional)', {
              placeholder:
                'e.g., explanation of large expenses, seasonal costs, or items listed in "Other."',
            }),
          ],
          {
            subtitle:
              'If you need to provide more details about your expenses, one-time costs, or anything else, please include them here.',
          },
        ),
      ],
      { subtitle: 'Business Expenses for Each Quarter' },
    ),

    step(
      'review',
      'Review & Submit',
      [
        section('additionalDocuments', 'Upload Additional Supporting Documents (Optional)', [
          f.upload('additionalDocuments', 'Additional Supporting Documents (Optional)', {
            help: 'Upload any other documents that support your quarterly filing.',
          }),
        ]),
      ],
      {
        review: true,
        subtitle:
          'Please review all the information below to ensure everything is correct before signing and submitting.',
      },
    ),
  ],
};
