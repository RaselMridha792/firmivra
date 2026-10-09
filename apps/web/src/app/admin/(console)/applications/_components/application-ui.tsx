'use client';

import {
  ApiRequestError,
  type FirmApplicationCounts,
  type FirmApplicationReviewStatus,
} from '@firmivra/types';
import { CheckCircle2, FileText, Users, XCircle } from 'lucide-react';
import { Card } from '@firmivra/ui';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { PageState } from '../../../../../components/page-state';

const dateOptions: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
};

export const dateText = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    ...dateOptions,
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

export const dateParts = (value: string) => {
  const date = new Date(value);
  return [
    new Intl.DateTimeFormat('en-US', dateOptions).format(date),
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
  ];
};

const statusNames: Record<FirmApplicationReviewStatus, string> = {
  PENDING_REVIEW: 'Pending Review',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

const statusTones: Record<FirmApplicationReviewStatus, string> = {
  PENDING_REVIEW: 'bg-warning-soft text-warning',
  APPROVED: 'bg-success-soft text-success',
  DECLINED: 'bg-danger-soft text-danger',
};

export function StatusPill({ status }: { status: FirmApplicationReviewStatus }) {
  return (
    <span
      data-testid="application-status"
      className={`inline-flex rounded-pill px-3 py-1 text-sm font-medium ${statusTones[status]}`}
    >
      {statusNames[status]}
    </span>
  );
}

export function ApplicationPageState<T>({
  query,
  empty,
  isEmpty,
  children,
}: {
  query: UseQueryResult<T>;
  empty?: string;
  isEmpty?: (value: T) => boolean;
  children: (value: T) => ReactNode;
}) {
  if (query.isError && query.error instanceof ApiRequestError && query.error.code === 'FORBIDDEN') {
    return (
      <Card data-testid="page-forbidden">
        <p className="font-medium text-text">You do not have permission to review applications.</p>
        <p className="mt-1 text-sm text-muted">Sign in with a Super Admin account to continue.</p>
      </Card>
    );
  }
  return (
    <PageState query={query} empty={empty} isEmpty={isEmpty}>
      {children}
    </PageState>
  );
}

export function NoApplicationPermission() {
  return (
    <Card data-testid="page-forbidden">
      <p className="font-medium text-text">You do not have permission to review applications.</p>
      <p className="mt-1 text-sm text-muted">Sign in with a Super Admin account to continue.</p>
    </Card>
  );
}

export function MetricCards({ counts }: { counts: FirmApplicationCounts }) {
  const metrics = [
    ['Pending Review', counts.pendingReview, FileText, 'text-brand-700 bg-brand-50'],
    ['Approved This Month', counts.approvedThisMonth, CheckCircle2, 'text-success bg-success/10'],
    ['Declined This Month', counts.declinedThisMonth, XCircle, 'text-danger bg-danger/10'],
    ['Total Applications', counts.all, Users, 'text-accent-600 bg-accent-500/10'],
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, count, Icon, tone]) => (
        <Card key={label} className="flex items-center gap-4">
          <span
            className={`flex size-14 shrink-0 items-center justify-center rounded-card ${tone}`}
          >
            <Icon aria-hidden className="size-7" />
          </span>
          <div>
            <p className="text-2xl font-semibold text-text">{count}</p>
            <p className="text-sm text-muted">{label}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
