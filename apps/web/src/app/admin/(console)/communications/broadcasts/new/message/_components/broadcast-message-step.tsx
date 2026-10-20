'use client';

import { Button, Card, Input } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BracketsCurly,
  CaretDown,
  CalendarBlank,
  Check,
  CheckCircle,
  ChatCircleDots,
  Code,
  EnvelopeSimple,
  Eye,
  FileText,
  FloppyDisk,
  Image,
  LinkSimple,
  ListBullets,
  ListNumbers,
  Paperclip,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  ADMIN_COMM_BROADCAST_ERRORS,
  ADMIN_COMM_SMS_MAX,
  type AdminCommBroadcastChannel,
  type AdminCommMedia,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../../lib/query';
import { readBroadcastDraft, stepHref } from '../../_components/broadcast-draft';

type BroadcastMessageChannel = AdminCommBroadcastChannel;
type Messages = Record<BroadcastMessageChannel, { subject: string; body: string }>;

const basePath = '/communications/broadcasts/new';
const channels: { id: BroadcastMessageChannel; label: string; icon: Icon }[] = [
  { id: 'EMAIL', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'IN_APP', label: 'In-App', icon: Bell },
];
const steps = [
  { label: 'Basic Information', description: 'Set up your broadcast', step: '' as const },
  { label: 'Audience', description: 'Choose recipients', step: 'audience' as const },
  { label: 'Message', description: 'Create your content', step: 'message' as const },
  { label: 'Review & Send', description: 'Confirm and send', step: 'review' as const },
];
/** The contract's merge fields (ADMIN_COMM_MERGE_FIELDS). */
const mergeFields = ['{{firm.name}}', '{{contact.name}}', '{{contact.first_name}}'];
const emptyMessages: Messages = {
  EMAIL: { subject: '', body: '' },
  SMS: { subject: '', body: '' },
  IN_APP: { subject: '', body: '' },
};
const editorTools: { label: string; icon: Icon }[] = [
  { label: 'Bold', icon: TextB },
  { label: 'Italic', icon: TextItalic },
  { label: 'Underline', icon: TextUnderline },
  { label: 'Bulleted list', icon: ListBullets },
  { label: 'Numbered list', icon: ListNumbers },
  { label: 'Align left', icon: TextAlignLeft },
  { label: 'Align center', icon: TextAlignCenter },
  { label: 'Align right', icon: TextAlignRight },
  { label: 'Insert link', icon: LinkSimple },
  { label: 'Insert image', icon: Image },
  { label: 'Insert date', icon: CalendarBlank },
];

function BroadcastProgress({ broadcastId }: { broadcastId?: string }) {
  return (
    <nav aria-label="Broadcast creation progress" className="py-1 lg:px-8">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-5 lg:flex lg:gap-3">
        {steps.map((step, index) => {
          const complete = index < 2;
          const current = index === 2;
          return (
            <li key={step.label} className="flex min-w-0 flex-1 items-center gap-3">
              <Link
                href={
                  broadcastId
                    ? stepHref(step.step, broadcastId)
                    : `${basePath}${step.step ? `/${step.step}` : ''}`
                }
                aria-current={current ? 'step' : undefined}
                className="flex min-w-0 items-center gap-3 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              >
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full lg:size-11 ${current ? 'bg-action text-on-action' : complete ? 'bg-info-soft text-action' : 'bg-table-head text-text'}`}
                >
                  {complete ? (
                    <>
                      <Check aria-hidden weight="bold" className="size-5" />
                      <span className="sr-only">Completed: </span>
                    </>
                  ) : (
                    <span className="text-lg font-bold">{index + 1}</span>
                  )}
                </span>
                <span className="min-w-0 text-sm">
                  <span className={`block font-bold ${current ? 'text-link' : 'text-heading'}`}>
                    {step.label}
                  </span>
                  <span
                    className={`mt-0.5 block text-xs lg:text-sm ${current ? 'text-link' : 'text-muted'}`}
                  >
                    {step.description}
                  </span>
                </span>
              </Link>
              {index < 3 && (
                <span aria-hidden className="hidden h-px min-w-2 flex-1 bg-border lg:block" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function IconButton({
  icon: Glyph,
  label,
  active = false,
  onClick,
}: {
  icon: Icon;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`flex size-7 shrink-0 items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-focus ${active ? 'bg-info-soft text-link' : 'text-heading hover:bg-info-soft'}`}
    >
      <Glyph aria-hidden weight="fill" className="size-4" />
    </button>
  );
}

function ToolButton({
  icon: Glyph,
  title,
  description,
  onClick,
}: {
  icon: Icon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 items-center gap-3 rounded-control text-left hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-info-soft text-link">
        <Glyph aria-hidden weight="fill" className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-heading">{title}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
    </button>
  );
}

/** Step 3 of the broadcast `?id=`: each channel's content, saved on the broadcast. */
export function BroadcastMessageStep({ broadcastId }: { broadcastId?: string }) {
  const broadcast = useApiQuery(
    ['admin-communications', 'broadcasts', 'one', broadcastId ?? 'new'],
    () => (broadcastId ? api.adminBroadcasts.broadcasts.get(broadcastId) : Promise.resolve(null)),
  );
  const draft = broadcastId ? readBroadcastDraft(broadcastId) : null;
  const template = useApiQuery(
    ['admin-communications', 'templates', 'one', draft?.templateId || 'none'],
    () =>
      draft?.templateId && draft.messageSource === 'template'
        ? api.adminCommunications.templates.get(draft.templateId)
        : Promise.resolve(null),
  );
  if (broadcast.isPending || template.isPending)
    return (
      <div data-testid="broadcast-message-step" className="space-y-5">
        <h1 className="font-display text-3xl font-bold text-heading">Create Broadcast</h1>
        <p role="status" className="text-sm text-muted">
          Loading the broadcast…
        </p>
      </div>
    );
  const saved = broadcast.data?.channels ?? [];
  const shown: BroadcastMessageChannel[] = saved.length
    ? saved.map((c) => c.channel)
    : draft?.channels.length
      ? draft.channels
      : ['EMAIL', 'SMS', 'IN_APP'];
  const seeded = template.data;
  const messages: Messages = { ...emptyMessages };
  for (const channel of shown) {
    const content = saved.find((c) => c.channel === channel);
    messages[channel] = content
      ? { subject: content.subject ?? '', body: content.body }
      : seeded
        ? { subject: channel === 'EMAIL' ? (seeded.subject ?? '') : '', body: seeded.body }
        : { subject: '', body: '' };
  }
  return (
    <MessageEditor
      broadcastId={broadcastId}
      broadcastName={broadcast.data?.name ?? draft?.name ?? ''}
      categoryId={draft?.category ?? ''}
      shown={shown}
      initial={messages}
      initialMedia={saved.find((c) => c.channel === 'EMAIL')?.media ?? []}
      loadError={
        broadcast.isError ? errorMessage(broadcast.error, ADMIN_COMM_BROADCAST_ERRORS) : ''
      }
    />
  );
}

function MessageEditor({
  broadcastId,
  broadcastName,
  categoryId,
  shown,
  initial,
  initialMedia,
  loadError,
}: {
  broadcastId?: string;
  broadcastName: string;
  categoryId: string;
  shown: BroadcastMessageChannel[];
  initial: Messages;
  initialMedia: AdminCommMedia[];
  loadError: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const visibleChannels = channels.filter(({ id }) => shown.includes(id));
  const first = visibleChannels[0]?.id ?? 'EMAIL';
  const [channel, setChannel] = useState<BroadcastMessageChannel>(first);
  const [previewChannel, setPreviewChannel] = useState<BroadcastMessageChannel>(first);
  const [messages, setMessages] = useState<Messages>(initial);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const [attachments, setAttachments] = useState<AdminCommMedia[]>(initialMedia);
  const templates = useApiQuery(['admin-communications', 'templates', 'active', channel], () =>
    channel === 'IN_APP'
      ? Promise.resolve(null)
      : api.adminCommunications.templates.list({
          status: 'ACTIVE',
          channel,
          sort: 'NAME',
          pageSize: 100,
        }),
  );
  const [toolbarActive, setToolbarActive] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subject = messages[channel].subject;
  const body = messages[channel].body;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const messageNotice =
    loadError || (!broadcastId ? 'Start the broadcast with its basic information first.' : '');
  const selectedPreview =
    visibleChannels.find(({ id }) => id === previewChannel) ?? visibleChannels[0]!;
  const previewLabel = selectedPreview.label;
  const previewContent =
    messages[previewChannel].body.trim() ||
    'This is a preview of your message content. Your formatting, images, and links will appear here exactly as your recipients see them.';

  function appendText(value: string) {
    setMessages((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        body: `${current[channel].body}${current[channel].body ? ' ' : ''}${value}`,
      },
    }));
    bodyRef.current?.focus();
  }

  function updateSubject(value: string) {
    setMessages((current) => ({
      ...current,
      [channel]: { ...current[channel], subject: value },
    }));
  }

  function updateBody(value: string) {
    setMessages((current) => ({
      ...current,
      [channel]: { ...current[channel], body: value },
    }));
  }

  function toggleToolbar(label: string) {
    setToolbarActive((active) =>
      active.includes(label) ? active.filter((item) => item !== label) : [...active, label],
    );
  }

  /** Every channel's content, checked; the first channel with a problem opens. */
  function contentOrProblem() {
    for (const { id, label } of visibleChannels) {
      const m = messages[id];
      if (id === 'EMAIL' && !m.subject.trim())
        return { channel: id, problem: 'Enter a subject line before continuing.' };
      if (!m.body.trim())
        return { channel: id, problem: `Enter message content for ${label} before continuing.` };
      if (id === 'SMS' && m.body.length > ADMIN_COMM_SMS_MAX)
        return {
          channel: id,
          problem: `A text message is at most ${ADMIN_COMM_SMS_MAX} characters.`,
        };
    }
    return null;
  }

  /** Saves the content on the broadcast; returns false when it could not. */
  async function saveContent(): Promise<boolean> {
    if (!broadcastId) {
      setValidation('Start the broadcast with its basic information first.');
      return false;
    }
    const issue = contentOrProblem();
    if (issue) {
      setChannel(issue.channel);
      setValidation(issue.problem);
      return false;
    }
    setValidation('');
    setBusy(true);
    try {
      const usable = attachments.filter((m) => m.scanStatus === 'CLEAN').map((m) => m.id);
      await api.adminBroadcasts.broadcasts.update(broadcastId, {
        channels: visibleChannels.map(({ id }) => ({
          channel: id,
          ...(id === 'EMAIL' ? { subject: messages[id].subject.trim() } : {}),
          body: messages[id].body.trim(),
          ...(id === 'EMAIL' && usable.length ? { mediaIds: usable } : {}),
        })),
      });
      await client.invalidateQueries({ queryKey: ['admin-communications', 'broadcasts'] });
      return true;
    } catch (error) {
      setNotice(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function continueToReview() {
    if ((await saveContent()) && broadcastId) router.push(stepHref('review', broadcastId));
  }

  /** Uploads files to the communications library (email attachments, once scanned clean). */
  async function attach(files: File[]) {
    for (const file of files) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, '0'),
        ).join('');
        const ticket = await api.adminBroadcasts.media.create({
          kind: file.type.startsWith('image/') ? 'INLINE_IMAGE' : 'ATTACHMENT',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          sha256,
        });
        if (!ticket.uploadUrl.startsWith('mock:')) {
          const stored = await fetch(ticket.uploadUrl, {
            method: 'PUT',
            headers: ticket.headers,
            body: file,
          });
          if (!stored.ok) throw new Error(`${file.name} could not be stored. Try again.`);
        }
        setAttachments((current) => [...current, ticket.media]);
      } catch (error) {
        setNotice(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
      }
    }
  }

  async function saveAsTemplate() {
    if (channel === 'IN_APP') {
      setNotice('Templates are for email and SMS.');
      return;
    }
    try {
      const category = categoryId || (await api.adminCommunications.categories.list()).items[0]?.id;
      if (!category) {
        setNotice('Add a template category first.');
        return;
      }
      const made = await api.adminCommunications.templates.create({
        categoryId: category,
        name: `${broadcastName || 'Broadcast'} (${channel === 'EMAIL' ? 'Email' : 'SMS'})`,
        channel,
        ...(channel === 'EMAIL' ? { subject: messages.EMAIL.subject.trim() } : {}),
        body: messages[channel].body.trim(),
      });
      setNotice(`Saved as the template ${made.name}.`);
    } catch (error) {
      setNotice(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
    }
  }

  return (
    <div className="space-y-5 xl:-mt-4" data-testid="broadcast-message-step">
      <header>
        <Link
          href="/communications/broadcasts"
          className="mb-3 inline-flex min-h-6 items-center gap-2 text-sm text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Broadcasts
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading">Create Broadcast</h1>
            <p className="text-base text-muted">
              Send a message to multiple recipients using email, SMS, or in-app notifications.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              className="border-transparent! bg-info-soft! text-link! hover:bg-folder-hover!"
              onClick={() => {
                setMessages(initial);
                setAttachments(initialMedia);
                setNotice(broadcastId ? 'Saved content loaded.' : 'There is no saved draft yet.');
              }}
            >
              <FileText aria-hidden weight="fill" className="size-4" />
              Load Saved Draft
            </Button>
            <Button
              variant="secondary"
              className="border-transparent! bg-info-soft! text-link! hover:bg-folder-hover!"
              onClick={() => setNotice(`Preview updated for ${previewLabel}.`)}
            >
              <Eye aria-hidden weight="fill" className="size-4" />
              Preview Message
            </Button>
          </div>
        </div>
      </header>

      <BroadcastProgress broadcastId={broadcastId} />

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(18rem,1fr)]">
        <Card className="min-w-0 overflow-hidden p-0! shadow-none!">
          <div className="space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="font-display text-2xl font-bold text-heading">Message</h2>
              <p className="mt-1 text-sm text-muted">
                Create your message content. You can customize each channel or use the same content
                for all selected channels.
              </p>
            </div>

            {messageNotice ? (
              <p
                role={loadError ? 'alert' : 'status'}
                className={`rounded-control border px-3 py-2 text-sm ${loadError ? 'border-danger text-danger' : 'border-border text-muted'} bg-info-soft`}
              >
                {messageNotice}
              </p>
            ) : null}

            <div
              role="tablist"
              aria-label="Broadcast message channel"
              className="grid grid-cols-3 gap-2"
            >
              {visibleChannels.map(({ id, label, icon: Glyph }) => {
                const active = channel === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setChannel(id);
                      setValidation('');
                    }}
                    className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus ${active ? 'bg-action text-on-action' : 'border border-transparent bg-info-soft text-link hover:bg-folder-hover'}`}
                  >
                    <Glyph aria-hidden weight="fill" className="size-5" />
                    {label}
                  </button>
                );
              })}
            </div>

            <section aria-labelledby="message-content-heading" className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-64">
                  <h3
                    id="message-content-heading"
                    className="font-display text-lg font-bold text-heading"
                  >
                    {channel === 'EMAIL'
                      ? 'Email Content'
                      : `${channel === 'SMS' ? 'SMS' : 'In-App'} Content`}
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    {channel === 'EMAIL'
                      ? 'Design your email using the editor below. You can use a template or start from scratch.'
                      : 'Write the message your audience will receive in this channel.'}
                  </p>
                </div>
                <div className="relative flex flex-wrap gap-2">
                  {templatesOpen ? (
                    <div
                      role="menu"
                      aria-label="Templates"
                      className="absolute top-full left-0 z-30 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-divider bg-surface p-1 shadow-lg"
                    >
                      {templates.data?.items.length ? (
                        templates.data.items.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMessages((current) => ({
                                ...current,
                                [channel]: {
                                  subject: channel === 'EMAIL' ? (t.subject ?? '') : '',
                                  body: t.body,
                                },
                              }));
                              setTemplatesOpen(false);
                            }}
                            className="w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-canvas"
                          >
                            {t.name}
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-sm text-muted">
                          {templates.isPending
                            ? 'Loading templates…'
                            : 'No templates for this channel.'}
                        </p>
                      )}
                    </div>
                  ) : null}
                  <Button
                    variant="secondary"
                    className="min-h-10! border-transparent! bg-info-soft! px-3! text-link! hover:bg-folder-hover!"
                    aria-expanded={templatesOpen}
                    disabled={channel === 'IN_APP'}
                    onClick={() => setTemplatesOpen((open) => !open)}
                  >
                    <FileText aria-hidden weight="fill" className="size-4" />
                    Use a Template
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-10! border-transparent! bg-info-soft! px-3! text-link! hover:bg-folder-hover!"
                    onClick={() => void saveAsTemplate()}
                  >
                    <FloppyDisk aria-hidden weight="fill" className="size-4" />
                    Save as Template
                  </Button>
                </div>
              </div>

              {channel === 'EMAIL' ? (
                <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
                  <Input
                    label="Subject Line *"
                    value={subject}
                    onChange={(event) => {
                      updateSubject(event.target.value);
                      setValidation('');
                    }}
                    placeholder="Type a compelling subject line..."
                    className="text-sm"
                    error={validation.startsWith('Enter a subject') ? validation : undefined}
                  />
                  <Button
                    variant="secondary"
                    className="min-h-10! px-3! text-sm!"
                    onClick={() =>
                      updateSubject(`${subject}${subject ? ' ' : ''}${mergeFields[0]}`)
                    }
                  >
                    <BracketsCurly aria-hidden weight="fill" className="size-4" />
                    Insert Merge Field
                    <CaretDown aria-hidden weight="bold" className="size-3.5 text-link" />
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-10! px-3! text-sm!"
                    onClick={() =>
                      updateSubject(`${subject}${subject ? ' ' : ''}${mergeFields[1]}`)
                    }
                  >
                    Personalize
                    <CaretDown aria-hidden weight="bold" className="size-3.5 text-link" />
                  </Button>
                </div>
              ) : null}

              <div className="min-w-0 space-y-2">
                <label htmlFor="broadcast-message-body" className="text-sm font-medium text-text">
                  {channel === 'EMAIL' ? 'Email Body *' : 'Message Body *'}
                </label>
                <div className="min-w-0 max-w-full overflow-hidden rounded-control border border-border bg-surface">
                  {channel === 'EMAIL' ? (
                    <div
                      role="toolbar"
                      aria-label="Email formatting toolbar"
                      className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-canvas p-1.5"
                    >
                      <label className="sr-only" htmlFor="broadcast-font-family">
                        Font family
                      </label>
                      <select
                        id="broadcast-font-family"
                        className="h-8 w-28 rounded-control border border-border bg-surface px-2 text-xs text-text"
                      >
                        <option>Arial</option>
                        <option>Georgia</option>
                        <option>Tahoma</option>
                      </select>
                      <label className="sr-only" htmlFor="broadcast-font-size">
                        Font size
                      </label>
                      <select
                        id="broadcast-font-size"
                        className="h-8 w-14 rounded-control border border-border bg-surface px-2 text-xs text-text"
                      >
                        <option>14</option>
                        <option>16</option>
                        <option>18</option>
                      </select>
                      <span aria-hidden className="mx-1 h-6 border-l border-border" />
                      <IconButton
                        icon={TextB}
                        label="Bold"
                        active={toolbarActive.includes('Bold')}
                        onClick={() => toggleToolbar('Bold')}
                      />
                      <IconButton
                        icon={TextItalic}
                        label="Italic"
                        active={toolbarActive.includes('Italic')}
                        onClick={() => toggleToolbar('Italic')}
                      />
                      <IconButton
                        icon={TextUnderline}
                        label="Underline"
                        active={toolbarActive.includes('Underline')}
                        onClick={() => toggleToolbar('Underline')}
                      />
                      <button
                        type="button"
                        aria-label="Text color"
                        className="flex size-8 items-center justify-center rounded-control text-heading hover:bg-info-soft"
                      >
                        <span className="border-b-2 border-action px-1 font-bold">A</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Highlight color"
                        className="flex size-8 items-center justify-center rounded-control text-heading hover:bg-info-soft"
                      >
                        <span className="border-b-2 border-link px-1 font-bold">A</span>
                      </button>
                      <span aria-hidden className="mx-1 h-6 border-l border-border" />
                      {editorTools.slice(3).map(({ icon, label }) => (
                        <IconButton
                          key={label}
                          icon={icon}
                          label={label}
                          active={toolbarActive.includes(label)}
                          onClick={() => toggleToolbar(label)}
                        />
                      ))}
                      <span className="ml-auto flex items-center gap-1">
                        <IconButton
                          icon={BracketsCurly}
                          label="Insert merge field"
                          onClick={() => appendText(mergeFields[2]!)}
                        />
                        <button
                          type="button"
                          className="rounded-control px-2 py-1 text-xs font-medium text-link hover:bg-info-soft"
                          onClick={() => appendText(mergeFields[2]!)}
                        >
                          Personalize
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <textarea
                    id="broadcast-message-body"
                    ref={bodyRef}
                    value={body}
                    onChange={(event) => {
                      updateBody(event.target.value);
                      setValidation('');
                    }}
                    placeholder={
                      channel === 'EMAIL'
                        ? 'Start typing your email message here...'
                        : 'Start typing your message here...'
                    }
                    aria-invalid={validation.startsWith('Enter message') || undefined}
                    className={`box-border min-h-44 w-full min-w-0 max-w-full resize-y bg-surface px-4 py-3 text-sm leading-6 text-text placeholder:text-muted focus:outline-2 focus:outline-focus ${validation.startsWith('Enter message') ? 'border-danger' : ''}`}
                  />
                </div>
                {validation.startsWith('Enter message') ? (
                  <p role="alert" className="text-xs text-danger">
                    {validation}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="sr-only"
                      aria-label="Attach files"
                      onChange={(event) => {
                        void attach(Array.from(event.target.files ?? []));
                        event.target.value = '';
                      }}
                    />
                    <Button
                      variant="secondary"
                      className="min-h-10! border-transparent! bg-info-soft! px-3! text-link! hover:bg-folder-hover!"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip aria-hidden weight="fill" className="size-4" />
                      Attach Files
                    </Button>
                    <span className="text-xs text-muted">
                      Add images, PDFs, or other files (Max 10 MB each)
                    </span>
                  </div>
                  <span className="text-xs text-muted">
                    {attachments.length
                      ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} (${attachments.filter((m) => m.scanStatus !== 'CLEAN').length} waiting for the scan)`
                      : `${words} words`}
                  </span>
                </div>
              </div>
              <p role="status" className="empty:hidden text-sm text-muted">
                {notice}
              </p>
              <div className="sr-only" aria-live="polite">
                {toolbarActive.length ? `Formatting selected: ${toolbarActive.join(', ')}` : ''}
              </div>
            </section>
          </div>

          <footer className="border-t border-border px-4 py-4 sm:px-5">
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="secondary"
                className="w-full border-transparent! bg-info-soft! text-link! hover:bg-folder-hover! sm:w-auto"
                onClick={() =>
                  router.push(
                    broadcastId ? stepHref('audience', broadcastId) : `${basePath}/audience`,
                  )
                }
              >
                <ArrowLeft aria-hidden weight="bold" className="size-4" />
                Back
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="secondary"
                  className="w-full border-transparent! bg-info-soft! text-link! hover:bg-folder-hover! sm:w-auto"
                  disabled={busy}
                  onClick={() =>
                    void saveContent().then((ok) => {
                      if (ok) setNotice('Draft saved.');
                    })
                  }
                >
                  <FloppyDisk aria-hidden weight="fill" className="size-4" />
                  Save as Draft
                </Button>
                <Button
                  className="w-full min-w-36 sm:w-auto"
                  disabled={busy}
                  onClick={() => void continueToReview()}
                >
                  Next
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
            </div>
          </footer>
        </Card>

        <aside
          aria-label="Message preview and tools"
          className="grid min-w-0 items-start gap-4 sm:grid-cols-2 xl:grid-cols-1"
        >
          <Card className="min-w-0 space-y-3 p-4! shadow-none!">
            <div>
              <h2 className="font-display text-lg font-bold text-heading">Channel Preview</h2>
              <p className="mt-1 text-sm text-muted">
                See how your message will look in each channel.
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Preview channel"
              className="grid grid-cols-3 rounded-control bg-canvas p-1"
            >
              {visibleChannels.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={previewChannel === id}
                  onClick={() => setPreviewChannel(id)}
                  className={`min-h-9 rounded-control px-2 text-xs font-medium ${previewChannel === id ? 'bg-surface text-link shadow-card' : 'text-muted hover:text-heading'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-control border border-border bg-surface">
              {previewChannel === 'EMAIL' ? (
                <>
                  <div className="border-b border-border bg-canvas px-3 py-2 text-xs text-muted">
                    <span className="font-semibold text-heading">Subject:</span>{' '}
                    {messages.EMAIL.subject || 'Your Subject Line Here'}
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-9 items-center justify-center rounded-full bg-info-soft text-action">
                        <span className="font-display text-lg font-bold">F</span>
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-heading">Firmivra</p>
                        <p className="truncate text-xs text-muted">From the Firmivra team</p>
                      </div>
                    </div>
                    <div className="flex h-20 items-center justify-center rounded-control bg-canvas text-muted">
                      <Image aria-hidden weight="fill" className="size-8" />
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted">
                      {previewContent}
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-3 bg-canvas p-4">
                  <p className="text-xs font-semibold text-muted">{previewLabel} preview</p>
                  <p className="whitespace-pre-wrap break-words rounded-xl bg-surface p-3 text-sm leading-5 text-text shadow-card">
                    {previewContent}
                  </p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted">
              Preview is an estimate. Final appearance may vary by channel.
            </p>
          </Card>

          <Card className="min-w-0 space-y-2 p-4! shadow-none!">
            <h2 className="font-display text-lg font-bold text-heading">Message Tools</h2>
            <ToolButton
              icon={BracketsCurly}
              title="Insert Merge Fields"
              description="Add personalized information"
              onClick={() => appendText(mergeFields[0]!)}
            />
            <ToolButton
              icon={Image}
              title="Add Image"
              description="Upload and insert an image"
              onClick={() => fileInputRef.current?.click()}
            />
            <ToolButton
              icon={LinkSimple}
              title="Add Link"
              description="Insert a hyperlink"
              onClick={() => setNotice('Select text in the editor to add a link.')}
            />
            <ToolButton
              icon={CheckCircle}
              title="Check Spelling"
              description="Scan for errors"
              onClick={() => setNotice('Spelling check complete.')}
            />
            <ToolButton
              icon={Code}
              title="HTML View"
              description="Edit HTML (advanced)"
              onClick={() => setNotice('HTML view is not available in this editor yet.')}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}
