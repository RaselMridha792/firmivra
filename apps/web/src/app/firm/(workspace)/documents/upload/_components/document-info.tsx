'use client';

import type { DocumentCategory, DocumentFolder } from '@firmivra/types';
import { Input, Select, Textarea, Toggle } from '@firmivra/ui';
import { Info, X } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { ClientPicker } from './client-picker';
import type { SharedInfo, UploadFor } from './upload-state';

const DESTINATIONS: { id: UploadFor; title: string; hint: string; available: boolean }[] = [
  { id: 'CLIENT', title: 'Client', hint: 'Assign to a client record', available: true },
  { id: 'LEAD', title: 'Lead', hint: 'Assign to a lead record', available: false },
  { id: 'FIRM', title: 'Firm', hint: 'Internal use only', available: false },
];
const MAX_TAGS = 20;
const MAX_TAG = 40;
const MAX_DESCRIPTION = 500;

/** Client folders as options, children indented under their parent (the API's flat list). */
export function folderOptions(folders: DocumentFolder[]) {
  const client = folders.filter((f) => f.scope === 'CLIENT');
  const roots = client.filter((f) => !f.parentId || !client.some((p) => p.id === f.parentId));
  const byOrder = (a: DocumentFolder, b: DocumentFolder) => a.sortOrder - b.sortOrder;
  return roots.sort(byOrder).flatMap((root) => [
    { value: root.id, label: root.name },
    ...client
      .filter((f) => f.parentId === root.id)
      .sort(byOrder)
      .map((child) => ({ value: child.id, label: ' ' + child.name })),
  ]);
}

function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex text-heading">
      <Info aria-hidden weight="regular" className="size-4" />
      <span className="sr-only">{text}</span>
    </span>
  );
}

/**
 * Frame 1's Document Information: who the files are for, their type, folder, name, description,
 * portal visibility, the client notice and tags. Only a client destination has an upload route
 * today, so Lead and Firm show but cannot be chosen (R56 Needs).
 */
export function DocumentInfo({
  info,
  onChange,
  categories,
  folders,
  fileCount,
  errors,
  disabled,
}: {
  info: SharedInfo;
  onChange: (next: Partial<SharedInfo>) => void;
  categories: DocumentCategory[] | undefined;
  folders: DocumentFolder[] | undefined;
  fileCount: number;
  errors: Record<string, string>;
  disabled: boolean;
}) {
  const id = useId();
  const [tag, setTag] = useState('');
  function addTag() {
    const value = tag.trim().slice(0, MAX_TAG);
    setTag('');
    if (!value || info.tags.includes(value) || info.tags.length >= MAX_TAGS) return;
    onChange({ tags: [...info.tags, value] });
  }
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5"
    >
      <h2 id={`${id}-title`} className="font-display text-xl font-bold text-heading">
        Document Information
      </h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-heading">
          Upload For<span className="text-danger"> *</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {DESTINATIONS.map((option) => {
            const chosen = info.uploadFor === option.id;
            return (
              <label
                key={option.id}
                title={option.available ? undefined : 'Not available for uploads yet'}
                className={`flex items-start gap-3 rounded-lg border p-3 ${chosen ? 'border-action bg-info-soft' : 'border-border bg-surface'} ${option.available && !disabled ? 'cursor-pointer hover:border-control-border' : 'cursor-not-allowed opacity-60'}`}
              >
                <input
                  type="radio"
                  name={`${id}-for`}
                  value={option.id}
                  checked={chosen}
                  disabled={!option.available || disabled}
                  onChange={() => onChange({ uploadFor: option.id })}
                  className="mt-1 size-5 shrink-0"
                />
                <span>
                  <span className="block font-semibold text-heading">{option.title}</span>
                  <span className="block text-sm text-text">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted">Uploads go to a client record for now.</p>
      </fieldset>

      <ClientPicker
        value={info.client}
        onChange={(client) => onChange({ client })}
        error={errors['client']}
        disabled={disabled}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Document Type *"
          value={info.categoryId}
          error={errors['categoryId']}
          disabled={disabled || !categories}
          onChange={(event) => onChange({ categoryId: event.target.value })}
          options={[
            { value: '', label: categories ? 'Choose a type' : 'Loading…' },
            ...(categories ?? [])
              .filter((c) => !c.archivedAt)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Folder *"
          value={info.folderId}
          error={errors['folderId']}
          disabled={disabled || !folders}
          onChange={(event) => onChange({ folderId: event.target.value })}
          options={[
            {
              value: '',
              label: !folders ? 'Loading…' : folders.length ? 'Choose a folder' : 'No folders yet',
            },
            ...folderOptions(folders ?? []),
          ]}
        />
      </div>

      <Input
        label="Document Name"
        value={fileCount > 1 ? '' : info.name}
        disabled={disabled || fileCount > 1}
        placeholder={fileCount > 1 ? 'Each file keeps its own name' : 'Use the file name'}
        maxLength={200}
        onChange={(event) => onChange({ name: event.target.value })}
      />

      <div className="flex flex-col gap-1">
        <Textarea
          label="Description (optional)"
          rows={3}
          maxLength={MAX_DESCRIPTION}
          value={info.description}
          disabled={disabled}
          onChange={(event) => onChange({ description: event.target.value })}
        />
        <span aria-live="polite" className="self-end text-sm text-muted">
          {info.description.length}/{MAX_DESCRIPTION}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3 text-sm text-text">
          <Toggle
            label="Make visible to client in portal"
            checked={info.shareWithClient}
            disabled={disabled}
            onChange={(checked) =>
              onChange({ shareWithClient: checked, notifyClient: checked && info.notifyClient })
            }
          />
          <span>Make visible to client in portal</span>
          <InfoTip text="The client sees it under Firm Uploaded Documents in their portal. Off keeps it internal." />
        </div>
        <div className="flex items-center gap-3 text-sm text-text">
          <Toggle
            label="Notify client that a document has been uploaded"
            checked={info.notifyClient}
            disabled={disabled || !info.shareWithClient}
            onChange={(checked) => onChange({ notifyClient: checked })}
          />
          <span>Notify client that a document has been uploaded</span>
          <InfoTip text="A secure notice that a document is waiting in the portal; the file is never attached. Share it with the client first." />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-tag`} className="text-sm font-semibold text-heading">
          Add Tags <span className="font-normal text-muted">(optional)</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            id={`${id}-tag`}
            value={tag}
            maxLength={MAX_TAG}
            disabled={disabled || info.tags.length >= MAX_TAGS}
            placeholder="Type a tag and press enter…"
            onChange={(event) => setTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
            className="min-h-11 rounded-control border border-border bg-surface px-3 text-sm text-text shadow-sm placeholder:text-muted hover:border-control-border focus:border-action focus:ring-2 focus:ring-action/25 focus:outline-none"
          />
          <ul
            aria-label="Tags"
            className="flex min-h-11 flex-wrap items-center gap-2 rounded-control border border-border px-2 py-1.5"
          >
            {info.tags.length ? (
              info.tags.map((value) => (
                <li
                  key={value}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-heading"
                >
                  {value}
                  <button
                    type="button"
                    aria-label={`Remove tag ${value}`}
                    disabled={disabled}
                    onClick={() => onChange({ tags: info.tags.filter((t) => t !== value) })}
                    className="rounded p-0.5 hover:bg-canvas"
                  >
                    <X aria-hidden weight="bold" className="size-3" />
                  </button>
                </li>
              ))
            ) : (
              <li className="px-1 text-xs text-muted">No tags</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
