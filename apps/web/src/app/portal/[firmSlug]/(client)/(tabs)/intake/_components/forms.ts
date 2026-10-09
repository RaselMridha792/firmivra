import type { IntakeFormKey } from '@firmivra/types';
import {
  BookOpenCheck,
  BriefcaseBusiness,
  ChartColumn,
  Lightbulb,
  type LucideIcon,
  UserRound,
  Users,
} from 'lucide-react';

/** The six intake forms, in the mockup's order, with the path segment each card opens. */
export const FORMS: { key: IntakeFormKey; path: string; title: string; icon: LucideIcon }[] = [
  { key: 'ANNUAL_TAX', path: 'annual-tax', title: 'Tax Preparation Intake Form', icon: UserRound },
  {
    key: 'QUARTERLY_TAX',
    path: 'quarterly-tax',
    title: 'Quarterly Tax Intake Form',
    icon: BriefcaseBusiness,
  },
  {
    key: 'TAX_PLANNING',
    path: 'tax-planning',
    title: 'Tax Planning & Strategy Intake Form',
    icon: ChartColumn,
  },
  {
    key: 'BOOKKEEPING',
    path: 'bookkeeping',
    title: 'Bookkeeping Services Intake Form',
    icon: BookOpenCheck,
  },
  { key: 'PAYROLL', path: 'payroll', title: 'Payroll Services Intake Form', icon: Users },
  {
    key: 'BUSINESS_DEVELOPMENT',
    path: 'business-development',
    title: 'Business Development & Advisory Intake Form',
    icon: Lightbulb,
  },
];
