import type {
  PayrollClientStatus,
  PayrollFrequency,
  PayrollLineStatus,
  PayrollRunStatus,
} from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  CheckCircle,
  Clock,
  Hourglass,
  PauseCircle,
  Prohibit,
  Spinner,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Every query of the Payroll module starts here: a change in one view refreshes the others. */
export const PAYROLL_KEY = ['payroll'] as const;

export const FREQUENCY_LABEL: Record<PayrollFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  SEMI_MONTHLY: 'Semi-Monthly',
  MONTHLY: 'Monthly',
};
export const FREQUENCY_OPTIONS = (Object.keys(FREQUENCY_LABEL) as PayrollFrequency[]).map((v) => ({
  value: v,
  label: FREQUENCY_LABEL[v],
}));
export const PROVIDER_OPTIONS = [
  { value: 'gusto', label: 'Gusto' },
  { value: 'adp', label: 'ADP' },
  { value: 'paychex', label: 'Paychex' },
  { value: 'quickbooks_payroll', label: 'QuickBooks Payroll' },
  { value: 'onpay', label: 'OnPay' },
];

export const CLIENT_STATUS_LABEL: Record<PayrollClientStatus, string> = {
  ON_TRACK: 'On Track',
  PROCESSING: 'Processing',
  ACTION_REQUIRED: 'Action Required',
  PAST_DUE: 'Past Due',
  NOT_STARTED: 'Not Started',
  ON_HOLD: 'On Hold',
  ARCHIVED: 'Archived',
};
export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  NOT_STARTED: 'Not Started',
  DRAFT: 'Draft',
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  APPROVED: 'Approved',
  SUBMITTED: 'Submitted',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  NEEDS_ATTENTION: 'Needs Attention',
};
export const LINE_STATUS_LABEL: Record<PayrollLineStatus, string> = {
  READY: 'Ready',
  WARNING: 'Warning',
  ERROR: 'Error',
  PENDING_CHANGE: 'Pending Change',
  EXCLUDED: 'Excluded',
};
export const WORKER_TYPE_LABEL = {
  FULL_TIME: 'Full-Time',
  PART_TIME: 'Part-Time',
  CONTRACTOR: 'Contractor',
} as const;
export const WORKER_STATUS_LABEL = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On Leave',
  INACTIVE: 'Inactive',
  PENDING_SETUP: 'Pending Setup',
} as const;

/** The chart colour of each client status (the kit's chart tones). */
export const STATUS_TONE = {
  ON_TRACK: 'green',
  PROCESSING: 'yellow',
  ACTION_REQUIRED: 'red',
  PAST_DUE: 'purple',
  NOT_STARTED: 'grey',
  ON_HOLD: 'grey',
  ARCHIVED: 'grey',
} as const;

const CLIENT_LOOK = {
  ON_TRACK: { tone: 'success', icon: CheckCircle },
  PROCESSING: { tone: 'warning', icon: Spinner },
  ACTION_REQUIRED: { tone: 'warning', icon: WarningCircle },
  PAST_DUE: { tone: 'danger', icon: Warning },
  NOT_STARTED: { tone: 'neutral', icon: Clock },
  ON_HOLD: { tone: 'neutral', icon: PauseCircle },
  ARCHIVED: { tone: 'neutral', icon: Prohibit },
} as const;
export function ClientStatusPill({ status }: { status: PayrollClientStatus }) {
  const look = CLIENT_LOOK[status];
  return (
    <span className="whitespace-nowrap">
      <Badge tone={look.tone} icon={look.icon}>
        {CLIENT_STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}

const RUN_LOOK = {
  NOT_STARTED: { tone: 'neutral', icon: Clock },
  DRAFT: { tone: 'neutral', icon: Clock },
  IN_PROGRESS: { tone: 'info', icon: Spinner },
  READY_FOR_REVIEW: { tone: 'warning', icon: Hourglass },
  APPROVED: { tone: 'info', icon: CheckCircle },
  SUBMITTED: { tone: 'info', icon: Spinner },
  PROCESSING: { tone: 'warning', icon: Spinner },
  COMPLETED: { tone: 'success', icon: CheckCircle },
  NEEDS_ATTENTION: { tone: 'danger', icon: Warning },
} as const;
export function RunStatusPill({ status }: { status: PayrollRunStatus }) {
  const look = RUN_LOOK[status];
  return (
    <span className="whitespace-nowrap">
      <Badge tone={look.tone} icon={look.icon}>
        {RUN_STATUS_LABEL[status]}
      </Badge>
    </span>
  );
}

/** "$48,620.00" from cents; "—" when the source has no figure (never estimated). */
export const money = (cents: number | null | undefined, digits = 2) =>
  cents === null || cents === undefined
    ? '—'
    : (cents / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const moneyShort = (cents: number | null | undefined) => money(cents, 0);
export const dollars = (cents: number) => String(Math.round(cents) / 100);
export const toCents = (text: string) => Math.round(Number(text || 0) * 100);

/** "Oct 5, 2026" from a calendar date. */
export const dayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const periodText = (start: string, end: string) => {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const f = (d: Date) =>
    d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return `${f(s)} – ${f(e)}, ${e.getUTCFullYear()}`;
};
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const daysUntil = (date: string) =>
  Math.round(
    (Date.parse(`${date}T12:00:00Z`) - Date.parse(`${todayIso()}T12:00:00Z`)) / 86_400_000,
  );
export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

/** The API's payroll codes, in the firm's words. */
export const PAYROLL_ERRORS: Record<string, string> = {
  ALREADY_PAYROLL_CLIENT: 'This client already has payroll.',
  NO_PAYROLL_SERVICE: 'Add a payroll service to this client first.',
  NOT_A_MEMBER: 'That person is not on your team.',
  CLIENT_NOT_ASSIGNED: 'You are not assigned to that client.',
  PROVIDER_NOT_CONNECTED: 'Connect a payroll provider first.',
  FREQUENCY_REQUIRED: 'Choose how often this client is paid.',
  RUN_EXISTS: 'A run for this period already exists.',
  RUN_STATE: 'This run cannot be changed in its current state.',
  RUN_BLOCKED: 'Resolve the errors before review.',
  RUN_EMPTY: 'The run has no employees.',
  CLIENT_STATE: 'This payroll service cannot be changed in its current state.',
  NOT_THIS_CLIENTS: 'That does not belong to this client.',
  DUPLICATE: 'That already exists.',
  FORBIDDEN: 'Your role cannot do this.',
};

export const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
export const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
export const outlined =
  'inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft disabled:opacity-50';
export const subtle =
  'inline-flex min-h-10 items-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
export const linkBtn = 'inline-flex items-center gap-1 text-sm font-medium text-link';
export const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';

export function Selectbox({
  value,
  onChange,
  options,
  id,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={field}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A tile + title card header, with a "View All →" slot. */
export function CardHead({
  icon: Glyph,
  title,
  aside,
}: {
  icon: typeof Clock;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action"
        >
          <Glyph weight="fill" className="size-5" />
        </span>
        <h2 className="font-display text-base font-bold text-heading">{title}</h2>
      </div>
      {aside}
    </header>
  );
}
