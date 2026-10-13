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
  Utensils,
  Wrench,
  Building2,
  CreditCard,
  Calculator,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  CloudUpload,
  FileText,
  Flag,
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
    [
      ['business', 'quarterly', 'records'],
      ['ownership', 'industry', 'years', 'additional'],
    ],
    [
      ['filingPeriod', 'grossReceipts', 'priorYear'],
      ['federalPayments', 'statePayments', 'payrollWages', 'payrollTaxes', 'additionalTax'],
    ],
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

const LOOKS: Partial<Record<IntakeFormKey, FormLook>> = { ANNUAL_TAX, QUARTERLY_TAX };

export const formLook = (form: IntakeFormKey): FormLook => LOOKS[form] ?? NO_LOOK;
