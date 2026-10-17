'use client';

import {
  TEMPLATE_ATTACHMENT_MAX_BYTES,
  TEMPLATE_ATTACHMENT_TYPES,
  type CommunicationDetail,
  type CommunicationRow,
} from '@firmivra/types';
import {
  Button,
  FileDropzone,
  Input,
  Modal,
  Radio,
  RichTextEditor,
  Select,
  Textarea,
  Toast,
} from '@firmivra/ui';
import {
  ArrowLeft,
  CheckCircle,
  Info,
  FileText,
  Trash,
  UsersThree,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { uploadFile } from '../../../../../lib/upload';
import { SaveTemplateDialog } from './communication-actions';
import { RecipientsModal } from './recipients-modal';
import { ReviewDialog } from './review-dialog';
import {
  CHANNELS,
  COMM_ERRORS,
  COMM_KEY,
  card,
  channelOf,
  dateTimeText,
  outlined,
  plain,
  quiet,
  StatusPill,
  subtle,
} from './communications-shared';

const FIELDS = [
  'Client First Name',
  'Client Full Name',
  'Business Name',
  'Staff Name',
  'Company Phone',
  'Document Upload Link',
];

interface Form {
  name: string;
  senderId: string;
  replyTo: string;
  subject: string;
  previewText: string;
  body: string;
  publishStartsAt: string;
  publishEndsAt: string;
  visibility: string;
}
const local = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const formOf = (d: CommunicationDetail): Form => ({
  name: d.name,
  senderId: d.sender?.id ?? '',
  replyTo: d.replyTo ?? '',
  subject: d.subject ?? '',
  previewText: d.previewText ?? '',
  body: d.body,
  publishStartsAt: local(d.publishStartsAt),
  publishEndsAt: local(d.publishEndsAt),
  visibility: d.visibility ?? '',
});

/** /communications/[id]/edit: the channel-aware composer. */
export function Composer({ id }: { id: string }) {
  const detail = useApiQuery([...COMM_KEY, 'detail', id], () => api.communications.get(id));
  if (detail.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="composer-error">
        <Link href="/communications" className="text-sm font-medium text-link">
          ← Back to Communications
        </Link>
        <p role="alert" className={quiet}>
          This communication is not available. It may have been removed, or we could not load it.
        </p>
      </div>
    );
  if (!detail.data) return <p className={quiet}>Loading…</p>;
  return <ComposerForm key={detail.data.id} initial={detail.data} />;
}

function ComposerForm({ initial }: { initial: CommunicationDetail }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [d, setD] = useState(initial);
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [dialog, setDialog] = useState<
    'recipients' | 'test' | 'template' | 'review' | 'strip' | 'saveTemplate'
  >();
  const [mode, setMode] = useState<'NOW' | 'LATER'>(() => (initial.scheduledFor ? 'LATER' : 'NOW'));
  const [when, setWhen] = useState(
    () => local(initial.scheduledFor) || local(new Date(Date.now() + 86_400_000).toISOString()),
  );
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [pendingChannel, setPendingChannel] = useState<CommunicationRow['channel']>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const channel = d.channel;
  const meta = channelOf(channel);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const senders = useApiQuery([...COMM_KEY, 'senders'], () => api.communications.senders());
  const locations = useApiQuery([...COMM_KEY, 'locations'], () =>
    api.communications.announcementLocations(),
  );
  const review = useApiQuery([...COMM_KEY, 'review', d.id, d.etag, 'side'], () =>
    api.communications.review(d.id),
  );
  const preview = useApiQuery([...COMM_KEY, 'preview', d.id, d.etag], () =>
    api.communications.preview(d.id),
  );
  const readOnly = !d.editable;
  const mine = (senders.data ?? []).filter((s) => s.channel === channel);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(d));

  const refresh = async () => {
    const next = await api.communications.get(d.id);
    setD(next);
    setForm(formOf(next));
    await qc.invalidateQueries({ queryKey: [...COMM_KEY, 'list'] });
    return next;
  };
  /** Sends only what changed, with the etag. Answers the fresh detail, or undefined after reporting the problem. */
  const save = async (quiet = false): Promise<CommunicationDetail | undefined> => {
    if (!dirty) return d;
    const base = formOf(d);
    const patch: Record<string, unknown> = {};
    if (form.name !== base.name) patch.name = form.name.trim() || 'Untitled communication';
    if (form.senderId !== base.senderId) patch.senderId = form.senderId || null;
    if (form.replyTo !== base.replyTo) patch.replyTo = form.replyTo.trim() || null;
    if (form.subject !== base.subject) patch.subject = form.subject.trim() || null;
    if (form.previewText !== base.previewText) patch.previewText = form.previewText.trim() || null;
    if (form.body !== base.body) patch.body = form.body;
    if (form.publishStartsAt !== base.publishStartsAt)
      patch.publishStartsAt = form.publishStartsAt
        ? new Date(form.publishStartsAt).toISOString()
        : null;
    if (form.publishEndsAt !== base.publishEndsAt)
      patch.publishEndsAt = form.publishEndsAt ? new Date(form.publishEndsAt).toISOString() : null;
    if (form.visibility !== base.visibility) patch.visibility = form.visibility || null;
    setSaving(true);
    try {
      const next = await api.communications.update(d.id, { ...patch, etag: d.etag });
      setD(next);
      setForm(formOf(next));
      if (!quiet) notice('Draft saved.', 'success');
      return next;
    } catch (e) {
      notice(errorMessage(e, COMM_ERRORS), 'error');
      return undefined;
    } finally {
      setSaving(false);
    }
  };
  const switchTo = async (to: CommunicationRow['channel'], confirm = false) => {
    if (to === channel) return;
    const saved = await save(true);
    if (!saved) return;
    try {
      const next = await api.communications.update(saved.id, {
        channel: to,
        ...(confirm ? { confirmStripContent: true } : {}),
        etag: saved.etag,
      });
      setD(next);
      setForm(formOf(next));
      setDialog(undefined);
    } catch (e) {
      if (
        e instanceof Error &&
        'code' in e &&
        (e as { code: string }).code === 'CONTENT_WOULD_BE_LOST'
      ) {
        setPendingChannel(to);
        setDialog('strip');
      } else notice(errorMessage(e, COMM_ERRORS), 'error');
    }
  };

  const checks = review.data?.checks ?? [];
  const saveDraft = (
    <button
      type="button"
      disabled={readOnly || saving || !dirty}
      className={outlined}
      onClick={() => void save()}
    >
      Save Draft
    </button>
  );
  const sendTest = (
    <button
      type="button"
      disabled={readOnly || channel === 'ANNOUNCEMENT'}
      className={subtle}
      onClick={() => void save(true).then((s) => s && setDialog('test'))}
    >
      Send Test
    </button>
  );
  const reviewBtn = (
    <button
      type="button"
      disabled={readOnly || saving || !d.canSend}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50"
      onClick={() =>
        void save(true).then((s) => {
          if (s) setDialog('review');
        })
      }
    >
      Review &amp; {mode === 'LATER' && channel !== 'ANNOUNCEMENT' ? 'Schedule' : 'Send'}
    </button>
  );
  const typeLabel = { EMAIL: 'Email', SMS: 'Text Message (SMS)', ANNOUNCEMENT: 'Announcement' };
  const chips = d.audience?.chips.filter((c) => !c.kind.startsWith('EXCLUDE')) ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="composer">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/communications" aria-label="Back to Communications" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/communications" className="text-link">
          Communications
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">
          {d.status === 'DRAFT' ? 'New Communication' : 'Edit Communication'}
        </span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-heading">
              Create New Communication
            </h1>
            <StatusPill status={d.status} />
          </div>
          <p className="text-base text-muted">
            Build, preview, and send a message to the right audience.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Top actions">
          {saveDraft}
          {sendTest}
          {reviewBtn}
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {readOnly ? (
        <p
          role="status"
          className="rounded-lg bg-warning-soft p-3 text-sm text-warning"
          data-testid="read-only"
        >
          This communication can no longer be edited.{' '}
          <Link href={`/communications/${d.id}`} className="font-medium underline">
            View it
          </Link>
        </p>
      ) : null}

      <section className={card} aria-label="Communication type">
        <h2 className="mb-2 text-sm font-semibold text-heading">Communication Type</h2>
        <div
          role="tablist"
          aria-label="Communication type"
          className="grid grid-cols-3 overflow-hidden rounded-control border border-border"
        >
          {CHANNELS.map((c) => (
            <button
              key={c.channel}
              type="button"
              role="tab"
              aria-selected={channel === c.channel}
              disabled={readOnly || saving}
              onClick={() => void switchTo(c.channel)}
              className={`inline-flex min-h-11 items-center justify-center gap-2 px-2 text-sm ${channel === c.channel ? 'bg-action font-semibold text-on-action' : 'font-medium text-heading hover:bg-canvas'}`}
            >
              <c.icon aria-hidden weight="fill" className="size-4 shrink-0" />
              <span className="truncate">{typeLabel[c.channel]}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section
          className={`${card} flex flex-col gap-4`}
          aria-label="Message"
          data-testid="composer-form"
        >
          <Input
            label={channel === 'ANNOUNCEMENT' ? 'Announcement Name' : 'Campaign Name'}
            value={form.name}
            disabled={readOnly}
            onChange={(e) => set({ name: e.target.value })}
          />

          {channel !== 'ANNOUNCEMENT' ? (
            <div className="flex flex-col gap-1" data-testid="recipients-field">
              <span className="text-sm font-medium text-heading">Recipients</span>
              <div className="flex flex-wrap items-center gap-2 rounded-control border border-border p-2">
                {chips.length === 0 ? (
                  <span className="px-1 text-sm text-muted">No recipients chosen yet</span>
                ) : null}
                {chips.map((c) => (
                  <span
                    key={`${c.kind}${c.id}`}
                    className="inline-flex items-center rounded-pill bg-info-soft px-3 py-1 text-xs font-medium text-info"
                  >
                    {c.label}
                    {c.count !== null && c.kind === 'SEGMENT' ? ` (${c.count})` : ''}
                  </span>
                ))}
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => void save(true).then((s) => s && setDialog('recipients'))}
                  className={`${outlined} ml-auto min-h-9`}
                >
                  <UsersThree aria-hidden weight="bold" className="size-4" /> Choose Recipients
                </button>
              </div>
              {d.audience ? (
                <p className="text-xs text-muted" data-testid="audience-count">
                  {d.audience.finalCount} can receive this message
                  {d.audience.selectedCount - d.audience.finalCount > 0
                    ? ` · ${d.audience.selectedCount - d.audience.finalCount} left out`
                    : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
              An announcement is shown in the client portal to all of your clients.
            </p>
          )}

          {channel !== 'ANNOUNCEMENT' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={channel === 'SMS' ? 'From Number' : 'From'}
                value={form.senderId}
                disabled={readOnly}
                onChange={(e) => set({ senderId: e.target.value })}
                options={
                  mine.length
                    ? mine.map((s) => ({ value: s.id, label: s.label }))
                    : [{ value: '', label: 'No sender connected' }]
                }
              />
              {channel === 'EMAIL' ? (
                <Input
                  label="Reply-To"
                  type="email"
                  value={form.replyTo}
                  disabled={readOnly}
                  onChange={(e) => set({ replyTo: e.target.value })}
                />
              ) : null}
            </div>
          ) : null}

          {channel !== 'SMS' ? (
            <Input
              label={channel === 'ANNOUNCEMENT' ? 'Title' : 'Subject Line'}
              value={form.subject}
              disabled={readOnly}
              onChange={(e) => set({ subject: e.target.value })}
            />
          ) : null}
          {channel === 'EMAIL' ? (
            <Input
              label="Preview Text (optional)"
              value={form.previewText}
              disabled={readOnly}
              onChange={(e) => set({ previewText: e.target.value })}
            />
          ) : null}

          {channel === 'SMS' ? (
            <div>
              <Textarea
                label="Message"
                rows={5}
                value={form.body}
                disabled={readOnly}
                onChange={(e) => set({ body: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted" data-testid="sms-count">
                {form.body.length} characters · {Math.max(1, Math.ceil(form.body.length / 160))}{' '}
                text part(s). Plain text only.
              </p>
            </div>
          ) : (
            <RichTextEditor
              label="Message"
              required
              value={form.body}
              onChange={(html) => set({ body: html })}
              maxLength={50_000}
              disabled={readOnly}
            />
          )}

          <Select
            label="Personalize"
            value=""
            disabled={readOnly}
            onChange={(e) => {
              const f = e.target.value;
              if (!f) return;
              set({
                body:
                  channel === 'SMS'
                    ? `${form.body}[${f}]`
                    : /<\/p>\s*$/.test(form.body)
                      ? form.body.replace(/<\/p>\s*$/, `[${f}]</p>`)
                      : `${form.body}<p>[${f}]</p>`,
              });
            }}
            options={[
              { value: '', label: 'Insert Personalization Field' },
              ...FIELDS.map((f) => ({ value: f, label: `[${f}]` })),
            ]}
          />
          {d.mergeFields.unknown.length > 0 ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
              data-testid="unknown-fields"
            >
              <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
              Unknown merge fields: {d.mergeFields.unknown.map((u) => `[${u}]`).join(', ')}.
            </p>
          ) : null}

          {channel === 'ANNOUNCEMENT' ? (
            <div className="grid gap-3 sm:grid-cols-3" data-testid="announcement-window">
              <Input
                label="Show From"
                type="datetime-local"
                value={form.publishStartsAt}
                disabled={readOnly}
                onChange={(e) => set({ publishStartsAt: e.target.value })}
              />
              <Input
                label="Show Until"
                type="datetime-local"
                value={form.publishEndsAt}
                disabled={readOnly}
                onChange={(e) => set({ publishEndsAt: e.target.value })}
              />
              <Select
                label="Where"
                value={form.visibility}
                disabled={readOnly}
                onChange={(e) => set({ visibility: e.target.value })}
                options={[
                  { value: '', label: 'Choose…' },
                  ...(locations.data ?? []).map((l) => ({ value: l.key, label: l.label })),
                ]}
              />
            </div>
          ) : null}

          {channel !== 'SMS' ? (
            <div data-testid="attachments">
              <h2 className="mb-2 text-sm font-medium text-heading">
                Attachments <span className="font-normal text-muted">(Optional)</span>
              </h2>
              <FileDropzone
                label="Attachments"
                multiple
                accept={[...TEMPLATE_ATTACHMENT_TYPES]}
                maxBytes={TEMPLATE_ATTACHMENT_MAX_BYTES}
                hints={['PDF, DOCX, XLSX, JPG, PNG (Max 10MB per file)']}
                disabled={uploading || readOnly}
                onReject={(r) =>
                  notice(`${r[0]?.file.name ?? 'That file'} cannot be attached.`, 'error')
                }
                onFiles={async (files) => {
                  setUploading(true);
                  try {
                    for (const file of files) {
                      await uploadFile(file, {
                        start: (facts) => api.communications.startAttachment(d.id, facts),
                        finish: (uploadToken) =>
                          api.communications.confirmAttachment({ uploadToken }),
                      });
                    }
                    await refresh();
                    notice('Attachment added.', 'success');
                  } catch (e) {
                    notice(errorMessage(e, COMM_ERRORS), 'error');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
              {d.attachments.length > 0 ? (
                <ul className="mt-2">
                  {d.attachments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
                    >
                      <span className="min-w-0 truncate text-heading">{a.fileName}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${a.fileName}`}
                        disabled={readOnly}
                        onClick={async () => {
                          try {
                            await api.communications.removeAttachment(d.id, a.id);
                            await refresh();
                          } catch (e) {
                            notice(errorMessage(e, COMM_ERRORS), 'error');
                          }
                        }}
                        className="flex size-8 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
                      >
                        <Trash aria-hidden weight="bold" className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {channel === 'EMAIL' ? (
            <p className="flex items-center gap-2 rounded-lg bg-info-soft p-3 text-sm text-info">
              <Info aria-hidden weight="fill" className="size-5 shrink-0" />
              An unsubscribe link and company mailing information will be added automatically.
            </p>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Delivery and preview">
          {channel !== 'ANNOUNCEMENT' ? (
            <section className={card} aria-label="Delivery" data-testid="delivery">
              <h2 className="mb-1 font-display text-lg font-bold text-heading">Delivery</h2>
              <Radio
                name="when"
                label="Send Now"
                checked={mode === 'NOW'}
                disabled={readOnly}
                onChange={() => setMode('NOW')}
              />
              <p className="-mt-2 mb-1 pl-7 text-xs text-muted">
                Send this message immediately after you review.
              </p>
              <Radio
                name="when"
                label="Schedule for Later"
                checked={mode === 'LATER'}
                disabled={readOnly}
                onChange={() => setMode('LATER')}
              />
              <p className="-mt-2 mb-1 pl-7 text-xs text-muted">
                Choose a date and time to send this message.
              </p>
              {mode === 'LATER' ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input
                    label="Date"
                    type="date"
                    value={when.slice(0, 10)}
                    disabled={readOnly}
                    onChange={(e) => setWhen(`${e.target.value}T${when.slice(11, 16) || '09:00'}`)}
                  />
                  <Input
                    label="Time"
                    type="time"
                    value={when.slice(11, 16)}
                    disabled={readOnly}
                    onChange={(e) => setWhen(`${when.slice(0, 10)}T${e.target.value}`)}
                  />
                </div>
              ) : null}
              <div className="mt-2">
                <Select
                  label="Time Zone"
                  value={d.timezone}
                  disabled
                  onChange={() => undefined}
                  options={[{ value: d.timezone, label: d.timezone.replace('_', ' ') }]}
                />
              </div>
            </section>
          ) : null}
          <section className={card} aria-label="Template" data-testid="template-card">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Template</h2>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-heading">
                <FileText aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
                <span className="truncate">{d.template ? d.template.name : 'No template'}</span>
              </span>
              <button
                type="button"
                disabled={readOnly}
                className={`${subtle} min-h-9`}
                onClick={() => setDialog('template')}
              >
                {d.template ? 'Change Template' : 'Use a Template'}
              </button>
            </div>
            <button
              type="button"
              disabled={readOnly}
              className={`${subtle} mt-2 min-h-9`}
              onClick={() => setDialog('saveTemplate')}
            >
              Save as Template
            </button>
          </section>
          <section className={card} aria-label="Message preview" data-testid="message-preview">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-heading">Message Preview</h2>
              <div
                className="flex overflow-hidden rounded-control border border-border"
                role="group"
                aria-label="Preview size"
              >
                {(['desktop', 'mobile'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={device === k}
                    onClick={() => setDevice(k)}
                    className={`min-h-9 px-3 text-xs font-medium ${device === k ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
                  >
                    {k === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
            </div>
            {preview.data ? (
              <div
                className={`mx-auto rounded-lg border border-divider bg-canvas p-3 text-sm ${device === 'mobile' ? 'max-w-56' : ''}`}
              >
                {preview.data.subject ? (
                  <p className="mb-1 font-semibold text-heading">{preview.data.subject}</p>
                ) : null}
                <p className="max-h-40 overflow-hidden whitespace-pre-wrap text-text">
                  {plain(preview.data.body) || 'Your message appears here.'}
                </p>
              </div>
            ) : (
              <p className={quiet}>
                {preview.isError ? 'The preview is not available right now.' : 'Loading…'}
              </p>
            )}
            {preview.data?.sms ? (
              <p className="mt-1 text-xs text-muted">
                {preview.data.sms.characters} characters, {preview.data.sms.parts} part(s).
              </p>
            ) : null}
          </section>
          <section className={card} aria-label="Pre-send checklist" data-testid="checklist">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Pre-Send Checklist</h2>
            {checks.length === 0 ? (
              <p className={quiet}>
                {review.isError ? 'The checklist is not available right now.' : 'Checking…'}
              </p>
            ) : (
              <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {checks.map((c, i) => {
                  const Glyph =
                    c.severity === 'OK' ? CheckCircle : c.severity === 'WARN' ? Warning : XCircle;
                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-2 text-sm ${c.severity === 'OK' ? 'text-success' : c.severity === 'WARN' ? 'text-warning' : 'text-danger'}`}
                    >
                      <Glyph aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
                      <span>{c.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-3 shadow-md">
        <Link href="/communications" className={subtle}>
          Cancel
        </Link>
        <p className="text-xs text-muted" role="status">
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : `Saved ${dateTimeText(d.savedAt)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {saveDraft}
          {sendTest}
          {reviewBtn}
        </div>
      </footer>

      {dialog === 'recipients' ? (
        <RecipientsModal
          detail={d}
          onClose={() => setDialog(undefined)}
          onApplied={() => {
            setDialog(undefined);
            void refresh();
          }}
        />
      ) : null}
      {dialog === 'review' ? (
        <ReviewDialog
          detail={d}
          scheduledFor={
            mode === 'LATER' && channel !== 'ANNOUNCEMENT' ? new Date(when).toISOString() : null
          }
          onClose={() => setDialog(undefined)}
          onDone={(cid) => {
            void qc.invalidateQueries({ queryKey: [...COMM_KEY] });
            router.push(`/communications/${cid}`);
          }}
        />
      ) : null}
      {dialog === 'saveTemplate' ? (
        <SaveTemplateDialog
          id={d.id}
          name={d.name}
          onClose={() => setDialog(undefined)}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'test' ? (
        <TestDialog detail={d} onClose={() => setDialog(undefined)} onNotice={notice} />
      ) : null}
      {dialog === 'template' ? (
        <TemplateDialog
          detail={d}
          onClose={() => setDialog(undefined)}
          onUsed={(next) => {
            setD(next);
            setForm(formOf(next));
            setDialog(undefined);
            notice('Template copied into this draft.', 'success');
          }}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'strip' ? (
        <Modal
          open
          title="Switch the type?"
          subtitle="Text messages have no formatting, images or attachments. They will be removed."
          onClose={() => setDialog(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialog(undefined)}>
                Keep {meta.label}
              </Button>
              <Button onClick={() => pendingChannel && void switchTo(pendingChannel, true)}>
                Switch and remove
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">Your wording stays. Only the formatting is removed.</p>
        </Modal>
      ) : null}
    </div>
  );
}

function TestDialog({
  detail,
  onClose,
  onNotice,
}: {
  detail: CommunicationDetail;
  onClose: () => void;
  onNotice: (t: string, tone: 'success' | 'error') => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const sms = detail.channel === 'SMS';
  return (
    <Modal
      open
      title="Send Test"
      subtitle="A test never counts as a recipient and does not change the draft."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !value.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.communications.testSend(
                  detail.id,
                  sms ? { toPhone: value.trim() } : { toEmail: value.trim() },
                );
                onNotice('Test sent.', 'success');
                onClose();
              } catch (e) {
                onNotice(errorMessage(e, COMM_ERRORS), 'error');
                setBusy(false);
              }
            }}
          >
            Send Test
          </Button>
        </>
      }
    >
      <Input
        label={sms ? 'Send a test to (+15551234567)' : 'Send a test to'}
        type={sms ? 'text' : 'email'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Modal>
  );
}

function TemplateDialog({
  detail,
  onClose,
  onUsed,
  onNotice,
}: {
  detail: CommunicationDetail;
  onClose: () => void;
  onUsed: (d: CommunicationDetail) => void;
  onNotice: (t: string, tone: 'success' | 'error') => void;
}) {
  const kinds: string[] =
    detail.channel === 'SMS'
      ? ['SMS']
      : detail.channel === 'ANNOUNCEMENT'
        ? ['ANNOUNCEMENT']
        : ['EMAIL', 'CAMPAIGN'];
  const list = useApiQuery([...COMM_KEY, 'composer-templates', detail.channel], () =>
    api.templates.list({ tab: 'all', page: 1, pageSize: 50 }),
  );
  const items = (list.data?.items ?? []).filter(
    (t) => kinds.includes(t.kind) && t.status === 'ACTIVE',
  );
  return (
    <Modal
      open
      title="Use a Template"
      subtitle="The template's wording replaces the message. The template itself is not changed."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ul className="max-h-80 overflow-auto" data-testid="template-list">
        {items.length === 0 ? (
          <li className={quiet}>
            {list.isError
              ? 'Templates are not available right now.'
              : 'No active templates for this type.'}
          </li>
        ) : null}
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 border-t border-divider py-2 first:border-t-0"
          >
            <span className="min-w-0 truncate text-sm font-medium text-heading">{t.name}</span>
            <button
              type="button"
              className="text-sm font-medium text-link"
              onClick={async () => {
                try {
                  onUsed(
                    await api.communications.useTemplate(detail.id, {
                      templateId: t.id,
                      etag: detail.etag,
                    }),
                  );
                } catch (e) {
                  onNotice(errorMessage(e, COMM_ERRORS), 'error');
                  onClose();
                }
              }}
            >
              Use
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
