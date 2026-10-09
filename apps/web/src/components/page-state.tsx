'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { errorMessage } from '../lib/errors';

interface PageStateProps<T> {
  /** The result of useApiQuery. */
  query: UseQueryResult<T>;
  /** Shown when there's nothing to list, for example "No tax statuses yet". */
  empty?: string;
  /** When the data counts as empty. Default: an empty array. */
  isEmpty?: (data: T) => boolean;
  /** The screen itself, once the data is there. */
  children: (data: T) => ReactNode;
}

const code = (error: unknown) => (error instanceof ApiRequestError ? error.code : undefined);

function Loading() {
  return (
    <Card data-testid="page-loading" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-4 animate-pulse rounded-control bg-border" />
      ))}
    </Card>
  );
}

/** A firm still in Pending Setup goes to the setup wizard (BUSINESS_SETUP_REQUIRED). */
function ToSetup() {
  const router = useRouter();
  useEffect(() => router.replace('/setup'), [router]);
  return <Loading />;
}

/** An in-person signing locked this staff session (KIOSK_LOCKED): only the kiosk opens. */
function ToKiosk() {
  const router = useRouter();
  useEffect(() => router.replace('/firm-sign/in-person'), [router]);
  return <Loading />;
}

/**
 * The states every screen needs, in one place: loading, empty, error (with Try again), and by
 * error code: FORBIDDEN is "no permission", NOT_FOUND "not found", BUSINESS_INACTIVE its own
 * notice, BUSINESS_SETUP_REQUIRED opens /setup, KIOSK_LOCKED the in-person kiosk. Wrap each
 * useApiQuery result:
 *   <PageState query={statuses} empty="No tax statuses yet">{(rows) => <Table rows={rows} />}</PageState>
 */
export function PageState<T>({
  query,
  empty,
  isEmpty = (data) => Array.isArray(data) && data.length === 0,
  children,
}: PageStateProps<T>) {
  if (query.isPending) return <Loading />;

  // No data yet and an error: show the error. (A failed background refetch keeps the data.)
  if (query.isError && query.data === undefined) {
    const errorCode = code(query.error);
    if (errorCode === 'BUSINESS_SETUP_REQUIRED') return <ToSetup />;
    if (errorCode === 'KIOSK_LOCKED') return <ToKiosk />;
    if (errorCode === 'FORBIDDEN') {
      return (
        <Card data-testid="page-forbidden">
          <p className="font-medium text-text">You don&apos;t have permission to see this.</p>
          <p className="mt-1 text-sm text-muted">Ask your firm&apos;s owner if you need access.</p>
        </Card>
      );
    }
    if (errorCode === 'NOT_FOUND') {
      return (
        <Card data-testid="page-not-found">
          <p className="font-medium text-text">We couldn&apos;t find this.</p>
          <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
        </Card>
      );
    }
    if (errorCode === 'BUSINESS_INACTIVE') {
      return (
        <Card data-testid="page-inactive">
          <p className="font-medium text-text">{errorMessage(query.error)}</p>
        </Card>
      );
    }
    return (
      <Card data-testid="page-error" role="alert" className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{errorMessage(query.error)}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </Card>
    );
  }

  const data = query.data as T;
  const stale = query.isError ? (
    <p data-testid="page-stale" role="status" className="mb-3 text-sm text-muted">
      This may be out of date: {errorMessage(query.error)}
    </p>
  ) : null;

  if (empty !== undefined && isEmpty(data)) {
    return (
      <>
        {stale}
        <Card data-testid="page-empty">
          <p className="text-sm text-muted">{empty}</p>
        </Card>
      </>
    );
  }

  return (
    <>
      {stale}
      {children(data)}
    </>
  );
}
