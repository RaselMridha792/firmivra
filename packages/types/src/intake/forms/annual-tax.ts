import type { IntakeFormDefinition } from '../definition.js';
import { FILING_STATUSES } from '../options.js';
import {
  address,
  f,
  fullName,
  has,
  is,
  oneOf,
  opts,
  quarterColumns,
  R,
  rowsWith,
  section,
  step,
} from './build.js';

// Annual Tax (the "Tax Preparation" card): docs/specs/NOTES-begin-online.md section 3, mockups
// `Annual Intake Form 1.png` to `Annual Tax Intake Form 4.png`.

const married = oneOf('filingStatus', ['MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY']);
/** Step 2, the business sections and the business uploads: only for a business return. */
const business = has('returnTypes', ['BUSINESS', 'BOTH']);

const descriptionColumn = {
  key: 'description',
  label: 'Description (optional)',
  type: 'text' as const,
};
const quarterlyAndAnnual = [
  descriptionColumn,
  ...quarterColumns,
  { key: 'annual', label: 'Total Annual', type: 'currency' as const },
];

const yes = (key: string, label: string) => f.yesNo(key, label);

export const ANNUAL_TAX_FORM: IntakeFormDefinition = {
  key: 'ANNUAL_TAX',
  version: 1,
  title: 'Annual Tax Intake Form',
  subtitle:
    "Let's get started! Please complete the information below so we can prepare an accurate and compliant tax return for you.",
  steps: [
    step('personal', 'Personal & Filing Information', [
      section(
        'personal',
        'Personal & Filing Information',
        [
          ...fullName('', R),
          f.date('dateOfBirth', 'Date of Birth', { ...R, past: true }),
          f.phone('phone', 'Phone Number', R),
          f.email('email', 'Email Address', R),
          f.ssn('ssn', 'Social Security Number (SSN)', R),
          ...address('', 'Physical Address', R),
          f.radio('filingStatus', 'Filing Status', opts(FILING_STATUSES), R),
          f.yesNo(
            'claimedAsDependent',
            "Are you claimed as a dependent on someone else's return?",
            R,
          ),
          f.checkboxes(
            'returnTypes',
            'Type of Tax Return(s) You Need (Select all that apply)',
            opts({
              PERSONAL: 'Personal (1040)',
              BUSINESS: 'Business (1120, 1120-S, 1065, etc.)',
              BOTH: 'Both Personal & Business',
            }),
            R,
          ),
          f.radio(
            'legalStatus',
            'Your Legal Status in the U.S.',
            opts({
              US_CITIZEN: 'U.S. Citizen',
              PERMANENT_RESIDENT: 'Permanent Resident (Green Card)',
              NON_RESIDENT_ALIEN: 'Non-Resident Alien',
              OTHER: 'Other',
            }),
            R,
          ),
          f.yesNo('armedForces', 'Did you serve in the U.S. Armed Forces?', R),
        ],
        { subtitle: 'Tell us about yourself.' },
      ),
      section(
        'spouse',
        'Spouse Information (if applicable)',
        [
          // Required while the section shows (married filers only).
          ...fullName('spouse', R),
          f.ssn('spouseSsn', 'Spouse SSN', R),
          f.date('spouseDateOfBirth', 'Date of Birth', { past: true, ...R }),
          f.text('spouseOccupation', 'Spouse Occupation', {
            placeholder: 'Occupation or job title',
          }),
          f.text('spouseEmployer', 'Spouse Employer', { placeholder: 'Employer name' }),
          f.phone('spousePhone', 'Spouse Phone Number'),
          f.email('spouseEmail', 'Spouse Email Address'),
          ...address('spouse', 'Spouse Address (if different)'),
        ],
        {
          subtitle: 'Tell us about your filing status, spouse, and dependents.',
          showIf: married,
        },
      ),
      section('dependents', 'Dependents', [
        f.yesNo('hasDependents', 'Do you have any dependents?', R),
        f.group(
          'dependents',
          'Dependents',
          [
            ...fullName('', R),
            f.date('dateOfBirth', 'Date of Birth', { ...R, past: true }),
            f.select(
              'relationship',
              'Relationship to you',
              opts({
                SON: 'Son',
                DAUGHTER: 'Daughter',
                STEPCHILD: 'Stepchild',
                FOSTER_CHILD: 'Foster child',
                GRANDCHILD: 'Grandchild',
                SIBLING: 'Brother or sister',
                PARENT: 'Parent',
                OTHER_RELATIVE: 'Other relative',
                OTHER: 'Other',
              }),
              R,
            ),
            f.ssn('ssn', 'SSN (if applicable)'),
            f.checkbox('livesWithYou', 'Lives with you'),
            f.checkbox('fullTimeStudent', 'Full-time student'),
            f.checkbox('disabled', 'Disabled'),
            f.checkbox('childTaxCredit', 'Qualifies for Child Tax Credit'),
          ],
          {
            ...R,
            showIf: is('hasDependents', true),
            itemLabel: 'Dependent',
            addLabel: 'Add Another Dependent',
          },
        ),
      ]),
      section(
        'deductions',
        'Deductions & Credits',
        [
          yes('studentLoanInterest', 'Did you pay student loan interest?'),
          yes(
            'retirementContributions',
            'Did you make contributions to a retirement account (IRA, 401(k), etc.)?',
          ),
          yes('hsaContributions', 'Did you make contributions to a Health Savings Account (HSA)?'),
          yes('educationExpenses', 'Did you pay eligible education expenses (e.g., tuition)?'),
          yes('mortgageInterest', 'Did you pay mortgage interest?'),
          yes('realEstateTaxes', 'Did you pay real estate taxes (property taxes)?'),
          yes(
            'charitableContributions',
            'Did you make charitable contributions (cash or non-cash)?',
          ),
          yes('medicalExpenses', 'Did you pay medical or dental expenses?'),
          yes('childCareExpenses', 'Did you pay for child or dependent care expenses?'),
          yes('energyImprovements', 'Did you make energy efficient home improvements?'),
          yes('otherDeductions', 'Do you have any other deductions or credits not listed above?'),
        ],
        { subtitle: 'Let us know which deductions or credits may apply to you.' },
      ),
      section(
        'income',
        'Income',
        [
          yes('incomeWages', 'Did you receive wages from an employer (W-2)?'),
          yes(
            'incomeSelfEmployment',
            'Did you have self-employment or independent contractor income (1099-NEC, 1099-MISC)?',
          ),
          yes('incomeBusiness', 'Did you own a business (Schedule C, S-Corp, Partnership, LLC)?'),
          yes('incomeInterest', 'Did you receive interest income (1099-INT)?'),
          yes('incomeDividends', 'Did you receive dividend income (1099-DIV)?'),
          yes('incomeRetirement', 'Did you receive retirement income (1099-R, SSA-1099)?'),
          yes('incomeUnemployment', 'Did you receive unemployment benefits (1099-G)?'),
          yes('incomeRental', 'Did you receive rental or real estate income (Schedule E)?'),
          yes('incomeAlimony', 'Did you receive alimony income?'),
          yes('incomeOther', 'Did you receive any other income not listed above?'),
          f.textarea('incomeDetails', 'If yes, please describe', {
            placeholder: 'Type details here...',
          }),
        ],
        { subtitle: 'Tell us more about the types of income you received in {taxYear}.' },
      ),
      section(
        'business',
        'Business Information (if applicable)',
        [
          f.group(
            'businesses',
            'Businesses',
            [
              f.radio(
                'legalStructure',
                'Business Legal Structure',
                opts({
                  LLC: 'LLC',
                  S_CORP: 'S Corporation',
                  C_CORP: 'C Corporation',
                  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
                  OTHER: 'Other',
                }),
              ),
              f.text('legalStructureOther', 'Please specify', {
                showIf: is('legalStructure', 'OTHER'),
              }),
              f.text('legalName', 'Business Legal Name', { placeholder: 'Your business name' }),
              f.ein('ein', 'Business EIN'),
              ...address('', 'Business Address'),
              f.radio(
                'sells',
                'Is your business primarily selling?',
                opts({ GOODS: 'Goods (Products)', SERVICES: 'Services' }),
                R,
              ),
              f.text('productsOrServices', 'What kind of products or services do you sell?', {
                ...R,
                placeholder: 'Please describe your products or services...',
              }),
            ],
            { ...R, itemLabel: 'Business', addLabel: 'Add Another Business', maxItems: 10 },
          ),
        ],
        { showIf: business },
      ),
      section('comments', 'Comments / Additional Information', [
        f.textarea(
          'comments',
          'If there is anything else you would like us to know, please provide details here.',
          { placeholder: 'Type your comments here...' },
        ),
        f.info(
          'documentsNote',
          'Important',
          'Your answers will help us determine which documents are required on the next page. Please be as accurate as possible.',
        ),
      ]),
    ]),

    step(
      'businessIncome',
      'Business Income & Expenses',
      [
        section(
          'businessIncome',
          'Business Income',
          [
            f.grid(
              'businessIncome',
              'Business Income',
              rowsWith('placeholder', [
                ['salesOfProducts', 'Sales of Products', 'e.g., physical products'],
                ['services', 'Services / Consulting', 'e.g., consulting fees'],
                ['rental', 'Rental Income', 'e.g., equipment, property'],
                ['investment', 'Investment Income', 'e.g., interest, dividends'],
                ['subcontractor', 'Subcontractor Income (1099)', 'e.g., contract work'],
                ['refunds', 'Refunds / Reimbursements', 'e.g., insurance, tax refunds'],
                ['other', 'Other Business Income', 'e.g., grants, misc.'],
              ]),
              quarterlyAndAnnual,
              { totalLabel: 'Total Business Income' },
            ),
          ],
          { subtitle: 'Enter all sources of business income received during the tax year.' },
        ),
        section(
          'payroll',
          'Wages, Payroll & Employment Taxes',
          [
            f.grid(
              'payrollTaxes',
              'Wages, Payroll & Employment Taxes',
              rowsWith('placeholder', [
                ['wages', 'Total Wages Paid (W-2)', 'Gross wages paid to employees'],
                ['ownerCompensation', 'Owner/Officer Compensation', 'Owner draws, salary, wages'],
                ['socialSecurity', 'Social Security Tax (FICA)', 'Employer portion'],
                ['medicare', 'Medicare Tax', 'Employer portion'],
                ['futa', 'Federal Unemployment (FUTA)', 'Employer portion'],
                ['suta', 'State Unemployment (SUTA)', 'Employer portion'],
                ['other', 'Other Payroll Taxes', 'e.g., local payroll taxes'],
              ]),
              quarterlyAndAnnual,
            ),
          ],
          {
            subtitle:
              'Enter total wages paid and payroll taxes for the year (if you had employees or paid yourself through payroll).',
          },
        ),
        section(
          'incomeTaxesPaid',
          'Income Taxes Paid',
          [
            f.grid(
              'incomeTaxesPaid',
              'Income Taxes Paid',
              rowsWith('placeholder', [
                ['federal', 'Federal Estimated Tax Payments', 'Form 1040-ES / 1120-ES'],
                ['state', 'State Estimated Tax Payments', 'e.g., GA Form 500 ES'],
                [
                  'otherState',
                  'Other State Income Tax Payments',
                  'if operating in multiple states',
                ],
                ['local', 'Local Income Tax Payments', 'e.g., city or county'],
                ['other', 'Other Income Tax Payments', 'e.g., prior year, extensions'],
              ]),
              quarterlyAndAnnual,
            ),
          ],
          { subtitle: 'Enter any business or owner income tax payments made during the year.' },
        ),
        section(
          'businessExpenses',
          'Business Expenses',
          [
            f.grid(
              'businessExpenses',
              'Business Expenses',
              rowsWith('placeholder', [
                ['advertising', 'Advertising & Marketing', 'e.g., online ads, flyers'],
                ['bankFees', 'Bank Fees', 'e.g., monthly service fees'],
                ['carTruck', 'Car & Truck Expenses', 'e.g., fuel, maintenance'],
                ['contractLabor', 'Contract Labor (1099)', 'e.g., subcontractors'],
                ['depreciation', 'Depreciation & Amortization', 'e.g., equipment, furniture'],
                ['insurance', 'Insurance', 'e.g., liability, property, WC'],
                ['legalProfessional', 'Legal & Professional Fees', 'e.g., legal, accounting'],
                ['meals', 'Meals & Entertainment', 'e.g., client meals (50%)'],
                ['office', 'Office Expenses', 'e.g., supplies, postage'],
                ['rent', 'Rent / Lease', 'e.g., office, equipment'],
                ['repairs', 'Repairs & Maintenance', 'e.g., equipment, property'],
                ['software', 'Software & Subscriptions', 'e.g., QuickBooks, Adobe'],
                ['telephone', 'Telephone & Internet', 'e.g., cell phone, internet'],
                ['utilities', 'Utilities', 'e.g., electric, water, gas'],
                ['travel', 'Travel Expenses', 'e.g., airfare, hotels, mileage'],
                ['dues', 'Dues & Memberships', 'e.g., professional organizations'],
                ['education', 'Education & Training', 'e.g., courses, seminars'],
                ['taxesLicenses', 'Taxes & Licenses', 'e.g., business licenses'],
                ['interest', 'Interest Expense', 'e.g., loan interest'],
                ['equipment', 'Equipment & Tools', 'e.g., computers, machinery'],
                ['inventory', 'Inventory / Cost of Goods Sold', 'e.g., materials, inventory'],
                ['supplies', 'Supplies', 'e.g., cleaning, office supplies'],
                ['other', 'Other Expenses', 'e.g., bank charges, misc.'],
              ]),
              [descriptionColumn, { key: 'annual', label: 'Total Annual', type: 'currency' }],
              { totalLabel: 'Total Business Expenses' },
            ),
          ],
          {
            subtitle:
              'Enter your total business expenses for the year. Include all ordinary and necessary expenses. You can also upload a detailed expense report.',
          },
        ),
      ],
      {
        subtitle:
          'Please provide the information below so we can accurately prepare your business and personal tax return.',
        showIf: business,
      },
    ),

    step(
      'documents',
      'Required Document Upload',
      [
        section('uploadRules', 'Required Document Uploads', [
          f.info(
            'uploadRules',
            'Important',
            'Upload clear, legible files. You can upload multiple files for each item (upload as many as needed). Maximum file size: 10 MB per file. Make sure each document is labeled correctly. All required documents must be uploaded or marked as "I don\'t have this document" with an explanation.',
          ),
        ]),
        section(
          'identity',
          'Identity Verification Documents',
          [
            f.upload('governmentId', 'Your Government ID', {
              ...R,
              notAvailable: true,
              help: "(e.g., Driver's License, State ID, or Passport)",
            }),
            f.upload('spouseGovernmentId', 'Spouse Government ID', {
              notAvailable: true,
              showIf: married,
            }),
            f.upload('socialSecurityCard', 'Your Social Security Card', {
              ...R,
              notAvailable: true,
            }),
            f.upload('spouseSocialSecurityCard', 'Spouse Social Security Card', {
              notAvailable: true,
              showIf: married,
            }),
            f.upload('dependentDocuments', 'Dependent(s) Qualifying Documents', {
              ...R,
              notAvailable: true,
              help: '(e.g., Birth Certificate, Adoption Papers)',
              showIf: is('hasDependents', true),
            }),
          ],
          {
            subtitle:
              'Upload government-issued IDs, Social Security cards, and dependent verification documents.',
          },
        ),
        section('incomeDocuments', 'Income Documents', [
          f.upload('incomeDocuments', 'Income Documents', {
            help: 'Upload all income documents that apply to you.',
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
          }),
        ]),
        section('deductionDocuments', 'Deductions & Credits Documentation', [
          f.upload('deductionDocuments', 'Deductions & Credits Documentation', {
            help: 'Upload any documents to support your eligible deductions and credits.',
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
          }),
        ]),
        section(
          'businessDocuments',
          'Business Income & Expenses Documentation',
          [
            f.upload('businessDocuments', 'Business Income & Expenses Documentation', {
              ...R,
              notAvailable: true,
              help: 'Required for Business Filings: a categorized list of all business expenses, and a summary of year-to-date business income.',
              examples: [
                'Profit & Loss Statement',
                'Balance Sheet',
                'Business Income (1099-NEC, 1099-MISC, etc.)',
                'Business Expense Receipts',
                'Mileage Log',
                'Bank Statements (Business)',
                'Invoices',
                'Client Contracts',
                'Equipment Purchases',
                'Payroll Reports',
                'Quarterly Tax Payments',
                'Other business records',
              ],
            }),
          ],
          { showIf: business },
        ),
        section(
          'formationDocuments',
          'Business EIN & Formation Documents',
          [
            f.upload('formationDocuments', 'Business EIN & Formation Documents', {
              help: 'Upload your business EIN confirmation and formation documents (if applicable).',
              examples: [
                'EIN Confirmation Letter (CP 575)',
                'Articles of Organization (LLC)',
                'Incorporation Documents (S-Corp or C-Corp)',
                'Operating Agreement',
                'Business License',
                'Other formation documents',
              ],
            }),
          ],
          { showIf: business },
        ),
        section('certify', 'Certification', [
          f.checkbox(
            'certifyDocuments',
            'Yes, I certify that I have uploaded all required documents and that the information provided is true and accurate to the best of my knowledge. I understand that failure to provide the required documents may delay the preparation of my tax return.',
            R,
          ),
        ]),
      ],
      {
        subtitle:
          'Please upload all applicable documents based on the information you provided on the previous page. If a document does not apply or you do not have it, select "I don\'t have this document" and provide an explanation.',
      },
    ),

    step(
      'review',
      'Review & Sign Agreement',
      [
        section('payment', 'How would you like to pay for your service?', [
          f.radio(
            'paymentPreference',
            'How would you like to pay for your service?',
            [
              {
                value: 'FROM_REFUND',
                label: 'I want to pay from my refund',
                help: '(For W-2 personal taxes only) This option attracts an additional bank product fee.',
              },
              {
                value: 'PAY_NOW_DISCOUNT',
                label: 'I want to pay now with a 10% discount',
                help: 'Payment is due before preparation commences. Invoice will be sent to your email.',
              },
              {
                value: 'PAY_AFTER',
                label: 'I want to pay after preparation is completed',
                help: '(Once preparation is complete, your preparer will send you an email to pay the invoice before documents for review are emailed to you.)',
              },
            ],
            R,
          ),
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
