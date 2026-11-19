'use client';

import {
  Archive,
  ArrowCounterClockwise,
  CalendarBlank,
  ChartBar,
  Copy,
  Eye,
  LinkSimple,
  PaperPlaneTilt,
  PencilSimple,
  User,
} from '@phosphor-icons/react';
import type { IntakeFormListItem } from '@firmivra/types';
import { Avatar, Badge, Button, Card, Skeleton } from '@firmivra/ui';
import { CategoryChip, CategoryTile, shortDate, shortName } from './template-look';
import { TemplateMenu } from './template-menu';

export interface TemplateActions {
  onPreview: (template: IntakeFormListItem) => void;
  onEdit: (template: IntakeFormListItem) => void;
  onUse: (template: IntakeFormListItem) => void;
  onDuplicate: (template: IntakeFormListItem) => void;
  onArchive: (template: IntakeFormListItem) => void;
  /** Intake Review 2 24c-i: an archived one back in the library, as a draft (Owner and Admin). */
  onRestore: (template: IntakeFormListItem) => void;
  /** Form Link: the main form's public link and embed code (I3). */
  onLink: (template: IntakeFormListItem) => void;
  /** A duplicate or archive is on its way: those two wait. */
  busy?: boolean;
}

// The card's three buttons are smaller than the kit's default button (design: about 30 px high).
const small = 'min-h-8! gap-1! px-2! py-1! text-xs! whitespace-nowrap';

/** A draft is sent only once it is published (the API answers FORM_NOT_PUBLISHED). */
const PUBLISH_FIRST = 'Publish this template before sending it: open Edit, then Publish.';

/**
 * One template card of form-templates-dashboard.jpg: the category's round tile, name, question
 * count, category chip (and Draft, for a template not yet published) and the "⋮" menu; the
 * description; Last updated, Used (forms sent with it, not copies) and the owner; then Preview,
 * Edit and Use Template.
 */
export function TemplateCard({
  template,
  actions,
}: {
  template: IntakeFormListItem;
  actions: TemplateActions;
}) {
  const { onPreview, onEdit, onUse, onDuplicate, onArchive, onRestore, onLink, busy } = actions;
  const draft = template.status === 'DRAFT';
  // 24c-i: an archived one can be previewed and restored, nothing else.
  const archived = template.archived;
  return (
    <Card
      variant="elevated"
      className="flex h-full min-w-0 flex-col p-3!"
      data-testid="template-card"
    >
      <div className="flex items-start gap-3">
        <CategoryTile category={template.category} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <h3 className="text-sm font-bold break-words text-heading">{template.name}</h3>
          <p className="text-sm text-muted">
            {template.questionCount} {template.questionCount === 1 ? 'question' : 'questions'}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <CategoryChip category={template.category} />
            {archived ? (
              <Badge tone="neutral">Archived</Badge>
            ) : draft ? (
              <Badge tone="warning">Draft</Badge>
            ) : null}
          </div>
        </div>
        <TemplateMenu
          label={`Actions for ${template.name}`}
          items={
            archived
              ? [
                  { label: 'Preview', icon: Eye, onSelect: () => onPreview(template) },
                  {
                    label: 'Restore',
                    icon: ArrowCounterClockwise,
                    onSelect: () => onRestore(template),
                    disabled: busy,
                  },
                ]
              : [
                  { label: 'Preview', icon: Eye, onSelect: () => onPreview(template) },
                  { label: 'Edit', icon: PencilSimple, onSelect: () => onEdit(template) },
                  {
                    label: 'Duplicate',
                    icon: Copy,
                    onSelect: () => onDuplicate(template),
                    disabled: busy,
                  },
                  {
                    label: 'Send to a client',
                    icon: PaperPlaneTilt,
                    onSelect: () => onUse(template),
                    disabled: draft,
                  },
                  { label: 'Share & Publish', icon: LinkSimple, onSelect: () => onLink(template) },
                  {
                    label: 'Archive',
                    icon: Archive,
                    onSelect: () => onArchive(template),
                    danger: true,
                    disabled: busy,
                  },
                ]
          }
        />
      </div>

      <p className="mt-3 line-clamp-3 text-sm text-text">
        {template.description ?? <span className="text-muted">No description yet.</span>}
      </p>

      <dl className="mt-auto flex flex-col gap-1.5 border-t border-divider pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2 text-muted">
            <CalendarBlank aria-hidden weight="fill" className="size-4" />
            Last updated
          </dt>
          <dd className="text-sm text-text">{shortDate(template.updatedAt)}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2 text-muted">
            <ChartBar aria-hidden weight="fill" className="size-4" />
            Used
          </dt>
          <dd className="text-sm text-text">
            {template.usageCount} {template.usageCount === 1 ? 'time' : 'times'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center text-muted">
            <User aria-hidden weight="fill" className="size-4" />
            <span className="sr-only">Owner</span>
          </dt>
          <dd className="flex min-w-0 items-center gap-2 text-sm text-text">
            {template.owner ? (
              <>
                <Avatar name={template.owner.name} size="sm" />
                <span className="truncate" title={template.owner.name}>
                  {shortName(template.owner.name)}
                </span>
              </>
            ) : (
              <span className="text-muted">No owner</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button variant="secondary" className={small} onClick={() => onPreview(template)}>
          <Eye aria-hidden weight="fill" className="size-4 text-action" />
          Preview
        </Button>
        {archived ? (
          <Button className={`${small} grow`} disabled={busy} onClick={() => onRestore(template)}>
            <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
            Restore
          </Button>
        ) : null}
        {archived ? null : (
          <>
            <Button variant="secondary" className={small} onClick={() => onEdit(template)}>
              <PencilSimple aria-hidden weight="fill" className="size-4 text-action" />
              Edit
            </Button>
            <Button
              className={`${small} grow`}
              disabled={draft}
              title={draft ? PUBLISH_FIRST : undefined}
              onClick={() => onUse(template)}
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
              Use Template
            </Button>
          </>
        )}
      </div>
      {draft && !archived ? <p className="mt-2 text-xs text-muted">{PUBLISH_FIRST}</p> : null}
    </Card>
  );
}

/** A card's shape while the library loads. */
export function TemplateCardSkeleton() {
  return (
    <Card variant="elevated" className="flex flex-col gap-3 p-3!">
      <div className="flex items-start gap-3">
        <Skeleton className="size-12! rounded-full!" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="w-3/4" />
          <Skeleton className="w-1/3" />
          <Skeleton className="h-5! w-1/2" />
        </div>
      </div>
      <Skeleton className="h-12!" />
      <div className="flex flex-col gap-2 border-t border-divider pt-3">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <Skeleton className="h-8!" />
    </Card>
  );
}
