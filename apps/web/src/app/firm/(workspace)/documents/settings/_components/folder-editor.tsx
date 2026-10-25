'use client';

import type { DocumentFolder } from '@firmivra/types';
import { Button, Input, Select, Tabs, Textarea, Toggle } from '@firmivra/ui';
import { Folder, FolderOpen, Info, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useId, useState } from 'react';
import {
  ACCESS_OPTIONS,
  COLORS,
  type FolderDraft,
  parentChoices,
  siblingsOf,
} from './folder-parts';

const DESCRIPTION_MAX = 500;

function Switch({
  label,
  checked,
  onChange,
  disabled,
  note,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  note?: string;
}) {
  const id = useId();
  return (
    <div className="flex min-h-9 items-center gap-3">
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label=""
        aria-labelledby={id}
      />
      <span id={id} className="text-sm text-heading">
        {label}
        {note ? <span className="block text-xs text-muted">{note}</span> : null}
      </span>
    </div>
  );
}

function AccessField({
  draft,
  put,
  disabled,
}: {
  draft: FolderDraft;
  put: (next: Partial<FolderDraft>) => void;
  disabled: boolean;
}) {
  const firm = draft.scope === 'FIRM';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label="Default Access"
            value={draft.defaultClientAccess}
            disabled={disabled || firm}
            onChange={(e) =>
              put({ defaultClientAccess: e.target.value as FolderDraft['defaultClientAccess'] })
            }
            options={ACCESS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        <span
          className="mb-3 inline-flex text-heading"
          title="Applies to each client's own new documents in this folder. It never opens a folder to every client."
        >
          <Info aria-hidden weight="bold" className="size-5" />
          <span className="sr-only">
            Applies to each client&apos;s own new documents in this folder. It never opens a folder
            to every client.
          </span>
        </span>
      </div>
      <p className="text-xs text-muted">
        {firm
          ? 'Firm Internal folders are never shown to clients.'
          : 'This will be the default access level for documents added to this folder.'}
      </p>
    </div>
  );
}

/**
 * Frame 6's middle column: one folder's Details, Access, Subfolders and Automation, or a new
 * folder. Saving sends only what changed; a firm folder never opens to clients.
 */
export function FolderEditor({
  folder,
  parent,
  draft,
  onDraft,
  folders,
  canEdit,
  busy,
  expiryReminderDays,
  errors,
  onSave,
  onCancel,
  onDelete,
  onAddSubfolder,
  onReorder,
  onSelect,
}: {
  /** null: a new folder. */
  folder: DocumentFolder | null;
  parent: DocumentFolder | null;
  draft: FolderDraft;
  onDraft: (next: Partial<FolderDraft>) => void;
  folders: DocumentFolder[];
  canEdit: boolean;
  busy: boolean;
  /** The firm's "remind before a document expires" days (Expiration & Reminders). */
  expiryReminderDays: number | null;
  errors: Partial<Record<'name', string>>;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (folder: DocumentFolder) => void;
  onAddSubfolder: (folder: DocumentFolder) => void;
  onReorder: (parentId: string | null) => void;
  onSelect: (folder: DocumentFolder) => void;
}) {
  const [tab, setTab] = useState('details');
  const locked = !canEdit || busy;
  const firm = draft.scope === 'FIRM';
  const children = folder ? siblingsOf(folders, folder.id) : [];
  const choices = parentChoices(folders, draft.scope, folder ?? undefined);
  const depthOf = (f: DocumentFolder) => {
    let n = 0;
    for (
      let at: string | null = f.parentId;
      at;
      at = folders.find((x) => x.id === at)?.parentId ?? null
    )
      n += 1;
    return n;
  };
  const Glyph = folder?.parentId || parent ? Folder : FolderOpen;

  const details = (
    <div className="flex flex-col gap-4">
      <Input
        id="folder-name"
        label="Folder Name *"
        value={draft.name}
        maxLength={80}
        disabled={locked}
        error={errors.name}
        onChange={(e) => onDraft({ name: e.target.value })}
      />
      <div className="flex flex-col gap-1">
        <Textarea
          label="Description"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          disabled={locked}
          value={draft.description}
          onChange={(e) => onDraft({ description: e.target.value })}
        />
        <span className="self-end text-xs text-muted">
          {draft.description.length}/{DESCRIPTION_MAX}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <Select
            label="Parent Folder"
            value={draft.parentId ?? ''}
            disabled={locked}
            onChange={(e) => onDraft({ parentId: e.target.value || null })}
            options={[
              { value: '', label: 'None (top level)' },
              ...choices.map((f) => ({
                value: f.id,
                label: `${'— '.repeat(depthOf(f))}${f.name}`,
              })),
            ]}
          />
          {!folder && !draft.parentId ? (
            <Select
              label="Holds"
              value={draft.scope}
              disabled={locked}
              onChange={(e) => {
                const scope = e.target.value as FolderDraft['scope'];
                onDraft(
                  scope === 'FIRM'
                    ? { scope, allowClientUploads: false, defaultClientAccess: 'NONE' }
                    : { scope },
                );
              }}
              options={[
                { value: 'CLIENT', label: 'Client documents' },
                { value: 'FIRM', label: 'Firm internal documents' },
              ]}
            />
          ) : null}
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-semibold text-heading">Folder Color</legend>
          <div className="flex flex-wrap gap-1">
            {Object.entries(COLORS).map(([value, c]) => (
              <label
                key={value}
                className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-full border-2 ${draft.color === value ? 'border-action' : 'border-transparent'}`}
              >
                <input
                  type="radio"
                  name="folder-color"
                  value={value}
                  checked={draft.color === value}
                  disabled={locked}
                  onChange={() => onDraft({ color: value as FolderDraft['color'] })}
                  className="sr-only"
                  aria-label={c.label}
                />
                <span aria-hidden className={`size-6 rounded-full ${c.swatch}`} />
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-heading">Default Settings for This Folder</h3>
        <Switch
          label="Require expiration date for new documents"
          checked={draft.requireExpiryDate}
          disabled={locked}
          onChange={(requireExpiryDate) => onDraft({ requireExpiryDate })}
        />
        <Switch
          label="Send reminder before document expiration"
          checked={draft.remindBeforeExpiry}
          disabled={locked}
          onChange={(remindBeforeExpiry) => onDraft({ remindBeforeExpiry })}
        />
        <Switch
          label="Allow client uploads to this folder"
          checked={draft.allowClientUploads}
          disabled={locked || firm}
          onChange={(allowClientUploads) => onDraft({ allowClientUploads })}
        />
        <Switch
          label="Notify assigned staff of new uploads"
          checked={draft.notifyStaffOnUpload}
          disabled={locked}
          onChange={(notifyStaffOnUpload) => onDraft({ notifyStaffOnUpload })}
        />
      </div>
      <AccessField draft={draft} put={onDraft} disabled={locked} />
    </div>
  );

  const access = (
    <div className="flex flex-col gap-4">
      <AccessField draft={draft} put={onDraft} disabled={locked} />
      <Switch
        label="Allow client uploads to this folder"
        checked={draft.allowClientUploads}
        disabled={locked || firm}
        onChange={(allowClientUploads) => onDraft({ allowClientUploads })}
      />
      <ul className="flex flex-col gap-2 rounded-control bg-canvas p-3 text-sm text-text">
        {ACCESS_OPTIONS.map((o) => (
          <li key={o.value}>
            <span className="font-semibold text-heading">{o.label}:</span> {o.note}
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        Your team&apos;s access to documents follows each person&apos;s role.{' '}
        <Link href="/settings/users" className="font-medium text-action underline">
          Users &amp; Roles
        </Link>
      </p>
    </div>
  );

  const subfolders = folder ? (
    <div className="flex flex-col gap-3">
      {children.length ? (
        <ul className="flex flex-col divide-y divide-divider rounded-control border border-border">
          {children.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <Folder aria-hidden weight="fill" className={`size-5 ${COLORS[c.color].icon}`} />
              <button
                type="button"
                onClick={() => onSelect(c)}
                className="min-w-0 flex-1 truncate text-left font-medium text-heading hover:underline"
              >
                {c.name}
              </button>
              <span className="text-xs text-muted">
                {c.documentCount} {c.documentCount === 1 ? 'document' : 'documents'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-control bg-canvas px-3 py-4 text-sm text-muted">
          No subfolders in {folder.name}.
        </p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onAddSubfolder(folder)}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Subfolder
          </Button>
          {children.length > 1 ? (
            <Button variant="secondary" disabled={busy} onClick={() => onReorder(folder.id)}>
              Reorder Subfolders
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const automation = (
    <div className="flex flex-col gap-3">
      <Switch
        label="Require expiration date for new documents"
        checked={draft.requireExpiryDate}
        disabled={locked}
        onChange={(requireExpiryDate) => onDraft({ requireExpiryDate })}
      />
      <Switch
        label="Send reminder before document expiration"
        note={
          expiryReminderDays
            ? `${expiryReminderDays} ${expiryReminderDays === 1 ? 'day' : 'days'} before, as set in Expiration & Reminders.`
            : 'Set how many days before in Expiration & Reminders.'
        }
        checked={draft.remindBeforeExpiry}
        disabled={locked}
        onChange={(remindBeforeExpiry) => onDraft({ remindBeforeExpiry })}
      />
      <Switch
        label="Notify assigned staff of new uploads"
        checked={draft.notifyStaffOnUpload}
        disabled={locked}
        onChange={(notifyStaffOnUpload) => onDraft({ notifyStaffOnUpload })}
      />
      <p className="text-sm text-muted">
        For more steps when a document arrives, build a rule in{' '}
        <Link href="/automations" className="font-medium text-action underline">
          Automations
        </Link>
        .
      </p>
    </div>
  );

  const panel: ReactNode =
    tab === 'access'
      ? access
      : tab === 'subfolders' && subfolders
        ? subfolders
        : tab === 'automation'
          ? automation
          : details;

  return (
    <section
      aria-label={folder ? `Folder ${folder.name}` : 'New folder'}
      data-testid="folder-editor"
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <Glyph
          aria-hidden
          weight="fill"
          className={`size-12 shrink-0 ${COLORS[draft.color].icon}`}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-heading">
            {folder ? folder.name : parent ? `New Subfolder in ${parent.name}` : 'New Folder'}
          </h2>
          <p className="text-sm text-muted">
            {folder
              ? (folder.description ??
                (folder.scope === 'FIRM' ? 'Firm internal documents.' : 'Client documents.'))
              : 'Name the folder and choose its defaults.'}
          </p>
        </div>
        {folder && canEdit ? (
          <Button
            variant="outline"
            onClick={() => {
              setTab('details');
              requestAnimationFrame(() => document.getElementById('folder-name')?.focus());
            }}
          >
            <PencilSimple aria-hidden weight="bold" className="size-4" />
            Edit Folder
          </Button>
        ) : null}
      </div>
      <div className="max-w-full overflow-x-auto">
        <Tabs
          label="Folder settings"
          variant="segmented"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'details', label: 'Details' },
            { id: 'access', label: 'Access' },
            ...(folder ? [{ id: 'subfolders', label: 'Subfolders', count: children.length }] : []),
            { id: 'automation', label: 'Automation' },
          ]}
        />
      </div>
      {panel}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
          {folder ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(folder)}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-danger bg-surface px-4 text-sm font-medium text-danger hover:bg-danger-soft disabled:opacity-50"
            >
              <Trash aria-hidden weight="bold" className="size-4" />
              Delete Folder
            </button>
          ) : null}
          <span className="flex-1" />
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onSave}>
            {folder ? 'Save Changes' : 'Create Folder'}
          </Button>
        </div>
      ) : (
        <p className="border-t border-divider pt-4 text-sm text-muted">
          Only an Owner or Admin changes folders.
        </p>
      )}
    </section>
  );
}
