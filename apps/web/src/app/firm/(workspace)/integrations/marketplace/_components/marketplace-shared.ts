import type { IntegrationCategory } from '@firmivra/types';
import {
  Bank,
  CalendarDots,
  ChatCircleDots,
  Code,
  CreditCard,
  FileText,
  Megaphone,
  PenNib,
  ShieldCheck,
  ShoppingCart,
  Users,
  type Icon,
} from '@phosphor-icons/react';

export const categories: { value: IntegrationCategory; label: string; icon: Icon }[] = [
  { value: 'ACCOUNTING_FINANCE', label: 'Accounting & Finance', icon: Bank },
  { value: 'PAYMENTS', label: 'Payments', icon: CreditCard },
  { value: 'COMMUNICATION', label: 'Communication', icon: ChatCircleDots },
  { value: 'PRODUCTIVITY', label: 'Productivity', icon: ShieldCheck },
  { value: 'SCHEDULING', label: 'Scheduling', icon: CalendarDots },
  { value: 'DOCUMENT_MANAGEMENT', label: 'Document Management', icon: FileText },
  { value: 'CRM_LEADS', label: 'CRM & Lead Generation', icon: Users },
  { value: 'E_SIGNATURE', label: 'E-Signature', icon: PenNib },
  { value: 'TAX_SOFTWARE', label: 'Tax Software', icon: FileText },
  { value: 'PAYROLL_HR', label: 'Payroll & HR', icon: Users },
  { value: 'MARKETING', label: 'Marketing', icon: Megaphone },
  { value: 'ECOMMERCE', label: 'E-Commerce', icon: ShoppingCart },
  { value: 'CUSTOM', label: 'Custom Integrations', icon: Code },
];
export const categoryLabel = (value: IntegrationCategory) =>
  categories.find((item) => item.value === value)?.label ?? value;
export const categoryOptions = categories.map(({ value, label }) => ({ value, label }));
export const actionLink =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-action px-3 py-1.5 text-center text-xs font-semibold text-action transition-colors hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-focus';
