import type { BookkeepingKpi, BookkeepingStatus } from '@firmivra/types';
import { Badge, type KpiTrend } from '@firmivra/ui';

/** Every query of the Bookkeeping module starts here: a change in one view refreshes the others. */
export const BK_KEY = ['bookkeeping'] as const;

export const STATUS_LABEL: Record<BookkeepingStatus, string> = {
  ON_TRACK: 'On Track',
  NEEDS_ATTENTION: 'Needs Attention',
  MISSING_DOCUMENTS: 'Missing Documents',
  OVERDUE: 'Overdue',
  NOT_STARTED: 'Not Started',
};
const STATUS_TONE: Record<BookkeepingStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ON_TRACK: 'success',
  NEEDS_ATTENTION: 'warning',
  MISSING_DOCUMENTS: 'danger',
  OVERDUE: 'danger',
  NOT_STARTED: 'neutral',
};
export function StatusPill({
  status,
  reason,
}: {
  status: BookkeepingStatus;
  reason?: string | null;
}) {
  return (
    <span title={reason ?? undefined}>
      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
    </span>
  );
}

export const PERIOD_LABEL = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  READY_FOR_REVIEW: 'Ready for Review',
  APPROVED: 'Approved',
  CLOSED: 'Closed',
} as const;
export function PeriodPill({ status }: { status: keyof typeof PERIOD_LABEL }) {
  const tone = {
    NOT_STARTED: 'neutral',
    IN_PROGRESS: 'info',
    READY_FOR_REVIEW: 'warning',
    APPROVED: 'success',
    CLOSED: 'success',
  } as const;
  return <Badge tone={tone[status]}>{PERIOD_LABEL[status]}</Badge>;
}

export const REPORT_LABEL = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  APPROVED: 'Approved',
  DELIVERED: 'Delivered',
} as const;
export function ReportPill({ status }: { status: keyof typeof REPORT_LABEL }) {
  const tone = {
    NOT_STARTED: 'neutral',
    IN_PROGRESS: 'info',
    IN_REVIEW: 'warning',
    APPROVED: 'success',
    DELIVERED: 'success',
  } as const;
  return <Badge tone={tone[status]}>{REPORT_LABEL[status]}</Badge>;
}

export const money = (cents: number | null) =>
  cents === null
    ? '—'
    : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const moneyWhole = (cents: number | null) =>
  cents === null
    ? '—'
    : `${cents < 0 ? '-' : ''}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
export const dayText = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const dateTimeText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The change against the period before, when there is one to compare; `badWhenUp` for costs. */
export const trendOf = (k: BookkeepingKpi, badWhenUp = false): KpiTrend | undefined => {
  if (k.changePercent === null) return undefined;
  const up = k.changePercent > 0;
  return {
    text: `${Math.abs(k.changePercent)}%`,
    direction: k.changePercent === 0 ? 'flat' : up ? 'up' : 'down',
    good: badWhenUp ? !up : up,
  };
};

const PROVIDER_TONE: Record<string, string> = {
  quickbooks: 'bg-chart-green text-on-action',
  xero: 'bg-chart-blue text-on-action',
  freshbooks: 'bg-action text-on-action',
  zoho_books: 'bg-info-soft text-action',
};
/** The accounting software's mark: its initials in its colour (the kit has no brand logos). */
export function SoftwareTile({
  provider,
  label,
  size = 'sm',
}: {
  provider: string | null;
  label: string;
  size?: 'sm' | 'md';
}) {
  const initials =
    provider === 'quickbooks'
      ? 'qb'
      : provider === 'zoho_books'
        ? 'Z'
        : provider === 'freshbooks'
          ? 'F'
          : provider === 'xero'
            ? 'xero'
            : '—';
  return (
    <span
      aria-hidden
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${size === 'md' ? 'size-10 text-sm' : 'size-7 text-[10px]'} ${provider ? (PROVIDER_TONE[provider] ?? 'bg-info-soft text-action') : 'bg-disabled text-muted'}`}
    >
      {initials}
    </span>
  );
}

/** The API's bookkeeping codes, in the firm's words. */
export const BK_ERRORS: Record<string, string> = {
  FORBIDDEN: 'Your role cannot do this.',
  NOT_FOUND: 'That could not be found.',
  ALREADY_BOOKKEEPING_CLIENT: 'This client already has bookkeeping.',
  NO_BOOKKEEPING_SERVICE: 'This client has no Bookkeeping service.',
  CLIENT_STATE: 'This client is not in the right state for that.',
  NOT_A_MEMBER: 'That person is not on your team.',
  CLIENT_NOT_ASSIGNED: 'That client is not assigned to you.',
  NOT_CONNECTED: 'No accounting software is connected for this client.',
  CONNECTION_EXISTS: 'This client is already connected to that software.',
  COMPANY_ALREADY_CONNECTED: 'That company is connected to another client.',
  DUPLICATE: 'That already exists.',
  PERIOD_STATE: 'The period is not in the right state for that.',
  PERIOD_LOCKED: 'This period is closed. Reopen it to change it.',
  CLOSE_ITEMS_OPEN: 'Finish the required checklist steps first.',
  RECON_STATE: 'The reconciliation is not in the right state for that.',
  RECON_DIFFERENCE: 'The difference is outside the tolerance.',
  REPORT_STATE: 'The report is not in the right state for that.',
  REPORT_NOT_PUBLISHED: 'Publish the report first.',
  NOT_THIS_CLIENTS: 'That belongs to another client.',
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
