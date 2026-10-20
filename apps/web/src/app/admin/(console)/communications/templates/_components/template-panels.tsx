import { Badge, Button, Card } from '@firmivra/ui';
import {
  ChatCircleDots,
  Copy,
  EnvelopeSimple,
  Eye,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { AdminCommTemplate } from '@firmivra/types';

/** A template as the library's table and panels show it. */
export interface TemplateRow {
  id: string;
  name: string;
  excerpt: string;
  category: string;
  channel: 'EMAIL' | 'SMS';
  status: 'Active' | 'Inactive' | 'Archived';
  updatedAt: string;
  createdAt: string;
  createdBy: string;
  subject: string;
  body: string;
  mergeFields: string[];
}
const statusLabels = { ACTIVE: 'Active', INACTIVE: 'Inactive', ARCHIVED: 'Archived' } as const;
export const rowOf = (t: AdminCommTemplate): TemplateRow => ({
  id: t.id,
  name: t.name,
  excerpt: t.body.replace(/\s+/g, ' ').slice(0, 120),
  category: t.category.name,
  channel: t.channel,
  status: statusLabels[t.status],
  updatedAt: t.updatedAt,
  createdAt: t.createdAt,
  createdBy: t.createdBy?.name ?? 'Firmivra',
  subject: t.subject ?? '',
  body: t.body,
  mergeFields: t.mergeFields.map((field) => `{{${field}}}`),
});

/** The six shipped categories have their colour; a category the team adds is neutral. */
const categoryTones: Record<
  string,
  'success' | 'info' | 'warning' | 'purple' | 'danger' | 'neutral'
> = {
  Sales: 'success',
  Onboarding: 'info',
  Support: 'warning',
  Billing: 'purple',
  'Firm Applications': 'danger',
  'System Notices': 'neutral',
};
export const softAction = 'border-transparent! bg-info-soft! text-link! hover:bg-folder-hover!';
export const templateDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex whitespace-nowrap [&>span]:rounded-control [&>span]:px-2 [&>span]:py-1 [&>span]:font-normal">
      <Badge tone={categoryTones[category] ?? 'neutral'}>{category}</Badge>
    </span>
  );
}

export function TemplateChannel({ channel }: { channel: TemplateRow['channel'] }) {
  const ChannelIcon = channel === 'EMAIL' ? EnvelopeSimple : ChatCircleDots;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <ChannelIcon aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
      {channel === 'EMAIL' ? 'Email' : 'SMS'}
    </span>
  );
}

export function TemplateMessage({ template }: { template: TemplateRow | null }) {
  return (
    <div className="min-h-56 rounded-control bg-canvas/60 text-sm leading-relaxed text-heading">
      {template?.channel === 'EMAIL' && (
        <p className="rounded-t-control bg-table-head px-3 py-2">
          <span className="font-semibold">Subject: </span>
          <span className="text-muted">{template.subject}</span>
        </p>
      )}
      <p className="whitespace-pre-wrap break-words px-3 py-3">
        {template?.body ?? 'Select a template to preview its message.'}
      </p>
    </div>
  );
}

interface TemplatePanelsProps {
  template: TemplateRow | null;
  onEdit: () => void;
  onPreview: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}
export function TemplatePanels({
  template,
  onEdit,
  onPreview,
  onDuplicate,
  onArchive,
}: TemplatePanelsProps) {
  const [copyNotice, setCopyNotice] = useState('');
  async function copyFields() {
    if (!template) return;
    try {
      await navigator.clipboard.writeText(template.mergeFields.join(' '));
      setCopyNotice('Merge fields copied.');
    } catch {
      setCopyNotice('Unable to copy. Select and copy the merge fields below.');
    }
  }
  return (
    <aside
      aria-label="Selected template"
      className="grid min-w-0 items-start gap-3 lg:grid-cols-2 xl:grid-cols-1"
    >
      <Card className="min-w-0 p-4! shadow-none!">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-heading">Template Details</h2>
          <Button
            variant="secondary"
            disabled={!template}
            onClick={onEdit}
            className="min-h-8! gap-1! px-2! py-1! text-xs!"
          >
            <PencilSimple aria-hidden weight="fill" className="size-3.5" />
            Edit
          </Button>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="font-display text-lg font-bold text-heading">
            {template?.name ?? 'No template selected'}
          </h3>
          {template && (
            <Badge tone={template.status === 'Active' ? 'success' : 'neutral'}>
              {template.status}
            </Badge>
          )}
        </div>
        <dl className="grid grid-cols-3 items-center gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Category</dt>
          <dd className="col-span-2 min-w-0">
            {template ? <CategoryBadge category={template.category} /> : '—'}
          </dd>
          <dt className="text-muted">Channel</dt>
          <dd className="col-span-2">
            {template ? <TemplateChannel channel={template.channel} /> : '—'}
          </dd>
          <dt className="text-muted">Created By</dt>
          <dd className="col-span-2 break-words">{template?.createdBy ?? '—'}</dd>
          <dt className="text-muted">Created On</dt>
          <dd className="col-span-2">{template ? templateDate(template.createdAt) : '—'}</dd>
          <dt className="text-muted">Last Updated</dt>
          <dd className="col-span-2">{template ? templateDate(template.updatedAt) : '—'}</dd>
        </dl>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-divider pt-3">
          <Button
            variant="secondary"
            className={`${softAction} min-h-9! gap-1! px-1! text-xs!`}
            disabled={!template}
            onClick={onPreview}
          >
            <Eye aria-hidden weight="fill" className="size-4" />
            Preview
          </Button>
          <Button
            variant="secondary"
            className={`${softAction} min-h-9! gap-1! px-1! text-xs!`}
            disabled={!template}
            onClick={onDuplicate}
          >
            <Copy aria-hidden weight="fill" className="size-4" />
            Duplicate
          </Button>
          <Button
            variant="secondary"
            className="min-h-9! gap-1! border-transparent! bg-danger-soft! px-1! text-xs! text-danger!"
            disabled={!template || template.status === 'Archived'}
            onClick={onArchive}
          >
            <Trash aria-hidden weight="fill" className="size-4" />
            Archive
          </Button>
        </div>
      </Card>
      <Card className="min-w-0 p-4! shadow-none!">
        <h2 className="mb-3 font-display text-lg font-bold text-heading">Message Preview</h2>
        <TemplateMessage template={template} />
        <div className="mt-4 border-t border-divider pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-heading">Merge Fields</h3>
            <Button
              variant="secondary"
              className={`${softAction} min-h-7! gap-1! px-2! py-1! text-xs!`}
              onClick={() => void copyFields()}
              disabled={!template}
            >
              <Copy aria-hidden weight="fill" className="size-3" />
              Copy
            </Button>
          </div>
          <div className="flex min-h-16 flex-wrap content-start gap-2">
            {template?.mergeFields.map((field) => (
              <span
                key={field}
                className="rounded-control bg-canvas px-2 py-1 text-xs text-heading"
              >
                {field}
              </span>
            ))}
            {!template && <p className="text-sm text-muted">No merge fields to display.</p>}
          </div>
          <p role="status" className="mt-2 text-xs text-muted empty:hidden">
            {copyNotice}
          </p>
        </div>
      </Card>
    </aside>
  );
}
