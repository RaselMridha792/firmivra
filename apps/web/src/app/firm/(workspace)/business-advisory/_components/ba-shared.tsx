import { Badge } from '@firmivra/ui';
import { ArrowRight, CheckCircle, type Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Every query of the Business Advisory module starts here: a change in one view refreshes the others. */
export const BA_KEY = ['business-advisory'] as const;
export const BASE = '/business-advisory';

type Tone = 'success' | 'info' | 'warning' | 'danger' | 'purple' | 'neutral';
const pill =
  (labels: Record<string, string>, tones: Record<string, Tone>) =>
  ({ status }: { status: string }) => (
    <Badge tone={tones[status] ?? 'neutral'} icon={CheckCircle}>
      {labels[status] ?? status}
    </Badge>
  );

export const CLIENT_STATUS: Record<string, string> = {
  IN_PROGRESS: 'In Progress',
  SCHEDULED: 'Scheduled',
  NEEDS_REVIEW: 'Needs Review',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};
export const ClientStatusPill = pill(CLIENT_STATUS, {
  IN_PROGRESS: 'success',
  SCHEDULED: 'info',
  NEEDS_REVIEW: 'warning',
  ON_HOLD: 'neutral',
  COMPLETED: 'purple',
  ARCHIVED: 'neutral',
});

export const PLAN_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In Review',
  FINALIZED: 'Finalized',
  SENT: 'Sent',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};
export const PlanStatusPill = pill(PLAN_STATUS, {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  FINALIZED: 'info',
  SENT: 'purple',
  IN_PROGRESS: 'success',
  COMPLETED: 'success',
  ARCHIVED: 'neutral',
});

export const GOAL_STATUS: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  PLANNING: 'Planning',
  IN_PROGRESS: 'In Progress',
  ON_TRACK: 'On Track',
  AT_RISK: 'At Risk',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};
export const GoalStatusPill = pill(GOAL_STATUS, {
  NOT_STARTED: 'neutral',
  PLANNING: 'info',
  IN_PROGRESS: 'success',
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  OVERDUE: 'danger',
  COMPLETED: 'purple',
  CANCELLED: 'neutral',
});

export const AREA_LABEL: Record<string, string> = {
  REVENUE_GROWTH: 'Revenue Growth',
  PROFITABILITY: 'Profitability',
  FUNDING: 'Funding',
  EXPANSION: 'Expansion',
  STAFFING: 'Staffing',
  OPERATIONS: 'Operations',
  MARKETING_SALES: 'Marketing / Sales',
  BUSINESS_SETUP: 'Business Setup',
  FINANCIAL_MANAGEMENT: 'Financial Management',
};

/** Free text in the API (max 60); these are the plan types the screens offer. */
export const PLAN_TYPES = [
  'Growth Plan',
  'Startup Plan',
  'Expansion Plan',
  'Funding Plan',
  'Operations Plan',
  'Turnaround Plan',
  'Exit Plan',
];

/** Free text in the API (max 60); these are the stages the screens offer. */
export const BUSINESS_STAGES = ['Startup', 'Growth', 'Established', 'Expansion', 'Transition'];

export const BA_ERRORS: Record<string, string> = {
  ALREADY_ADVISORY_CLIENT: 'This client is in the advisory program already.',
  DUPLICATE_SERVICE: 'This service is on the client already.',
  SAVE_CONFLICT: 'Someone saved this after you opened it. Reload and try again.',
  INVALID_STATUS: 'That does not fit the current status.',
  PLAN_NOT_READY: 'The plan is not ready yet. Open its Review step to see what is missing.',
  PLAN_ARCHIVED: 'Restore the plan before changing it.',
  INCONSISTENT_FIGURES: 'Net profit must be revenue minus expenses.',
  OVERRIDE_NOT_ALLOWED: 'Replacing figures from a source needs an override reason.',
  FINANCIALS_RESTRICTED: 'Financial figures are restricted for your role.',
  NOT_A_MEMBER: 'That person is not an active member of the firm.',
  RESOURCE_NOT_CLIENT_FACING: 'This resource is for staff and cannot be sent.',
  NOT_THIS_CLIENT: 'That plan, goal or service belongs to another client.',
  FORBIDDEN: 'Your role cannot do this.',
};

/** A goal's or milestone's progress: the bar and its percent. */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex min-w-32 items-center gap-3">
      <span
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 flex-1 overflow-hidden rounded-pill bg-disabled"
      >
        <span className="block h-full rounded-pill bg-action" style={{ width: `${value}%` }} />
      </span>
      <span className="w-10 text-right text-sm text-text">{value}%</span>
    </span>
  );
}

/** A card's heading: the tinted icon tile, the title and line under it, and "View All". */
export function SectionHead({
  icon: Glyph,
  title,
  subtitle,
  href,
}: {
  icon: Icon;
  title: string;
  subtitle?: string;
  href?: string;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action"
        >
          <Glyph weight="fill" className="size-7" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {href ? (
        <Link href={href} className={linkBtn} aria-label={`View all: ${title}`}>
          View All <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

/** "Oct 3, 2026" over "10:00 AM", as the tables show a meeting time. */
export function DateTimeCell({ iso }: { iso: string | null }): ReactNode {
  if (!iso) return <span className="text-muted">—</span>;
  const d = new Date(iso);
  return (
    <span className="flex flex-col leading-snug">
      <span>
        {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
      <span>{d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
    </span>
  );
}

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined
    ? '—'
    : `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
export const dayText = (d: string | null | undefined) =>
  d
    ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
export const today = () => new Date().toISOString().slice(0, 10);

export const primary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:bg-action-hover disabled:opacity-50';
export const outlined =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-heading hover:bg-accent-soft disabled:opacity-50';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
export const linkBtn =
  'inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-link hover:underline';
