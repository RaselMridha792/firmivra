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
  EnvelopeSimple,
  FileText,
  FloppyDisk,
  LinkSimple,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
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
  X,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ADMIN_COMM_ERRORS,
  FIRM_PLANS,
  type AdminCommContact,
  type AdminCommContactRef,
  type AdminCommSendMode,
} from '@firmivra/types';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';

type Channel = 'EMAIL' | 'SMS';
const kindLabels: Record<AdminCommContact['type'], string> = {
  FIRM: 'Firm',
  LEAD: 'Lead',
  TEAM: 'Team',
};
/** A contact's key and its reference (the record, never typed contact details). */
const keyOf = (c: AdminCommContact) =>
  `${c.type}:${c.business?.id ?? c.salesContactId ?? c.userId ?? c.name}`;
function refOf(c: AdminCommContact): AdminCommContactRef | null {
  if (c.type === 'FIRM' && c.business) return { type: 'FIRM', businessId: c.business.id };
  if (c.type === 'LEAD' && c.salesContactId)
    return { type: 'LEAD', salesContactId: c.salesContactId };
  if (c.type === 'TEAM' && c.userId) return { type: 'TEAM', userId: c.userId };
  return null;
}
const labelOf = (c: AdminCommContact) =>
  c.type === 'FIRM' && c.business && c.business.name !== c.name
    ? `${c.name} (${c.business.name})`
    : c.type === 'TEAM'
      ? `Team: ${c.name}`
      : c.name;
const FIRST_NAME = '{{contact.first_name}}';
const emails = (text: string) =>
  text
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

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
  const [selected, setSelected] = useState<AdminCommContact[]>([]);
  const [activeKey, setActiveKey] = useState('');
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [ccOpen, setCcOpen] = useState(false);
  const [bccOpen, setBccOpen] = useState(false);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [template, setTemplate] = useState('');
  const [loadedTemplate, setLoadedTemplate] = useState('');
  const [subject, setSubject] = useState('');
  const [recipientDetailsOpen, setRecipientDetailsOpen] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [sendOptionsOpen, setSendOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchText(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const contacts = useApiQuery(['admin-communications', 'contacts', searchText], () =>
    searchText
      ? api.adminCommunications.contacts({ search: searchText })
      : Promise.resolve({ items: [] }),
  );
  const templates = useApiQuery(['admin-communications', 'templates', 'active', channel], () =>
    api.adminCommunications.templates.list({
      status: 'ACTIVE',
      channel,
      sort: 'NAME',
      pageSize: 100,
    }),
  );
  const person = selected.find((c) => keyOf(c) === activeKey) ?? selected[0];
  const firmId = person?.type === 'FIRM' ? (person.business?.id ?? null) : null;
  const firm = useApiQuery(['firms', 'detail', firmId ?? 'none'], () =>
    firmId ? api.firmApplications.getFirm(firmId) : Promise.resolve(null),
  );

  const filteredRecipients = useMemo(() => {
    const chosen = new Set(selected.map(keyOf));
    return (contacts.data?.items ?? []).filter((c) => !chosen.has(keyOf(c)));
  }, [contacts.data, selected]);

  const addRecipient = (contact: AdminCommContact) => {
    setSelected((current) => [...current, contact]);
    setActiveKey(keyOf(contact));
    setSearch('');
    setSearchOpen(false);
  };

  const removeRecipient = (key: string) => {
    const remaining = selected.filter((c) => keyOf(c) !== key);
    setSelected(remaining);
    if (key === activeKey) setActiveKey(remaining[0] ? keyOf(remaining[0]) : '');
  };

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
  };

  const insertText = (value: string) => applyFormat('insertText', value);

  const loadTemplate = () => {
    const chosen = templates.data?.items.find((t) => t.id === template);
    if (!chosen) return;
    setLoadedTemplate(chosen.id);
    if (chosen.subject) setSubject(chosen.subject);
    if (editorRef.current) editorRef.current.innerText = chosen.body;
  };

  /** One message per recipient, each in its own thread; Cc and Bcc on email only. */
  async function submit(mode: AdminCommSendMode) {
    const body = editorRef.current?.innerText.trim() ?? '';
    if (!selected.length) return setNotice('Add at least one recipient.');
    if (!body) return setNotice('Write a message.');
    if (channel === 'EMAIL' && mode !== 'DRAFT' && !subject.trim())
      return setNotice('Add a subject.');
    if (mode === 'SCHEDULE' && !scheduleAt) return setNotice('Choose when to send it.');
    setBusy(true);
    setNotice('');
    let done = 0;
    try {
      for (const contact of selected) {
        const ref = refOf(contact);
        if (!ref) continue;
        await api.adminCommunications.messages.create({
          contact: ref,
          channel,
          ...(channel === 'EMAIL' && subject.trim() ? { subject: subject.trim() } : {}),
          body,
          ...(loadedTemplate ? { templateId: loadedTemplate } : {}),
          ...(channel === 'EMAIL' && cc.trim() ? { cc: emails(cc) } : {}),
          ...(channel === 'EMAIL' && bcc.trim() ? { bcc: emails(bcc) } : {}),
          mode,
          ...(mode === 'SCHEDULE'
            ? {
                scheduledAt: new Date(scheduleAt).toISOString(),
                scheduledTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }
            : {}),
          idempotencyKey: crypto.randomUUID(),
        });
        done += 1;
      }
      router.push('/communications');
    } catch (error) {
      setNotice(
        `${done ? `${done} of ${selected.length} done. ` : ''}${errorMessage(error, ADMIN_COMM_ERRORS)}`,
      );
    } finally {
      setBusy(false);
    }
  }

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
              disabled={busy}
              onClick={() => void submit('DRAFT')}
              className="border-transparent bg-info-soft text-action hover:bg-folder-hover"
            >
              <CalendarBlank aria-hidden weight="fill" className="size-4" />
              Save as Draft
            </Button>
            <div className="relative">
              <div className="flex overflow-hidden rounded-control">
                <Button
                  className="rounded-r-none"
                  disabled={busy}
                  onClick={() => void submit('SEND')}
                >
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
        {notice || null}
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
                {selected.map((recipient) => (
                  <span
                    key={keyOf(recipient)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-pill bg-info-soft px-2.5 py-1 text-sm text-action"
                  >
                    <button
                      type="button"
                      className="truncate"
                      onClick={() => setActiveKey(keyOf(recipient))}
                    >
                      {labelOf(recipient)}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${labelOf(recipient)}`}
                      onClick={() => removeRecipient(keyOf(recipient))}
                      className="shrink-0 rounded-full hover:bg-folder-hover"
                    >
                      <X aria-hidden weight="bold" className="size-3.5" />
                    </button>
                  </span>
                ))}
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
                  aria-label={`${selected.length} recipients selected`}
                  className="inline-flex shrink-0 items-center gap-2 text-sm text-text"
                >
                  To ({selected.length})
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
                        key={keyOf(recipient)}
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => addRecipient(recipient)}
                        className="flex w-full items-center justify-between rounded-control px-3 py-2 text-left hover:bg-folder-surface"
                      >
                        <span className="text-sm font-medium text-text">{labelOf(recipient)}</span>
                        <span className="text-xs text-muted">{kindLabels[recipient.type]}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted">
                      {contacts.isError
                        ? 'Contacts are unavailable. Try again in a moment.'
                        : contacts.isFetching
                          ? 'Searching…'
                          : 'No recipients found.'}
                    </p>
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
                      {
                        value: '',
                        label: templates.data?.items.length
                          ? 'Select a template...'
                          : 'No templates for this channel',
                      },
                      ...(templates.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
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
                      onClick={() => insertText(FIRST_NAME)}
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
                        icon={Smiley}
                        label="Insert smile"
                        onClick={() => insertText(' 🙂')}
                      />
                      <button
                        type="button"
                        onClick={() => insertText(FIRST_NAME)}
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
                  ></div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                    multiple
                    disabled
                    className="sr-only"
                    aria-label="Attach files"
                  />
                  <Button
                    variant="secondary"
                    disabled
                    className="border-transparent bg-info-soft text-action hover:bg-folder-hover"
                  >
                    <Paperclip aria-hidden weight="bold" className="size-4" /> Attach Files
                  </Button>
                  <span className="text-xs text-muted">
                    A direct message carries text; files go out with broadcasts.
                  </span>
                </div>
                <span className="text-xs text-muted">0 attachments</span>
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
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => void submit('DRAFT')}
              >
                <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Draft
              </Button>
              <Button
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => void submit('SEND')}
              >
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
                      value={scheduleAt}
                      onChange={(event) => setScheduleAt(event.target.value)}
                      className="w-full rounded-control border border-border bg-surface px-3 py-2 text-sm text-text"
                    />
                    <Button
                      className="mt-3 w-full"
                      disabled={busy || !scheduleAt}
                      onClick={() => {
                        setScheduleOpen(false);
                        void submit('SCHEDULE');
                      }}
                    >
                      Schedule
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
                        {person.name
                          .split(' ')
                          .map((word) => word[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-heading">{person.name}</h3>
                          <Badge tone="success">{kindLabels[person.type]}</Badge>
                        </div>
                        <p className="text-sm text-muted">{person.business?.name ?? 'Firmivra'}</p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 text-sm text-muted">
                      {person.email ? (
                        <DetailRow icon={EnvelopeSimple} value={person.email} link />
                      ) : null}
                      {person.phone ? <DetailRow icon={Phone} value={person.phone} /> : null}
                      {person.business ? (
                        <DetailRow icon={Buildings} value={person.business.name} />
                      ) : null}
                      {firm.data?.plan ? (
                        <DetailRow icon={Tag} label="Plan:" value={FIRM_PLANS[firm.data.plan]} />
                      ) : null}
                      {firm.data ? (
                        <DetailRow
                          icon={FileText}
                          label="Status:"
                          value={
                            <Badge tone="success">
                              {firm.data.status.charAt(0) + firm.data.status.slice(1).toLowerCase()}
                            </Badge>
                          }
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
              <Link
                href="/audit-security"
                className="text-sm font-medium text-link hover:underline"
              >
                View All
              </Link>
            </div>
            <p className="border-t border-border px-4 py-3 text-sm text-muted">
              {person
                ? 'Changes to this contact are kept in Audit & Security.'
                : 'No recent activity available.'}
            </p>
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
