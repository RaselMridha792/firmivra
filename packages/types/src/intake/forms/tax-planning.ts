import { INTAKE_LIMITS, type IntakeFormDefinition } from '../definition.js';
import {
  ACCOUNTING_METHODS,
  BUSINESS_STRUCTURES,
  FILING_STATUSES,
  YES_NO_PREVIOUSLY,
} from '../options.js';
import { f, has, is, oneOf, opts, R, section, step } from './build.js';

// Tax Planning: docs/specs/NOTES-begin-online.md section 7, mockups `Tax Planning intake 1.png` to
// `Tax planning intake 4.png`. Single answers drawn as checkboxes are radios here. The business
// sections show only when the person seeks business planning, so their required fields are
// required only then. "Tax year of most recent return" is asked once (step 2 asked it twice). The
// dropdown lists the mockups leave empty are proposals for Octavia (R11 question 7). The agreement,
// its acknowledgments, the signature and the confirmation email come from the firm's agreements
// (R14; R11 question 8).

const business = oneOf('planningFor', ['BUSINESS', 'BOTH']);
const other = (field: string, key: string) =>
  f.text(key, 'Please specify', { placeholder: 'Please specify', showIf: has(field, ['OTHER']) });
const money = (key: string, label: string) => f.currency(key, label);

export const TAX_PLANNING_FORM: IntakeFormDefinition = {
  key: 'TAX_PLANNING',
  version: 1,
  title: 'Tax Planning Intake Form',
  subtitle:
    'Tell us about yourself and your business so we can create a personalized tax strategy that helps you keep more, plan better, and grow with confidence.',
  steps: [
    step(
      'profile',
      'Client, Business & Tax Profile',
      [
        section(
          'contact',
          'Client & Contact Information',
          [
            f.text('fullName', 'Full Name', { ...R, placeholder: 'First and Last Name' }),
            f.phone('phone', 'Phone Number', R),
            f.email('email', 'Email Address', R),
            f.radio(
              'planningFor',
              'Are you seeking tax planning for?',
              opts({ INDIVIDUAL: 'Individual (Personal)', BUSINESS: 'Business', BOTH: 'Both' }),
              R,
            ),
          ],
          {
            subtitle:
              "Let's start with some basic information so we can understand you and your business.",
          },
        ),
        section(
          'business',
          'Business Information',
          [
            f.text('businessName', 'Business Legal Name', { placeholder: 'Your Business Name' }),
            f.text('dba', 'Doing Business As (DBA) (if applicable)', { placeholder: 'DBA Name' }),
            f.ein('ein', 'EIN (if applicable)'),
            f.select('businessStructure', 'Business Structure', opts(BUSINESS_STRUCTURES), R),
            f.select(
              'industry',
              'Industry / Type of Business',
              opts({
                CONSTRUCTION: 'Construction & trades',
                REAL_ESTATE: 'Real estate',
                RETAIL: 'Retail',
                ECOMMERCE: 'E-commerce / online sales',
                PROFESSIONAL: 'Professional services',
                HEALTHCARE: 'Healthcare',
                FOOD: 'Food & hospitality',
                TRANSPORTATION: 'Transportation & logistics',
                BEAUTY: 'Beauty & personal care',
                TECHNOLOGY: 'Technology',
                MANUFACTURING: 'Manufacturing',
                EDUCATION: 'Education & child care',
                CLEANING: 'Cleaning & maintenance',
                CREATIVE: 'Creative & media',
                NONPROFIT: 'Nonprofit',
                OTHER: 'Other',
              }),
              R,
            ),
            f.select(
              'yearsInBusiness',
              'Years in Business',
              opts({
                UNDER_1: 'Less than 1 year',
                '1_TO_3': '1 to 3 years',
                '3_TO_5': '3 to 5 years',
                '5_TO_10': '5 to 10 years',
                OVER_10: 'More than 10 years',
              }),
            ),
            f.states('operatingStates', 'State(s) Where Your Business Operates', R),
            f.select(
              'owners',
              'Number of Owners',
              opts({ '1': '1', '2': '2', '3_TO_5': '3 to 5', OVER_5: 'More than 5' }),
            ),
            f.select(
              'employees',
              'Number of Employees',
              opts({
                NONE: 'None',
                '1_TO_5': '1 to 5',
                '6_TO_10': '6 to 10',
                '11_TO_25': '11 to 25',
                '26_TO_50': '26 to 50',
                OVER_50: 'More than 50',
              }),
            ),
            f.select(
              'contractors',
              'Number of 1099 Contractors',
              opts({
                NONE: 'None',
                '1_TO_5': '1 to 5',
                '6_TO_10': '6 to 10',
                OVER_10: 'More than 10',
              }),
            ),
          ],
          { subtitle: 'Tell us about your business.', showIf: business },
        ),
        section(
          'accounting',
          'Accounting & Tax Information',
          [
            f.select('accountingMethod', 'Accounting Method', opts(ACCOUNTING_METHODS), R),
            f.year('planningTaxYear', 'Tax Year', R),
            f.radio(
              'hasBookkeeper',
              'Do you currently have a bookkeeper or accountant?',
              opts(YES_NO_PREVIOUSLY),
              R,
            ),
          ],
          {
            subtitle:
              'This helps us understand your current tax setup and identify planning opportunities.',
          },
        ),
        section(
          'details',
          'Tax Planning Details',
          [
            f.checkboxes(
              'services',
              'Which tax planning services are you most interested in? (Select all that apply)',
              opts({
                INDIVIDUAL: 'Individual tax planning',
                BUSINESS: 'Business tax planning',
                ENTITY: 'Entity structure review and optimization',
                S_CORP: 'S-Corporation election planning',
                OWNER_COMP: 'Owner compensation strategies',
                RETIREMENT: 'Retirement plan strategies (e.g., SEP, Solo 401(k), 401(k))',
                INVESTMENT: 'Investment and wealth-building strategies',
                REAL_ESTATE: 'Real estate and rental property planning',
                MULTI_STATE: 'Multi-state tax planning',
                ESTATE: 'Estate and succession planning',
                CREDITS: 'Tax credit and incentive planning',
                INTERNATIONAL: 'International tax planning',
                GENERAL: 'General tax strategy and advice',
                OTHER: 'Other (please specify)',
              }),
              {
                ...R,
                selectAll:
                  "Select All or Most (Choose this if you're open to discussing all services)",
              },
            ),
            other('services', 'servicesOther'),
            f.checkboxes(
              'reasons',
              'What is your primary reason for seeking tax planning?',
              opts({
                REDUCE_LIABILITY: 'Reduce my overall tax liability',
                GROWTH: 'Plan for business growth',
                ESTIMATED: 'Understand estimated tax payments',
                ENTITY: 'Explore better entity structure options',
                RETIREMENT: 'Plan for retirement',
                PURCHASE: 'Plan for a major purchase or investment',
                SALE: 'Prepare for a business sale or succession',
                CASH_FLOW: 'Improve cash flow and financial efficiency',
                NOT_SURE: "I'm not sure - I need guidance",
                OTHER: 'Other (please specify)',
              }),
              R,
            ),
            other('reasons', 'reasonsOther'),
          ],
          {
            subtitle:
              "Tell us which areas of tax planning you're interested in and what you hope to achieve.",
          },
        ),
      ],
      { subtitle: 'Smart Tax Strategies for a Brighter Tomorrow.' },
    ),

    step(
      'finances',
      'Income & Financial Information',
      [
        section(
          'personalIncome',
          'Personal Income Information',
          [
            money('w2Income', 'Estimated annual W-2 income'),
            money('selfEmploymentIncome', 'Self-employment / 1099 income'),
            money('investmentIncome', 'Investment income (dividends, interest, etc.)'),
            money('rentalIncome', 'Rental property income'),
            money('retirementIncome', 'Retirement income (pension, IRA, etc.)'),
            money('otherIncome', 'Other income (alimony, etc.)'),
            f.yesNo('multipleStates', 'Do you have multiple states of residence or income?', R),
            f.states('incomeStates', 'If yes, please list the state(s):', {
              showIf: is('multipleStates', true),
            }),
            f.select('filingStatus', 'Filing status (current)', opts(FILING_STATUSES)),
            f.textarea(
              'incomeChanges',
              'Are there any expected changes to your personal income this year or next year?',
              { placeholder: 'Please explain...' },
            ),
          ],
          { subtitle: 'Tell us about your personal income sources.' },
        ),
        section(
          'businessFinances',
          'Business Financial Information',
          [
            money('businessRevenue', 'Estimated annual business revenue'),
            money('netProfit', 'Estimated annual net profit (before owner comp)'),
            money('ownerCompensation', 'Owner compensation (salary, draws, distributions)'),
            money('totalPayroll', 'Total payroll (employees, if any)'),
            money('majorExpenses', 'Major business expenses (if any)'),
            f.radio(
              'plannedPurchases',
              'Do you have business assets or major purchases planned in the next 12 months?',
              opts({ YES: 'Yes', NO: 'No', NOT_SURE: 'Not Sure' }),
            ),
            f.textarea('plannedPurchasesDetails', 'If yes, please describe:', {
              placeholder: 'Please provide details...',
              showIf: is('plannedPurchases', 'YES'),
            }),
            f.textarea('otherEntities', 'Any other business income streams or entities?', {
              placeholder: 'Please explain...',
            }),
          ],
          {
            subtitle: 'Tell us about your business revenue, expenses and financial picture.',
            showIf: business,
          },
        ),
        section(
          'currentTax',
          'Current Tax Information',
          [
            f.radio(
              'filedRecentReturn',
              'Have you filed your most recent tax return?',
              opts({ YES: 'Yes', NO: 'No', NOT_YET: 'Not Yet' }),
              R,
            ),
            f.year('recentReturnYear', 'Tax year of most recent return'),
            money('priorLiability', 'Prior year total tax liability (federal and state, if known)'),
            f.currency('priorRefundOrOwed', 'Prior year refund or amount owed', {
              min: -INTAKE_LIMITS.maxCents,
              help: 'Enter a refund as a positive amount and an amount owed as a negative amount.',
            }),
            money(
              'federalWithholding',
              'Current federal tax withholding (from W-2 or other income)',
            ),
            money('stateWithholding', 'Current state tax withholding'),
            money('federalEstimated', 'Federal estimated taxes paid (YTD)'),
            money('stateEstimated', 'State estimated taxes paid (YTD)'),
            f.yesNo(
              'taxIssues',
              'Do you have any tax notices, audits or unresolved tax issues?',
              R,
            ),
            f.textarea('taxIssuesDetails', 'If yes, please explain:', {
              placeholder: 'Please provide details...',
              showIf: is('taxIssues', true),
            }),
            f.yesNo(
              'majorChanges',
              'Have you made any major financial changes in the last 3 years? (e.g., bought/sold property, started/closed a business, inheritance, etc.)',
            ),
            f.textarea('majorChangesDetails', 'If yes, please explain:', {
              placeholder: 'Please provide details...',
              showIf: is('majorChanges', true),
            }),
            f.radio(
              'taxProfessional',
              'Are you currently working with a tax professional?',
              opts(YES_NO_PREVIOUSLY),
              R,
            ),
            f.text('taxProfessionalName', 'If yes, what is their name (optional)?', {
              placeholder: 'Name of accountant or firm',
              showIf: is('taxProfessional', 'YES'),
            }),
          ],
          { subtitle: 'Share details about your most recent tax situation.' },
        ),
        section(
          'additionalFinancial',
          'Additional Financial Details (Optional)',
          [
            f.yesNo(
              'upcomingExpenses',
              'Do you have significant upcoming expenses? (e.g., education, home purchase, retirement)',
            ),
            f.textarea('upcomingExpensesDetails', 'If yes, please describe:', {
              placeholder: 'Please provide details...',
              showIf: is('upcomingExpenses', true),
            }),
            f.textarea(
              'financialComments',
              "Anything else you'd like us to know about your financial situation?",
              { placeholder: 'Please share any additional details...' },
            ),
          ],
          {
            subtitle:
              'Share any other information that may help us create a personalized tax strategy.',
          },
        ),
      ],
      {
        subtitle:
          'Help us understand your financial picture so we can create a customized tax strategy for your goals.',
      },
    ),

    step(
      'goals',
      'Planning Goals & Opportunities',
      [
        section(
          'goals',
          'Tax Planning Goals',
          [
            f.checkboxes(
              'goals',
              'Select the goals that are most important to you. (Select all that apply)',
              opts({
                REDUCE_LIABILITY: 'Reduce overall tax liability',
                DEDUCTIONS: 'Maximize deductions and credits',
                SELF_EMPLOYMENT: 'Minimize self-employment taxes',
                CASH_FLOW: 'Improve cash flow',
                RETIREMENT: 'Plan for retirement (e.g., SEP, 401(k), IRA)',
                EDUCATION: 'Plan for education expenses',
                WEALTH: 'Build wealth through tax strategies',
                REAL_ESTATE: 'Plan for real estate and rental property',
                STRUCTURE: 'Evaluate or change business structure',
                S_CORP: 'Consider S-Corp election',
                OWNER_COMP: 'Plan for owner compensation',
                EXPANSION: 'Plan for business expansion',
                HIRING: 'Plan for hiring employees or contractors',
                BUY_SELL: 'Plan for buying or selling a business',
                PURCHASE: 'Plan for a major purchase or investment',
                ESTATE: 'Plan for estate and succession',
                MULTI_STATE: 'Multi-state tax planning',
                INTERNATIONAL: 'International tax planning',
                ESTIMATED: 'Better understand estimated tax payments',
                GENERAL: 'General tax strategy and advice',
                OTHER: 'Other (please specify)',
              }),
            ),
            other('goals', 'goalsOther'),
          ],
          { subtitle: 'Select the goals that are most important to you.' },
        ),
        section(
          'changes',
          'Upcoming Changes',
          [
            f.checkboxes(
              'upcomingChanges',
              'Let us know about any expected changes that could affect your tax situation. (Select all that apply)',
              opts({
                INCOME_UP: 'Expecting a significant increase in income',
                INCOME_DOWN: 'Expecting a decrease in income',
                BUY_HOME: 'Planning to purchase a home',
                SELL: 'Planning to sell a property or business',
                NEW_BUSINESS: 'Starting a new business or side business',
                HIRING: 'Hiring employees or contractors',
                LARGE_PURCHASE: 'Making a large equipment or asset purchase',
                MARRIAGE: 'Getting married or divorced',
                CHILD: 'Having a child or dependent',
                RETIRING: 'Planning for retirement or will retire soon',
                INHERITANCE: 'Expecting an inheritance',
                RELOCATING: 'Relocating to another state',
                OTHER: 'Other (please specify)',
              }),
            ),
            other('upcomingChanges', 'upcomingChangesOther'),
          ],
          { subtitle: "Life changes. So do tax opportunities. Let us know what's ahead." },
        ),
        section(
          'concerns',
          'Specific Tax Concerns',
          [
            f.checkboxes(
              'concerns',
              "Are there any specific tax issues or areas you'd like us to review? (Select all that apply)",
              opts({
                BACK_TAXES: 'Owe back taxes',
                IRS_NOTICE: 'Received an IRS notice',
                UNDERESTIMATED: 'Underestimated taxes in the past',
                QUARTERLY: 'Need help with quarterly estimated payments',
                RECORD_KEEPING: 'Want to improve record keeping',
                DEDUCTIONS: 'Have questions about deductions/credits',
                STRUCTURE: 'Need guidance on business structure',
                RETIREMENT: 'Need guidance on retirement plan options',
                MULTI_STATE: 'Questions about multi-state taxation',
                REAL_ESTATE: 'Questions about real estate or rental property',
                CRYPTO: 'Questions about cryptocurrency',
                OTHER: 'Other (please specify)',
              }),
            ),
            other('concerns', 'concernsOther'),
            f.textarea(
              'specificQuestion',
              'Have a specific question? Share any additional details here.',
              {
                placeholder: 'Please provide details...',
              },
            ),
          ],
          { subtitle: "Are there any specific tax issues or areas you'd like us to review?" },
        ),
        section(
          'vision',
          'Long-Term Vision',
          [
            f.textarea('shortTermGoals', 'What are your short-term goals? (next 1-2 years)', {
              placeholder: 'e.g., buy a home, reduce debt, save for retirement...',
            }),
            f.textarea('longTermGoals', 'What are your long-term goals? (3-5+ years)', {
              placeholder: 'e.g., grow my business, build generational wealth...',
            }),
            f.textarea('visionComments', "Anything else you'd like us to know?", {
              placeholder:
                'Share any additional information that may help us create the best strategy for you...',
            }),
          ],
          {
            subtitle:
              'Tell us about your long-term goals so we can align your tax strategy with your bigger picture.',
          },
        ),
      ],
      {
        subtitle:
          "You're almost there! Tell us about your goals, upcoming changes, and what you hope to achieve so we can create a personalized tax strategy for you.",
      },
    ),

    step(
      'review',
      'Review & Submit',
      [
        section('reviewNote', 'Review Your Information', [
          f.info(
            'reviewNote',
            'Review Your Information',
            'Please review each section below. Use Edit to change any answers before you read the service agreement and sign.',
          ),
        ]),
      ],
      { review: true, subtitle: 'Your information is secure and confidential.' },
    ),
  ],
};
