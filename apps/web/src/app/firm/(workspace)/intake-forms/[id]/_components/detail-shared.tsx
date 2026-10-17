import type { AssignedFormEvent, IntakeAnswers, IntakeField, IntakeStatus } from '@firmivra/types';
import type { TileTone } from '@firmivra/ui';
import {
  CheckCircle,
  Envelope,
  Eye,
  FileArrowUp,
  FloppyDisk,
  PaperPlaneTilt,
  Archive,
  ArrowsClockwise,
  Bell,
  ClipboardText,
  Lightning,
  UserSwitch,
  CalendarPlus,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export const DETAIL_KEY = ['intake-forms', 'detail'] as const;
export const recordKey = (id: string) => [...DETAIL_KEY, id, 'record'];
export const responsesKey = (id: string) => [...DETAIL_KEY, id, 'responses'];

export const STATUS_TONE: Record<
  IntakeStatus,
  'neutral' | 'warning' | 'info' | 'danger' | 'purple' | 'success'
> = {
  DRAFT: 'neutral',
  SENT: 'neutral',
  IN_PROGRESS: 'warning',
  SUBMITTED: 'info',
  NEEDS_CORRECTION: 'danger',
  UNDER_REVIEW: 'purple',
  COMPLETED: 'success',
  EXPIRED: 'danger',
  ARCHIVED: 'neutral',
};

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const plainDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};

/** The icon and tile colour of one history or communication event. */
export const EVENT: Record<AssignedFormEvent['kind'], { icon: Icon; tone: TileTone }> = {
  SENT: { icon: PaperPlaneTilt, tone: 'blue' },
  RESENT: { icon: ArrowsClockwise, tone: 'blue' },
  REMINDER: { icon: Bell, tone: 'amber' },
  OPENED: { icon: Eye, tone: 'blue' },
  SAVED: { icon: FloppyDisk, tone: 'grey' },
  UPLOADED: { icon: FileArrowUp, tone: 'purple' },
  SUBMITTED: { icon: CheckCircle, tone: 'green' },
  REVIEW_STARTED: { icon: ClipboardText, tone: 'purple' },
  REVISION_REQUESTED: { icon: Envelope, tone: 'red' },
  COMPLETED: { icon: CheckCircle, tone: 'green' },
  ASSIGNED: { icon: UserSwitch, tone: 'blue' },
  EXTENDED: { icon: CalendarPlus, tone: 'amber' },
  ARCHIVED: { icon: Archive, tone: 'grey' },
} as Record<AssignedFormEvent['kind'], { icon: Icon; tone: TileTone }>;
export const eventMeta = (kind: AssignedFormEvent['kind']) =>
  EVENT[kind] ?? { icon: Lightning, tone: 'grey' as TileTone };

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** A raw answer as the plain text a row shows ("Not provided" when there is none). */
export function answerText(field: IntakeField, value: IntakeAnswers[string] | undefined): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value) && value.length === 0) return '';
  const options = 'options' in field ? field.options : undefined;
  const label = (v: unknown) => options?.find((o) => o.value === v)?.label ?? String(v);
  switch (field.type) {
    case 'ssn':
    case 'ein':
      return typeof value === 'object' && value !== null && 'last4' in value
        ? `XXX-XX-${String(value.last4)}`
        : '';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? plainDay(value)
        : String(value);
    case 'currency':
      return typeof value === 'number' ? money(value) : '';
    case 'yesNo':
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'radio':
    case 'select':
      return label(value);
    case 'checkboxes':
      return Array.isArray(value) ? value.map(label).join(', ') : '';
    default:
      return typeof value === 'object' ? '' : String(value);
  }
}

export const isPlain = (field: IntakeField) =>
  !['group', 'grid', 'upload', 'info'].includes(field.type);

export const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">{children}</p>
);

/** The short names the Overview cards use for the form's long yes-or-no questions. */
export const SHORT_LABEL: Record<string, string> = {
  studentLoanInterest: 'Student Loan Interest',
  retirementContributions: 'Retirement Contributions',
  hsaContributions: 'Health Savings Account (HSA)',
  educationExpenses: 'Education Credits',
  mortgageInterest: 'Mortgage Interest',
  realEstateTaxes: 'Real Estate Taxes',
  charitableContributions: 'Charitable Contributions',
  medicalExpenses: 'Medical Expenses',
  childCareExpenses: 'Childcare Expenses',
  energyImprovements: 'Energy Improvements',
  otherDeductions: 'Other Deductions or Credits',
  incomeWages: 'W-2 Wages',
  incomeSelfEmployment: '1099-NEC (Self-Employment)',
  incomeBusiness: 'Business Income',
  incomeInterest: '1099-INT (Interest)',
  incomeDividends: '1099-DIV (Dividends)',
  incomeRetirement: 'Retirement Income',
  incomeUnemployment: 'Unemployment (1099-G)',
  incomeRental: 'Rental Income',
  incomeAlimony: 'Alimony',
  incomeOther: 'Other Income',
};
