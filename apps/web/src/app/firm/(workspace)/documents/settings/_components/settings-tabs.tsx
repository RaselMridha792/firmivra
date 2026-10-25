'use client';

import {
  type DocumentCategory,
  type DocumentFolder,
  type DocumentSettings,
  UPLOAD_LIMITS,
  type UpdateDocumentSettingsRequest,
  type UploadContentType,
} from '@firmivra/types';
import { Button, Input, Select, Skeleton, Toggle } from '@firmivra/ui';
import { Folder } from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ACCESS_OPTIONS, buildTree, COLORS, flatten } from './folder-parts';

const MB = 1024 * 1024;

export function Panel({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-6"
    >
      <div>
        <h2 className="font-display text-xl font-bold text-heading">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="rounded-control bg-canvas px-4 py-6 text-center text-sm text-muted">{children}</p>
);

/** Access & Permissions and Notifications: one row per folder, changed in place. */
export function FolderRules({
  folders,
  state,
  canEdit,
  busy,
  kind,
  onChange,
}: {
  folders: DocumentFolder[];
  state: 'loading' | 'error' | 'ready';
  canEdit: boolean;
  busy: boolean;
  kind: 'access' | 'notify';
  onChange: (folder: DocumentFolder, next: Partial<DocumentFolder>) => void;
}) {
  if (state === 'loading') return <Skeleton className="h-64" />;
  if (state === 'error') return <Quiet>Folders could not be loaded right now.</Quiet>;
  const rows = flatten(buildTree(folders));
  if (!rows.length) return <Quiet>No folders yet. Add them under Folders &amp; Categories.</Quiet>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="bg-canvas text-left text-xs font-semibold text-heading">
            <th scope="col" className="px-3 py-2">
              Folder
            </th>
            {kind === 'access' ? (
              <>
                <th scope="col" className="w-56 px-3 py-2">
                  Default Client Access
                </th>
                <th scope="col" className="w-32 px-3 py-2">
                  Client Uploads
                </th>
              </>
            ) : (
              <th scope="col" className="w-48 px-3 py-2">
                Notify Assigned Staff
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ folder: f, depth }) => {
            const firm = f.scope === 'FIRM';
            return (
              <tr key={f.id} data-testid="folder-rule" className="border-b border-divider">
                <td className="px-3 py-2">
                  <span
                    className="flex items-center gap-2 text-heading"
                    style={{ paddingLeft: `${(depth - 1) * 1.25}rem` }}
                  >
                    <Folder
                      aria-hidden
                      weight="fill"
                      className={`size-5 ${COLORS[f.color].icon}`}
                    />
                    {f.name}
                  </span>
                </td>
                {kind === 'access' ? (
                  <>
                    <td className="px-3 py-2">
                      {firm ? (
                        <span className="text-muted">Firm only</span>
                      ) : (
                        <Select
                          label={`Default client access for ${f.name}`}
                          hideLabel
                          value={f.defaultClientAccess}
                          disabled={!canEdit || busy}
                          onChange={(e) =>
                            onChange(f, {
                              defaultClientAccess: e.target
                                .value as DocumentFolder['defaultClientAccess'],
                            })
                          }
                          options={ACCESS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Toggle
                        label={`Client uploads to ${f.name}`}
                        checked={f.allowClientUploads}
                        disabled={!canEdit || busy || firm}
                        onChange={(allowClientUploads) => onChange(f, { allowClientUploads })}
                      />
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2">
                    <Toggle
                      label={`Notify assigned staff of uploads to ${f.name}`}
                      checked={f.notifyStaffOnUpload}
                      disabled={!canEdit || busy}
                      onChange={(notifyStaffOnUpload) => onChange(f, { notifyStaffOnUpload })}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const dayOptions = (none: string, max: number, steps: number[]) => [
  { value: '', label: none },
  ...steps
    .filter((d) => d <= max)
    .map((d) => ({ value: String(d), label: `${d} ${d === 1 ? 'day' : 'days'}` })),
];
const numberOrNull = (v: string) => (v ? Number(v) : null);

/** A settings form for some of the firm's document settings; Save sends only what changed. */
function SettingsForm({
  settings,
  canEdit,
  busy,
  onSave,
  fields,
}: {
  settings: DocumentSettings;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: UpdateDocumentSettingsRequest) => Promise<boolean>;
  fields: (value: DocumentSettings, put: (next: Partial<DocumentSettings>) => void) => ReactNode;
}) {
  const [value, setValue] = useState(settings);
  const changes: Record<string, unknown> = {};
  for (const key of [
    'requestReminderDaysBefore',
    'requestExpiryDays',
    'documentExpiryReminderDays',
    'shareExpiryDays',
    'uploadMaxBytes',
  ] as const)
    if (value[key] !== settings[key]) changes[key] = value[key];
  if ([...value.uploadTypes].sort().join() !== [...settings.uploadTypes].sort().join())
    changes['uploadTypes'] = value.uploadTypes;
  if ((value.defaultReviewer?.userId ?? null) !== (settings.defaultReviewer?.userId ?? null))
    changes['defaultReviewerUserId'] = value.defaultReviewer?.userId ?? null;
  const dirty = Object.keys(changes).length > 0;
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void onSave(changes as UpdateDocumentSettingsRequest);
      }}
    >
      {fields(value, (next) => setValue((v) => ({ ...v, ...next })))}
      {canEdit ? (
        <div className="flex justify-end gap-3 border-t border-divider pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() => setValue(settings)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={!dirty || busy}>
            Save Changes
          </Button>
        </div>
      ) : (
        <p className="border-t border-divider pt-4 text-sm text-muted">
          Only an Owner or Admin changes these settings.
        </p>
      )}
    </form>
  );
}

export type SettingsState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; settings: DocumentSettings };

function withSettings(state: SettingsState, render: (s: DocumentSettings) => ReactNode) {
  if (state.kind === 'loading') return <Skeleton className="h-64" />;
  if (state.kind === 'error')
    return <Quiet>Document settings could not be loaded right now.</Quiet>;
  return render(state.settings);
}

/** Expiration & Reminders: request reminders and expiry, document expiry reminders, share links. */
export function ExpirationTab(props: {
  state: SettingsState;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: UpdateDocumentSettingsRequest) => Promise<boolean>;
}) {
  return (
    <Panel
      title="Expiration & Reminders"
      subtitle="The defaults new requests and shares start from; each request can still change its own."
      testId="expiration-settings"
    >
      {withSettings(props.state, (settings) => (
        <SettingsForm
          key={settings.updatedAt ?? 'new'}
          settings={settings}
          canEdit={props.canEdit}
          busy={props.busy}
          onSave={props.onSave}
          fields={(v, put) => (
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Remind clients before a request is due"
                value={v.requestReminderDaysBefore?.toString() ?? ''}
                disabled={!props.canEdit}
                onChange={(e) => put({ requestReminderDaysBefore: numberOrNull(e.target.value) })}
                options={dayOptions('No reminder', 30, [1, 2, 3, 5, 7, 14, 30])}
              />
              <Select
                label="A request expires after it is sent"
                value={v.requestExpiryDays?.toString() ?? ''}
                disabled={!props.canEdit}
                onChange={(e) => put({ requestExpiryDays: numberOrNull(e.target.value) })}
                options={dayOptions('Never', 365, [7, 14, 30, 60, 90, 180, 365])}
              />
              <Select
                label="Remind before a document expires"
                value={v.documentExpiryReminderDays?.toString() ?? ''}
                disabled={!props.canEdit}
                onChange={(e) => put({ documentExpiryReminderDays: numberOrNull(e.target.value) })}
                options={dayOptions('No reminder', 365, [7, 14, 30, 60, 90])}
              />
              <Select
                label="A shared link expires after"
                value={v.shareExpiryDays?.toString() ?? ''}
                disabled={!props.canEdit}
                onChange={(e) => put({ shareExpiryDays: numberOrNull(e.target.value) })}
                options={dayOptions('Never', 365, [1, 7, 14, 30, 60, 90])}
              />
            </div>
          )}
        />
      ))}
    </Panel>
  );
}

const TYPE_NAMES: Record<UploadContentType, string> = {
  'application/pdf': 'PDF (.pdf)',
  'image/jpeg': 'JPEG image (.jpg, .jpeg)',
  'image/png': 'PNG image (.png)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
} as Record<UploadContentType, string>;

/** File Settings: the largest upload and the file types the firm takes. */
export function FileTab(props: {
  state: SettingsState;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: UpdateDocumentSettingsRequest) => Promise<boolean>;
}) {
  const all = Object.keys(UPLOAD_LIMITS.types) as UploadContentType[];
  const max = Math.floor(UPLOAD_LIMITS.maxBytes / MB);
  return (
    <Panel
      title="File Settings"
      subtitle={`What clients and staff can upload. Firmivra's own limit is ${max} MB a file.`}
      testId="file-settings"
    >
      {withSettings(props.state, (settings) => (
        <SettingsForm
          key={settings.updatedAt ?? 'new'}
          settings={settings}
          canEdit={props.canEdit}
          busy={props.busy}
          onSave={props.onSave}
          fields={(v, put) => {
            // No types chosen means every type the platform takes.
            const chosen = v.uploadTypes.length ? v.uploadTypes : all;
            return (
              <div className="grid gap-5 md:grid-cols-2">
                <Input
                  label={`Largest file (MB, at most ${max})`}
                  type="number"
                  min={1}
                  max={max}
                  value={Math.round(v.uploadMaxBytes / MB)}
                  disabled={!props.canEdit}
                  onChange={(e) => {
                    const n = Math.min(max, Math.max(1, Math.round(Number(e.target.value) || 1)));
                    put({ uploadMaxBytes: n * MB });
                  }}
                />
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm font-semibold text-heading">
                    Allowed file types
                  </legend>
                  {all.map((t) => (
                    <label key={t} className="flex min-h-9 items-center gap-3 text-sm text-text">
                      <input
                        type="checkbox"
                        className="size-4 accent-action"
                        checked={chosen.includes(t)}
                        disabled={!props.canEdit || (chosen.length === 1 && chosen.includes(t))}
                        onChange={() => {
                          const next = chosen.includes(t)
                            ? chosen.filter((x) => x !== t)
                            : [...chosen, t];
                          put({ uploadTypes: next.length === all.length ? [] : next });
                        }}
                      />
                      {TYPE_NAMES[t] ?? t}
                    </label>
                  ))}
                </fieldset>
              </div>
            );
          }}
        />
      ))}
    </Panel>
  );
}

/** Notifications: who reviews new client uploads, and which folders notify assigned staff. */
export function ReviewerForm(props: {
  state: SettingsState;
  members: { value: string; label: string }[] | null;
  canEdit: boolean;
  busy: boolean;
  onSave: (body: UpdateDocumentSettingsRequest) => Promise<boolean>;
}) {
  return withSettings(props.state, (settings) => (
    <SettingsForm
      key={settings.updatedAt ?? 'new'}
      settings={settings}
      canEdit={props.canEdit}
      busy={props.busy}
      onSave={props.onSave}
      fields={(v, put) => (
        <div className="max-w-md">
          <Select
            label="Default reviewer for new client uploads"
            value={v.defaultReviewer?.userId ?? ''}
            disabled={!props.canEdit || !props.members}
            onChange={(e) => {
              const m = props.members?.find((x) => x.value === e.target.value);
              put({ defaultReviewer: m ? { userId: m.value, name: m.label } : null });
            }}
            options={[
              { value: '', label: 'No default reviewer' },
              ...(props.members ??
                (v.defaultReviewer
                  ? [{ value: v.defaultReviewer.userId, label: v.defaultReviewer.name }]
                  : [])),
            ]}
          />
          <p className="mt-1 text-xs text-muted">
            They are told of each upload that waits for review.{' '}
            <Link href="/settings/notifications" className="font-medium text-action underline">
              Notification settings
            </Link>
          </p>
        </div>
      )}
    />
  ));
}

/** General Settings' document types: the firm's categories, their retention, archive and restore. */
export function DocumentTypes({
  categories,
  state,
  canEdit,
  busy,
  onCreate,
  onUpdate,
}: {
  categories: DocumentCategory[];
  state: 'loading' | 'error' | 'ready';
  canEdit: boolean;
  busy: boolean;
  onCreate: (name: string, retentionYears: number | null) => Promise<boolean>;
  onUpdate: (
    category: DocumentCategory,
    next: { name?: string; retentionYears?: number | null; archived?: boolean },
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [years, setYears] = useState('');
  const [error, setError] = useState('');
  const yearOptions = [
    { value: '', label: 'Keep for good' },
    ...[1, 3, 5, 7, 10].map((y) => ({
      value: String(y),
      label: `${y} ${y === 1 ? 'year' : 'years'}`,
    })),
  ];
  if (state === 'loading') return <Skeleton className="h-48" />;
  if (state === 'error') return <Quiet>Document types could not be loaded right now.</Quiet>;
  return (
    <div className="flex flex-col gap-4" data-testid="document-types">
      {categories.length ? (
        <ul className="flex flex-col divide-y divide-divider rounded-control border border-border">
          {categories.map((c) => (
            <li
              key={c.id}
              data-testid="document-type"
              className="flex flex-wrap items-center gap-3 px-3 py-2"
            >
              <span
                className={`min-w-0 flex-1 text-sm font-medium ${c.archivedAt ? 'text-muted' : 'text-heading'}`}
              >
                {c.name}
                {c.archivedAt ? <span className="ml-2 text-xs">(archived)</span> : null}
              </span>
              <div className="w-40">
                <Select
                  label={`Keep ${c.name} documents`}
                  hideLabel
                  value={c.retentionYears?.toString() ?? ''}
                  disabled={!canEdit || busy}
                  onChange={(e) =>
                    void onUpdate(c, { retentionYears: numberOrNull(e.target.value) })
                  }
                  options={
                    c.retentionYears && ![1, 3, 5, 7, 10].includes(c.retentionYears)
                      ? [
                          ...yearOptions,
                          { value: String(c.retentionYears), label: `${c.retentionYears} years` },
                        ]
                      : yearOptions
                  }
                />
              </div>
              {canEdit ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void onUpdate(c, { archived: !c.archivedAt })}
                >
                  {c.archivedAt ? 'Restore' : 'Archive'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Quiet>No document types yet.</Quiet>
      )}
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Enter the type’s name.');
            setError('');
            void onCreate(name.trim(), numberOrNull(years)).then((ok) => {
              if (ok) {
                setName('');
                setYears('');
              }
            });
          }}
        >
          <div className="min-w-[14rem] flex-1">
            <Input
              label="New document type"
              maxLength={80}
              value={name}
              error={error || undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Select
              label="Keep documents"
              value={years}
              onChange={(e) => setYears(e.target.value)}
              options={yearOptions}
            />
          </div>
          <Button type="submit" disabled={busy}>
            Add Type
          </Button>
        </form>
      ) : null}
    </div>
  );
}
