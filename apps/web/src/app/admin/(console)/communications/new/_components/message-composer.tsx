'use client';

import { Badge, Button, Card, Input, PageHeader, Select } from '@firmivra/ui';
import {
  ArrowUUpLeft,
  ArrowUUpRight,
  BracketsCurly,
  Buildings,
  CalendarBlank,
  CaretDown,
  ChatCircleDots,
  CheckCircle,
  EnvelopeSimple,
  FileText,
  FloppyDisk,
  LinkSimple,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  NotePencil,
  Paperclip,
  PaperPlaneTilt,
  Phone,
  Plus,
  Smiley,
  Tag,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
  User,
  X,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';

type Channel = 'EMAIL' | 'SMS';
type RecipientKind = 'Client' | 'Firm' | 'Team' | 'Lead';

interface Recipient {
  id: string;
  label: string;
  kind: RecipientKind;
  email?: string;
  phone?: string;
  organization?: string;
  assignee?: string;
  source?: string;
  since?: string;
  status?: string;
}

const recipients: Recipient[] = [
  {
    id: 'karen-wilson',
    label: 'Karen Wilson',
    kind: 'Client',
    email: 'karen.wilson@example.test',
    phone: '(555) 010-0142',
    organization: 'Blue Ridge Consulting',
    assignee: 'Octavia Holder',
    source: 'Website',
    since: 'Oct 2, 2026',
    status: 'Active Client',
  },
  { id: 'blue-ridge', label: 'Blue Ridge Consulting (Firm)', kind: 'Firm' },
  { id: 'onboarding-team', label: 'Team: Onboarding', kind: 'Team' },
  {
    id: 'jordan-lee',
    label: 'Jordan Lee',
    kind: 'Lead',
    email: 'jordan.lee@example.test',
    phone: '(555) 010-0198',
    organization: 'Northstar Tax Group',
    assignee: 'Octavia Holder',
    source: 'Referral',
    since: 'Oct 10, 2026',
    status: 'New Lead',
  },
  {
    id: 'maya-chen',
    label: 'Maya Chen',
    kind: 'Client',
    email: 'maya.chen@example.test',
    phone: '(555) 010-0175',
    organization: 'Chen Studio',
    assignee: 'Octavia Holder',
    source: 'Website',
    since: 'Oct 8, 2026',
    status: 'Active Client',
  },
];

const activity = [
  { icon: EnvelopeSimple, title: 'Email received', date: 'Oct 14, 2026 10:21 AM' },
  { icon: EnvelopeSimple, title: 'Email sent', date: 'Oct 14, 2026 10:24 AM' },
  { icon: FileText, title: 'Form submitted', date: 'Oct 13, 2026 2:15 PM' },
  { icon: CheckCircle, title: 'Status changed to Client', date: 'Oct 12, 2026 11:03 AM' },
  { icon: NotePencil, title: 'Note added', date: 'Oct 10, 2026 9:42 AM' },
];

const initialMessage =
  "Hi {{first_name}},\n\nWelcome to Firmivra! We're excited to have you {{client_type}} on board.\n\nOur team is here to help you get started. If you have any questions, just reply to this message.\n\nBest regards,\nThe Firmivra Team";

const textTools: { label: string; icon: Icon; command: string; value?: string }[] = [
  { label: 'Bold', icon: TextB, command: 'bold' },
  { label: 'Italic', icon: TextItalic, command: 'italic' },
  { label: 'Underline', icon: TextUnderline, command: 'underline' },
  { label: 'Bulleted list', icon: ListBullets, command: 'insertUnorderedList' },
  { label: 'Numbered list', icon: ListNumbers, command: 'insertOrderedList' },
  { label: 'Align left', icon: TextAlignLeft, command: 'justifyLeft' },
  { label: 'Align center', icon: TextAlignCenter, command: 'justifyCenter' },
  { label: 'Align right', icon: TextAlignRight, command: 'justifyRight' },
];

function NumberedSection({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-sm font-semibold text-on-action">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold leading-6 text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ToolbarButton({
  icon: Glyph,
  label,
  active,
  iconWeight = 'bold',
  onClick,
}: {
  icon: Icon;
  label: string;
  active?: boolean;
  iconWeight?: 'regular' | 'bold';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`flex size-8 shrink-0 items-center justify-center rounded-control 2xl:size-9 ${active ? 'border border-action bg-surface text-action' : 'text-text hover:bg-folder-surface'}`}
    >
      <Glyph aria-hidden weight={iconWeight} className="size-4 2xl:size-4.5" />
    </button>
  );
}

export function MessageComposer() {
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState(['karen-wilson', 'blue-ridge', 'onboarding-team']);
  const [activeId, setActiveId] = useState('karen-wilson');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [ccOpen, setCcOpen] = useState(false);
  const [bccOpen, setBccOpen] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [template, setTemplate] = useState('');
  const [subject, setSubject] = useState('Welcome to Firmivra!');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [recipientDetailsOpen, setRecipientDetailsOpen] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [sendOptionsOpen, setSendOptionsOpen] = useState(false);
  const [sendNotice, setSendNotice] = useState(false);

  const selectedRecipients = useMemo(
    () =>
      selectedIds
        .map((id) => recipients.find((recipient) => recipient.id === id))
        .filter((item) => item),
    [selectedIds],
  );
  const activeRecipient = selectedRecipients.find((recipient) => recipient?.id === activeId);
  const filteredRecipients = useMemo(() => {
    const term = search.trim().toLowerCase();
    return recipients.filter(
      (recipient) =>
        !selectedIds.includes(recipient.id) &&
        (!term || `${recipient.label} ${recipient.kind}`.toLowerCase().includes(term)),
    );
  }, [search, selectedIds]);

  const addRecipient = (recipient: Recipient) => {
    setSelectedIds((current) => [...current, recipient.id]);
    setActiveId(recipient.id);
    setSearch('');
    setSearchOpen(false);
  };

  const removeRecipient = (id: string) => {
    const remaining = selectedIds.filter((recipientId) => recipientId !== id);
    setSelectedIds(remaining);
    if (id === activeId) setActiveId(remaining[0] ?? '');
  };

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const insertText = (value: string) => applyFormat('insertText', value);

  const loadTemplate = () => {
    if (!template) return;
    setSubject(template === 'welcome' ? 'Welcome to Firmivra!' : 'Monthly Newsletter');
    if (editorRef.current) editorRef.current.innerText = initialMessage;
  };

  const attachFiles = (files: FileList | null) => {
    if (!files) return;
    setAttachedFiles((current) => [
      ...current,
      ...Array.from(files).filter((file) => file.size <= 10 * 1024 * 1024),
    ]);
  };

  const person = activeRecipient ?? undefined;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New Message"
        subtitle="Send an email or SMS to your firms, leads, clients, contacts, or team members."
        above={
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <Link href="/communications" className="text-muted hover:text-link">
              Communications
            </Link>
            <span aria-hidden className="text-muted">
              ›
            </span>
            <span className="font-medium text-heading">New Message</span>
          </nav>
        }
        actions={
          <>
            <Button
              variant="secondary"
              className="border-transparent bg-info-soft text-action hover:bg-folder-hover"
            >
              <CalendarBlank aria-hidden weight="fill" className="size-4" />
              Save as Draft
            </Button>
            <div className="relative">
              <div className="flex overflow-hidden rounded-control">
                <Button className="rounded-r-none" onClick={() => setSendNotice(true)}>
                  <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                  Send Now
                </Button>
                <Button
                  aria-label="More send options"
                  className="rounded-l-none border-l border-on-action/20 px-3"
                  onClick={() => setSendOptionsOpen((open) => !open)}
                >
                  <CaretDown aria-hidden weight="bold" className="size-4" />
                </Button>
              </div>
              {sendOptionsOpen ? (
                <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-card border border-border bg-surface p-1 shadow-card">
                  <button
                    type="button"
                    onClick={() => {
                      setSendOptionsOpen(false);
                      setScheduleOpen(true);
                    }}
                    className="w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-folder-surface"
                  >
                    Schedule Send
                  </button>
                </div>
              ) : null}
            </div>
          </>
        }
      />
      <p
        role="status"
        className="rounded-control bg-info-soft px-3 py-2 text-sm text-text empty:hidden"
      >
        {sendNotice ? 'Message sending is not connected in this preview.' : null}
      </p>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-7">
        <Card className="overflow-hidden !p-0 xl:col-span-5">
          <NumberedSection
            number={1}
            title="Select Recipients"
            subtitle="Choose one or more recipients from your firms, leads, clients, contacts, or team members."
          >
            <div className="relative rounded-control border border-border bg-surface">
              <div className="flex min-h-18 flex-wrap items-center gap-2 px-3 py-2">
                {selectedRecipients.map((recipient) =>
                  recipient ? (
                    <span
                      key={recipient.id}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-info-soft px-2.5 py-1 text-sm text-action"
                    >
                      <span className="truncate">{recipient.label}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${recipient.label}`}
                        onClick={() => removeRecipient(recipient.id)}
                        className="shrink-0 rounded-full hover:bg-folder-hover"
                      >
                        <X aria-hidden weight="bold" className="size-3.5" />
                      </button>
                    </span>
                  ) : null,
                )}
                <div className="flex min-w-40 flex-1 items-center gap-2">
                  <Phone aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
                  <MagnifyingGlass aria-hidden className="size-4 shrink-0 text-muted" />
                  <input
                    aria-label="Search and add recipients"
                    role="combobox"
                    aria-expanded={searchOpen}
                    aria-controls="message-recipient-options"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setSearchOpen(true);
                    }}
                    onFocus={() => setSearchOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setSearchOpen(false);
                      if (event.key === 'Enter' && filteredRecipients[0]) {
                        event.preventDefault();
                        addRecipient(filteredRecipients[0]);
                      }
                    }}
                    placeholder="Search and add recipients..."
                    className="min-w-0 flex-1 bg-transparent py-1 text-sm text-text outline-none placeholder:text-muted"
                  />
                </div>
                <button
                  type="button"
                  aria-label={`${selectedIds.length} recipients selected`}
                  className="inline-flex shrink-0 items-center gap-2 text-sm text-text"
                >
                  To ({selectedIds.length})
                  <CaretDown aria-hidden weight="bold" className="size-4 text-muted" />
                </button>
              </div>
              {searchOpen && search.trim() ? (
                <div
                  id="message-recipient-options"
                  role="listbox"
                  className="absolute z-20 left-3 right-3 top-full mt-1 max-h-56 overflow-auto rounded-card border border-border bg-surface p-1 shadow-card"
                >
                  {filteredRecipients.length ? (
                    filteredRecipients.map((recipient) => (
                      <button
                        key={recipient.id}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => addRecipient(recipient)}
                        className="flex w-full items-center justify-between rounded-control px-3 py-2 text-left hover:bg-folder-surface"
                      >
                        <span className="text-sm font-medium text-text">{recipient.label}</span>
                        <span className="text-xs text-muted">{recipient.kind}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted">No recipients found.</p>
                  )}
                </div>
              ) : null}
            </div>

            {channel === 'EMAIL' ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => setCcOpen((open) => !open)}
                  className="inline-flex items-center gap-1 text-sm text-link hover:underline"
                >
                  <Plus aria-hidden className="size-3.5" /> Add Cc
                </button>
                <span aria-hidden className="h-4 border-l border-border" />
                <button
                  type="button"
                  onClick={() => setBccOpen((open) => !open)}
                  className="inline-flex items-center gap-1 text-sm text-link hover:underline"
                >
                  <Plus aria-hidden className="size-3.5" /> Add Bcc
                </button>
                {ccOpen ? (
                  <Input
                    label="Cc"
                    hideLabel
                    placeholder="Add Cc recipients"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className="min-h-9 max-w-sm text-sm"
                  />
                ) : null}
                {bccOpen ? (
                  <Input
                    label="Bcc"
                    hideLabel
                    placeholder="Add Bcc recipients"
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    className="min-h-9 max-w-sm text-sm"
                  />
                ) : null}
              </div>
            ) : null}
          </NumberedSection>

          <NumberedSection
            number={2}
            title="Choose Channel"
            subtitle="Select how you want to send this message."
          >
            <div className="flex flex-wrap gap-3">
              {(['EMAIL', 'SMS'] as const).map((value) => {
                const selected = channel === value;
                const Glyph = value === 'EMAIL' ? EnvelopeSimple : ChatCircleDots;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setChannel(value)}
                    className={`inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-control border px-4 text-sm font-medium ${selected ? 'border-action bg-info-soft text-action' : 'border-border bg-surface text-text hover:bg-canvas'}`}
                  >
                    <Glyph aria-hidden weight="fill" className="size-5" />
                    {value === 'EMAIL' ? 'Email' : 'SMS'}
                  </button>
                );
              })}
            </div>
          </NumberedSection>

          <NumberedSection number={3} title="Compose Message">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label
                  htmlFor="message-template"
                  className="shrink-0 pb-2 text-sm font-medium text-text"
                >
                  Use a Template <span className="font-normal text-muted">(Optional)</span>
                </label>
                <div className="min-w-0 flex-1">
                  <Select
                    id="message-template"
                    label="Select a template"
                    hideLabel
                    value={template}
                    onChange={(event) => setTemplate(event.target.value)}
                    options={[
                      { value: '', label: 'Select a template...' },
                      { value: 'welcome', label: 'Welcome to Firmivra' },
                      { value: 'monthly', label: 'Monthly Newsletter' },
                    ]}
                    className="text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={loadTemplate}
                  className="inline-flex h-9 items-center justify-center rounded-control bg-info-soft px-3 text-sm font-medium text-action hover:bg-folder-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Load Template
                </button>
              </div>

              {channel === 'EMAIL' ? (
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="message-subject" className="text-sm font-medium text-text">
                      Subject <span className="text-danger">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => insertText('{{first_name}}')}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-control bg-info-soft px-3 text-xs font-medium text-action hover:bg-folder-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      <BracketsCurly aria-hidden weight="bold" className="size-4" />
                      <span>Insert Merge Field</span>
                    </button>
                  </div>
                  <Input
                    id="message-subject"
                    label="Subject"
                    hideLabel
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    className="min-h-9 py-1.5 text-sm"
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-text" htmlFor="message-body">
                  Message <span className="text-danger">*</span>
                </label>
                <div className="overflow-hidden rounded-control border border-border bg-surface">
                  <div
                    role="toolbar"
                    aria-label="Message formatting"
                    className="overflow-x-auto border-b border-border"
                  >
                    <div className="flex min-w-max items-center gap-0 px-2 py-1">
                      <select
                        aria-label="Text style"
                        defaultValue="p"
                        onChange={(event) => applyFormat('formatBlock', event.target.value)}
                        className="h-8 w-24 rounded-control border border-border bg-surface px-2 text-sm text-text"
                      >
                        <option value="p">Paragraph</option>
                        <option value="h3">Heading</option>
                        <option value="h4">Subheading</option>
                      </select>
                      {textTools.map((tool, index) => (
                        <span
                          key={tool.label}
                          className={
                            index === 3 || index === 5 ? 'ml-1 border-l border-border pl-1' : ''
                          }
                        >
                          <ToolbarButton
                            icon={tool.icon}
                            label={tool.label}
                            onClick={() => applyFormat(tool.command, tool.value)}
                          />
                        </span>
                      ))}
                      <span className="ml-1 border-l border-border pl-1">
                        <ToolbarButton
                          icon={LinkSimple}
                          label="Insert link"
                          onClick={() => {
                            const url = window.prompt('Link address (https://)');
                            if (url?.startsWith('https://')) applyFormat('createLink', url);
                          }}
                        />
                      </span>
                      {channel === 'EMAIL' ? (
                        <ToolbarButton
                          icon={EnvelopeSimple}
                          label="Email formatting"
                          active
                          onClick={() => setChannel('EMAIL')}
                        />
                      ) : null}
                      <ToolbarButton
                        icon={Paperclip}
                        label="Attach files"
                        onClick={() => fileRef.current?.click()}
                      />
                      <ToolbarButton
                        icon={Smiley}
                        label="Insert smile"
                        onClick={() => insertText(' 🙂')}
                      />
                      <button
                        type="button"
                        onClick={() => insertText('{{first_name}}')}
                        className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-control bg-info-soft px-2 text-xs font-medium text-action hover:bg-folder-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                      >
                        <BracketsCurly aria-hidden weight="bold" className="size-4" />
                        <span>Merge Field</span>
                      </button>
                      <span className="ml-1 flex items-center border-l border-border pl-1">
                        <ToolbarButton
                          icon={ArrowUUpLeft}
                          label="Undo"
                          iconWeight="regular"
                          onClick={() => applyFormat('undo')}
                        />
                        <ToolbarButton
                          icon={ArrowUUpRight}
                          label="Redo"
                          iconWeight="regular"
                          onClick={() => applyFormat('redo')}
                        />
                      </span>
                    </div>
                  </div>
                  <div
                    id="message-body"
                    ref={editorRef}
                    role="textbox"
                    aria-label="Message body"
                    aria-multiline="true"
                    aria-required="true"
                    contentEditable
                    suppressContentEditableWarning
                    className="min-h-48 whitespace-pre-wrap px-3 py-3 text-sm leading-6 text-text focus:outline-none sm:min-h-52 sm:px-4"
                  >
                    {initialMessage}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    multiple
                    onChange={(event) => attachFiles(event.currentTarget.files)}
                    className="sr-only"
                    aria-label="Attach files"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => fileRef.current?.click()}
                    className="border-transparent bg-info-soft text-action hover:bg-folder-hover"
                  >
                    <Paperclip aria-hidden weight="bold" className="size-4" /> Attach Files
                  </Button>
                  <span className="text-xs text-muted">
                    Support for PDF, DOC, DOCX, JPG, PNG (Max 10 MB each)
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {attachedFiles.length} {attachedFiles.length === 1 ? 'attachment' : 'attachments'}
                </span>
                {attachedFiles.length ? (
                  <ul className="flex w-full flex-wrap gap-2" aria-label="Attached files">
                    {attachedFiles.map((file) => (
                      <li
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="rounded-control bg-canvas px-2 py-1 text-xs text-text"
                      >
                        {file.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </NumberedSection>

          <footer className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Button
              variant="secondary"
              onClick={() => router.push('/communications')}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="w-full sm:w-auto">
                <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Draft
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => setSendNotice(true)}>
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" /> Send Now
              </Button>
              <div className="relative flex">
                <Button
                  variant="secondary"
                  onClick={() => setScheduleOpen((open) => !open)}
                  className="w-full rounded-r-none border-action text-action hover:bg-info-soft sm:w-auto"
                >
                  <CalendarBlank aria-hidden weight="fill" className="size-4" /> Schedule Send
                </Button>
                <Button
                  variant="secondary"
                  aria-label="Schedule options"
                  onClick={() => setScheduleOpen((open) => !open)}
                  className="rounded-l-none border-l-0 border-action px-3 text-action hover:bg-info-soft"
                >
                  <CaretDown aria-hidden weight="bold" className="size-4" />
                </Button>
                {scheduleOpen ? (
                  <div className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-card border border-border bg-surface p-4 shadow-card">
                    <label
                      htmlFor="schedule-time"
                      className="mb-2 block text-sm font-medium text-text"
                    >
                      Schedule date and time
                    </label>
                    <input
                      id="schedule-time"
                      type="datetime-local"
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text"
                    />
                    <Button className="mt-3 w-full" onClick={() => setScheduleOpen(false)}>
                      Done
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </footer>
        </Card>

        <aside className="flex min-w-0 flex-col gap-3 xl:col-span-2">
          <Card className="!p-0">
            <button
              type="button"
              aria-expanded={recipientDetailsOpen}
              onClick={() => setRecipientDetailsOpen((open) => !open)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="font-display text-lg font-bold text-heading">Recipient Details</span>
              <CaretDown
                aria-hidden
                weight="bold"
                className={`size-4 text-heading transition-transform ${recipientDetailsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {recipientDetailsOpen ? (
              <div className="border-t border-border px-4 pb-4">
                {person ? (
                  <>
                    <div className="flex items-center gap-3 py-3">
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-soft font-semibold text-action">
                        {person.label
                          .split(' ')
                          .map((word) => word[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-heading">{person.label}</h3>
                          <Badge tone="success">{person.kind}</Badge>
                        </div>
                        <p className="text-sm text-muted">{person.organization ?? person.label}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 text-sm text-muted">
                      {person.email ? (
                        <DetailRow icon={EnvelopeSimple} value={person.email} link />
                      ) : null}
                      {person.phone ? <DetailRow icon={Phone} value={person.phone} /> : null}
                      {person.organization ? (
                        <DetailRow icon={Buildings} value={person.organization} />
                      ) : null}
                      {person.assignee ? (
                        <DetailRow icon={User} label="Assigned To:" value={person.assignee} />
                      ) : null}
                      {person.source ? (
                        <DetailRow icon={Tag} label="Lead Source:" value={person.source} />
                      ) : null}
                      {person.since ? (
                        <DetailRow
                          icon={CalendarBlank}
                          label="Client Since:"
                          value={person.since}
                        />
                      ) : null}
                      {person.status ? (
                        <DetailRow
                          icon={FileText}
                          label="Status:"
                          value={<Badge tone="success">{person.status}</Badge>}
                        />
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="py-5 text-sm text-muted">
                    Select a recipient to see their details.
                  </p>
                )}
              </div>
            ) : null}
          </Card>

          <Card className="!p-0">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="font-display text-lg font-bold text-heading">Recent Activity</h2>
              <button type="button" className="text-sm font-medium text-link hover:underline">
                View All
              </button>
            </div>
            <ul className="flex flex-col gap-2 border-t border-border px-4 py-3">
              {person ? (
                activity.map(({ icon: Glyph, title, date }) => (
                  <li key={title} className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                    <Glyph aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
                    <span className="min-w-0 flex-1 truncate text-text">{title}</span>
                    <time className="shrink-0 text-muted">{date}</time>
                  </li>
                ))
              ) : (
                <li className="py-2 text-sm text-muted">No recent activity available.</li>
              )}
            </ul>
          </Card>

          <Card className="!p-0">
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-info-soft text-action">
                <ChatCircleDots aria-hidden weight="fill" className="size-4" />
              </span>
              <h2 className="font-display text-lg font-bold text-heading">Tips</h2>
            </div>
            <ul className="list-disc space-y-1.5 border-t border-border px-5 py-3 pl-10 text-sm text-text">
              <li>You can send to multiple recipients.</li>
              <li>Use templates to save time.</li>
              <li>Insert merge fields to personalize your message.</li>
              <li>You can schedule the message for a later date.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function DetailRow({
  icon: Glyph,
  label,
  value,
  link,
}: {
  icon: Icon;
  label?: string;
  value: ReactNode;
  link?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Glyph aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
      <span className="min-w-0 break-words">
        {label ? <span className="mr-1">{label}</span> : null}
        {link && typeof value === 'string' ? (
          <a className="text-link hover:underline" href={`mailto:${value}`}>
            {value}
          </a>
        ) : (
          value
        )}
      </span>
    </div>
  );
}
