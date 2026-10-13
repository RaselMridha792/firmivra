import type { IntakeFormKey } from '@firmivra/types';
import {
  BriefcaseBusiness,
  Building2,
  Calculator,
  ChartColumn,
  FileText,
  MessageSquareMore,
  ReceiptText,
  User,
  Users,
} from 'lucide-react';
import { type FormLook, NO_LOOK } from './intake-layout';

// Each form's panels as its mockups draw them (docs/mockups/begin-online/), by section key.

/** Annual Tax: `Annual Intake Form 1.png` to `Annual Tax Intake Form 4.png`. */
const ANNUAL_TAX: FormLook = {
  footerNote: 'documentsNote',
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
    income: { icon: ChartColumn, yesNoList: true, inline: ['incomeDetails'] },
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
    businessIncome: { icon: ChartColumn, wide: true },
    payroll: { icon: Users, wide: true },
    incomeTaxesPaid: { icon: ReceiptText, wide: true },
    businessExpenses: { icon: Calculator, wide: true },
  },
};

const LOOKS: Partial<Record<IntakeFormKey, FormLook>> = { ANNUAL_TAX };

export const formLook = (form: IntakeFormKey): FormLook => LOOKS[form] ?? NO_LOOK;
