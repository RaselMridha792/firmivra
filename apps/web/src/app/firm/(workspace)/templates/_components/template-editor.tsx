'use client';

import {
  ApiRequestError,
  type MessageTemplateDetail,
  type MessageTemplateKind,
  type MergeField,
  TEMPLATE_ATTACHMENT_MAX_BYTES,
  TEMPLATE_ATTACHMENT_TYPES,
} from '@firmivra/types';
import {
  Button,
  Checkbox,
  FileDropzone,
  Input,
  Modal,
  RichTextEditor,
  Select,
  Textarea,
  Toast,
} from '@firmivra/ui';
import { ArrowLeft, Copy, Eye, FloppyDisk, PaperPlaneTilt, Trash, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';
import { PreviewDialog } from './template-dialogs';
import {
  AUTOMATION_KINDS,
  HAS_SUBJECT,
  KINDS,
  KindTile,
  TEMPLATES_KEY,
  TEMPLATE_ERRORS,
  card,
  dayText,
  fieldCls,
  gold,
  kindBySlug,
  kindOf,
  outlined,
  quiet,
  subtle,
} from './templates-shared';

const GROUPS: { id: 'ALL' | MergeField['group']; label: string }[] = [
  { id: 'ALL', label: 'All Fields' },
  { id: 'CLIENT', label: 'Client' },
  { id: 'COMPANY', label: 'Company' },
  { id: 'APPOINTMENT', label: 'Appointment' },
  { id: 'INVOICE', label: 'Invoice' },
  { id: 'CUSTOM', label: 'Custom' },
];

interface Form {
  name: string;
  categoryId: string;
  status: 'DRAFT' | 'ACTIVE';
  subject: string;
  body: string;
  access: 'PRIVATE' | 'TEAM' | 'SELECTED';
  shared: string[];
  automations: boolean;
  tags: string[];
}
const blank = (): Form => ({
  name: '',
  categoryId: '',
  status: 'DRAFT',
  subject: '',
  body: '',
  access: 'TEAM',
  shared: [],
  automations: false,
  tags: [],
});
const fromDetail = (d: MessageTemplateDetail): Form => ({
  name: d.name,
  categoryId: d.category?.id ?? '',
  status: d.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
  subject: d.subject ?? '',
  body: d.body,
  access: d.access,
  shared: d.sharedWith.map((m) => m.userId),
  automations: d.includeInAutomations,
  tags: d.tags,
});

/** /templates/new and /templates/[id]/edit. */
export function TemplateEditorScreen({ id, kindSlug }: { id?: string; kindSlug?: string }) {
  const detail = useApiQuery([...TEMPLATES_KEY, 'detail', id ?? 'new'], async () =>
    id ? api.templates.get(id) : undefined,
  );
  if (id && !detail.data) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/templates"
          className="flex w-fit items-center gap-2 text-sm font-medium text-link"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Templates
        </Link>
        <p className={`${card} ${quiet}`}>
          {detail.isError ? 'This template is not available right now.' : 'Loading…'}
        </p>
      </div>
    );
  }
  const kind: MessageTemplateKind =
    detail.data?.kind ??
    kindBySlug(kindSlug ?? '')?.kind ??
    KINDS.find((k) => k.kind === kindSlug)?.kind ??
    'EMAIL';
  return <Editor key={id ?? `new-${kind}`} id={id} kind={kind} initial={detail.data} />;
}

function Editor({
  id,
  kind,
  initial,
}: {
  id: string | undefined;
  kind: MessageTemplateKind;
  initial: MessageTemplateDetail | undefined;
}) {
  const router = useRouter();
  const meta = kindOf(kind);
  const [saved, setSaved] = useState<MessageTemplateDetail | undefined>(initial);
  const [form, setForm] = useState<Form>(() => (initial ? fromDetail(initial) : blank()));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(initial ? fromDetail(initial) : blank()),
  );
  const [errors, setErrors] = useState<Partial<Record<'name' | 'subject' | 'body', string>>>({});
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [preview, setPreview] = useState(false);
  const [impact, setImpact] = useState<string>();
  const [tagText, setTagText] = useState('');
  const [fieldSearch, setFieldSearch] = useState('');
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('ALL');
  const [target, setTarget] = useState<'subject' | 'body'>('body');
  const [uploading, setUploading] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const set = (change: Partial<Form>) => setForm((cur) => ({ ...cur, ...change }));
  const dirty = JSON.stringify(form) !== baseline;
  const hasSubject = HAS_SUBJECT.includes(kind);
  const eligible = AUTOMATION_KINDS.includes(kind);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const cats = useApiQuery([...TEMPLATES_KEY, 'categories', kind], () =>
    api.templates.categories({ kind }),
  );
  const fields = useApiQuery([...TEMPLATES_KEY, 'merge-fields'], () => api.templates.mergeFields());
  const team = useApiQuery([...TEMPLATES_KEY, 'members'], () => api.team.list());
  const versions = useApiQuery(
    [...TEMPLATES_KEY, 'versions', id ?? 'none', saved?.version ?? 0],
    async () => (id ? api.templates.versions(id) : []),
  );
  const options = { invalidate: [...TEMPLATES_KEY] };
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, TEMPLATE_ERRORS), tone: 'error' });

  const check = (status: Form['status']): boolean => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = 'Enter the template name';
    if (hasSubject && status === 'ACTIVE' && !form.subject.trim()) e.subject = 'Add a subject line';
    if (!form.body.replace(/<[^>]+>/g, '').trim()) e.body = 'Write the template';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const save = useApiMutation(async (v: { status: Form['status']; confirm: boolean }) => {
    const common = {
      categoryId: form.categoryId || null,
      name: form.name.trim(),
      subject: hasSubject ? form.subject.trim() || null : null,
      body: form.body,
      status: v.status,
      access: form.access,
      sharedWithUserIds: form.access === 'SELECTED' ? form.shared : [],
      tags: form.tags,
      includeInAutomations: eligible ? form.automations : false,
    };
    if (saved) {
      return api.templates.update(saved.id, {
        ...common,
        etag: saved.etag,
        ...(v.confirm ? { confirmAutomationImpact: true } : {}),
      });
    }
    return api.templates.create({ kind, ...common });
  }, options);
  const doSave = (status: Form['status'], confirm = false) => {
    if (!check(status)) return;
    save.mutate(
      { status, confirm },
      {
        onSuccess: (d) => {
          setImpact(undefined);
          setSaved(d);
          const next = {
            ...form,
            status: d.status === 'ACTIVE' ? ('ACTIVE' as const) : ('DRAFT' as const),
          };
          setForm(next);
          setBaseline(JSON.stringify(next));
          setMessage({
            text: status === 'DRAFT' ? 'Draft saved.' : 'Template saved.',
            tone: 'success',
          });
          if (!id) router.replace(`/templates/${d.id}/edit`);
        },
        onError: (e) => {
          if (e instanceof ApiRequestError && e.code === 'AUTOMATION_IN_USE') setImpact(e.message);
          else fail(e);
        },
      },
    );
  };
  const duplicate = useApiMutation(
    () => api.templates.duplicate((saved as MessageTemplateDetail).id),
    options,
  );
  const archive = useApiMutation(
    (confirm: boolean) =>
      api.templates.archive(
        (saved as MessageTemplateDetail).id,
        confirm ? { confirmAutomationImpact: true } : {},
      ),
    options,
  );
  const restoreVersion = useApiMutation(
    (v: number) => api.templates.restoreVersion((saved as MessageTemplateDetail).id, v),
    options,
  );

  /** Insert a merge field where the cursor is: the subject line or the content. */
  const insert = (token: string) => {
    if (target === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const start = el.selectionStart ?? form.subject.length;
      const end = el.selectionEnd ?? start;
      set({ subject: `${form.subject.slice(0, start)}${token}${form.subject.slice(end)}` });
      return;
    }
    const area = bodyRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (area && document.activeElement === area) document.execCommand('insertText', false, token);
    else
      set({
        body: `${form.body}${form.body.endsWith('>') || form.body === '' ? '<p>' : ' '}${token}${form.body.endsWith('>') || form.body === '' ? '</p>' : ''}`,
      });
  };

  const shownFields = (fields.data ?? []).filter(
    (f) =>
      (group === 'ALL' || f.group === group) &&
      (!fieldSearch.trim() ||
        `${f.key} ${f.label}`.toLowerCase().includes(fieldSearch.trim().toLowerCase())),
  );
  const addTag = () => {
    const t = tagText.trim();
    if (t && !form.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && form.tags.length < 20)
      set({ tags: [...form.tags, t] });
    setTagText('');
  };
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const unknown = saved?.mergeFields.unknown ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="template-editor">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/templates" className="text-link">
          Templates
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <Link href={`/templates/library/${meta.slug}`} className="text-link">
          {meta.title}
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">
          {id ? 'Edit Template' : 'Create Template'}
        </span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <KindTile kind={kind} size="lg" />
          <div className="min-w-0">
            <h1
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
              data-testid="editor-title"
            >
              {id ? 'Edit' : 'Create'} {meta.noun} Template
            </h1>
            <p className="text-base text-muted">
              Design a reusable {meta.noun.toLowerCase()} template for clients, leads, or your team.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={outlined}
            disabled={!saved}
            title={saved ? undefined : 'Save the template to preview it'}
            onClick={() => setPreview(true)}
          >
            <Eye aria-hidden weight="fill" className="size-4" /> Preview Template
          </button>
          <button
            type="button"
            className={gold}
            disabled={!saved}
            title={saved ? undefined : 'Save the template to send a test'}
            onClick={() => setPreview(true)}
          >
            <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Test Send
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {unknown.length > 0 ? (
        <p
          role="alert"
          className="rounded-lg bg-warning-soft p-3 text-sm text-warning"
          data-testid="unknown-fields"
        >
          Unknown merge fields in this template: {unknown.map((u) => `[${u}]`).join(', ')}. They
          will not be filled in.
        </p>
      ) : null}
      {saved?.status === 'ARCHIVED' ? (
        <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
          This template is archived. Restore it from the library to edit it.
        </p>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section
          className={`${card} flex flex-col gap-4`}
          aria-label="Template content"
          data-testid="editor-main"
        >
          <div className="grid gap-3 md:grid-cols-[2fr_1.5fr_1fr]">
            <Input
              label="Template Name *"
              value={form.name}
              maxLength={200}
              onChange={(e) => set({ name: e.target.value })}
              {...(errors.name ? { error: errors.name } : {})}
            />
            <Select
              label="Category"
              value={form.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
              options={[
                { value: '', label: 'No category' },
                ...(saved?.category && !(cats.data ?? []).some((c) => c.id === saved.category?.id)
                  ? [{ value: saved.category.id, label: saved.category.name }]
                  : []),
                ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => set({ status: e.target.value as Form['status'] })}
              options={[
                { value: 'DRAFT', label: 'Draft' },
                { value: 'ACTIVE', label: 'Active' },
              ]}
            />
          </div>
          {hasSubject ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="te-subject" className="text-sm font-medium text-text">
                Subject Line <span className="text-danger">*</span>
              </label>
              <input
                id="te-subject"
                ref={subjectRef}
                value={form.subject}
                maxLength={300}
                onFocus={() => setTarget('subject')}
                onChange={(e) => set({ subject: e.target.value })}
                className={fieldCls}
              />
              {errors.subject ? <p className="text-xs text-danger">{errors.subject}</p> : null}
            </div>
          ) : null}
          <div ref={bodyRef} onFocusCapture={() => setTarget('body')}>
            {kind === 'SMS' ? (
              <div>
                <Textarea
                  label="Message *"
                  value={form.body}
                  rows={6}
                  maxLength={1000}
                  onChange={(e) => set({ body: e.target.value })}
                  onFocus={() => setTarget('body')}
                  {...(errors.body ? { error: errors.body } : {})}
                />
                <p className="mt-1 text-xs text-muted">
                  {form.body.length} characters · {Math.max(1, Math.ceil(form.body.length / 160))}{' '}
                  text part(s). Plain text only.
                </p>
              </div>
            ) : (
              <RichTextEditor
                label={`${meta.noun} Content`}
                required
                value={form.body}
                onChange={(html) => set({ body: html })}
                maxLength={50_000}
                {...(errors.body ? { error: errors.body } : {})}
              />
            )}
          </div>
        </section>

        <aside
          className={`${card} flex flex-col gap-3`}
          aria-label="Merge Fields"
          data-testid="merge-panel"
        >
          <h2 className="font-display text-lg font-bold text-heading">Merge Fields</h2>
          <Input
            label="Search merge fields"
            hideLabel
            placeholder="Search merge fields…"
            value={fieldSearch}
            onChange={(e) => setFieldSearch(e.target.value)}
          />
          <div role="tablist" aria-label="Merge field groups" className="flex flex-wrap gap-1">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={group === g.id}
                onClick={() => setGroup(g.id)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${group === g.id ? 'bg-warning-soft text-heading' : 'bg-canvas text-text hover:bg-folder-surface'}`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <ul
            className="max-h-96 overflow-auto rounded-lg border border-divider"
            data-testid="merge-list"
          >
            {shownFields.length === 0 ? (
              <li className="p-3 text-sm text-muted">
                {fields.isPending
                  ? 'Loading…'
                  : fields.isError
                    ? 'Merge fields are not available right now.'
                    : 'No merge fields match.'}
              </li>
            ) : (
              shownFields.map((f) => (
                <li key={f.token} className="border-t border-divider first:border-t-0">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(f.token)}
                    aria-label={`Insert ${f.token}`}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-canvas"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-heading">{f.token}</span>
                      <span className="block truncate text-xs text-muted">{f.label}</span>
                    </span>
                    <Copy aria-hidden weight="regular" className="size-4 shrink-0 text-muted" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Attachments" data-testid="attachments">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">
            Attachments <span className="text-sm font-normal text-muted">(Optional)</span>
          </h2>
          {saved ? (
            <>
              <FileDropzone
                label="Template attachments"
                multiple
                accept={[...TEMPLATE_ATTACHMENT_TYPES]}
                maxBytes={TEMPLATE_ATTACHMENT_MAX_BYTES}
                hints={['PDF, DOCX, XLSX, JPG, PNG (Max 10MB per file)']}
                disabled={uploading || saved.status === 'ARCHIVED'}
                onReject={(r) =>
                  setMessage({
                    text: `${r[0]?.file.name ?? 'That file'} cannot be attached.`,
                    tone: 'error',
                  })
                }
                onFiles={async (files) => {
                  setUploading(true);
                  try {
                    for (const file of files) {
                      await uploadFile(file, {
                        start: (facts) => api.templates.startAttachment(saved.id, facts),
                        finish: (uploadToken) => api.templates.confirmAttachment({ uploadToken }),
                      });
                    }
                    setSaved(await api.templates.get(saved.id));
                    setMessage({ text: 'Attachment added.', tone: 'success' });
                  } catch (e) {
                    fail(e);
                  } finally {
                    setUploading(false);
                  }
                }}
              />
              {saved.attachments.length > 0 ? (
                <ul className="mt-3 flex flex-col">
                  {saved.attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
                    >
                      <span className="min-w-0 truncate text-heading">{a.fileName}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {Math.max(1, Math.round(a.sizeBytes / 1024))} KB
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.fileName}`}
                        className="text-danger"
                        onClick={async () => {
                          try {
                            await api.templates.removeAttachment(saved.id, a.id);
                            setSaved(await api.templates.get(saved.id));
                          } catch (e) {
                            fail(e);
                          }
                        }}
                      >
                        <Trash aria-hidden weight="fill" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className={quiet}>Save the template first, then add attachments.</p>
          )}
        </section>

        <section
          className={`${card} flex flex-col gap-3`}
          aria-label="Template Settings"
          data-testid="settings"
        >
          <h2 className="font-display text-lg font-bold text-heading">Template Settings</h2>
          <Select
            label="Who Can Use This Template"
            value={form.access}
            onChange={(e) => set({ access: e.target.value as Form['access'] })}
            options={[
              { value: 'PRIVATE', label: 'Only me' },
              { value: 'TEAM', label: 'All Team Members' },
              { value: 'SELECTED', label: 'Selected people' },
            ]}
          />
          {form.access === 'SELECTED' ? (
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium text-text">Share with</legend>
              {members.map((m) => (
                <Checkbox
                  key={m.user.id}
                  label={m.user.name}
                  checked={form.shared.includes(m.user.id)}
                  onChange={(e) =>
                    set({
                      shared: e.target.checked
                        ? [...form.shared, m.user.id]
                        : form.shared.filter((x) => x !== m.user.id),
                    })
                  }
                />
              ))}
            </fieldset>
          ) : null}
          <Checkbox
            label="Include in Automations"
            checked={eligible && form.automations}
            disabled={!eligible}
            onChange={(e) => set({ automations: e.target.checked })}
          />
          {!eligible ? (
            <p className="-mt-2 text-xs text-muted">
              This kind of template cannot be used in automations.
            </p>
          ) : form.status === 'DRAFT' && form.automations ? (
            <p className="-mt-2 text-xs text-muted">
              A draft is not offered to automations until it is active.
            </p>
          ) : null}
          {saved ? (
            <Checkbox
              label="Add to Favorites"
              checked={saved.favorite}
              onChange={async (e) => {
                try {
                  setSaved(
                    e.target.checked
                      ? await api.templates.favorite(saved.id)
                      : await api.templates.unfavorite(saved.id),
                  );
                } catch (err) {
                  fail(err);
                }
              }}
            />
          ) : null}
          <div>
            <label htmlFor="te-tags" className="text-sm font-medium text-text">
              Tags (Optional)
            </label>
            <input
              id="te-tags"
              value={tagText}
              maxLength={40}
              placeholder="Add a tag and press Enter…"
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              className={fieldCls}
            />
            {form.tags.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {form.tags.map((t) => (
                  <li
                    key={t}
                    className="flex items-center gap-1 rounded-md bg-warning-soft px-2 py-1 text-xs text-heading"
                  >
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => set({ tags: form.tags.filter((x) => x !== t) })}
                    >
                      <X aria-hidden weight="bold" className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>

      {saved && (versions.data ?? []).length > 0 ? (
        <section className={card} aria-label="Version history" data-testid="versions">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Version History</h2>
          <ul>
            {(versions.data ?? []).slice(0, 6).map((v) => (
              <li
                key={v.version}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
              >
                <span className="text-heading">
                  Version {v.version} · {v.name}
                </span>
                <span className="text-xs text-muted">
                  {dayText(v.savedAt)} · {v.savedBy.name}
                </span>
                {v.version !== saved.version ? (
                  <button
                    type="button"
                    className="text-sm font-medium text-link"
                    onClick={() =>
                      restoreVersion.mutate(v.version, {
                        onSuccess: (d) => {
                          setSaved(d);
                          const f = fromDetail(d);
                          setForm(f);
                          setBaseline(JSON.stringify(f));
                          setMessage({
                            text: `Version ${v.version} restored as a new version.`,
                            tone: 'success',
                          });
                        },
                        onError: fail,
                      })
                    }
                  >
                    Restore<span className="sr-only"> version {v.version}</span>
                  </button>
                ) : (
                  <span className="text-xs text-muted">Current</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/templates/library/${meta.slug}`} className={subtle}>
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={outlined}
            disabled={save.isPending}
            onClick={() => doSave('DRAFT')}
            data-testid="save-draft"
          >
            <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Draft
          </button>
          {saved ? (
            <>
              <button
                type="button"
                className={outlined}
                disabled={duplicate.isPending}
                onClick={() =>
                  duplicate.mutate(undefined, {
                    onSuccess: (d) => router.push(`/templates/${d.id}/edit`),
                    onError: fail,
                  })
                }
              >
                <Copy aria-hidden weight="fill" className="size-4" /> Duplicate Template
              </button>
              {saved.status !== 'ARCHIVED' ? (
                <button
                  type="button"
                  className={`${subtle} text-danger`}
                  onClick={() =>
                    archive.mutate(false, {
                      onSuccess: () => router.push(`/templates/library/${meta.slug}`),
                      onError: (e) =>
                        e instanceof ApiRequestError && e.code === 'AUTOMATION_IN_USE'
                          ? setImpact(`archive:${e.message}`)
                          : fail(e),
                    })
                  }
                >
                  Archive
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            className={gold}
            disabled={save.isPending || saved?.status === 'ARCHIVED'}
            onClick={() => doSave(form.status === 'DRAFT' && !saved ? 'ACTIVE' : form.status)}
            data-testid="save-template"
          >
            <FloppyDisk aria-hidden weight="fill" className="size-5" /> Save Template
          </button>
        </div>
      </footer>
      {preview && saved ? (
        <PreviewDialog template={saved} onClose={() => setPreview(false)} />
      ) : null}
      {impact ? (
        <Modal
          open
          title={impact.startsWith('archive:') ? 'Archive template?' : 'Save changes?'}
          subtitle={saved?.name}
          onClose={() => setImpact(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setImpact(undefined)}>
                Keep Editing
              </Button>
              <Button
                onClick={() =>
                  impact.startsWith('archive:')
                    ? archive.mutate(true, {
                        onSuccess: () => router.push(`/templates/library/${meta.slug}`),
                        onError: fail,
                      })
                    : doSave(form.status, true)
                }
              >
                {impact.startsWith('archive:') ? 'Archive Anyway' : 'Save Anyway'}
              </Button>
            </>
          }
        >
          <p role="alert" className="text-sm text-warning" data-testid="automation-warning">
            {impact.replace('archive:', '')} Changing or archiving it affects what those automations
            send.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
