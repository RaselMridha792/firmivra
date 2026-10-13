import type { IntakeFormKey } from '@firmivra/types';
import {
  BriefcaseBusiness,
  Car,
  ChartColumnBig,
  FilePen,
  Monitor,
  Palette,
  ShieldCheck,
  Store,
  Ellipsis,
  House,
  Landmark,
  Lightbulb,
  Megaphone,
  NotebookPen,
  Package,
  Percent,
  Shield,
  Sprout,
  SquareCheckBig,
  Target,
  Upload,
  Utensils,
  Wrench,
  Building2,
  CreditCard,
  Calculator,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CircleDollarSign,
  ClipboardList,
  CloudUpload,
  FileSpreadsheet,
  FileText,
  Flag,
  Gem,
  IdCard,
  MapPin,
  MessageSquareMore,
  Paperclip,
  ReceiptText,
  Settings,
  User,
  Users,
} from 'lucide-react';
import { type FormLook, NO_LOOK } from './intake-layout';

// Each form's panels as its mockups draw them (docs/mockups/begin-online/), by section key.

/** Annual Tax: `Annual Intake Form 1.png` to `Annual Tax Intake Form 4.png`. */
const ANNUAL_TAX: FormLook = {
  footerNote: 'documentsNote',
  reviewHeading: true,
  panels: {
    personal: {
      icon: User,
      rows: ['dateOfBirth phone'],
      labels: { name: 'Full Legal Name' },
      boxed: { returnTypes: BriefcaseBusiness },
    },
    spouse: {
      join: ['spouse', 'dependents'],
      title: 'Filing Details & Dependents',
      subtitle: 'Tell us about your filing status, spouse, and dependents.',
      icon: Users,
      joinIcons: { spouse: User, dependents: Users },
      rows: [
        'spouseName:8 spouseSsn:4',
        'spouseDateOfBirth:5 spouseOccupation:7',
        'spouseEmployer:7 spousePhone:5',
      ],
      labels: { spouseName: 'Spouse Full Legal Name' },
    },
    dependents: {
      yesNoList: true,
      groups: {
        dependents: {
          rows: [
            'name:8 dateOfBirth:4',
            'relationship:7 ssn:5',
            'livesWithYou+fullTimeStudent+disabled+childTaxCredit',
          ],
        },
      },
    },
    deductions: { icon: FileText, yesNoList: true },
    income: { icon: ChartNoAxesColumnIncreasing, yesNoList: true, inline: ['incomeDetails'] },
    business: {
      icon: Building2,
      iconFirst: true,
      wide: true,
      groups: {
        businesses: {
          bare: true,
          columns: [
            { span: 4, rows: ['legalStructure', 'legalStructureOther'] },
            { span: 4, rows: ['legalName:7 ein:5', 'address'] },
            { span: 4, rows: ['sells', 'productsOrServices'] },
          ],
        },
      },
    },
    comments: { bar: true, icon: MessageSquareMore },
    // Step 2, Business Income & Expenses: four wide tables.
    businessIncome: { icon: ChartNoAxesColumnIncreasing, wide: true },
    payroll: { icon: Users, wide: true },
    incomeTaxesPaid: { icon: ReceiptText, wide: true },
    businessExpenses: { icon: Calculator, wide: true },
    // Step 3, Required Document Upload.
    uploadRules: { intro: true, wide: true },
    identity: { badge: IdCard, tiles: true, wide: true },
    incomeDocuments: { badge: FileText, wide: true },
    deductionDocuments: { badge: ReceiptText, wide: true },
    businessDocuments: { badge: BriefcaseBusiness, wide: true },
    formationDocuments: { badge: Building2, wide: true },
    certify: { headless: true, bar: true, wide: true },
    // Step 4, Review & Sign: the payment choice in a tinted panel.
    payment: { badge: CreditCard, tint: true, wide: true },
  },
};

/** Quarterly Tax: `business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png`. */
const QUARTERLY_TAX: FormLook = {
  footerNote: 'businessNote',
  review: {
    byStep: true,
    banded: true,
    aside: true,
    icons: { business: Building2, taxesIncome: ChartNoAxesColumnIncreasing, expenses: FileText },
  },
  stacks: [
    {
      columns: [
        ['business', 'quarterly', 'records'],
        ['ownership', 'industry', 'years', 'additional'],
      ],
    },
    {
      columns: [
        ['filingPeriod', 'grossReceipts', 'priorYear'],
        ['federalPayments', 'statePayments', 'payrollWages', 'payrollTaxes', 'additionalTax'],
      ],
    },
  ],
  panels: {
    // Step 1, Business Information.
    business: { icon: Building2, rows: ['ein phone'], addressLabels: true },
    ownership: { icon: Users, optionColumns: { businessStructure: 2 } },
    industry: { icon: BriefcaseBusiness, iconFirst: true, noNumber: true },
    quarterly: { icon: FileText, optionColumns: { quarters: 4 } },
    years: { icon: ChartNoAxesColumnIncreasing },
    records: { icon: Settings },
    additional: { icon: MessageSquareMore },
    // Step 2, Taxes & Income.
    filingPeriod: { icon: CalendarDays, rows: ['taxYearStart taxYearEnd'] },
    federalPayments: { icon: Flag },
    grossReceipts: { icon: ChartNoAxesColumnIncreasing },
    statePayments: {
      icon: MapPin,
      groups: {
        statePayments: {
          rows: [
            'state',
            'q1Amount q1Date',
            'q2Amount q2Date',
            'q3Amount q3Date',
            'q4Amount q4Date',
          ],
        },
      },
    },
    payrollWages: { icon: Users },
    payrollTaxes: { icon: FileText },
    priorYear: { icon: FileText },
    additionalTax: { icon: MessageSquareMore },
    incomeDocuments: {
      icon: Paperclip,
      iconFirst: true,
      wide: true,
      quiet: ['incomeDocuments'],
      chooser: true,
    },
    // Step 3, Business Expenses.
    expenses: {
      icon: BriefcaseBusiness,
      iconFirst: true,
      noNumber: true,
      wide: true,
      grids: {
        expenses: {
          tones: true,
          icons: {
            cogs: Package,
            office: Paperclip,
            rent: House,
            utilities: Lightbulb,
            vehicleTravel: Car,
            meals: Utensils,
            payroll: Users,
            professional: FileText,
            marketing: Megaphone,
            insurance: Shield,
            repairs: Wrench,
            taxesLicenses: Landmark,
            interest: Percent,
            depreciation: ChartColumnBig,
            other: Ellipsis,
          },
        },
      },
    },
    expenseDocuments: {
      icon: FileText,
      iconFirst: true,
      noNumber: true,
      wide: true,
      quiet: ['expenseDocuments'],
      chooser: true,
    },
    expenseNotes: { icon: NotebookPen, iconFirst: true, noNumber: true, wide: true },
    // Step 4, Review & Submit: the optional extra files beside the answers.
    additionalDocuments: {
      icon: CloudUpload,
      iconFirst: true,
      noNumber: true,
      wide: true,
      quiet: ['additionalDocuments'],
      chooser: true,
    },
  },
};

/** Bookkeeping: `Bookkeeping intake.png` and the three after it. */
const BOOKKEEPING: FormLook = {
  titleBreak: true,
  stepperHints: {
    business: 'Tell us about you and your business.',
    background: 'Help us understand your operations.',
    documents: 'Upload your required documents.',
    review: 'Review your information and sign.',
  },
  panels: {
    // Step 1, Personal and Business Information.
    contact: { rows: ['phone:6'], labels: { name: 'Full Name' } },
    business: {
      shareNumber: true,
      rows: [
        'businessName dba',
        'ein businessPhone',
        'website',
        'industry:5 entityType:4 yearsInBusiness:3',
      ],
    },
    package: {
      wide: true,
      quiet: ['package'],
      cardIcons: { STARTER: Sprout, GROWTH: ChartNoAxesColumnIncreasing, PREMIUM: Gem },
    },
    additional: {
      rows: [
        'primaryBanks accountingSoftware',
        'hasBookkeeper bookkeeperLastDay',
        'currentSituation reportFrequency',
      ],
    },
    details: {},
    expensesAssets: {
      wide: true,
      columns: [
        { span: 6, rows: ['commonExpenses', 'commonExpensesOther'] },
        { span: 6, rows: ['assets'] },
      ],
      optionColumns: { commonExpenses: 2 },
      groups: { assets: { table: true } },
    },
    systems: {
      wide: true,
      columns: [
        { span: 8, rows: ['systems'] },
        { span: 4, rows: ['noPasswords'] },
      ],
      noteCards: ['noPasswords'],
      groups: { systems: { table: true } },
    },
    // Step 2, Business Background Details: three columns of numbered panels.
    history: { icon: CalendarDays, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    accounts: { icon: Landmark, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    receivables: { icon: CreditCard, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    payables: { icon: ReceiptText, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    people: { icon: Users, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    salesTax: { icon: FileText, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    inventory: {
      icon: Package,
      iconFirst: true,
      numberInTitle: true,
      iconTone: 'danger',
      tone: 'danger',
      alerts: ['inventoryHelp'],
    },
    financing: { icon: FileText, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    owner: { icon: User, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    openingBalances: {
      icon: ChartNoAxesColumnIncreasing,
      iconFirst: true,
      numberInTitle: true,
      iconTone: 'heading',
    },
    basis: { icon: Calculator, iconFirst: true, numberInTitle: true, iconTone: 'heading' },
    // Step 3, Document Upload: headings on the page, upload cards two to a row.
    required: {
      plain: true,
      wide: true,
      lead: 'uploadRules',
      rows: ['formationDocument einDocument', 'lastYearReturn supportingDocuments'],
      uploadCards: {
        formationDocument: FileText,
        einDocument: IdCard,
        lastYearReturn: FileSpreadsheet,
        supportingDocuments: FileText,
        inventoryRecords: Package,
      },
      uploadWide: ['inventoryRecords'],
    },
    comments: { plain: true, wide: true, quiet: ['onboardingComments'] },
    // Step 4, Review & Sign Agreement.
    confirm: {
      title: '3. Review & Confirm',
      noNumber: true,
      badge: SquareCheckBig,
      badgeDark: true,
    },
  },
  stacks: [
    { columns: [['history'], ['accounts'], ['receivables']], stretch: true },
    { columns: [['payables'], ['people'], ['salesTax']], stretch: true },
    { columns: [['inventory'], ['financing', 'openingBalances'], ['owner', 'basis']] },
  ],
  banners: ['background', 'documents', 'review'],
  agreementTitle: '4. Review & Sign Our Agreement',
  review: {
    collapsed: true,
    agreementRight: true,
    skipSteps: ['documents'],
    titles: {
      answers: 'Review Your Information',
      answersNote:
        'Please review the information you provided. If you need to make changes, click “Edit” in any section.',
      files: 'Review Your Uploaded Documents',
      filesNote:
        'Please confirm that all required documents have been uploaded. You can view or replace any document if needed.',
    },
    icons: { business: User, background: Landmark },
    notes: {
      business: 'Your name, contact details, business name, EIN, address, and basic information.',
      background:
        'Your business operations, accounts, payroll, inventory, tax information, and more.',
    },
  },
};

/** Payroll: `Payroll intake 1.png`, `Payroll intake 2.png`, `Payroll Review intake.png`. */
const PAYROLL: FormLook = {
  eyebrow: true,
  tagline: 'Accurate Payroll. Compliant Business. Confident Growth.',
  unnumbered: true,
  banners: ['business', 'payroll', 'review'],
  stepperHints: {
    business: 'Tell us about your business and payroll needs.',
    payroll: 'Provide employee and payroll information.',
    review: 'Upload documents and review before submitting.',
  },
  stacks: [
    {
      columns: [
        ['business', 'businessType'],
        ['ownership', 'needs', 'additional'],
      ],
    },
    { columns: [['employees'], ['schedule'], ['setup']], stretch: true },
    { columns: [['paymentTax'], ['payDeductions'], ['additionalPayroll']], stretch: true },
  ],
  panels: {
    // Step 1, Business Details.
    business: {
      icon: Building2,
      iconCircle: true,
      rows: ['ein stateOfFormation', 'businessPhone businessEmail'],
      addressLabels: true,
    },
    businessType: {
      icon: BriefcaseBusiness,
      iconCircle: true,
      optionColumns: { businessFocus: 3 },
    },
    ownership: { icon: Users, iconCircle: true, rows: ['fullName phone'] },
    needs: { icon: Settings, iconCircle: true, optionColumns: { payrollSituation: 1 } },
    additional: { icon: ClipboardList, iconCircle: true },
    // Step 2, Payroll Details.
    employees: { icon: Users, iconCircle: true },
    schedule: { icon: CalendarDays, iconCircle: true },
    setup: { icon: Settings, iconCircle: true },
    paymentTax: { icon: CircleDollarSign, iconCircle: true, optionColumns: { payrollTaxes: 1 } },
    payDeductions: {
      icon: ClipboardList,
      iconCircle: true,
      optionColumns: { payMethods: 1, benefits: 1 },
    },
    additionalPayroll: { icon: Users, iconCircle: true, optionColumns: { assistance: 1 } },
    documents: { icon: Upload, iconCircle: true, wide: true, quiet: ['payrollDocuments'] },
    // Step 3, Review & Sign.
    additionalDocuments: { headless: true, wide: true, uploadButtons: ['additionalDocuments'] },
    additionalInformation: {
      icon: MessageSquareMore,
      iconCircle: true,
      wide: true,
      quiet: ['additionalInformation'],
    },
  },
  agreementTitle: '3. Review Our Service Agreement',
  review: {
    collapsed: true,
    agreementRight: true,
    titles: {
      answers: 'Review Your Information',
      answersNote: 'Please review your answers. You can go back to make changes if needed.',
      files: 'Review Your Uploaded Documents',
      filesNote:
        "Here are the documents you've uploaded. You can view, download, or replace any file.",
    },
    rows: [
      {
        title: 'Business Details',
        sections: ['business', 'businessType', 'ownership', 'needs', 'additional'],
      },
      { title: 'Payroll Details', sections: ['employees', 'schedule', 'setup', 'documents'] },
      { title: 'Payment & Tax Information', sections: ['paymentTax'] },
      { title: 'Employee Pay & Deductions', sections: ['payDeductions'] },
      { title: 'Additional Payroll Information', sections: ['additionalPayroll'] },
    ],
  },
};

/** Tax Planning: `Tax Planning intake 1.png` to `Tax planning intake 4.png`. */
const TAX_PLANNING: FormLook = {
  unnumbered: true,
  stepperBox: true,
  hero: {
    profile: 'Smart Tax Strategies for a Brighter Tomorrow.',
    finances: 'Smart Strategies. Brighter Outcomes.',
    goals: 'Let\u2019s Build a Smarter Tax Strategy.',
    review: 'Review. Sign. Submit.',
  },
  panels: {
    // Step 1, Client, Business & Tax Profile.
    contact: {
      icon: User,
      iconCircle: true,
      wide: true,
      rows: ['fullName phone email'],
    },
    business: {
      icon: BriefcaseBusiness,
      iconCircle: true,
      wide: true,
      rows: [
        'businessName dba ein',
        'businessStructure industry yearsInBusiness',
        'operatingStates owners employees contractors',
      ],
    },
    accounting: {
      icon: FileText,
      iconCircle: true,
      wide: true,
      rows: ['accountingMethod:3 planningTaxYear:3 hasBookkeeper:6'],
    },
    details: {
      icon: Target,
      iconCircle: true,
      wide: true,
      columns: [
        { span: 7, rows: ['services', 'servicesOther'] },
        { span: 5, rows: ['reasons', 'reasonsOther'] },
      ],
      optionColumns: { services: 2, reasons: 1 },
    },
    // Step 2, Income & Financial Information: amounts set beside their labels.
    personalIncome: {
      icon: User,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        {
          span: 6,
          rows: [
            'w2Income',
            'selfEmploymentIncome',
            'investmentIncome',
            'rentalIncome',
            'retirementIncome',
            'otherIncome',
          ],
        },
        { span: 6, rows: ['multipleStates', 'incomeStates', 'filingStatus', 'incomeChanges'] },
      ],
      inline: [
        'w2Income',
        'selfEmploymentIncome',
        'investmentIncome',
        'rentalIncome',
        'retirementIncome',
        'otherIncome',
      ],
    },
    businessFinances: {
      icon: BriefcaseBusiness,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        {
          span: 6,
          rows: [
            'businessRevenue',
            'netProfit',
            'ownerCompensation',
            'totalPayroll',
            'majorExpenses',
          ],
        },
        { span: 6, rows: ['plannedPurchases', 'plannedPurchasesDetails', 'otherEntities'] },
      ],
      inline: [
        'businessRevenue',
        'netProfit',
        'ownerCompensation',
        'totalPayroll',
        'majorExpenses',
      ],
    },
    currentTax: {
      icon: FileText,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        {
          span: 6,
          rows: [
            'filedRecentReturn',
            'recentReturnYear',
            'priorLiability',
            'priorRefundOrOwed',
            'federalWithholding',
            'stateWithholding',
            'federalEstimated',
            'stateEstimated',
          ],
        },
        {
          span: 6,
          rows: [
            'taxIssues',
            'taxIssuesDetails',
            'majorChanges',
            'majorChangesDetails',
            'taxProfessional',
            'taxProfessionalName',
          ],
        },
      ],
      inline: [
        'recentReturnYear',
        'priorLiability',
        'priorRefundOrOwed',
        'federalWithholding',
        'stateWithholding',
        'federalEstimated',
        'stateEstimated',
      ],
    },
    additionalFinancial: {
      icon: ChartNoAxesColumnIncreasing,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      rows: ['upcomingExpenses:3 upcomingExpensesDetails:4 financialComments:5'],
    },
    // Step 3, Planning Goals & Opportunities.
    goals: {
      icon: Target,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      quiet: ['goals'],
      optionColumns: { goals: 3 },
    },
    changes: {
      icon: Lightbulb,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      quiet: ['upcomingChanges'],
      optionColumns: { upcomingChanges: 2 },
    },
    concerns: {
      icon: Settings,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        { span: 8, rows: ['concerns', 'concernsOther'] },
        { span: 4, rows: ['specificQuestion'] },
      ],
      quiet: ['concerns'],
      optionColumns: { concerns: 2 },
      warm: ['specificQuestion'],
    },
    vision: {
      icon: Target,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      rows: ['shortTermGoals longTermGoals visionComments'],
    },
    // Step 4, Review & Submit.
    reviewNote: { hidden: true },
  },
  review: {
    collapsed: true,
    titles: {
      answers: 'Review Your Information',
      answersNote:
        'Please review your responses below. You can edit any section before submitting.',
    },
    icons: { profile: User, finances: Calculator, goals: Target },
    notes: {
      profile: 'Your contact information, business details, and tax setup.',
      finances: 'Your personal and business income, expenses, and current tax information.',
      goals: 'Your tax planning goals, upcoming changes, and specific concerns.',
    },
  },
};

/** Business Development: `Development intake 1.png` to `Development Intake 4.png`. */
const BUSINESS_DEVELOPMENT: FormLook = {
  unnumbered: true,
  stepperBox: true,
  heroTail: true,
  hero: {
    services: 'Let\u2019s turn your vision into a real business.',
    details: 'Let\u2019s Build Your Vision Together!',
    more: 'Let\u2019s Build Your Vision Together!',
    review: 'Almost Done!',
  },
  panels: {
    // Step 1, Your Information & Services: headings on the page, the services as cards.
    contact: {
      title: 'Personal & Business Information',
      wide: true,
      rows: ['fullName phone email', 'businessName businessAddress'],
      addressLabels: true,
    },
    services: {
      title: 'Business Development Services',
      wide: true,
      quiet: ['services'],
      cardIcons: {
        FORMATION: Building2,
        EIN: FileText,
        REGISTERED_AGENT_LOCAL: ShieldCheck,
        REGISTERED_AGENT_US: MapPin,
        BUSINESS_PLAN: FilePen,
        OPERATING_AGREEMENT: FileText,
        LOGO: Palette,
        WEBSITE: Monitor,
        PRODUCT_DEVELOPMENT: Package,
        SERVICE_DEVELOPMENT: Settings,
        BUDGETING: Calculator,
        RESOURCES: Users,
      },
    },
    // Step 2, Business Details.
    overview: {
      icon: Store,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        { span: 4, rows: ['currentStatus'] },
        { span: 4, rows: ['businessType', 'businessTypeOther'] },
        { span: 4, rows: ['hasNameInMind', 'proposedName'] },
      ],
      optionColumns: { currentStatus: 1, businessType: 2 },
    },
    accounting: {
      icon: FileText,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        { span: 6, rows: ['accountingYear', 'fiscalStartMonth'] },
        { span: 6, rows: ['usesSoftware', 'hasBookkeeper'] },
      ],
      optionColumns: { accountingYear: 1 },
    },
    about: {
      icon: BriefcaseBusiness,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      rows: ['productsOrServices targetMarket', 'unique nearTermVision'],
    },
    location: {
      icon: MapPin,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      rows: ['primaryState registeredAgentStates'],
    },
    branding: {
      icon: Palette,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      rows: ['logoColors colorsReason'],
    },
    additional: {
      icon: Monitor,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      quiet: ['additionalInformation'],
    },
    // Step 3, Additional Information.
    goals: {
      icon: FileText,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        { span: 6, rows: ['mainGoals'] },
        { span: 6, rows: ['timeframe', 'longTermVision'] },
      ],
    },
    stage: {
      icon: Target,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      columns: [
        { span: 4, rows: ['stage', 'stageOther'] },
        { span: 8, rows: ['challenges', 'challengesOther'] },
      ],
      optionColumns: { stage: 1, challenges: 2 },
    },
    questions: { icon: Users, iconCircle: true, wide: true, numberInTitle: true },
    documents: {
      icon: CloudUpload,
      iconCircle: true,
      wide: true,
      numberInTitle: true,
      quiet: ['documents'],
    },
    // Step 4, Review & Submit.
    reviewNote: { hidden: true },
  },
  review: {
    byStep: true,
    twoColumns: true,
    rows: [
      { title: '1. Personal & Business Information', sections: ['contact'], icon: User },
      { title: '2. Selected Services', sections: ['services'], icon: ClipboardList },
      {
        title: '3. Business Details',
        sections: ['overview', 'accounting', 'about', 'location', 'branding', 'additional'],
        icon: Building2,
      },
      {
        title: '4. Additional Information',
        sections: ['goals', 'stage', 'questions', 'documents'],
        icon: ClipboardList,
      },
    ],
  },
};

const LOOKS: Partial<Record<IntakeFormKey, FormLook>> = {
  BUSINESS_DEVELOPMENT,
  TAX_PLANNING,
  ANNUAL_TAX,
  QUARTERLY_TAX,
  BOOKKEEPING,
  PAYROLL,
};

export const formLook = (form: IntakeFormKey): FormLook => LOOKS[form] ?? NO_LOOK;
