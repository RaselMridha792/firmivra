'use client';

import { ArrowRight, Lightbulb } from '@phosphor-icons/react';
import {
  FORM_CATEGORY_LABELS,
  type FormCategory,
  type IntakeFormLibrarySummary,
  type IntakeFormListItem,
} from '@firmivra/types';
import { Callout, Card, Skeleton } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { CATEGORY_ORDER, CategoryTile, LoadFailed, Quiet, usedAgo } from './template-look';

const SHOWN_CATEGORIES = 6;
const SHOWN_RECENT = 3;

/** A side frame: bold title, "View All" (or "Show Less") on the right, rows under it. */
function SideFrame({
  title,
  testId,
  toggle,
  children,
}: {
  title: string;
  testId: string;
  toggle?: { expanded: boolean; onToggle: () => void };
  children: ReactNode;
}) {
  return (
    <Card variant="elevated" className="p-4!" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-heading">{title}</h2>
        {toggle ? (
          <button
            type="button"
            aria-expanded={toggle.expanded}
            onClick={toggle.onToggle}
            className="text-sm font-medium text-link underline hover:text-action-hover"
          >
            {toggle.expanded ? 'Show Less' : 'View All'}
          </button>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

function RowsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 py-1">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-9! rounded-lg!" />
          <Skeleton className="flex-1" />
        </div>
      ))}
    </div>
  );
}

/**
 * Template Categories: the categories with live counts from the library summary. Selecting one
 * filters the library; View All lists every category, including those with no templates yet.
 */
export function TemplateCategories({
  summary,
  selected,
  onSelect,
}: {
  summary: UseQueryResult<IntakeFormLibrarySummary>;
  selected: FormCategory | null;
  onSelect: (category: FormCategory) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const counts = new Map<FormCategory, number>(
    summary.data?.byCategory.map((row): [FormCategory, number] => [row.category, row.count]),
  );
  const used = CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0);
  const rows = expanded ? CATEGORY_ORDER : used.slice(0, SHOWN_CATEGORIES);
  return (
    <SideFrame
      title="Template Categories"
      testId="template-categories"
      toggle={summary.data ? { expanded, onToggle: () => setExpanded((open) => !open) } : undefined}
    >
      {summary.isPending ? (
        <RowsLoading />
      ) : summary.isError && !summary.data ? (
        <LoadFailed error={summary.error} onRetry={() => void summary.refetch()} />
      ) : rows.length === 0 ? (
        <Quiet>No templates in any category yet.</Quiet>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {rows.map((category) => (
            <li key={category}>
              <button
                type="button"
                aria-pressed={selected === category}
                onClick={() => onSelect(category)}
                className={`flex w-full items-center gap-3 rounded-md py-1.5 text-left text-sm hover:bg-canvas ${selected === category ? 'font-semibold text-action' : 'text-heading'}`}
              >
                <CategoryTile category={category} shape="square" />
                <span className="min-w-0 flex-1 truncate">{FORM_CATEGORY_LABELS[category]}</span>
                <span className="inline-flex min-w-7 items-center justify-center rounded-md border border-divider px-1.5 py-0.5 text-xs font-semibold text-heading">
                  {counts.get(category) ?? 0}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SideFrame>
  );
}

/**
 * Recently Used: templates by their last use, with "Used 3 days ago". A row opens the preview;
 * View All lists every used template.
 */
export function RecentlyUsed({
  recent,
  onOpen,
}: {
  recent: UseQueryResult<IntakeFormListItem[]>;
  onOpen: (template: IntakeFormListItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Read once: the relative dates are for this visit (render stays pure).
  const [now] = useState(() => Date.now());
  const used = (recent.data ?? []).filter(
    (template): template is IntakeFormListItem & { lastUsedAt: string } =>
      template.lastUsedAt !== null && template.status !== 'RETIRED',
  );
  const rows = expanded ? used : used.slice(0, SHOWN_RECENT);
  return (
    <SideFrame
      title="Recently Used"
      testId="recently-used"
      toggle={
        used.length > SHOWN_RECENT
          ? { expanded, onToggle: () => setExpanded((open) => !open) }
          : undefined
      }
    >
      {recent.isPending ? (
        <RowsLoading />
      ) : recent.isError && !recent.data ? (
        <LoadFailed error={recent.error} onRetry={() => void recent.refetch()} />
      ) : rows.length === 0 ? (
        <Quiet>No template has been used yet.</Quiet>
      ) : (
        <ul className="flex flex-col divide-y divide-divider">
          {rows.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => onOpen(template)}
                className="flex w-full items-center gap-3 rounded-md py-2 text-left hover:bg-canvas"
              >
                <CategoryTile category={template.category} shape="square" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-heading">{template.name}</span>
                  <span className="block text-xs text-muted">
                    {usedAgo(template.lastUsedAt, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SideFrame>
  );
}

/** Pro Tip, with the way back to the Intake Forms dashboard. */
export function TemplatesProTip() {
  return (
    <Callout
      icon={Lightbulb}
      title="Pro Tip:"
      titleStyle="tip"
      surface="info"
      action={
        <Link href="/intake-forms" className="text-sm font-medium text-link underline">
          Go to Intake Forms <ArrowRight aria-hidden weight="bold" className="inline size-4" />
        </Link>
      }
    >
      Standardize your client onboarding process with templates to save time, ensure consistency,
      and capture all necessary information.
    </Callout>
  );
}
