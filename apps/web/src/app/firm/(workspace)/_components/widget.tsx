'use client';

import { Button, Skeleton } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorMessage } from '../../../../lib/errors';

/** A dashboard card: title, optional "View all" link, and the loading, error and empty states. */
export function Widget<T>({
  title,
  query,
  link,
  empty,
  isEmpty,
  className = '',
  navy = false,
  children,
}: {
  title: string;
  query: UseQueryResult<T>;
  link?: { href: string; label: string };
  /** Shown when `isEmpty(data)`; it says what to do next. */
  empty: string;
  isEmpty: (data: T) => boolean;
  className?: string;
  /** The design's filled navy title bar (Upcoming Appointments). */
  navy?: boolean;
  children: (data: T) => ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid="dashboard-widget"
      className={`flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-5 shadow-md ${className}`}
    >
      <div
        className={`flex items-center justify-between gap-3 ${navy ? '-mx-5 -mt-5 rounded-t-xl bg-navigation px-5 py-3 text-on-action' : 'text-heading'}`}
      >
        <h2 className="text-xl font-bold">{title}</h2>
        {link ? (
          <Link
            href={link.href}
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium ${navy ? '' : 'text-link'}`}
          >
            {link.label}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          <p className="text-danger">{errorMessage(query.error)}</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : isEmpty(query.data) ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        children(query.data)
      )}
    </section>
  );
}
