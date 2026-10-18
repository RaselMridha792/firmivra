'use client';

import type { IntakeFormDetail, QuestionType } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import type { ReactNode } from 'react';
import type { FormDraft } from './builder-draft';

export const INTAKE_FORMS = ['intake-forms'];
export const NOT_LOADED = 'Could not load this right now. It fills in once the data is available.';

export type BuilderTab = 'builder' | 'preview' | 'logic';

/** What the builder's cards and the middle column's tab work with. */
export interface BuilderState {
  id: string;
  form: IntakeFormDetail;
  draft: FormDraft;
  update: (change: (d: FormDraft) => FormDraft) => void;
  errors: Record<string, string>;
  /** The section Add Questions adds to. */
  active: string | null;
  setActive: (key: string | null) => void;
  addQuestion: (type: QuestionType, sectionKey?: string) => void;
  addSection: () => void;
}

/**
 * A numbered card of the builder ("1. Form Details"). `className` adds layout classes, such as
 * growing to the bottom of its column (the design's cards end level).
 */
export function BuilderCard({
  title,
  subtitle,
  action,
  testId,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title.replace(/^\d\.\s*/, '')}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-heading">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-text">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A card's frame while the form loads (grey bars) or when it could not load (one quiet line). */
export function CardFrame({
  title,
  loading,
  className,
}: {
  title: string;
  loading: boolean;
  className?: string;
}) {
  return (
    <BuilderCard title={title} className={className}>
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          {['first', 'second', 'third'].map((bar) => (
            <Skeleton key={bar} className="h-10" />
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-canvas p-3 text-sm text-muted">{NOT_LOADED}</p>
      )}
    </BuilderCard>
  );
}
