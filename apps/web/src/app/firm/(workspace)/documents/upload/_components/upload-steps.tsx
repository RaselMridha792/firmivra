'use client';

import {
  uploadContentTypeFor,
  type DocumentCategory,
  type DocumentFolder,
  type Engagement,
  type TeamMember,
} from '@firmivra/types';
import { Badge, Input, Select, Toggle } from '@firmivra/ui';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { FileIcon } from '../../_components/file-icon';
import { folderOptions } from './document-info';
import { savedName, sizeText, type QueuedFile, type SharedInfo } from './upload-state';

const YEARS = Array.from({ length: 8 }, (_, n) => String(new Date().getFullYear() - n));

export const engagementLabel = (e: Engagement) =>
  `${e.service.name}${e.taxYear ? ` ${e.taxYear}` : ''}${e.title && e.title !== e.service.name ? `: ${e.title}` : ''}`;

/**
 * Document Details: each file's own name, type, service and period (docx Frame 1: a tax return and
 * a spreadsheet are not classified as one). The service is the client's open engagement.
 */
export function DetailsStep({
  files,
  onChange,
  categories,
  engagements,
  engagementsState,
  errors,
}: {
  files: QueuedFile[];
  onChange: (key: string, next: Partial<QueuedFile>) => void;
  categories: DocumentCategory[];
  engagements: Engagement[];
  engagementsState: 'loading' | 'error' | 'ready';
  errors: Record<string, string>;
}) {
  return (
    <section aria-labelledby="details-title" className="flex flex-col gap-4">
      <div>
        <h2 id="details-title" className="font-display text-xl font-bold text-heading">
          Document Details
        </h2>
        <p className="text-sm text-text">
          Check each file&apos;s name, type, service and period before it is saved.
        </p>
      </div>
      {engagementsState === 'ready' && engagements.length === 0 ? (
        <p role="alert" className="rounded-control bg-warning-soft px-4 py-3 text-sm text-heading">
          This client has no open service. Start a service on the client&apos;s profile first: every
          document belongs to one.
        </p>
      ) : engagementsState === 'error' ? (
        <p role="alert" className="rounded-control bg-danger-soft px-4 py-3 text-sm text-heading">
          Could not load this client&apos;s services right now.
        </p>
      ) : null}
      <ul aria-label="Files" className="flex flex-col gap-3">
        {files.map((item) => (
          <li
            key={item.key}
            className="grid gap-4 rounded-card border border-border bg-surface p-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
          >
            <div className="flex min-w-0 items-start gap-3">
              <FileIcon contentType={uploadContentTypeFor(item.file.name, item.file.type) ?? ''} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-heading">{item.file.name}</span>
                <span className="block text-sm text-muted">{sizeText(item.file.size)}</span>
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.6fr)]">
              <Input
                label="Document Name *"
                value={item.name}
                maxLength={200}
                error={errors[`${item.key}-name`]}
                onChange={(event) => onChange(item.key, { name: event.target.value })}
              />
              <Select
                label="Document Type *"
                value={item.categoryId}
                error={errors[`${item.key}-categoryId`]}
                onChange={(event) => onChange(item.key, { categoryId: event.target.value })}
                options={[
                  { value: '', label: 'Choose a type' },
                  ...categories
                    .filter((c) => !c.archivedAt)
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Select
                label="Service *"
                value={item.serviceId}
                disabled={engagementsState !== 'ready' || engagements.length === 0}
                error={errors[`${item.key}-serviceId`]}
                onChange={(event) => {
                  const chosen = engagements.find((e) => e.id === event.target.value);
                  onChange(item.key, {
                    serviceId: event.target.value,
                    taxYear: chosen?.taxYear ? String(chosen.taxYear) : item.taxYear,
                  });
                }}
                options={[
                  {
                    value: '',
                    label:
                      engagementsState === 'loading'
                        ? 'Loading…'
                        : engagements.length
                          ? 'Choose a service'
                          : 'No open service',
                  },
                  ...engagements.map((e) => ({ value: e.id, label: engagementLabel(e) })),
                ]}
              />
              <Select
                label="Tax Year"
                value={item.taxYear}
                onChange={(event) => onChange(item.key, { taxYear: event.target.value })}
                options={[
                  { value: '', label: 'None' },
                  ...YEARS.map((y) => ({ value: y, label: y })),
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Organize & Assign: the folder, a reviewer (Owner and Admin pick one) and client visibility. */
export function OrganizeStep({
  info,
  onChange,
  folders,
  team,
  errors,
}: {
  info: SharedInfo;
  onChange: (next: Partial<SharedInfo>) => void;
  folders: DocumentFolder[];
  /** Null when this person may not list the team (Staff): no reviewer to choose. */
  team: TeamMember[] | null;
  errors: Record<string, string>;
}) {
  return (
    <section aria-labelledby="organize-title" className="flex max-w-3xl flex-col gap-5">
      <div>
        <h2 id="organize-title" className="font-display text-xl font-bold text-heading">
          Organize &amp; Assign
        </h2>
        <p className="text-sm text-text">
          Where the files are kept, who reviews them, and whether the client sees them.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Folder *"
          value={info.folderId}
          error={errors['folderId']}
          onChange={(event) => onChange({ folderId: event.target.value })}
          options={[{ value: '', label: 'Choose a folder' }, ...folderOptions(folders)]}
        />
        {team ? (
          <Select
            label="Reviewer"
            value={info.reviewerUserId}
            onChange={(event) => onChange({ reviewerUserId: event.target.value })}
            options={[
              { value: '', label: 'No review needed' },
              ...team
                .filter((m) => m.status === 'ACTIVE')
                .map((m) => ({ value: m.user.id, label: m.user.name })),
            ]}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-3 text-sm text-text">
        <div className="flex items-center gap-3">
          <Toggle
            label="Make visible to client in portal"
            checked={info.shareWithClient}
            onChange={(checked) =>
              onChange({ shareWithClient: checked, notifyClient: checked && info.notifyClient })
            }
          />
          Make visible to client in portal
        </div>
        <div className="flex items-center gap-3">
          <Toggle
            label="Notify client that a document has been uploaded"
            checked={info.notifyClient}
            disabled={!info.shareWithClient}
            onChange={(checked) => onChange({ notifyClient: checked })}
          />
          Notify client that a document has been uploaded
        </div>
      </div>
    </section>
  );
}

const STATE_BADGE: Record<
  QueuedFile['state'],
  { tone: 'neutral' | 'info' | 'success' | 'danger'; label: string }
> = {
  QUEUED: { tone: 'neutral', label: 'Ready' },
  UPLOADING: { tone: 'info', label: 'Uploading' },
  DONE: { tone: 'success', label: 'Uploaded' },
  FAILED: { tone: 'danger', label: 'Failed' },
};

/** Review & Upload: every file with its final details; Upload sends them one by one. */
export function ReviewStep({
  info,
  files,
  categories,
  engagements,
  folders,
  team,
}: {
  info: SharedInfo;
  files: QueuedFile[];
  categories: DocumentCategory[];
  engagements: Engagement[];
  folders: DocumentFolder[];
  team: TeamMember[] | null;
}) {
  const category = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';
  const service = (id: string) => {
    const e = engagements.find((x) => x.id === id);
    return e ? engagementLabel(e) : '—';
  };
  const reviewer = team?.find((m) => m.user.id === info.reviewerUserId)?.user.name;
  const facts: [string, string][] = [
    ['Upload for', info.client?.displayName ?? '—'],
    ['Folder', folders.find((f) => f.id === info.folderId)?.name ?? '—'],
    ['Reviewer', reviewer ?? 'No review needed'],
    [
      'Client portal',
      info.shareWithClient
        ? info.notifyClient
          ? 'Visible, client notified'
          : 'Visible'
        : 'Internal only',
    ],
    ['Tags', info.tags.length ? info.tags.join(', ') : 'None'],
    ['Description', info.description.trim() || 'None'],
  ];
  return (
    <section aria-labelledby="review-title" className="flex flex-col gap-5">
      <div>
        <h2 id="review-title" className="font-display text-xl font-bold text-heading">
          Review &amp; Upload
        </h2>
        <p className="text-sm text-text">Nothing is saved until you choose Upload.</p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 rounded-card border border-border bg-surface p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-sm font-semibold text-heading">{label}</dt>
            <dd className="mb-2 break-words text-sm text-text sm:mb-0">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="relative overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">Files to upload</caption>
          <thead className="bg-table-head text-heading">
            <tr>
              {['Document', 'Type', 'Service', 'Tax Year', 'Size', 'Status'].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {files.map((item) => {
              const badge = STATE_BADGE[item.state];
              return (
                <tr key={item.key} className="align-top">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-3">
                      <FileIcon
                        contentType={uploadContentTypeFor(item.file.name, item.file.type) ?? ''}
                      />
                      <span className="min-w-0 font-semibold break-words text-heading">
                        {savedName(item.name, item.file.name)}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text">{category(item.categoryId)}</td>
                  <td className="px-4 py-3 text-text">{service(item.serviceId)}</td>
                  <td className="px-4 py-3 text-text">{item.taxYear || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-text">
                    {sizeText(item.file.size)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex flex-col gap-1">
                      <span className="inline-flex items-center gap-1.5">
                        {item.state === 'DONE' ? (
                          <CheckCircle aria-hidden weight="fill" className="size-4 text-success" />
                        ) : item.state === 'FAILED' ? (
                          <WarningCircle aria-hidden weight="fill" className="size-4 text-danger" />
                        ) : null}
                        <Badge tone={badge.tone}>
                          {item.state === 'UPLOADING'
                            ? `${badge.label} ${item.percent}%`
                            : badge.label}
                        </Badge>
                      </span>
                      {item.error ? (
                        <span className="text-xs text-danger">{item.error}</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
