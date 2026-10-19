import { Badge } from '@firmivra/ui';

/** Every query of the Tax Planning module starts here: a change in one view refreshes the others. */
export const TP_KEY = ['tax-planning'] as const;

export const PLAN_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  AWAITING_CLIENT: 'Awaiting Client',
  READY_FOR_REVIEW: 'Needs Review',
  IMPLEMENTED: 'Implemented',
  CLOSED: 'Closed',
};
const PLAN_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  IN_PROGRESS: 'success',
  AWAITING_CLIENT: 'warning',
  READY_FOR_REVIEW: 'warning',
  IMPLEMENTED: 'success',
  CLOSED: 'neutral',
};
export function PlanPill({ status }: { status: string | null }) {
  return status ? (
    <Badge tone={PLAN_TONE[status] ?? 'neutral'}>{PLAN_STATUS[status] ?? status}</Badge>
  ) : (
    <span className="text-muted">No plan</span>
  );
}

export const OPP_STATUS: Record<string, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under Review',
  ADDED_TO_PLAN: 'Added to Plan',
  ASSIGNED: 'Assigned',
  DISCUSSION_SCHEDULED: 'Discussion Scheduled',
  NEEDS_DOCUMENTS: 'Needs Documents',
  NOT_APPLICABLE: 'Not Applicable',
  DISMISSED: 'Dismissed',
  IMPLEMENTED: 'Implemented',
  CLOSED: 'Closed',
};
export function OppPill({ status }: { status: string }) {
  const tone =
    status === 'NEW'
      ? 'info'
      : status === 'IMPLEMENTED' || status === 'ADDED_TO_PLAN'
        ? 'success'
        : status === 'NEEDS_DOCUMENTS'
          ? 'warning'
          : status === 'NOT_APPLICABLE' || status === 'DISMISSED' || status === 'CLOSED'
            ? 'neutral'
            : 'info';
  return <Badge tone={tone}>{OPP_STATUS[status] ?? status}</Badge>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  RETIREMENT: 'Retirement',
  DEDUCTIONS: 'Deductions',
  BUSINESS: 'Business',
  CREDITS: 'Credits',
  ENTITY: 'Entity',
  TIMING: 'Timing',
  INVESTMENT: 'Investment',
  ESTATE_OTHER: 'Estate & Other',
};
export const PRIORITY_LABEL: Record<string, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
export function PriorityPill({ priority }: { priority: string }) {
  return (
    <Badge tone={priority === 'HIGH' ? 'danger' : priority === 'MEDIUM' ? 'warning' : 'info'}>
      {PRIORITY_LABEL[priority] ?? priority}
    </Badge>
  );
}
export const GOALS: Record<string, string> = {
  REDUCE_TAXABLE_INCOME: 'Reduce taxable income',
  INCREASE_RETIREMENT_SAVINGS: 'Increase retirement savings',
  PURCHASE_HOME: 'Purchase a home',
  START_BUSINESS: 'Start a business',
  BUY_EQUIPMENT_VEHICLE: 'Buy equipment or vehicle',
  MINIMIZE_SELF_EMPLOYMENT_TAX: 'Minimize self-employment tax',
  PLAN_EDUCATION_EXPENSES: 'Plan for education expenses',
  BUILD_LONG_TERM_WEALTH: 'Build long-term wealth',
  PREPARE_LIFE_CHANGES: 'Prepare for major life changes',
  OTHER: 'Other (specify)',
};
export const FILING: Record<string, string> = {
  SINGLE: 'Single',
  MARRIED_FILING_JOINTLY: 'Married Filing Jointly',
  MARRIED_FILING_SEPARATELY: 'Married Filing Separately',
  HEAD_OF_HOUSEHOLD: 'Head of Household',
  QUALIFYING_SURVIVING_SPOUSE: 'Qualifying Surviving Spouse',
};

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
export const moneyExact = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dayText = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const dateTimeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const dollars = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '')) * 100);
export const toDollars = (c: number | null | undefined) =>
  c === null || c === undefined ? '' : (c / 100).toFixed(0);

export const TP_ERRORS: Record<string, string> = {
  DUPLICATE_PLAN: 'This client already has a plan with that name for that year.',
  DUPLICATE_STRATEGY: 'That strategy is already in the plan.',
  DUPLICATE_OPPORTUNITY: 'This client already has an open opportunity for that strategy.',
  DUPLICATE_NAME: 'A strategy with this name already exists.',
  SAVE_CONFLICT: 'Someone saved this after you opened it. Reload and try again.',
  OVERRIDE_NOT_ALLOWED: 'You may not override an estimate.',
  FINANCIAL_INPUTS_RESTRICTED: 'The financial figures are restricted for your role.',
  INVALID_STATUS: 'That does not fit the current status.',
  PLAN_NOT_READY: 'The plan is not ready yet. Check what is missing.',
  PLAN_ARCHIVED: 'Restore the plan before changing it.',
  DOCUMENT_NOT_ALLOWED: 'That document does not belong to this client.',
  CALCULATION_UNAVAILABLE: 'The estimate could not be calculated now.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const primary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link';
