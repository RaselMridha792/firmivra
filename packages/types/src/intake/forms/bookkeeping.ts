import type { IntakeFormDefinition } from '../definition.js';
import { ACCOUNTING_METHODS } from '../options.js';
import { address, f, fullName, has, is, opts, R, section, step } from './build.js';

// Business Bookkeeping: docs/specs/NOTES-begin-online.md section 5, mockups `Bookkeeping
// intake.png`, `Bookkeeping Background intake.png`, `Bookkeeping Document Upload intake .png` and
// `Bookkeeping Review intake.png`. The mockups' "Please type yes or no" boxes are Yes/No radios
// here, and a follow-up question shows only for the answer it follows. The required documents keep
// "I don't have this document" with a reason (R11 question 2). The agreement, name, title and
// signature come from the firm's agreements (R14).

const yes = (key: string, label: string) => f.yesNo(key, label, R);

export const BOOKKEEPING_FORM: IntakeFormDefinition = {
  key: 'BOOKKEEPING',
  version: 1,
  title: 'Business Bookkeeping Intake Form',
  subtitle: "Let's get your books organized and your business on track.",
  steps: [
    step(
      'business',
      'Personal and Business Information',
      [
        section(
          'contact',
          'Contact Information',
          [
            ...fullName('', R),
            f.text('title', 'Title / Role', { ...R, placeholder: 'Owner, Partner, CEO, etc.' }),
            f.email('email', 'Email Address', R),
            f.phone('phone', 'Phone Number', R),
            f.radio(
              'preferredContact',
              'Preferred Contact Method',
              opts({ EMAIL: 'Email', PHONE: 'Phone', TEXT: 'Text' }),
              { ...R, defaultValue: 'EMAIL' },
            ),
          ],
          { subtitle: 'Tell us about the primary contact for your business.' },
        ),
        section(
          'business',
          'Business Information',
          [
            f.text('businessName', 'Business Legal Name', {
              ...R,
              placeholder: 'Your business legal name',
            }),
            f.text('dba', 'Doing Business As (DBA) (if applicable)', {
              placeholder: 'Your DBA name',
            }),
            f.ein('ein', 'Business EIN', R),
            f.phone('businessPhone', 'Business Phone Number'),
            ...address('', 'Business Address', R),
            f.url('website', 'Business Website (if applicable)'),
            f.text('industry', 'Business Industry', {
              ...R,
              placeholder: 'e.g., Retail, Construction, Consulting',
            }),
            f.text('entityType', 'Business Entity Type', {
              ...R,
              placeholder: 'e.g., LLC, S Corp, etc.',
            }),
            f.number('yearsInBusiness', 'Years in Business', { ...R, max: 200 }),
          ],
          { subtitle: 'Tell us about your business.' },
        ),
        section(
          'package',
          'Bookkeeping Package Selection',
          [
            f.radio(
              'package',
              'Bookkeeping Package',
              [
                {
                  value: 'STARTER',
                  label: 'Starter',
                  help: 'Essential Bookkeeping. Solid Foundation. Perfect for new and growing businesses that need reliable, accurate bookkeeping.',
                  details: [
                    'Monthly Transaction Categorization',
                    'Bank & Credit Card Reconciliation',
                    'Monthly Financial Reports (Profit & Loss, Balance Sheet)',
                    'Dedicated Support (Email)',
                  ],
                },
                {
                  value: 'GROWTH',
                  label: 'Growth',
                  badge: 'Most Popular',
                  help: 'More Insight. More Clarity. More Growth. Ideal for established businesses that need deeper financial insight and support.',
                  details: [
                    'Everything in Starter',
                    'Accounts Payable & Receivable Tracking',
                    'Monthly Financial Review Calls',
                    'Customized Financial Reports',
                    'Dedicated Support (Email & Phone)',
                    'Quarterly Tax Readiness Review',
                  ],
                },
                {
                  value: 'PREMIUM',
                  label: 'Premium',
                  badge: 'Most Comprehensive',
                  help: 'Full Service. Strategic Support. Peace of Mind. Designed for scaling businesses that want a fully managed bookkeeping solution.',
                  details: [
                    'Everything in Growth',
                    'Payroll Processing Support',
                    'Inventory Tracking (if applicable)',
                    'Monthly Budgeting & Forecasting',
                    'Dedicated Strategic Advisor',
                    'Priority Support',
                    'Year-End Tax Preparation Support',
                  ],
                },
              ],
              { ...R, cards: true, defaultValue: 'GROWTH' },
            ),
          ],
          {
            subtitle:
              'Choose the package that best fits your business needs. You can always upgrade later.',
          },
        ),
        section(
          'additional',
          'Additional Information',
          [
            f.text('primaryBanks', 'Primary Bank(s) Used for Business', {
              ...R,
              placeholder: 'e.g., Chase, Bank of America, etc.',
            }),
            f.text('accountingSoftware', 'Accounting Software Currently Used (if any)', {
              placeholder: 'e.g., QuickBooks, Xero, FreshBooks, etc.',
            }),
            yes('hasBookkeeper', 'Do you currently have a bookkeeper?'),
            f.date('bookkeeperLastDay', 'If yes, when was your last day with your bookkeeper?', {
              showIf: is('hasBookkeeper', true),
            }),
            f.text('currentSituation', 'What is your current bookkeeping situation?', {
              ...R,
              placeholder:
                'e.g., I handle it myself, behind on books, need help with clean up, etc.',
            }),
            f.text('reportFrequency', 'How often would you like to receive financial reports?', {
              ...R,
              placeholder: 'e.g., Monthly, Quarterly, etc.',
            }),
            f.textarea(
              'bookkeepingComments',
              'Is there anything else you would like us to know about your bookkeeping needs?',
              { placeholder: 'Type your comments here...' },
            ),
          ],
          { subtitle: 'Help us better understand your bookkeeping needs.' },
        ),
        section(
          'details',
          'Business Details',
          [
            f.text('goodsOrServices', 'What type of goods or services do you provide?', {
              ...R,
              placeholder: 'e.g., Landscaping, Online Retail, Consulting, Food Service, etc.',
            }),
            f.date('startDate', 'When did you start your business?', { ...R, past: true }),
            f.textarea('goals', 'What are your main business goals for the next 1-3 years?', {
              placeholder: 'e.g., Increase revenue, expand locations, hire employees, etc.',
            }),
            f.textarea('otherDetails', 'Any other important details about your business?', {
              placeholder: 'Type your response here...',
            }),
          ],
          { subtitle: 'Tell us more about your business.' },
        ),
        section(
          'expensesAssets',
          'Business Expenses & Assets',
          [
            f.checkboxes(
              'commonExpenses',
              'Common Business Expenses (Check all that apply)',
              opts({
                RENT: 'Rent / Lease (Office or Equipment)',
                UTILITIES: 'Utilities (Electricity, Water, Gas, Internet)',
                OFFICE_SUPPLIES: 'Office Supplies',
                INVENTORY: 'Inventory / Cost of Goods Sold',
                TRAVEL: 'Travel / Transportation',
                VEHICLE: 'Vehicle Expenses (Fuel, Maintenance, etc.)',
                MEALS: 'Meals & Entertainment (Business)',
                MARKETING: 'Marketing & Advertising',
                SOFTWARE: 'Software & Subscriptions',
                PROFESSIONAL: 'Professional Services (Legal, Accounting, etc.)',
                CONTRACTORS: 'Contractors / 1099 Payments',
                PAYROLL: 'Payroll / Wages',
                BENEFITS: 'Employee Benefits (Health, Retirement, etc.)',
                INSURANCE: 'Insurance (General Liability, Property, etc.)',
                REPAIRS: 'Repairs & Maintenance',
                EQUIPMENT: 'Equipment Purchases',
                PHONE: 'Phone (Business)',
                EDUCATION: 'Education & Training',
                LICENSES: 'Licenses, Permits & Fees',
                BANK_FEES: 'Bank Fees',
                INTEREST: 'Interest Expenses',
                TAXES: 'Taxes (Payroll, Sales Tax, etc.)',
                OTHER: 'Other (Please specify)',
              }),
            ),
            f.text('commonExpensesOther', 'Other expense', {
              placeholder: 'Type other expense here...',
              showIf: has('commonExpenses', ['OTHER']),
            }),
            f.group(
              'assets',
              'Business Assets',
              [
                f.text('description', 'Asset Name / Description', {
                  ...R,
                  placeholder: 'e.g., 2023 Ford F-150',
                }),
                f.date('datePurchased', 'Date Purchased', { ...R, past: true }),
                f.currency('purchasePrice', 'Purchase Price', R),
                f.yesNo(
                  'depreciating',
                  'Have you been depreciating this asset since it was placed in service?',
                  R,
                ),
              ],
              {
                help: 'Assets can include vehicles (business vehicles), machinery, equipment, furniture, computers, and property.',
                itemLabel: 'Asset',
                addLabel: 'Add Another Asset',
                maxItems: 30,
              },
            ),
          ],
          {
            subtitle: 'Select the common business expenses you have and list your business assets.',
          },
        ),
        section(
          'systems',
          'System Access (if applicable)',
          [
            f.info(
              'noPasswords',
              'For your security, please do not enter passwords on this form.',
              'After you submit this intake form, we will send you secure instructions on how to provide access to your accounting systems (e.g., invite {firmName} as an accountant/user).',
            ),
            f.group(
              'systems',
              'Systems',
              [
                f.text('system', 'System / Platform', { placeholder: 'e.g., QuickBooks Online' }),
                f.text('username', 'Username / Email', { placeholder: 'Enter username or email' }),
                f.text('notes', 'Notes (if any)', {
                  placeholder: 'e.g., admin access, read only, etc.',
                }),
              ],
              { itemLabel: 'System', addLabel: 'Add Another System', maxItems: 20 },
            ),
          ],
          {
            subtitle:
              'Provide login information for any systems you currently use that are related to your bookkeeping.',
          },
        ),
      ],
      { subtitle: 'Tell us about you and your business.' },
    ),

    step(
      'background',
      'Business Background Details',
      [
        section('history', 'Bookkeeping Start & History', [
          f.month(
            'startMonth',
            'What month and year would you like us to begin bookkeeping for you?',
            R,
          ),
          yes('needsCatchUp', 'Do you need prior months or years caught up?'),
          f.month('catchUpFrom', 'If yes, from what date should we start?', {
            ...R,
            showIf: is('needsCatchUp', true),
          }),
          yes(
            'hadBookkeeperBefore',
            'Have you worked with another bookkeeper or accounting firm before?',
          ),
          f.textarea('changeReason', 'If yes, tell us the reason for the change.', {
            ...R,
            showIf: is('hadBookkeeperBefore', true),
          }),
        ]),
        section('accounts', 'Business Accounts', [
          f.number('checkingAccounts', 'How many business checking accounts do you have?', R),
          f.number('savingsAccounts', 'How many business savings accounts do you have?'),
          f.number('creditCards', 'How many business credit cards do you have?', R),
          f.number('loans', 'How many loans or lines of credit do you have?', R),
          f.number(
            'merchantAccounts',
            'How many merchant/merchant processing accounts do you use? (e.g., Stripe, PayPal, Square)',
            R,
          ),
          f.textarea(
            'institutions',
            'Please list the names of your financial institutions (banks, credit unions, etc.).',
            { ...R, placeholder: 'Type the names here...' },
          ),
        ]),
        section('receivables', 'How Customers Pay You', [
          f.textarea(
            'paymentMethods',
            'How do your customers typically pay you? Please list all that apply.',
            {
              ...R,
              placeholder:
                'e.g., Cash, Check, Bank Transfer, Credit Card, PayPal, Stripe, Square, Zelle, etc.',
            },
          ),
          yes(
            'hasReceivables',
            'Do customers currently owe your business money (accounts receivable)?',
          ),
          f.currency('receivablesAmount', 'If yes, what is the approximate amount?', {
            ...R,
            showIf: is('hasReceivables', true),
          }),
          f.textarea('invoiceTracking', 'Are invoices currently tracked in a system?', {
            ...R,
            placeholder: 'Please tell us how you track invoices or type "Not yet."',
          }),
        ]),
        section('payables', 'Accounts Payable (Vendors & Bills)', [
          yes(
            'hasPayables',
            'Does your business currently owe vendors or suppliers (accounts payable)?',
          ),
          f.currency('payablesAmount', 'If yes, what is the approximate amount?', {
            ...R,
            showIf: is('hasPayables', true),
          }),
          f.textarea('billTracking', 'Are bills currently tracked in a system?', {
            ...R,
            placeholder: 'Please tell us how you track bills or type "Not yet."',
          }),
          f.text('vendorPayments', 'How do you currently manage vendor payments?', {
            ...R,
            placeholder: 'e.g., Online banking, Check, Credit Card, etc.',
          }),
        ]),
        section('people', 'Employees & Contractors', [
          f.number('w2Employees', 'How many W-2 employees do you have?', R),
          f.number('contractors1099', 'How many 1099 contractors do you have?', R),
          yes('hasPayrollProvider', 'Do you currently use a payroll provider?'),
          f.text('payrollProvider', 'If yes, which payroll provider do you use?', {
            ...R,
            placeholder: 'e.g., Gusto, ADP, Paychex, etc.',
            showIf: is('hasPayrollProvider', true),
          }),
          f.yesNo('needsPayrollSetup', 'If no, do you need help setting up payroll?', {
            ...R,
            showIf: is('hasPayrollProvider', false),
          }),
        ]),
        section('salesTax', 'Sales Tax', [
          yes('collectsSalesTax', 'Does your business collect sales tax?'),
          f.states('salesTaxStates', 'If yes, which state(s) do you collect sales tax in?', {
            ...R,
            showIf: is('collectsSalesTax', true),
          }),
          f.text('salesTaxFrequency', 'How often do you file sales tax returns?', {
            ...R,
            placeholder: 'e.g., Monthly, Quarterly, Annually',
            showIf: is('collectsSalesTax', true),
          }),
          f.yesNo('salesTaxCurrent', 'Are your sales tax filings current?', {
            ...R,
            showIf: is('collectsSalesTax', true),
          }),
          yes('salesTaxHelp', 'Do you need assistance with sales tax filing?'),
        ]),
        section('inventory', 'Inventory (Product-Based Businesses)', [
          yes('hasInventory', 'Do you purchase or maintain inventory?'),
          f.radio(
            'inventoryType',
            'Do you manufacture products, purchase finished products for resale, or both?',
            opts({ MANUFACTURE: 'Manufacture', RESALE: 'Purchase for resale', BOTH: 'Both' }),
            { ...R, showIf: is('hasInventory', true) },
          ),
          f.text('inventoryTracking', 'How do you currently track inventory?', {
            ...R,
            placeholder: 'e.g., QuickBooks, Spreadsheet, Shopify, Square, etc.',
            showIf: is('hasInventory', true),
          }),
          f.number('skuCount', 'Approximately how many products/SKUs do you carry?', {
            ...R,
            max: 1_000_000,
            showIf: is('hasInventory', true),
          }),
          f.yesNo(
            'hasInventoryList',
            'Do you have a current inventory list (e.g., product list with quantities and costs)?',
            { ...R, showIf: is('hasInventory', true) },
          ),
          f.checkbox(
            'inventoryHelp',
            "I don't have my inventory organized yet. I need help setting up or organizing my inventory.",
            { showIf: is('hasInventory', true) },
          ),
        ]),
        section('financing', 'Loans & Financing', [
          yes(
            'hasFinancing',
            'Does your business have any business loans, lines of credit, or equipment financing?',
          ),
          f.text('lenders', 'If yes, please list the lender(s) and purpose of the loan(s).', {
            ...R,
            placeholder: 'e.g., Bank of America - Equipment Loan',
            showIf: is('hasFinancing', true),
          }),
          f.currency('financingBalance', 'What is the current balance (approximate)?', {
            ...R,
            showIf: is('hasFinancing', true),
          }),
        ]),
        section('owner', 'Owner Activity & Other Information', [
          yes('businessFundsPersonal', 'Do you use business funds for personal expenses?'),
          f.textarea('businessFundsPersonalDetails', 'If yes, please explain.', {
            ...R,
            placeholder: 'Type your explanation here...',
            showIf: is('businessFundsPersonal', true),
          }),
          yes(
            'personalFundsBusiness',
            'Do you pay business expenses personally and need them recorded/reimbursed?',
          ),
          f.textarea('ownerActivityDetails', 'If yes, please explain.', {
            ...R,
            placeholder: 'Type your explanation here...',
            showIf: is('personalFundsBusiness', true),
          }),
          f.textarea(
            'operationsComments',
            'Is there anything else we should know about your business operations, goals, or bookkeeping needs?',
            { placeholder: 'Type your additional comments here...' },
          ),
        ]),
        section('openingBalances', 'Opening Balances & Reports', [
          yes(
            'hasCurrentReports',
            'If you are switching from another bookkeeper or system, do you have a current Balance Sheet and Profit & Loss Statement?',
          ),
          f.month('reportsDate', 'If yes, what is the date of the most recent reports?', {
            ...R,
            showIf: is('hasCurrentReports', true),
          }),
          f.textarea(
            'reportsDetails',
            'If no, please let us know and we will help you get started.',
            {
              ...R,
              placeholder: 'Type any details here...',
              showIf: is('hasCurrentReports', false),
            },
          ),
        ]),
        section('basis', 'Accounting Basis', [
          f.radio(
            'accountingMethod',
            'If known, which accounting method does your business currently use?',
            opts(ACCOUNTING_METHODS),
            R,
          ),
          f.textarea(
            'reportingRequirements',
            'Do you have any specific reporting requirements (for banks, investors, etc.)?',
            { ...R, placeholder: 'Please explain here...' },
          ),
          f.textarea(
            'businessGoals',
            'What are your short-term and long-term goals for your business?',
            {
              ...R,
              placeholder: 'Type your goals here...',
            },
          ),
        ]),
      ],
      {
        subtitle:
          'Help us understand your business operations so we can provide the best bookkeeping support.',
      },
    ),

    step(
      'documents',
      'Document Upload',
      [
        section(
          'required',
          'Required Documents',
          [
            f.info(
              'uploadRules',
              'Accepted file types',
              'PDF, JPG, PNG (Max file size: 10 MB per file). All documents are securely uploaded and encrypted. If you do not have a required document, select "I don\'t have this document" and tell us why.',
            ),
            f.upload('formationDocument', 'Business Formation Document', {
              ...R,
              notAvailable: true,
              help: 'Upload your business formation document (e.g., Articles of Organization, Articles of Incorporation, LLC Operating Agreement, Partnership Agreement, etc.).',
            }),
            f.upload('einDocument', 'Business EIN Document', {
              ...R,
              notAvailable: true,
              help: 'Upload your IRS EIN confirmation letter (CP 575 or similar document).',
            }),
            f.upload('lastYearReturn', "Last Year's Business Tax Return", {
              ...R,
              notAvailable: true,
              help: 'Upload your most recent filed business tax return (e.g., 1120, 1120-S, 1065, or Schedule C).',
            }),
            f.upload('supportingDocuments', 'Additional Supporting Documents (Optional)', {
              help: 'Upload any other relevant documents such as: bank statements, financial statements, payroll reports, sales tax reports, loan statements, or prior bookkeeping files.',
            }),
            f.upload('inventoryRecords', 'Inventory Records (Product-Based Businesses Only)', {
              help: 'If you sell physical products, please upload your current inventory records (e.g., inventory list, SKU list, quantity on hand, cost information, or inventory report from your system such as Shopify, QuickBooks, Square, etc.).',
              showIf: is('hasInventory', true),
            }),
          ],
          {
            subtitle:
              'Please upload the following documents to help us set up your bookkeeping account.',
          },
        ),
        section(
          'comments',
          'Additional Comments or Concerns',
          [
            f.textarea('onboardingComments', 'Additional Comments or Concerns', {
              maxLength: 1000,
              placeholder:
                'Type your comments, questions, or anything you would like to discuss here...',
            }),
          ],
          {
            subtitle:
              'Let us know if there is anything else you would like us to know or discuss during onboarding.',
          },
        ),
      ],
      {
        subtitle:
          'Please upload the required documents so we can get everything set up for your bookkeeping services.',
      },
    ),

    step(
      'review',
      'Review & Sign Agreement',
      [
        section(
          'confirm',
          'Review & Confirm',
          [
            f.checkbox(
              'confirmAccurate',
              'I have reviewed all the information I provided and confirm it is accurate and complete to the best of my knowledge.',
              R,
            ),
            f.checkbox(
              'confirmDocuments',
              'I have uploaded all required documents or will provide any additional requested documents upon request.',
              R,
            ),
            f.checkbox(
              'confirmUnderstand',
              'I understand that providing accurate information helps {firmName} deliver the best bookkeeping services for my business.',
              R,
            ),
          ],
          { subtitle: 'Please confirm that your information is complete and accurate.' },
        ),
      ],
      { review: true, subtitle: 'Review your information and sign.' },
    ),
  ],
};
