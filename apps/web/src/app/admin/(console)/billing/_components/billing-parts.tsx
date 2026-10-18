'use client';

import { ApiRequestError } from '@firmivra/types';
import { Skeleton, Toast, tileTones } from '@firmivra/ui';
import { ArrowDown, ArrowUp, type Icon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type {
  CreditNoteStatus,
  EstimateStatus,
  InvoiceStatus,
  PaymentStatus,
  RecurringStatus,
} from '../../../../../mocks/admin-billing';
import {
  CREDIT_NOTE_STATUS_LABELS,
  ESTIMATE_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RECURRING_STATUS_LABELS,
} from './billing-labels';

/** Cards, badges and quiet states the Billing pages share. */

/** The soft tile colours of the Billing designs (the kit's tiles, plus teal and orange). */
export const BILLING_TONES = {
  ...tileTones,
  teal: 'bg-platform-teal-soft text-platform-teal',
  orange: 'bg-warning-soft text-orange',
} as const;
export type BillingTone = keyof typeof BILLING_TONES;

/** A soft square tile behind a solid icon (KPI cards, Quick Actions). */
export function BillingTile({
  icon: Glyph,
  tone,
  size = 'md',
}: {
  icon: Icon;
  tone: BillingTone;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-2xl ${size === 'md' ? 'size-14' : 'size-12'} ${BILLING_TONES[tone]}`}
    >
      <Glyph weight="fill" className={size === 'md' ? 'size-7' : 'size-6'} />
    </span>
  );
}

/** The quiet line a frame shows when its data could not load (403 says so). */
export function quietErrorText(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'FORBIDDEN')
    return "You don't have permission to see this.";
  return 'Could not load this right now. Try again in a moment.';
}

/** A quiet one-line message inside a frame (empty or failed). */
export function QuietLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="py-4 text-sm text-muted">
      {children}
    </p>
  );
}

/**
 * One summary card: tile, label, value, trend and the note under it. Loading shows a skeleton,
 * `failed` a dash (the frame stays).
 */
export function BillingKpiCard({
  icon,
  tone,
  label,
  value,
  note,
  trend,
  upIsGood = true,
  loading,
  failed,
  testId,
}: {
  icon: Icon;
  tone: BillingTone;
  label: string;
  value: string;
  note?: string;
  /** Percent change against the previous period; null or undefined hides it. */
  trend?: number | null;
  upIsGood?: boolean;
  loading?: boolean;
  failed?: boolean;
  testId?: string;
}) {
  const showTrend = !loading && !failed && trend !== null && trend !== undefined && trend !== 0;
  const up = (trend ?? 0) > 0;
  const good = up === upIsGood;
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className="flex min-w-0 items-center gap-4 rounded-xl bg-surface p-4 shadow-sm 2xl:gap-5 2xl:p-5"
    >
      <BillingTile icon={icon} tone={tone} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm text-muted md:text-base">{label}</p>
        {loading ? (
          <Skeleton className="h-7 w-28" />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              data-testid={testId ? `${testId}-value` : undefined}
              className="text-2xl leading-tight font-bold text-heading"
            >
              {failed ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">Not available right now</span>
                </>
              ) : (
                value
              )}
            </span>
            {showTrend ? (
              <span
                title="Against the previous period"
                className={`inline-flex items-center gap-1 text-sm font-semibold ${good ? 'text-success' : 'text-danger'}`}
              >
                {up ? (
                  <ArrowUp aria-hidden weight="bold" className="size-3.5" />
                ) : (
                  <ArrowDown aria-hidden weight="bold" className="size-3.5" />
                )}
                <span className="sr-only">{up ? 'Up' : 'Down'}</span>
                {Math.abs(trend ?? 0)}%
              </span>
            ) : null}
          </p>
        )}
        {note && !loading && !failed ? (
          <p className="text-sm text-muted md:text-base">{note}</p>
        ) : null}
      </div>
    </section>
  );
}

const BADGE_TONES = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  purple: 'bg-purple-soft text-purple',
  neutral: 'bg-disabled text-muted',
} as const;
export type BadgeTone = keyof typeof BADGE_TONES;

/** The designs' status chip: a rounded rectangle, centred text. */
export function StatusBadge({
  tone,
  children,
  size = 'sm',
}: {
  tone: BadgeTone;
  children: ReactNode;
  /** `lg` next to a page title (Invoice Details). */
  size?: 'sm' | 'lg';
}) {
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap ${size === 'lg' ? 'min-h-10 px-4 text-base' : 'min-w-18 px-3 py-1 text-sm'} ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
  OVERDUE: 'danger',
  VOIDED: 'neutral',
  REFUNDED: 'purple',
  PARTIALLY_REFUNDED: 'purple',
};
export const PAYMENT_STATUS_TONES: Record<PaymentStatus, BadgeTone> = {
  COMPLETED: 'success',
  PENDING: 'warning',
  FAILED: 'danger',
  REFUNDED: 'purple',
  PARTIALLY_REFUNDED: 'purple',
};
export const ESTIMATE_STATUS_TONES: Record<EstimateStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PENDING: 'warning',
  APPROVED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'neutral',
  CONVERTED: 'purple',
};
export const CREDIT_NOTE_STATUS_TONES: Record<CreditNoteStatus, BadgeTone> = {
  DRAFT: 'neutral',
  AVAILABLE: 'info',
  APPLIED: 'success',
  PARTIALLY_APPLIED: 'warning',
  REFUNDED: 'danger',
  VOIDED: 'neutral',
};
export const RECURRING_STATUS_TONES: Record<RecurringStatus, BadgeTone> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  CANCELED: 'danger',
};

/** Invoice status chip. */
export function InvoiceStatusBadge({
  status,
  size,
}: {
  status: InvoiceStatus;
  size?: 'sm' | 'lg';
}) {
  return (
    <StatusBadge tone={INVOICE_STATUS_TONES[status]} size={size}>
      {INVOICE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}
/** Payment status chip. */
export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <StatusBadge tone={PAYMENT_STATUS_TONES[status]}>{PAYMENT_STATUS_LABELS[status]}</StatusBadge>
  );
}
/** Estimate status chip. */
export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  return (
    <StatusBadge tone={ESTIMATE_STATUS_TONES[status]}>{ESTIMATE_STATUS_LABELS[status]}</StatusBadge>
  );
}
/** Credit note status chip. */
export function CreditNoteStatusBadge({ status }: { status: CreditNoteStatus }) {
  return (
    <StatusBadge tone={CREDIT_NOTE_STATUS_TONES[status]}>
      {CREDIT_NOTE_STATUS_LABELS[status]}
    </StatusBadge>
  );
}
/** Recurring schedule status chip. */
export function RecurringStatusBadge({ status }: { status: RecurringStatus }) {
  return (
    <StatusBadge tone={RECURRING_STATUS_TONES[status]}>
      {RECURRING_STATUS_LABELS[status]}
    </StatusBadge>
  );
}

/** A white card with an optional icon title and a link or button on the right. */
export function BillingCard({
  title,
  icon: Glyph,
  iconClassName = 'text-action',
  action,
  children,
  className = '',
  testId,
  titleSize = 'lg',
}: {
  title?: ReactNode;
  icon?: Icon;
  iconClassName?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  titleSize?: 'lg' | 'xl';
}) {
  return (
    <section
      data-testid={testId}
      className={`min-w-0 rounded-xl bg-surface p-5 shadow-sm ${className}`}
    >
      {title ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2
            className={`flex min-w-0 items-center gap-2 font-bold text-heading ${titleSize === 'xl' ? 'text-xl' : 'text-lg'}`}
          >
            {Glyph ? (
              <Glyph aria-hidden weight="fill" className={`size-6 shrink-0 ${iconClassName}`} />
            ) : null}
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A label and value pair in a details list. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-1 text-sm">
      <dt className="col-span-2 text-muted">{label}</dt>
      <dd className="col-span-3 min-w-0 wrap-anywhere text-text">{children}</dd>
    </div>
  );
}

/** A success or error message after an action, pinned to the bottom right. */
export interface Notice {
  tone: 'success' | 'error';
  message: string;
}
/** `[notice, show, clear]` for BillingNotice; a success clears itself after a few seconds. */
export function useNotice(): [Notice | null, (notice: Notice) => void, () => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  const show = (next: Notice) => {
    setNotice(next);
    if (next.tone === 'success')
      window.setTimeout(() => setNotice((now) => (now === next ? null : now)), 5000);
  };
  return [notice, show, () => setNotice(null)];
}
/** Shows the current notice (role status or alert, from the kit's Toast). */
export function BillingNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null;
  onDismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div
      data-testid="billing-notice"
      className="fixed right-4 bottom-4 z-40 max-w-sm md:right-6 md:bottom-6"
    >
      <Toast tone={notice.tone} message={notice.message} onDismiss={onDismiss} />
    </div>
  );
}
