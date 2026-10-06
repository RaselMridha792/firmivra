'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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

const box = 'rounded-card border border-border bg-surface p-6 text-sm';

/**
 * The four states every screen needs, in one place: loading, empty, error (with Retry), and
 * "no permission" / "not found" when the API answers 403 / 404. Wrap each useApiQuery result:
 *   <PageState query={statuses} empty="No tax statuses yet">{(rows) => <Table rows={rows} />}</PageState>
 */
export function PageState<T>({
  query,
  empty,
  isEmpty = (data) => Array.isArray(data) && data.length === 0,
  children,
}: PageStateProps<T>) {
  if (query.isPending) {
    return (
      <div data-testid="page-loading" aria-busy="true" className={`${box} flex flex-col gap-3`}>
        <span className="sr-only">Loading…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-4 animate-pulse rounded-control bg-border" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    const status = query.error instanceof ApiRequestError ? query.error.status : undefined;
    if (status === 403) {
      return (
        <div data-testid="page-forbidden" className={box}>
          <p className="font-medium text-text">You don&apos;t have permission to see this.</p>
          <p className="mt-1 text-muted">Ask your firm&apos;s owner if you need access.</p>
        </div>
      );
    }
    if (status === 404) {
      return (
        <div data-testid="page-not-found" className={box}>
          <p className="font-medium text-text">We couldn&apos;t find this.</p>
          <p className="mt-1 text-muted">It may have been removed, or the link is wrong.</p>
        </div>
      );
    }
    return (
      <div
        data-testid="page-error"
        role="alert"
        className={`${box} flex flex-col items-start gap-3`}
      >
        <p className="text-danger">{errorMessage(query.error)}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (empty !== undefined && isEmpty(query.data)) {
    return (
      <div data-testid="page-empty" className={`${box} text-muted`}>
        {empty}
      </div>
    );
  }

  return <>{children(query.data)}</>;
}
