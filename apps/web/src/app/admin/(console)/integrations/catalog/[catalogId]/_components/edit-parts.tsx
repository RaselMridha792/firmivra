'use client';

import { Card } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { loadError, QuietLine, SkeletonLines } from '../../../_components/integration-states';

/**
 * Parts of the catalog edit page (stripe-integration-admin-dashboard-1.jpg): the white form card
 * with its bold title, a labelled field with the red asterisk, its help or error line and a
 * character count (all tied to the control for screen readers), and the frame a tab keeps while
 * the entry loads or could not load.
 */

/** The text inputs' look, as the kit's Input draws it. */
export const controlClass = (error?: string) =>
  `w-full min-w-0 rounded-control border bg-surface px-3 py-2 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:cursor-not-allowed disabled:bg-disabled ${error ? 'border-danger' : 'border-border'}`;

/** The ids a control points at with aria-describedby (its help or error line). */
export const helpId = (id: string) => `${id}-help`;

export function Field({
  id,
  label,
  required,
  hint,
  error,
  counter,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  /** "45/250". */
  counter?: string;
  children: ReactNode;
}) {
  const line = error ?? hint;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-heading">
        {label}
        {required ? (
          <span aria-hidden className="text-danger">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {line || counter ? (
        <div className="flex justify-between gap-3 text-xs">
          <p id={helpId(id)} className={error ? 'text-danger' : 'text-muted'}>
            {line}
          </p>
          {counter ? <p className="shrink-0 text-muted tabular-nums">{counter}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The form card: bold title, one line under it, then the fields. */
export function EditCard({
  title,
  subtitle,
  action,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} className="flex min-w-0 flex-col gap-5 p-6!">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-text">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A tab's card while the entry loads (skeleton) or could not load (the quiet line). */
export function TabFallback<T>({ title, query }: { title: string; query: UseQueryResult<T> }) {
  return (
    <EditCard title={title}>
      {query.isError ? <QuietLine>{loadError(query.error)}</QuietLine> : <SkeletonLines rows={5} />}
    </EditCard>
  );
}
