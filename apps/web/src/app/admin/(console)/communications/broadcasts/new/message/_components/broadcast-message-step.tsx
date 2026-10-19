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
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../../lib/query';
import {
  getBroadcastMessage,
  type BroadcastMessageChannel,
} from '../../../../../../../../mocks/admin-communications-broadcast-message';

const basePath = '/communications/broadcasts/new';
const channels: { id: BroadcastMessageChannel; label: string; icon: Icon }[] = [
  { id: 'EMAIL', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'IN_APP', label: 'In-App', icon: Bell },
];
const steps = [
  { label: 'Basic Information', description: 'Set up your broadcast', href: basePath },
  { label: 'Audience', description: 'Choose recipients', href: `${basePath}/audience` },
  { label: 'Message', description: 'Create your content', href: `${basePath}/message` },
  { label: 'Review & Send', description: 'Confirm and send', href: `${basePath}/review` },
];
const mergeFields = ['{{firm_name}}', '{{contact_name}}', '{{first_name}}'];
const emptyMessages: Record<BroadcastMessageChannel, { subject: string; body: string }> = {
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

function BroadcastProgress() {
  return (
    <nav aria-label="Broadcast creation progress" className="py-1 lg:px-8">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-5 lg:flex lg:gap-3">
        {steps.map((step, index) => {
          const complete = index < 2;
          const current = index === 2;
          return (
            <li key={step.label} className="flex min-w-0 flex-1 items-center gap-3">
              <Link
                href={step.href}
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

export function BroadcastMessageStep() {
  const router = useRouter();
  const query = useApiQuery(['admin-communications', 'broadcast-message'], getBroadcastMessage);
  const fixture = query.data ?? null;
  const visibleChannels = channels.filter(({ id }) => fixture?.channels.includes(id) ?? true);
  const [channel, setChannel] = useState<BroadcastMessageChannel>('EMAIL');
  const [previewChannel, setPreviewChannel] = useState<BroadcastMessageChannel>('EMAIL');
  const [messages, setMessages] = useState(emptyMessages);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [toolbarActive, setToolbarActive] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subject = messages[channel].subject;
  const body = messages[channel].body;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const messageNotice = query.isError
    ? errorMessage(query.error)
    : query.data === null && !query.isPending
      ? 'No saved message data yet. Start composing your broadcast below.'
      : '';
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

  function continueToReview() {
    if (channel === 'EMAIL' && !subject.trim()) {
      setValidation('Enter a subject line before continuing.');
      return;
    }
    if (!body.trim()) {
      setValidation('Enter message content before continuing.');
      return;
    }
    setValidation('');
    router.push(`${basePath}/review`);
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
              onClick={() => setNotice('No saved draft was found for this broadcast.')}
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

      <BroadcastProgress />

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
                role={query.isError ? 'alert' : 'status'}
                className={`rounded-control border px-3 py-2 text-sm ${query.isError ? 'border-danger text-danger' : 'border-border text-muted'} bg-info-soft`}
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
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-10! border-transparent! bg-info-soft! px-3! text-link! hover:bg-folder-hover!"
                    onClick={() => setNotice('No saved templates are available yet.')}
                  >
                    <FileText aria-hidden weight="fill" className="size-4" />
                    Use a Template
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-10! border-transparent! bg-info-soft! px-3! text-link! hover:bg-folder-hover!"
                    onClick={() => setNotice('Template saving is not connected yet.')}
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
                        setAttachments(
                          Array.from(event.target.files ?? []).map((file) => file.name),
                        );
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
                      ? `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`
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
                onClick={() => router.push(`${basePath}/audience`)}
              >
                <ArrowLeft aria-hidden weight="bold" className="size-4" />
                Back
              </Button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="secondary"
                  className="w-full border-transparent! bg-info-soft! text-link! hover:bg-folder-hover! sm:w-auto"
                  onClick={() =>
                    setNotice(
                      'Draft saving is not connected yet. Your content remains on this page.',
                    )
                  }
                >
                  <FloppyDisk aria-hidden weight="fill" className="size-4" />
                  Save as Draft
                </Button>
                <Button className="w-full min-w-36 sm:w-auto" onClick={continueToReview}>
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
                        <p className="truncate text-sm font-semibold text-heading">
                          {fixture?.senderName ?? 'Your Firm Name'}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {fixture?.senderEmail ?? 'you@yourfirm.com'}
                        </p>
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
