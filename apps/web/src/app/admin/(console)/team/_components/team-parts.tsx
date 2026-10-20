'use client';

import { Badge } from '@firmivra/ui';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import {
  ACCESS_LEVELS,
  type AccessLevel,
  AVAILABILITY,
  type Availability,
  MEMBER_STATUSES,
  type MemberStatus,
} from './team-api';

/** Every Team query key starts here, so one invalidation refreshes the module. */
export const TEAM_KEY = ['admin-team'] as const;

/** The quiet line a frame shows when its call fails (the API cannot be reached). */
export const UNREACHABLE = 'Could not load this right now. Check your connection and try again.';

/** A frame's quiet empty or error line. */
export function QuietLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="px-4 py-6 text-sm text-muted">
      {children}
    </p>
  );
}

type BadgeTone = ComponentProps<typeof Badge>['tone'];

const STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  ACTIVE: 'success',
  PENDING_INVITATION: 'info',
  PENDING_APPROVAL: 'warning',
  SUSPENDED: 'danger',
  INACTIVE: 'neutral',
  DEACTIVATED: 'neutral',
};

export function StatusBadge({ status }: { status: MemberStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{MEMBER_STATUSES[status]}</Badge>;
}

const ACCESS_TONES: Record<AccessLevel, BadgeTone> = {
  SUPER_ADMIN: 'purple',
  ADMIN: 'info',
  STANDARD: 'info',
};

export function AccessBadge({ level }: { level: AccessLevel }) {
  return <Badge tone={ACCESS_TONES[level]}>{ACCESS_LEVELS[level]}</Badge>;
}

/**
 * The job title pill on a member card, tinted by department as in the design: by the
 * department's code on the API (the same in every environment), by its id in the mock.
 */
const DEPARTMENT_TONES: Record<string, BadgeTone> = {
  executive: 'info',
  sales: 'info',
  marketing: 'purple',
  operations: 'success',
  customer: 'warning',
  product: 'danger',
  technology: 'info',
  hr: 'purple',
  finance: 'success',
  compliance: 'neutral',
  security: 'danger',
  it: 'info',
  legal: 'neutral',
  EXECUTIVE: 'info',
  REVENUE_SALES: 'info',
  MARKETING: 'purple',
  OPERATIONS: 'success',
  CUSTOMER_SUCCESS_SUPPORT: 'warning',
  PRODUCT: 'danger',
  TECHNOLOGY_ENGINEERING: 'info',
  HR_PEOPLE: 'purple',
  FINANCE_ACCOUNTING: 'success',
  COMPLIANCE_RISK: 'neutral',
  INFORMATION_SECURITY: 'danger',
  IT_BUSINESS_SYSTEMS: 'info',
  LEGAL: 'neutral',
};

export function TitleBadge({ department, children }: { department: string; children: string }) {
  return <Badge tone={DEPARTMENT_TONES[department] ?? 'info'}>{children}</Badge>;
}

const PRESENCE_DOTS: Record<Availability, string> = {
  ONLINE: 'bg-chart-green',
  IN_MEETING: 'bg-chart-yellow',
  AWAY: 'bg-chart-yellow',
  OFFLINE: 'bg-chart-grey',
};

/**
 * A coloured dot and the presence text; `pill` puts it on a soft chip (member cards). The API
 * stores no presence (null): a quiet line instead, or the last sign-in when `signedInAt` is given
 * (the table's column, which sorts by it).
 */
export function Presence({
  value,
  pill,
  signedInAt,
}: {
  value: Availability | null;
  pill?: boolean;
  signedInAt?: string | null;
}) {
  if (value === null)
    return (
      <span
        className={`inline-flex items-center text-sm text-muted ${pill ? 'rounded-pill bg-canvas px-2.5 py-0.5 text-xs font-medium' : ''}`}
      >
        {signedInAt === undefined
          ? 'Presence unknown'
          : signedInAt
            ? `Signed in ${formatDate(signedInAt)}`
            : 'Never signed in'}
      </span>
    );
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm text-text ${pill ? 'rounded-pill bg-canvas px-2.5 py-0.5 text-xs font-medium' : ''}`}
    >
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${PRESENCE_DOTS[value]}`} />
      {AVAILABILITY[value]}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));

const LINK_VARIANTS = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-canvas',
  outline: 'border border-action bg-surface text-action hover:bg-accent-soft',
};

/** A link that looks like the kit's Button (navigation, not an action). */
export function ButtonLink({
  href,
  variant = 'primary',
  className = '',
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'className'> & {
  variant?: keyof typeof LINK_VARIANTS;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${LINK_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}

/** "62%" of a whole, 0% when there is nothing to count. */
export const percent = (part: number, whole: number) =>
  `${whole > 0 ? Math.round((part / whole) * 100) : 0}%`;

/** "1 team member" / "3 team members". */
export const members = (count: number) => `${count} team member${count === 1 ? '' : 's'}`;
