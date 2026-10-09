'use client';

import { ApiRequestError, type FirmApplicationReviewStatus } from '@firmivra/types';
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
      className={`inline-flex whitespace-nowrap rounded-pill px-3 py-1 text-sm font-medium ${statusTones[status]}`}
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
