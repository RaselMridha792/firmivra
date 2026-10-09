import type { IntakeFormDefinition } from '../definition.js';
import { BUSINESS_STRUCTURES, HEARD_ABOUT } from '../options.js';
import { address, f, has, is, opts, R, section, step } from './build.js';

// Payroll Services: docs/specs/NOTES-begin-online.md section 6, mockups `Payroll intake 1.png`,
// `Payroll intake 2.png` and `Payroll Review intake.png`. The start date and the current provider
// are asked once, on step 2 (both steps asked them; R11 question 3). The dropdown lists the
// mockups leave empty are proposals for Octavia to confirm (R11 question 7). The agreement, its
// confirmations, name and signature come from the firm's agreements (R14).

/** "Other (please specify)" text under a multiple choice, shown when Other is ticked. */
const otherFor = (field: string, key: string) =>
  f.text(key, 'Please specify', {
    placeholder: 'Type additional details',
    showIf: has(field, ['OTHER']),
  });

export const PAYROLL_FORM: IntakeFormDefinition = {
  key: 'PAYROLL',
  version: 1,
  title: 'Payroll Services Intake Form',
  subtitle: "Let's get your payroll set up the right way.",
  steps: [
    step(
      'business',
      'Business Details',
      [
        section(
          'business',
          'Business Information',
          [
            f.text('businessName', 'Legal Business Name', {
              ...R,
              placeholder: 'Enter your legal business name',
            }),
            f.text('dba', 'Doing Business As (DBA) (if applicable)', {
              placeholder: 'Enter DBA name',
            }),
            f.ein('ein', 'Business EIN', R),
            f.state('stateOfFormation', 'State of Formation', R),
            ...address('', 'Business Address', R),
            f.phone('businessPhone', 'Business Phone', R),
            f.email('businessEmail', 'Business Email', R),
            f.url('website', 'Website (if applicable)'),
          ],
          { subtitle: 'Tell us about your business.' },
        ),
        section(
          'businessType',
          'Business Type',
          [
            f.text('industry', 'Industry', {
              ...R,
              placeholder: 'Type your industry (e.g., Construction, Retail, Healthcare, etc.)',
            }),
            f.radio(
              'businessFocus',
              'Is your business primarily:',
              opts({ PRODUCT: 'Product-based', SERVICE: 'Service-based', BOTH: 'Both' }),
              R,
            ),
            f.textarea('description', 'Brief description of your business', {
              ...R,
              placeholder: 'e.g., What products or services do you offer?',
            }),
          ],
          { subtitle: 'Help us understand your industry and operations.' },
        ),
        section(
          'ownership',
          'Business Ownership',
          [
            f.select('businessStructure', 'Business Structure', opts(BUSINESS_STRUCTURES), R),
            f.text('businessStructureOther', 'Please specify', {
              ...R,
              showIf: is('businessStructure', 'OTHER'),
            }),
            f.yesNo('isOwner', 'Are you the business owner?', R),
            f.select(
              'role',
              'If no, what is your role?',
              opts({
                PARTNER_OFFICER: 'Partner or officer',
                MANAGER: 'Manager',
                OFFICE_ADMIN: 'Office or HR administrator',
                BOOKKEEPER: 'Bookkeeper or accountant',
                AUTHORIZED: 'Authorized representative',
                OTHER: 'Other',
              }),
              { ...R, showIf: is('isOwner', false) },
            ),
            f.text('fullName', 'Primary Contact Name', {
              ...R,
              maxLength: 200,
              placeholder: 'Enter contact name',
            }),
            f.phone('phone', 'Primary Contact Phone', R),
            f.email('email', 'Primary Contact Email', R),
          ],
          { subtitle: 'Let us know how your business is structured.' },
        ),
        section(
          'needs',
          'Payroll Service Needs',
          [
            f.checkboxes(
              'payrollSituation',
              'What best describes your current payroll situation? (Select all that apply)',
              opts({
                NO_SYSTEM: 'I do not currently have a payroll system',
                MANUAL: 'I currently process payroll manually (e.g., using spreadsheets)',
                SWITCHING: "I'm using another payroll provider and want to switch",
                FIRST_TIME: 'I need help setting up payroll for the first time',
                TAX_FILING: 'I need help with payroll tax filing (federal, state, and/or local)',
                NEW_HIRES: 'I need help with employee set up (new hires)',
                YEAR_END: 'I need help with year-end forms (e.g., W-2s, 1099s)',
                OTHER: 'Other (please specify)',
              }),
              R,
            ),
            f.text('payrollSituationOther', 'Please specify', {
              placeholder: 'Tell us more...',
              showIf: has('payrollSituation', ['OTHER']),
            }),
          ],
          { subtitle: "Tell us a little about what you're looking for." },
        ),
        section(
          'additional',
          'Additional Information',
          [
            f.select(
              'heardAbout',
              'How did you hear about our payroll services?',
              opts(HEARD_ABOUT),
              R,
            ),
          ],
          { subtitle: 'A few final questions to help us get started.' },
        ),
      ],
      {
        subtitle: "Let's start with some basic information about your business and payroll needs.",
      },
    ),

    step(
      'payroll',
      'Payroll Details',
      [
        section(
          'employees',
          'Employee Information',
          [
            f.number('totalEmployees', 'Total number of employees', R),
            f.number('fullTimeEmployees', 'Number of full-time employees'),
            f.number('partTimeEmployees', 'Number of part-time employees'),
            f.number('contractors', 'Number of contractors (1099)'),
            f.yesNo('seasonalEmployees', 'Do you have seasonal employees?', R),
            f.textarea('seasonalDetails', 'If yes, please provide details (optional)', {
              placeholder: 'e.g., time of year, number of employees, roles, etc.',
              showIf: is('seasonalEmployees', true),
            }),
          ],
          { subtitle: 'Tell us about your team.' },
        ),
        section(
          'schedule',
          'Payroll Schedule & Timing',
          [
            f.select(
              'payFrequency',
              'Payroll frequency',
              opts({
                WEEKLY: 'Weekly',
                BIWEEKLY: 'Every two weeks (bi-weekly)',
                SEMIMONTHLY: 'Twice a month (semi-monthly)',
                MONTHLY: 'Monthly',
                NOT_SURE: 'Not sure yet',
              }),
              R,
            ),
            f.select(
              'payDay',
              'Preferred pay day',
              opts({
                MON: 'Monday',
                TUE: 'Tuesday',
                WED: 'Wednesday',
                THU: 'Thursday',
                FRI: 'Friday',
              }),
              R,
            ),
            f.date('startDate', 'Desired start date for payroll services', R),
            f.yesNo('processesPayroll', 'Do you currently process payroll?', R),
            f.date('lastPayrollDate', 'If yes, what is your last payroll date?', {
              past: true,
              showIf: is('processesPayroll', true),
            }),
            f.yesNo('caughtUp', 'If yes, are you caught up on prior payrolls?', {
              showIf: is('processesPayroll', true),
            }),
            f.yesNo(
              'specialPayrolls',
              'Are there any upcoming special payrolls? (bonuses, commissions, etc.)',
            ),
            f.textarea('specialPayrollDetails', 'If yes, please explain (optional)', {
              placeholder: 'e.g., bonus schedule, commission structure, etc.',
              showIf: is('specialPayrolls', true),
            }),
          ],
          { subtitle: 'Let us know how often and when you run payroll.' },
        ),
        section(
          'setup',
          'Current Payroll Setup',
          [
            f.yesNo('usesPayrollSystem', 'Do you currently use a payroll system?', R),
            f.select(
              'payrollSystem',
              'Which system do you use?',
              opts({
                ADP: 'ADP',
                GUSTO: 'Gusto',
                PAYCHEX: 'Paychex',
                QUICKBOOKS: 'QuickBooks Payroll',
                SQUARE: 'Square Payroll',
                OTHER: 'Other',
              }),
              { ...R, showIf: is('usesPayrollSystem', true) },
            ),
            f.text('payrollSystemOther', 'If other, please specify', {
              placeholder: 'Type the system name',
              showIf: is('payrollSystem', 'OTHER'),
            }),
            f.yesNo('transitioning', 'Are you transitioning from another provider?', R),
            f.text('previousProvider', 'If yes, which provider?', {
              placeholder: 'Type the provider name',
              showIf: is('transitioning', true),
            }),
            f.textarea('changeReason', 'Reason for the change (optional)', {
              placeholder: 'e.g., cost, service, features, support, etc.',
              showIf: is('transitioning', true),
            }),
          ],
          { subtitle: 'Tell us what you currently use.' },
        ),
        section(
          'paymentTax',
          'Payment & Tax Information',
          [
            f.select(
              'funding',
              'Who should fund the payroll?',
              opts({
                BUSINESS_ACCOUNT: 'The business bank account (debited each payroll)',
                OWNER_TRANSFER: 'I will transfer the funds before each payroll',
                NOT_SURE: 'Not sure yet',
              }),
              R,
            ),
            f.radio(
              'payrollTaxes',
              'How should payroll taxes be handled?',
              opts({
                INCLUDED: 'Include in payroll service',
                SELF: 'I will handle tax payments',
                NOT_SURE: 'Not sure yet',
              }),
              R,
            ),
            f.checkboxes(
              'registrationHelp',
              'Do you need help setting up or registering for:',
              opts({
                FEDERAL_EIN: 'Federal tax account (EIN)',
                STATE_TAX: 'State tax account(s)',
                SUI: 'Unemployment (SUI) account',
                WORKERS_COMP: "Workers' compensation",
                OTHER: 'Other (please specify)',
              }),
            ),
            otherFor('registrationHelp', 'registrationHelpOther'),
          ],
          { subtitle: "Help us understand how you'd like to handle payments and taxes." },
        ),
        section(
          'payDeductions',
          'Employee Pay & Deductions',
          [
            f.checkboxes(
              'payMethods',
              'How do you pay your employees? (Select all that apply)',
              opts({
                DIRECT_DEPOSIT: 'Direct deposit (ACH)',
                PAPER_CHECKS: 'Paper checks',
                PAY_CARDS: 'Pay cards',
                OTHER: 'Other (please specify)',
              }),
              R,
            ),
            f.text('payMethodsOther', 'Please specify', {
              placeholder: 'Type other payment method',
              showIf: has('payMethods', ['OTHER']),
            }),
            f.checkboxes(
              'benefits',
              'Do you offer employee benefits or deductions? (Select all that apply)',
              opts({
                HEALTH: 'Health insurance',
                DENTAL: 'Dental insurance',
                VISION: 'Vision insurance',
                RETIREMENT: 'Retirement plan (e.g., 401(k), SIMPLE IRA)',
                HSA: 'Health Savings Account (HSA)',
                FSA: 'Flexible Spending Account (FSA)',
                GARNISHMENTS: 'Garnishments (e.g., child support, tax levies)',
                OTHER: 'Other (please specify)',
              }),
            ),
            f.text('benefitsOther', 'Please specify', {
              placeholder: 'Type additional deduction or benefit',
              showIf: has('benefits', ['OTHER']),
            }),
          ],
          { subtitle: 'Tell us how you pay your employees and what deductions apply.' },
        ),
        section(
          'additionalPayroll',
          'Additional Payroll Information',
          [
            f.yesNo(
              'multiplePayRates',
              'Do you have multiple pay rates (hourly, salary, commission, etc.)?',
              R,
            ),
            f.yesNo('tracksTime', 'Do you track employee time (time clock or system)?', R),
            f.checkboxes(
              'assistance',
              'Do you need assistance with: (Select all that apply)',
              opts({
                NEW_EMPLOYEES: 'New employee setup',
                TERMINATIONS: 'Terminations/offboarding',
                YEAR_END: 'Year-end forms (W-2s, 1099s)',
                POLICY: 'Payroll policy setup',
                COMPLIANCE: 'Compliance support',
                OTHER: 'Other (please specify)',
              }),
            ),
            otherFor('assistance', 'assistanceOther'),
            f.textarea(
              'payrollComments',
              'Anything else we should know about your payroll needs?',
              {
                placeholder: 'Tell us more...',
              },
            ),
          ],
          { subtitle: 'A few more details to help us serve you better.' },
        ),
        section(
          'documents',
          'Payroll Documents & Employee Information',
          [
            f.upload('payrollDocuments', 'Payroll Documents & Employee Information', {
              help: 'Upload any documents you currently have. This helps us set up your payroll accurately and quickly. You can upload multiple files (PDF, Excel, Word, or CSV).',
              examples: [
                'Current payroll reports',
                'Chart of accounts (if available)',
                'Employee list (names, addresses, SSNs, pay rates, etc.)',
                'Prior year W-2s or 1099s',
                "State unemployment (SUI) or workers' comp documents",
                'Garnishment orders (if applicable)',
                'Any other payroll-related documents',
              ],
            }),
          ],
          { subtitle: 'Upload any documents you currently have.' },
        ),
      ],
      {
        subtitle:
          'Tell us about your employees, payroll setup, and specific needs so we can provide the right solution for your business.',
      },
    ),

    step(
      'review',
      'Review & Sign Agreement',
      [
        section('additionalDocuments', 'Upload Additional Documents', [
          f.upload('additionalDocuments', 'Upload Additional Documents', {
            help: 'You can upload multiple files (PDF, Excel, Word, or CSV).',
          }),
        ]),
        section(
          'additionalInformation',
          'Additional Information (Optional)',
          [
            f.textarea('additionalInformation', 'Additional Information (Optional)', {
              maxLength: 1000,
              placeholder: 'Type additional information here...',
            }),
          ],
          { subtitle: "Is there anything else you'd like us to know about your payroll needs?" },
        ),
      ],
      {
        review: true,
        subtitle: 'Please review your information, read the service agreement and sign below.',
      },
    ),
  ],
};
