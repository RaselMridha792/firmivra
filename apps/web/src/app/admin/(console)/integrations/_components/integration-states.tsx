'use client';

import { ApiRequestError } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { errorMessage } from '../../../../../lib/errors';

/**
 * The three states every Integrations frame keeps (design-match rule 2): a skeleton while
 * loading, a quiet line when the data could not load (never one error panel for the page), and
 * the content. KPIs show "—" when their number is unavailable.
 */

/** The quiet line a frame shows when its data could not load. */
export function loadError(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === 'NOT_FOUND')
    return "We couldn't find this. It may have been removed, or it is outside your access.";
  if (error instanceof ApiRequestError && error.code === 'FORBIDDEN')
    return "You don't have permission to see this.";
  return 'Could not load this right now. Try again in a moment.';
}

/** Texts for the module's own error codes (mocks/admin-integrations.ts INTEGRATION_ERRORS). */
export const INTEGRATION_ERROR_TEXTS: Record<string, string> = {
  CONFLICT: 'Someone else changed this. Reload to see the latest version, then try again.',
  DUPLICATE_CONNECTION: 'This provider already has a connection in that environment.',
  TEST_REQUIRED: 'Run a passing connection test before activating.',
  CREDENTIALS_REQUIRED: 'Enter every required connection field first.',
  CONFIRMATION_REQUIRED: 'Confirm this change to continue.',
  ACCESS_LOSS: 'This change removes access for firms that are connected. Confirm to save it.',
  INVALID_STATE: "This can't be done in the integration's current state.",
};
/** `errorMessage` with the module's codes: use it for every failed change on these pages. */
export const integrationErrorMessage = (error: unknown) =>
  errorMessage(error, INTEGRATION_ERROR_TEXTS);

/** A quiet one-line note inside a frame: empty, failed or not applicable. */
export function QuietLine({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`py-3 text-sm text-muted ${className}`}>{children}</p>;
}

/** Skeleton lines inside a frame while it loads. */
export function SkeletonLines({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3 py-2">
      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].slice(0, rows).map((line) => (
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

/** "—" for a number that could not load, named for screen readers. */
export function Unavailable() {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">Not available right now</span>
    </>
  );
}
