'use client';

import { ApiRequestError } from '@firmivra/types';
import { Badge, Card, Skeleton } from '@firmivra/ui';
import { CaretLeft, CaretRight, Warning, type Icon } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  AccountStatus,
  AlertState,
  AuditActor,
  EventCategory,
  Outcome,
  Severity,
} from '../../../../../mocks/admin-audit-security';

/** Shared parts of the Audit & Security pages (dashboard, event details, security settings). */

export const SEVERITY_LABELS: Record<Severity, string> = {
  INFO: 'Info',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};
const SEVERITY_TONES = {
  INFO: 'info',
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
} as const;

export function SeverityBadge({ severity, suffix }: { severity: Severity; suffix?: string }) {
  return (
    <Badge tone={SEVERITY_TONES[severity]} icon={severity === 'CRITICAL' ? Warning : undefined}>
      {SEVERITY_LABELS[severity]}
      {suffix ? ` ${suffix}` : ''}
    </Badge>
  );
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  SUCCESS: 'Success',
  FAILURE: 'Failed',
  DENIED: 'Denied',
};
const OUTCOME_TONES = {
  SUCCESS: 'success',
  FAILURE: 'danger',
  DENIED: 'purple',
} as const;

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>;
}

export const ALERT_LABELS: Record<AlertState, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  RESOLVED: 'Resolved',
  DISMISSED: 'Dismissed',
};
const ALERT_TONES = {
  OPEN: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
} as const;

export function AlertBadge({ state }: { state: AlertState }) {
  return <Badge tone={ALERT_TONES[state]}>Alert: {ALERT_LABELS[state]}</Badge>;
}

const ACCOUNT_TONES = { ACTIVE: 'success', LOCKED: 'danger', SUSPENDED: 'danger' } as const;
export function AccountBadge({ status }: { status: AccountStatus }) {
  return (
    <Badge tone={ACCOUNT_TONES[status]}>
      {status === 'ACTIVE' ? 'Active' : status === 'LOCKED' ? 'Locked' : 'Suspended'}
    </Badge>
  );
}

export const ACTOR_TYPE_LABELS: Record<AuditActor['type'], string> = {
  STAFF: 'Firm staff',
  CLIENT: 'Client',
  PLATFORM: 'Firmivra team',
  SERVICE: 'Service account',
  SYSTEM: 'Firmivra system',
  ANONYMOUS: 'Not signed in',
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  AUTHENTICATION: 'Authentication',
  AUTHORIZATION: 'Authorization',
  DATA: 'Data',
  INTEGRATION: 'Integration',
  SECURITY: 'Security',
  SYSTEM: 'System',
};

// Times are stored in UTC and shown in the viewer's own time zone, with the zone named (docx §1).
const zone = (date: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value ?? '';
/** "Oct 14, 2026". */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "09:12 AM". */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
/** "09:12:34 AM (EDT)". */
export const formatClock = (iso: string) => {
  const date = new Date(iso);
  const clock = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${clock} (${zone(date)})`;
};
/** "Oct 14, 2026 09:12:34 AM (EDT)". */
export const formatStamp = (iso: string) => `${formatDate(iso)} ${formatClock(iso)}`;
/** "Oct 14, 2026 09:12 AM", with " (EDT)" when `withZone`. */
export const formatShortStamp = (iso: string, withZone = false) =>
  `${formatDate(iso)} ${formatTime(iso)}${withZone ? ` (${zone(new Date(iso))})` : ''}`;

/** The quiet line a frame shows when its data could not load (never one panel for the page). */
export function loadError(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'NOT_FOUND')
    return "We couldn't find this event. It may not exist, or it is outside your access.";
  if (error instanceof ApiRequestError && error.code === 'FORBIDDEN')
    return "You don't have permission to see this.";
  return 'Could not load this right now. Try again in a moment.';
}

export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-muted">{children}</p>;
}

export function SkeletonLines({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3 py-2">
      {['a', 'b', 'c', 'd', 'e', 'f'].slice(0, rows).map((line) => (
        <Skeleton key={line} />
      ))}
    </div>
  );
}

/** A frame's body in its three states: skeleton, the quiet error line, or the content. */
export function Loaded<T>({
  query,
  rows,
  children,
}: {
  query: UseQueryResult<T>;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <SkeletonLines rows={rows} />;
  if (query.isError) return <QuietLine>{loadError(query.error)}</QuietLine>;
  return <>{children(query.data)}</>;
}

/** A white card with a solid icon and a bold title (the event details designs). */
export function Panel({
  title,
  icon: Glyph,
  action,
  children,
  testId,
  className = '',
}: {
  title: string;
  icon?: Icon;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <Card data-testid={testId} className={`flex min-w-0 flex-col gap-3 p-5!${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-lg font-bold text-heading">
          {Glyph ? <Glyph aria-hidden weight="fill" className="size-6 text-action" /> : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Label and value rows; the label cell on a soft band, a divider between rows. */
export function FactTable({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-divider border-y border-divider text-sm">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-5 sm:grid-cols-3">
          <dt className="col-span-2 bg-subtle px-3 py-2 text-text sm:col-span-1">{row.label}</dt>
          <dd className="col-span-3 min-w-0 px-3 py-2 wrap-anywhere text-heading sm:col-span-2">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const buttonLook = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-border bg-surface text-action hover:bg-canvas',
};
/** A link that looks like the kit's Button (navigation stays a real link). */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  children,
  className = '',
}: {
  href: string;
  variant?: keyof typeof buttonLook;
  /** `sm`: the slimmer button of a table row. */
  size?: 'md' | 'sm';
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-control text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${size === 'sm' ? 'min-h-9 px-5 py-1.5' : 'min-h-11 px-4 py-2'} ${buttonLook[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/** "‹ Audit & Security › Audit Logs › Event Details": the last item is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  const back = items.findLast((item) => item.href)?.href;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {back ? (
        <Link href={back} aria-label="Back" className="rounded-sm text-heading hover:text-action">
          <CaretLeft aria-hidden weight="bold" className="size-4" />
        </Link>
      ) : null}
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            {index ? <CaretRight aria-hidden weight="bold" className="size-3 text-muted" /> : null}
            {item.href ? (
              <Link href={item.href} className="text-text hover:text-action hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-semibold text-heading">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
