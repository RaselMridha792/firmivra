'use client';

import type { MergeField, MessageTemplateKind, MessageTemplateRow } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { ArrowDown, ArrowUp, PencilSimple, Trash, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { KINDS, TEMPLATES_KEY, TEMPLATE_ERRORS, kindOf, quiet } from './templates-shared';

const GROUP_LABEL: Record<MergeField['group'], string> = {
  CLIENT: 'Client',
  COMPANY: 'Company',
  STAFF: 'Staff',
  APPOINTMENT: 'Appointment',
  INVOICE: 'Invoice',
  TAX: 'Tax',
  WORKFLOW: 'Workflow',
  CUSTOM: 'Custom',
};

/** Preview with sample data: unresolved merge fields are flagged, and a test send never changes the template. */
export function PreviewDialog({
  template,
  onClose,
}: {
  template: Pick<MessageTemplateRow, 'id' | 'name' | 'kind'>;
  onClose: () => void;
}) {
  const preview = useApiQuery([...TEMPLATES_KEY, 'preview', template.id], () =>
    api.templates.preview(template.id),
  );
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<{ text: string; ok: boolean }>();
  const channel = template.kind === 'SMS' ? 'SMS' : 'EMAIL';
  const send = useApiMutation(
    () =>
      api.templates.testSend(template.id, {
        channel,
        ...(channel === 'EMAIL' ? { toEmail: email.trim() } : { toPhone: phone.trim() }),
      }),
    {},
  );
  const p = preview.data;
  return (
    <Modal
      open
      title="Preview"
      subtitle={`${template.name} · sample data`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="preview-dialog">
        {!p ? (
          <p className={quiet}>
            {preview.isError ? 'The preview is not available right now.' : 'Loading…'}
          </p>
        ) : (
          <>
            {p.unresolved.length > 0 ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
                data-testid="unresolved"
              >
                <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                Unresolved merge fields: {p.unresolved.map((u) => `[${u}]`).join(', ')}. Do not send
                this to a client until they are fixed.
              </p>
            ) : null}
            {p.subject !== null ? (
              <p className="text-sm text-heading">
                <span className="font-semibold">Subject: </span>
                {p.subject}
              </p>
            ) : null}
            <div
              className="max-h-80 overflow-auto rounded-lg border border-divider bg-surface p-3 text-sm whitespace-pre-wrap text-heading"
              data-testid="preview-body"
            >
              {p.body
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>\s*<p>/gi, '\n\n')
                .replace(/<li>/gi, '• ')
                .replace(/<\/li>/gi, '\n')
                .replace(/<[^>]+>/g, '')}
            </div>
            {p.sms ? (
              <p className="text-xs text-muted">
                {p.sms.characters} characters, {p.sms.parts} text{' '}
                {p.sms.parts === 1 ? 'part' : 'parts'}.
              </p>
            ) : null}
          </>
        )}
        <div className="rounded-lg bg-canvas p-3">
          <h3 className="mb-2 text-sm font-semibold text-heading">Test Send</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              {channel === 'EMAIL' ? (
                <Input
                  label="Send a test to"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              ) : (
                <Input
                  label="Send a test to (+15551234567)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </div>
            <Button
              disabled={send.isPending || (channel === 'EMAIL' ? !email.trim() : !phone.trim())}
              onClick={() =>
                send.mutate(undefined, {
                  onSuccess: () =>
                    setMessage({ text: 'Test sent. The template was not changed.', ok: true }),
                  onError: (e) => setMessage({ text: errorMessage(e, TEMPLATE_ERRORS), ok: false }),
                })
              }
            >
              Test Send
            </Button>
          </div>
          {message ? (
            <p
              role={message.ok ? 'status' : 'alert'}
              className={`mt-2 text-sm ${message.ok ? 'text-success' : 'text-danger'}`}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/** Import Template: paste HTML or text; imported markup is cleaned before it is kept. */
export function ImportDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (name: string, removed: number) => void;
}) {
  const [kind, setKind] = useState<MessageTemplateKind>('EMAIL');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'HTML' | 'TEXT'>('HTML');
  const [content, setContent] = useState('');
  const send = useApiMutation(
    () => api.templates.importTemplate({ kind, name: name.trim(), format, content }),
    { invalidate: [...TEMPLATES_KEY] },
  );
  return (
    <Modal
      open
      title="Import Template"
      subtitle="Paste your own HTML or text. It becomes a draft you can edit."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !content.trim() || send.isPending}
            onClick={() =>
              send.mutate(undefined, { onSuccess: (r) => onDone(r.template.name, r.removed) })
            }
          >
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="import-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as MessageTemplateKind)}
            options={KINDS.map((k) => ({ value: k.kind, label: k.noun }))}
          />
          <Select
            label="Format"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'HTML')}
            options={[
              { value: 'HTML', label: 'HTML' },
              { value: 'TEXT', label: 'Plain text' },
            ]}
          />
        </div>
        <Input
          label="Template name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <Textarea
          label="Content"
          value={content}
          rows={8}
          onChange={(e) => setContent(e.target.value)}
        />
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, TEMPLATE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Merge Fields: the groups, with the firm's own custom fields. */
export function MergeFieldsDialog({ onClose }: { onClose: () => void }) {
  const list = useApiQuery([...TEMPLATES_KEY, 'merge-fields'], () => api.templates.mergeFields());
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MergeField | 'new'>();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [fallback, setFallback] = useState('');
  const [error, setError] = useState<string>();
  const options = { invalidate: [...TEMPLATES_KEY] };
  const save = useApiMutation(
    () =>
      editing && editing !== 'new' && editing.customId
        ? api.templates.updateMergeField(editing.customId, {
            key: editing.key,
            label: label.trim(),
            ...(fallback.trim() ? { fallback: fallback.trim() } : {}),
          })
        : api.templates.createMergeField({
            key: key.trim(),
            label: label.trim(),
            ...(fallback.trim() ? { fallback: fallback.trim() } : {}),
          }),
    options,
  );
  const drop = useApiMutation((id: string) => api.templates.deleteMergeField(id), options);
  const rows = (list.data ?? []).filter(
    (f) =>
      !search.trim() || `${f.key} ${f.label}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <Modal
      open
      title="Merge Fields"
      subtitle="Dynamic fields like [Client First Name] are filled in when a template is used."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="merge-fields-dialog">
        <Input
          label="Search merge fields"
          hideLabel
          placeholder="Search merge fields…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 overflow-auto rounded-lg border border-divider">
          {groups.length === 0 ? (
            <p className={quiet}>
              {list.isPending
                ? 'Loading…'
                : list.isError
                  ? 'Merge fields are not available right now.'
                  : 'No merge fields match.'}
            </p>
          ) : (
            groups.map((g) => (
              <section key={g}>
                <h3 className="bg-table-head px-3 py-1.5 text-xs font-semibold text-heading uppercase">
                  {GROUP_LABEL[g]}
                </h3>
                <ul>
                  {rows
                    .filter((r) => r.group === g)
                    .map((f) => (
                      <li
                        key={f.token}
                        className="flex items-center justify-between gap-2 border-t border-divider px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-heading">{f.token}</span>
                          <span className="text-xs text-muted">
                            {f.label} · e.g. {f.example}
                          </span>
                        </span>
                        {f.customId ? (
                          <span className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              aria-label={`Edit ${f.token}`}
                              className="inline-flex size-8 items-center justify-center rounded-lg text-heading hover:bg-canvas"
                              onClick={() => {
                                setEditing(f);
                                setLabel(f.label);
                                setFallback(f.fallback ?? '');
                              }}
                            >
                              <PencilSimple aria-hidden weight="fill" className="size-4" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${f.token}`}
                              className="inline-flex size-8 items-center justify-center rounded-lg text-danger hover:bg-canvas"
                              onClick={() =>
                                drop.mutate(f.customId as string, {
                                  onError: (e) => setError(errorMessage(e, TEMPLATE_ERRORS)),
                                })
                              }
                            >
                              <Trash aria-hidden weight="fill" className="size-4" />
                            </button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </section>
            ))
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        {editing ? (
          <form
            className="flex flex-col gap-2 rounded-lg bg-canvas p-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(undefined);
              save.mutate(undefined, {
                onSuccess: () => {
                  setEditing(undefined);
                  setKey('');
                  setLabel('');
                  setFallback('');
                },
                onError: (err) => setError(errorMessage(err, TEMPLATE_ERRORS)),
              });
            }}
          >
            <h3 className="text-sm font-semibold text-heading">
              {editing === 'new' ? 'New custom field' : 'Edit custom field'}
            </h3>
            {editing === 'new' ? (
              <Input
                label="Field name (letters, digits, single spaces)"
                value={key}
                maxLength={40}
                onChange={(e) => setKey(e.target.value)}
              />
            ) : null}
            <Input
              label="Label"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              label="Fallback text (when a client has no value)"
              value={fallback}
              maxLength={200}
              onChange={(e) => setFallback(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={!label.trim() || (editing === 'new' && !key.trim()) || save.isPending}
              >
                Save Field
              </Button>
              <Button variant="secondary" onClick={() => setEditing(undefined)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="w-fit text-sm font-medium text-link"
            onClick={() => {
              setEditing('new');
              setKey('');
              setLabel('');
              setFallback('');
            }}
          >
            + Add a custom field
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Branding & Letterhead: the footer, disclaimer and signature added to client messages. */
export function BrandingDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const q = useApiQuery([...TEMPLATES_KEY, 'branding'], () => api.templates.branding());
  if (!q.data) {
    return (
      <Modal
        open
        title="Branding & Letterhead"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className={quiet}>{q.isError ? 'Branding is not available right now.' : 'Loading…'}</p>
      </Modal>
    );
  }
  return <BrandingForm initial={q.data} onClose={onClose} onDone={onDone} />;
}
function BrandingForm({
  initial,
  onClose,
  onDone,
}: {
  initial: {
    footerText: string | null;
    disclaimer: string | null;
    signatureText: string | null;
    letterheadEnabled: boolean;
    businessName: string | null;
    logoUrl: string | null;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    footer: initial.footerText ?? '',
    disclaimer: initial.disclaimer ?? '',
    signature: initial.signatureText ?? '',
    letterhead: initial.letterheadEnabled,
  });
  const save = useApiMutation(
    () =>
      api.templates.saveBranding({
        footerText: f.footer.trim() || null,
        disclaimer: f.disclaimer.trim() || null,
        signatureText: f.signature.trim() || null,
        letterheadEnabled: f.letterhead,
      }),
    { invalidate: [...TEMPLATES_KEY] },
  );
  return (
    <Modal
      open
      title="Branding & Letterhead"
      subtitle="Your logo and business name come from Settings."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onDone })}
          >
            Save Branding
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="branding-form">
        <p className="text-sm text-text">
          Business name:{' '}
          <span className="font-semibold text-heading">{initial.businessName ?? 'Not set'}</span> ·
          Logo: {initial.logoUrl ? 'set' : 'not set'}
        </p>
        <Textarea
          label="Footer text"
          value={f.footer}
          rows={2}
          maxLength={1000}
          onChange={(e) => setF({ ...f, footer: e.target.value })}
        />
        <Textarea
          label="Disclaimer"
          value={f.disclaimer}
          rows={2}
          maxLength={2000}
          onChange={(e) => setF({ ...f, disclaimer: e.target.value })}
        />
        <Textarea
          label="Signature"
          value={f.signature}
          rows={2}
          maxLength={1000}
          onChange={(e) => setF({ ...f, signature: e.target.value })}
        />
        <Checkbox
          label="Use the letterhead on letters and notices"
          checked={f.letterhead}
          onChange={(e) => setF({ ...f, letterhead: e.target.checked })}
        />
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, TEMPLATE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Template Categories: rename, reorder, merge and archive, one kind at a time. */
export function CategoriesDialog({
  initialKind = 'EMAIL',
  onClose,
}: {
  initialKind?: MessageTemplateKind;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<MessageTemplateKind>(initialKind);
  const list = useApiQuery([...TEMPLATES_KEY, 'categories', kind, 'all'], () =>
    api.templates.categories({ kind, includeArchived: true }),
  );
  const [name, setName] = useState('');
  const [rename, setRename] = useState<{ id: string; name: string }>();
  const [mergeFrom, setMergeFrom] = useState<string>();
  const [into, setInto] = useState('');
  const [error, setError] = useState<string>();
  const options = { invalidate: [...TEMPLATES_KEY] };
  const fail = (e: unknown) => setError(errorMessage(e, TEMPLATE_ERRORS));
  const create = useApiMutation(
    () => api.templates.createCategory({ kind, name: name.trim() }),
    options,
  );
  const update = useApiMutation(
    (v: { id: string; name: string }) => api.templates.updateCategory(v.id, { name: v.name }),
    options,
  );
  const reorder = useApiMutation(
    (ids: string[]) => api.templates.reorderCategories({ kind, ids }),
    options,
  );
  const merge = useApiMutation(
    (v: { id: string; into: string }) => api.templates.mergeCategory(v.id, { intoId: v.into }),
    options,
  );
  const archive = useApiMutation((id: string) => api.templates.archiveCategory(id), options);
  const restore = useApiMutation((id: string) => api.templates.restoreCategory(id), options);
  const rows = list.data ?? [];
  const live = rows.filter((c) => !c.archivedAt);
  const move = (index: number, d: number) => {
    const ids = live.map((c) => c.id);
    const j = index + d;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    reorder.mutate(ids, { onError: fail });
  };
  return (
    <Modal
      open
      title="Template Categories"
      subtitle="Organize templates into categories for easy access."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="categories-dialog">
        <Select
          label="Kind of template"
          value={kind}
          onChange={(e) => setKind(e.target.value as MessageTemplateKind)}
          options={KINDS.map((k) => ({ value: k.kind, label: k.noun }))}
        />
        {rows.length === 0 ? (
          <p className={quiet}>
            {list.isPending
              ? 'Loading…'
              : list.isError
                ? 'Categories are not available right now.'
                : `No ${kindOf(kind).noun} categories yet.`}
          </p>
        ) : (
          <ul className="rounded-lg border border-divider">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 border-t border-divider px-3 py-2 text-sm first:border-t-0"
              >
                {rename?.id === c.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      update.mutate(
                        { id: c.id, name: rename.name.trim() },
                        { onSuccess: () => setRename(undefined), onError: fail },
                      );
                    }}
                  >
                    <Input
                      label="Category name"
                      hideLabel
                      value={rename.name}
                      maxLength={100}
                      onChange={(e) => setRename({ id: c.id, name: e.target.value })}
                    />
                    <Button type="submit">Save</Button>
                  </form>
                ) : (
                  <span
                    className={`min-w-0 flex-1 ${c.archivedAt ? 'text-muted line-through' : 'font-medium text-heading'}`}
                  >
                    {c.name} <span className="text-xs text-muted">({c.templateCount})</span>
                  </span>
                )}
                {!c.archivedAt ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${c.name} up`}
                      onClick={() => move(live.indexOf(c), -1)}
                      className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-canvas"
                    >
                      <ArrowUp aria-hidden weight="bold" className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${c.name} down`}
                      onClick={() => move(live.indexOf(c), 1)}
                      className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-canvas"
                    >
                      <ArrowDown aria-hidden weight="bold" className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="px-2 text-sm font-medium text-link"
                      onClick={() => setRename({ id: c.id, name: c.name })}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="px-2 text-sm font-medium text-link"
                      onClick={() => {
                        setMergeFrom(c.id);
                        setInto('');
                      }}
                    >
                      Merge
                    </button>
                    <button
                      type="button"
                      className="px-2 text-sm font-medium text-danger"
                      onClick={() => archive.mutate(c.id, { onError: fail })}
                    >
                      Archive
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="px-2 text-sm font-medium text-link"
                    onClick={() => restore.mutate(c.id, { onError: fail })}
                  >
                    Restore
                  </button>
                )}
                {mergeFrom === c.id ? (
                  <div className="flex w-full items-end gap-2">
                    <Select
                      label={`Merge ${c.name} into`}
                      value={into}
                      onChange={(e) => setInto(e.target.value)}
                      options={[
                        { value: '', label: 'Choose a category' },
                        ...live
                          .filter((x) => x.id !== c.id)
                          .map((x) => ({ value: x.id, label: x.name })),
                      ]}
                    />
                    <Button
                      disabled={!into}
                      onClick={() =>
                        merge.mutate(
                          { id: c.id, into },
                          { onSuccess: () => setMergeFrom(undefined), onError: fail },
                        )
                      }
                    >
                      Merge
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setError(undefined);
            create.mutate(undefined, { onSuccess: () => setName(''), onError: fail });
          }}
        >
          <Input
            label="New category"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Add Category
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
