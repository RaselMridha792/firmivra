import type { IntakeFormKey } from '@firmivra/types';
import {
  BriefcaseBusiness,
  Car,
  ChartColumnBig,
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
  Utensils,
  Wrench,
  Building2,
  CreditCard,
  Calculator,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
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

const LOOKS: Partial<Record<IntakeFormKey, FormLook>> = { ANNUAL_TAX, QUARTERLY_TAX, BOOKKEEPING };

export const formLook = (form: IntakeFormKey): FormLook => LOOKS[form] ?? NO_LOOK;
