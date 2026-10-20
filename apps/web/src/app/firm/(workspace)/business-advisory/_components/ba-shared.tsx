import { ApiRequestError } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  ArrowRight,
  Bank,
  Buildings,
  ChartBar,
  ChartLineUp,
  CheckCircle,
  FileText,
  Globe,
  HandCoins,
  PaintBrush,
  PlayCircle,
  TrendUp,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorCode, errorMessage } from '../../../../../lib/errors';

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

/** The resource library's categories (apps/api/src/advisory/catalog.ts), each with its icon. */
export const RESOURCE_ICON: Record<string, Icon> = {
  'Formation / EIN': Buildings,
  Branding: PaintBrush,
  Website: Globe,
  Banking: Bank,
  Funding: HandCoins,
  'Business Planning': FileText,
  'Market Research': ChartBar,
  'Financial Management': ChartLineUp,
  'Growth / Operations': TrendUp,
  Education: PlayCircle,
};

export const REC_STATUS: Record<string, string> = {
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  IMPLEMENTED: 'Implemented',
  NOT_APPLICABLE: 'Not Applicable',
  DECLINED: 'Declined',
};
export const RecStatusPill = pill(REC_STATUS, {
  PROPOSED: 'info',
  ACCEPTED: 'purple',
  IN_PROGRESS: 'success',
  IMPLEMENTED: 'success',
  NOT_APPLICABLE: 'neutral',
  DECLINED: 'danger',
});

export const ACTION_STATUS: Record<string, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};
export const ActionStatusPill = pill(ACTION_STATUS, {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELLED: 'neutral',
});

export const PRIORITY: Record<string, string> = { HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' };
export function PriorityPill({ priority }: { priority: string }) {
  return (
    <Badge tone={priority === 'HIGH' ? 'danger' : priority === 'NORMAL' ? 'info' : 'neutral'}>
      {PRIORITY[priority] ?? priority}
    </Badge>
  );
}

export const ASSIGNEE_KIND: Record<string, string> = {
  STAFF: 'Staff',
  CLIENT: 'Client',
  TEAM: 'Team',
};
export const SOURCE: Record<string, string> = {
  MANUAL: 'Manual',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  BANK: 'Bank / Integration',
  UPLOADED: 'Uploaded',
};
export const RESOURCE_KIND: Record<string, string> = {
  PDF: 'PDF',
  CHECKLIST: 'Checklist',
  GUIDE: 'Guide',
  TEMPLATE: 'Template',
  VIDEO: 'Video',
  LINK: 'Link',
};

/** "$1,250" typed in a field to cents; undefined when empty, NaN when not a number. */
export const centsOf = (v: string): number | undefined => {
  const t = v.replace(/[$,\s]/g, '');
  return t === '' ? undefined : Math.round(Number(t) * 100);
};

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
  PLAN_NOT_READY: 'The plan is not ready yet.',
  PLAN_ARCHIVED: 'Restore the plan before changing it.',
  INCONSISTENT_FIGURES: 'Net profit must be revenue minus expenses.',
  OVERRIDE_NOT_ALLOWED: 'Replacing figures from a source needs an override reason.',
  FINANCIALS_RESTRICTED: 'Financial figures are restricted for your role.',
  NOT_A_MEMBER: 'That person is not an active member of the firm.',
  RESOURCE_NOT_CLIENT_FACING: 'This resource is for staff and cannot be sent.',
  NOT_THIS_CLIENT: 'That plan, goal or service belongs to another client.',
  FORBIDDEN: 'Your role cannot do this.',
};

/**
 * What went wrong, for a toast or a dialog: the code's message, then the API's details lines
 * ("Still needed: Add at least one goal to the plan; Add the financial figures.").
 */
export function errorText(error: unknown): string {
  const text = errorMessage(error, BA_ERRORS);
  const lines = error instanceof ApiRequestError ? (error.details ?? []).map((d) => d.message) : [];
  return lines.length ? `${text} Still needed: ${lines.join('; ')}.` : text;
}

/** A client record another module does not know reads as "none yet", not as an outage. */
export const noneWhenMissing =
  <T,>(none: T) =>
  (e: unknown): T => {
    if (errorCode(e) === 'NOT_FOUND') return none;
    throw e;
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
