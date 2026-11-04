'use client';

import {
  OUTBOUND_FILES_MAX,
  OUTBOUND_RELATED_LABELS,
  OUTBOUND_RELATED_TYPES,
  type OutboundExclusion,
  type OutboundRelatedType,
  type OutboundMessage,
  UPLOAD_LIMITS,
} from '@firmivra/types';
import {
  Button,
  Checkbox,
  FileDropzone,
  Input,
  Modal,
  Stepper,
  Textarea,
  Toast,
  Toggle,
} from '@firmivra/ui';
import {
  CaretRight,
  ChatCircleDots,
  ChatText,
  CheckCircle,
  EnvelopeSimple,
  Info,
  MagnifyingGlass,
  PaperPlaneTilt,
  Paperclip,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useEffect, useState } from 'react';
import { fileSize } from '../../../../../../components/message-files';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../../lib/unsaved';
import { uploadFile } from '../../../../../../lib/upload';
import { addDays, localParts, todayIn, toInstant } from '../../../calendar/_components/time';
import {
  EmojiPicker,
  MergeFieldPicker,
  TEMPLATE_KIND,
  TemplatePicker,
} from '../../_components/compose-tools';

type Channel = OutboundMessage['channel'];
type Who = 'clients' | 'leads' | 'both';
const KEY = ['messages', 'outbound'] as const;
const card = 'flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-4 shadow-md';
const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
const h2 = 'font-display text-xl font-bold text-action';

const CHANNELS: { channel: Channel; label: string; hint: string; icon: typeof EnvelopeSimple }[] = [
  {
    channel: 'PORTAL',
    label: 'Portal Message',
    hint: 'A secure message through the client portal',
    icon: ChatCircleDots,
  },
  { channel: 'EMAIL', label: 'Email', hint: 'Send via email', icon: EnvelopeSimple },
  { channel: 'SMS', label: 'Text / SMS', hint: 'Send via text message', icon: ChatText },
];
const NOTE: Record<Channel, string> = {
  PORTAL:
    'Clients read it in their portal and get the usual notice there and by email, if they allow it.',
  EMAIL:
    'Clients get an email that a new message is waiting, with a link to their portal; the message itself stays in the portal. Leads get the message by email.',
  SMS: 'Texts reach leads with a mobile number who agreed to texts.',
};
export const REASON: Record<OutboundExclusion, string> = {
  NO_CONTACT: 'No email or mobile for this channel',
  NO_CONSENT: 'Has not agreed to this channel',
  NO_PORTAL_ACCESS: 'No portal access',
  PROVIDER_UNAVAILABLE: 'This channel is not available',
  SUPPRESSED: 'Address not reachable',
  NOT_PERMITTED: 'Not allowed (archived or out of your reach)',
  MANUALLY_EXCLUDED: 'Left out',
  DUPLICATE: 'Listed twice',
};
const UNAVAILABLE = { TURNED_OFF: 'Turned off in Messages Settings', NOT_SET_UP: 'Not set up yet' };

type Form = {
  channel: Channel;
  subject: string;
  body: string;
  /** The template it started from (MSG-F11). */
  templateId: string | null;
  /** MSG-F13: "type:id" of the client's record it is about, or ''. */
  related: string;
  /** MSG-F16: who owns the conversations it opens, or ''. */
  assignedUserId: string;
  clients: Map<string, string>;
  leads: Map<string, string>;
  later: boolean;
  date: string;
  time: string;
};
const emptyForm = (subject = ''): Form => ({
  channel: 'PORTAL',
  subject,
  body: '',
  templateId: null,
  related: '',
  assignedUserId: '',
  clients: new Map(),
  leads: new Map(),
  later: false,
  date: '',
  time: '09:00',
});
const formOf = (m: OutboundMessage, timeZone: string): Form => {
  const at = m.scheduledFor ? localParts(m.scheduledFor, timeZone) : null;
  return {
    channel: m.channel,
    subject: m.subject ?? '',
    body: m.body,
    templateId: m.templateId,
    related: m.related ? `${m.related.type}:${m.related.id}` : '',
    assignedUserId: m.assignedTo?.userId ?? '',
    clients: new Map(m.recipients.filter((r) => r.kind === 'CLIENT').map((r) => [r.id, r.name])),
    leads: new Map(m.recipients.filter((r) => r.kind === 'LEAD').map((r) => [r.id, r.name])),
    later: at !== null,
    date: at?.date ?? '',
    time: at?.time ?? '09:00',
  };
};
/** New Message's refusals (MSG-F12, F13, F16), in the screen's words. */
const ERRORS: Record<string, string> = {
  RELATED_NEEDS_ONE_CLIENT: 'Related To is for a message to one client.',
  ASSIGNEE_CANNOT_REACH: 'This staff member does not work with everyone you chose.',
  FILES_NEED_PORTAL:
    'Files go to clients through their portal. Choose Portal, or remove the files.',
  FILES_NOT_READY: 'A file is still being checked for viruses. Try again in a moment.',
  FILE_BLOCKED: 'A file failed its security check. Remove it, then send.',
  ATTACHMENT_TYPE: 'Messages Settings do not allow this type of file.',
  ATTACHMENT_TOO_LARGE: 'This file is over the size Messages Settings allow.',
  TOO_MANY_FILES: `A message carries at most ${OUTBOUND_FILES_MAX} files.`,
};
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/**
 * /messages/new (MSG-F09, F10, F14; Frame 2): choose clients, leads or both, the channel (only
 * what reaches them, with the reason when not), the subject and message, then Save Draft,
 * Schedule (firm time zone, editable and cancelable until it goes) or Send. Nothing is sent but by
 * Send Message or a schedule.
 */
export function ComposeScreen({
  initialId,
  initialClientId,
  initialSubject,
}: {
  initialId?: string;
  initialClientId?: string;
  initialSubject?: string;
}) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<OutboundMessage>();
  const [form, setForm] = useState<Form>(() => emptyForm(initialSubject));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [reviewing, setReviewing] = useState(false);
  useUnsavedChanges(dirty);
  const options = useApiQuery(['scheduling', 'options'], () => api.scheduling.options());
  const timeZone = saved?.timezone ?? options.data?.timezone ?? 'America/New_York';

  // A draft or a scheduled message to reopen; a client to start with.
  const opened = useApiQuery([...KEY, 'open', initialId], async () =>
    initialId ? api.messages.outbound.get(initialId) : null,
  );
  const preset = useApiQuery([...KEY, 'preset', initialClientId], async () =>
    initialClientId && !initialId ? api.clients.get(initialClientId) : null,
  );
  const [seeded, setSeeded] = useState(false);
  if (!seeded && opened.data && options.data) {
    setSeeded(true);
    setSaved(opened.data);
    setForm(formOf(opened.data, opened.data.timezone));
  }
  if (!seeded && preset.data) {
    setSeeded(true);
    setForm((f) => ({ ...f, clients: new Map([[preset.data!.id, preset.data!.displayName]]) }));
  }
  useEffect(() => {
    const next = saved ? `/messages/new?id=${saved.id}` : null;
    if (next && !window.location.search.includes(saved!.id)) {
      const params = new URLSearchParams(window.location.search);
      params.set('id', saved!.id);
      params.delete('clientId');
      params.delete('subject');
      window.history.replaceState(null, '', `/messages/new?${params.toString()}`);
    }
  }, [saved]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const chosen = form.clients.size + form.leads.size;
  const ids = {
    clientIds: [...form.clients.keys()].sort(),
    leadIds: [...form.leads.keys()].sort(),
  };
  const check = useApiQuery(
    [...KEY, 'check', form.channel, ids.clientIds, ids.leadIds],
    async () =>
      chosen > 0 ? api.messages.outbound.check({ channel: form.channel, ...ids }) : null,
  );
  const firmChannels = useApiQuery([...KEY, 'channels'], () =>
    api.messages.outbound.check({ channel: 'PORTAL' }),
  );
  const can = check.data?.recipients.filter((r) => r.canReceive).length ?? 0;
  const smsTooLong = form.channel === 'SMS' && form.body.length > 1600;
  const subjectMissing = form.channel === 'EMAIL' && !form.subject.trim();
  const when = form.later && form.date ? toInstant(form.date, form.time, timeZone) : null;
  const finished = saved && !saved.editable;
  const step = finished
    ? 'send'
    : reviewing
      ? 'review'
      : chosen === 0
        ? 'recipients'
        : !form.body.trim()
          ? 'details'
          : 'review';

  // Related To is for a message to one client: another client leaves it out.
  const oneClient = form.clients.size === 1;
  const [relatedType, relatedId] = form.related.split(':');
  const payload = () => ({
    channel: form.channel,
    subject: form.subject.trim() || null,
    body: form.body.trim(),
    templateId: form.templateId,
    related:
      oneClient && relatedType && relatedId
        ? { type: relatedType as OutboundRelatedType, id: relatedId }
        : null,
    assignedUserId: form.assignedUserId || null,
    ...ids,
  });
  /** Saves the draft (a new one when its people or channel changed) and answers it. */
  const save = async (): Promise<OutboundMessage> => {
    const next = saved
      ? await api.messages.outbound.update(saved.id, { version: saved.updatedAt, ...payload() })
      : await api.messages.outbound.create(payload());
    setSaved(next);
    setDirty(false);
    return next;
  };
  /** The saved draft, saved now if it changed (Review reads the server's copy). */
  const prepare = async () => (!saved || dirty ? save() : saved);
  const run = async (what: 'draft' | 'send' | 'schedule', confirmUnresolved = false) => {
    setBusy(true);
    setNotice(undefined);
    try {
      const draft = await prepare();
      if (what === 'draft') setNotice({ text: 'Draft saved.', tone: 'success' });
      if (what === 'send') {
        const sent = await api.messages.outbound.send(draft.id, {
          version: draft.updatedAt,
          confirmUnresolved,
        });
        setSaved(sent);
      }
      if (what === 'schedule' && when) {
        const scheduled = await api.messages.outbound.schedule(draft.id, {
          version: draft.updatedAt,
          scheduledFor: when,
          confirmUnresolved,
        });
        setSaved(scheduled);
        setNotice({ text: 'Message scheduled.', tone: 'success' });
      }
      setReviewing(false);
      await qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (e) {
      setNotice({ text: errorMessage(e, ERRORS), tone: 'error' });
    }
    setBusy(false);
  };
  const cancelSchedule = async () => {
    if (!saved) return;
    setBusy(true);
    try {
      setSaved(await api.messages.outbound.cancel(saved.id, { version: saved.updatedAt }));
      setNotice({ text: 'The scheduled message was canceled. Nothing was sent.', tone: 'success' });
    } catch (e) {
      setNotice({ text: errorMessage(e, ERRORS), tone: 'error' });
    }
    setBusy(false);
  };
  const sendDisabled =
    busy || chosen === 0 || !form.body.trim() || can === 0 || smsTooLong || subjectMissing;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="compose">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChatCircleDots weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
            >
              Messages
            </h1>
            <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
              <Link href="/messages" className="text-link hover:underline">
                Messages
              </Link>
              <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
              <span aria-current="page" className="font-semibold text-heading">
                New Message
              </span>
            </nav>
            <p className="text-base text-muted">
              Create and send a message to your clients or leads.
            </p>
          </div>
        </div>
      </header>
      <div className="rounded-xl bg-surface p-4 shadow-md">
        <Stepper
          label="New message steps"
          current={step}
          steps={[
            { id: 'recipients', label: 'Recipients' },
            { id: 'details', label: 'Message Details' },
            { id: 'review', label: 'Options and Review' },
            { id: 'send', label: 'Send' },
          ]}
        />
      </div>
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(undefined)} />
      ) : null}
      {opened.isError ? (
        <p role="alert" className={quiet}>
          This message is not available. It may have been removed, or it is not yours to open.
        </p>
      ) : null}
      {initialId && !seeded && !opened.isError ? <p className={quiet}>Loading…</p> : null}

      {finished && saved ? (
        <Outcome message={saved} timeZone={timeZone} />
      ) : initialId && !seeded ? null : (
        <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <Recipients form={form} onChange={set} />

          <section aria-label="Message Details" className={card}>
            <h2 className={h2}>2. Message Details</h2>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-heading">
                Communication Channel
              </legend>
              <div role="radiogroup" aria-label="Channel" className="grid gap-2 sm:grid-cols-3">
                {CHANNELS.map((c) => {
                  const off = firmChannels.data?.channels.find((x) => x.channel === c.channel);
                  return (
                    <button
                      key={c.channel}
                      type="button"
                      role="radio"
                      aria-checked={form.channel === c.channel}
                      onClick={() => set({ channel: c.channel })}
                      className={`flex flex-col gap-1 rounded-lg border p-3 text-left ${form.channel === c.channel ? 'border-action bg-accent-soft' : 'border-divider hover:bg-canvas'}`}
                    >
                      <span className="flex items-center gap-2 font-semibold text-heading">
                        <c.icon aria-hidden weight="fill" className="size-5 text-action" />
                        {c.label}
                      </span>
                      <span className="text-xs text-muted">{c.hint}</span>
                      {off?.unavailable ? (
                        <span className="text-xs font-medium text-danger">
                          {UNAVAILABLE[off.unavailable]}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <p className="flex items-start gap-2 text-xs text-muted">
                <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-action" />
                {NOTE[form.channel]}
              </p>
            </fieldset>
            <TemplatePicker
              key={form.channel}
              kind={TEMPLATE_KIND[form.channel]}
              onUse={(t) =>
                set({
                  templateId: t.id,
                  body: t.body,
                  ...(form.channel !== 'SMS' && t.subject ? { subject: t.subject } : {}),
                })
              }
            />
            {form.channel !== 'SMS' ? (
              <Input
                label={
                  form.channel === 'EMAIL' ? 'Subject (required for email)' : 'Subject (optional)'
                }
                maxLength={200}
                value={form.subject}
                onChange={(e) => set({ subject: e.target.value })}
              />
            ) : null}
            <div
              className="flex flex-wrap items-center justify-end gap-2"
              aria-label="Message tools"
            >
              <MergeFieldPicker
                onInsert={(token) =>
                  set({
                    body: `${form.body}${form.body && !/\s$/.test(form.body) ? ' ' : ''}${token}`,
                  })
                }
              />
              <EmojiPicker onPick={(e) => set({ body: `${form.body}${e}` })} />
            </div>
            <Textarea
              label="Message"
              rows={9}
              maxLength={form.channel === 'SMS' ? 1600 : 10_000}
              value={form.body}
              onChange={(e) => set({ body: e.target.value })}
            />
            <p className="text-right text-xs text-muted" data-testid="compose-count">
              Words: {words(form.body)} · Characters: {form.body.length}
              {form.channel === 'SMS' ? ` of 1,600` : ''}
            </p>
            {/* MSG-F12: files, to clients through their portal. */}
            <ComposeFiles
              message={saved}
              channel={form.channel}
              canSave={chosen > 0 && form.body.trim() !== '' && !smsTooLong}
              prepare={prepare}
              onChanged={setSaved}
              onError={(text) => setNotice({ text, tone: 'error' })}
            />
          </section>

          <div className="flex min-w-0 flex-col gap-4">
            <section aria-label="Additional Options" className={card}>
              <h2 className={h2}>3. Additional Options</h2>
              <RelatedAndOwner form={form} onChange={set} />
              <div className="flex items-center justify-between gap-3 text-sm font-semibold text-heading">
                <span>
                  Schedule Message <span className="font-normal text-muted">(optional)</span>
                </span>
                <Toggle
                  label="Schedule Message"
                  checked={form.later}
                  onChange={(v) =>
                    set({
                      later: v,
                      date: v && !form.date ? addDays(todayIn(timeZone), 1) : form.date,
                    })
                  }
                />
              </div>
              {form.later ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Date"
                      type="date"
                      min={todayIn(timeZone)}
                      value={form.date}
                      onChange={(e) => set({ date: e.target.value })}
                    />
                    <Input
                      label="Time"
                      type="time"
                      value={form.time}
                      onChange={(e) => set({ time: e.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted">
                    In your firm&apos;s time zone ({timeZone}). You can change or cancel it until it
                    goes.
                  </p>
                </>
              ) : null}
            </section>

            <section aria-label="Preview Recipients" className={card} data-testid="compose-preview">
              <h2 className={h2}>4. Preview Recipients ({chosen})</h2>
              {chosen === 0 ? <p className={quiet}>Choose who receives it.</p> : null}
              <ul className="flex flex-col gap-1 text-sm">
                {(check.data?.recipients ?? []).map((r) => (
                  <li key={`${r.kind}${r.id}`} className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-heading">{r.name}</span>
                    {r.canReceive ? (
                      <span className="shrink-0 rounded-md bg-success-soft px-2 py-0.5 text-xs text-success">
                        Can receive
                      </span>
                    ) : (
                      <span className="shrink-0 text-right text-xs text-danger">
                        {r.reason ? REASON[r.reason] : 'Cannot receive'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {chosen > 0 && check.data ? (
                <p className="text-xs text-muted" data-testid="compose-reach">
                  {can} of {chosen} can receive it. Anyone who cannot is skipped, never sent to.
                </p>
              ) : null}
            </section>

            <section aria-label="Send Message" className={card}>
              <h2 className={h2}>5. Send Message</h2>
              {subjectMissing ? (
                <p className="text-xs text-danger">An email needs a subject.</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/messages"
                  className="inline-flex min-h-11 items-center rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-accent-soft"
                >
                  Cancel
                </Link>
                <Button
                  variant="secondary"
                  disabled={busy || chosen === 0 || !form.body.trim()}
                  onClick={() => void run('draft')}
                >
                  Save Draft
                </Button>
                {form.later ? (
                  <button
                    type="button"
                    className={gold}
                    disabled={sendDisabled || !when}
                    onClick={() => setReviewing(true)}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Review and
                    Schedule
                  </button>
                ) : (
                  <button
                    type="button"
                    className={gold}
                    disabled={sendDisabled}
                    onClick={() => setReviewing(true)}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Review and Send
                  </button>
                )}
              </div>
              {saved?.status === 'SCHEDULED' && !dirty ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-info-soft p-3 text-sm text-heading">
                  <span data-testid="compose-scheduled">
                    Scheduled for {localParts(saved.scheduledFor ?? '', timeZone).date}{' '}
                    {localParts(saved.scheduledFor ?? '', timeZone).time} ({timeZone}).
                  </span>
                  <Button variant="secondary" disabled={busy} onClick={() => void cancelSchedule()}>
                    Cancel Schedule
                  </Button>
                </div>
              ) : null}
            </section>
            <Drafts currentId={saved?.id} />
            {reviewing ? (
              <ReviewDialog
                prepare={prepare}
                later={form.later}
                busy={busy}
                onBack={() => setReviewing(false)}
                onConfirm={(confirm) => void run(form.later ? 'schedule' : 'send', confirm)}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** 1. Select Recipients: Clients, Leads or Both, several at once, with the count and Clear All. */
function Recipients({ form, onChange }: { form: Form; onChange: (patch: Partial<Form>) => void }) {
  const [who, setWho] = useState<Who>('clients');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const clients = useApiQuery([...KEY, 'clients', term], () =>
    api.clients.list({ ...(term ? { search: term } : {}), limit: 50 }),
  );
  const leads = useApiQuery([...KEY, 'leads', term], () =>
    api.leadPipeline.list({ ...(term ? { search: term } : {}), pageSize: 50 }),
  );
  const rows = [
    ...(who === 'leads'
      ? []
      : (clients.data?.items ?? []).map((c) => ({
          kind: 'CLIENT' as const,
          id: c.id,
          name: c.displayName,
          secondary: c.email ?? '',
        }))),
    ...(who === 'clients'
      ? []
      : (leads.data?.items ?? []).map((l) => ({
          kind: 'LEAD' as const,
          id: l.id,
          name: `${l.firstName} ${l.lastName}`.trim(),
          secondary: l.businessName ?? l.email,
        }))),
  ];
  const chosen = form.clients.size + form.leads.size;
  const toggle = (r: (typeof rows)[number], on: boolean) => {
    const map = new Map(r.kind === 'CLIENT' ? form.clients : form.leads);
    if (on) map.set(r.id, r.name);
    else map.delete(r.id);
    onChange(r.kind === 'CLIENT' ? { clients: map } : { leads: map });
  };
  return (
    <section aria-label="Select Recipients" className={card} data-testid="compose-recipients">
      <h2 className={h2}>1. Select Recipients</h2>
      <div role="tablist" aria-label="Who" className="flex border-b border-divider">
        {(
          [
            ['clients', 'Clients'],
            ['leads', 'Leads'],
            ['both', 'Both'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={who === id}
            onClick={() => setWho(id)}
            className={`-mb-px min-h-11 flex-1 border-b-2 px-3 text-sm ${who === id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
        <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
        <span className="sr-only">Search recipients</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients and leads by name or email..."
          className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
      </label>
      {clients.isPending || leads.isPending ? <p className={quiet}>Loading…</p> : null}
      {!clients.isPending && !leads.isPending && rows.length === 0 ? (
        <p className={quiet}>No one matches.</p>
      ) : null}
      <ul className="flex max-h-120 flex-col overflow-auto" aria-label="People">
        {rows.map((r) => (
          <li
            key={`${r.kind}${r.id}`}
            className="flex items-center justify-between gap-2 border-t border-divider first:border-t-0"
          >
            <Checkbox
              label={r.name}
              checked={(r.kind === 'CLIENT' ? form.clients : form.leads).has(r.id)}
              onChange={(e) => toggle(r, e.target.checked)}
            />
            <span className="flex shrink-0 flex-col items-end text-xs">
              <span className="rounded-md bg-info-soft px-2 py-0.5 font-medium text-info">
                {r.kind === 'CLIENT' ? 'Client' : 'Lead'}
              </span>
              <span className="max-w-40 truncate text-muted">{r.secondary}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-divider pt-2 text-sm">
        <span className="font-semibold text-heading" data-testid="compose-selected">
          {chosen} selected
        </span>
        <button
          type="button"
          className="font-medium text-link disabled:text-muted"
          disabled={chosen === 0}
          onClick={() => onChange({ clients: new Map(), leads: new Map() })}
        >
          Clear All
        </button>
      </div>
    </section>
  );
}

/** Drafts and scheduled messages to pick up again (Staff: their own). */
/**
 * MSG-F12: files sent with the message, to clients through their portal (the Portal channel). A
 * file goes on the saved draft (saved first when needed), is checked for viruses, and the message
 * sends once each is ready. Messages Settings decide the types and the size.
 */
function ComposeFiles({
  message,
  channel,
  canSave,
  prepare,
  onChanged,
  onError,
}: {
  message?: OutboundMessage;
  channel: OutboundMessage['channel'];
  /** A draft can be saved: someone is chosen and there is a message. */
  canSave: boolean;
  prepare: () => Promise<OutboundMessage>;
  onChanged: (m: OutboundMessage) => void;
  onError: (text: string) => void;
}) {
  const settings = useApiQuery(['messages', 'settings'], () => api.messages.settings());
  const [busy, setBusy] = useState(false);
  const files = message?.files ?? [];
  const editable = !message || message.editable;
  const types: readonly string[] = settings.data?.allowedAttachmentTypes ?? [];
  const maxMb = settings.data?.attachmentMaxMb ?? 0;
  const accept = Object.values(UPLOAD_LIMITS.types)
    .flat()
    .filter((e) => types.includes(e.slice(1)));
  const room = OUTBOUND_FILES_MAX - files.length;
  const add = async (picked: File[]) => {
    setBusy(true);
    try {
      const m = await prepare();
      for (const file of picked.slice(0, room)) {
        await uploadFile(file, {
          start: (facts) => api.messages.outbound.startFile(m.id, facts),
          finish: (uploadToken) => api.messages.outbound.confirmFile(m.id, { uploadToken }),
          maxBytes: maxMb * 1024 * 1024,
        });
      }
      onChanged(await api.messages.outbound.get(m.id));
    } catch (e) {
      onError(errorMessage(e, ERRORS));
    }
    setBusy(false);
  };
  const remove = async (fileId: string) => {
    if (!message) return;
    setBusy(true);
    try {
      await api.messages.outbound.removeFile(message.id, fileId);
      onChanged(await api.messages.outbound.get(message.id));
    } catch (e) {
      onError(errorMessage(e, ERRORS));
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-2" data-testid="compose-files">
      <span className="text-sm font-semibold text-heading">
        Attachments <span className="font-normal text-muted">(optional)</span>
      </span>
      {files.length > 0 ? (
        <ul aria-label="Attached files" className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-heading"
            >
              <Paperclip aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{f.fileName}</span>
              <span className="shrink-0 text-xs text-muted">
                {f.status === 'READY'
                  ? fileSize(f.sizeBytes)
                  : f.status === 'CHECKING'
                    ? 'Checking…'
                    : 'Failed its security check'}
              </span>
              {editable ? (
                <button
                  type="button"
                  aria-label={`Remove ${f.fileName}`}
                  disabled={busy}
                  onClick={() => void remove(f.id)}
                  className="rounded-full p-1 text-muted hover:bg-canvas hover:text-heading disabled:opacity-50"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {channel !== 'PORTAL' && files.length > 0 ? (
        <p role="alert" className="text-xs text-danger">
          Files go to clients through their portal. Choose Portal, or remove the files.
        </p>
      ) : null}
      {editable && room > 0 ? (
        <FileDropzone
          label="Attach files"
          multiple
          accept={accept}
          maxBytes={maxMb * 1024 * 1024 || undefined}
          maxFiles={room}
          disabled={busy || !canSave || accept.length === 0}
          hints={[
            `Accepted formats: ${accept.map((e) => e.slice(1).toUpperCase()).join(', ')}`,
            `Max size: ${maxMb} MB per file, up to ${OUTBOUND_FILES_MAX} files`,
            canSave
              ? 'Files go to clients through their portal (Portal channel), never by email or text.'
              : 'Choose recipients and write the message first: files go on the saved draft.',
          ]}
          onFiles={(picked) => void add(picked)}
        />
      ) : null}
    </div>
  );
}

const pick =
  'h-10 w-full min-w-0 rounded-lg border border-divider bg-surface px-3 text-sm font-normal text-text disabled:opacity-50';

/**
 * MSG-F13, F16: Related To, one of the client's own records (for a message to one client), and
 * Assign Staff, who owns the conversations it opens. Both reach the conversation: it is filed
 * under the record (Appointments, Invoices or Documents in Messages) and owned by that person.
 */
function RelatedAndOwner({
  form,
  onChange,
}: {
  form: Form;
  onChange: (patch: Partial<Form>) => void;
}) {
  const one = form.clients.size === 1 ? [...form.clients.keys()][0] : '';
  const options = useApiQuery([...KEY, 'related', one], async () =>
    one ? api.messages.outbound.relatedOptions({ clientId: one }) : null,
  );
  const assignees = useApiQuery([...KEY, 'assignees'], () => api.messages.outbound.assignees());
  const items = options.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3" data-testid="compose-related">
      <label className="flex flex-col gap-1 text-sm font-semibold text-heading">
        <span>
          Related To <span className="font-normal text-muted">(optional)</span>
        </span>
        <select
          className={pick}
          value={one ? form.related : ''}
          disabled={!one}
          onChange={(e) => onChange({ related: e.target.value })}
        >
          <option value="">
            {one
              ? items.length || options.isPending
                ? 'Nothing'
                : 'This client has no records yet'
              : 'Choose one client to link one of their records'}
          </option>
          {OUTBOUND_RELATED_TYPES.map((type) => {
            const ofType = items.filter((i) => i.type === type);
            return ofType.length ? (
              <optgroup key={type} label={OUTBOUND_RELATED_LABELS[type]}>
                {ofType.map((i) => (
                  <option key={i.id} value={`${i.type}:${i.id}`}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold text-heading">
        <span>
          Assign Staff <span className="font-normal text-muted">(optional)</span>
        </span>
        <select
          className={pick}
          value={form.assignedUserId}
          onChange={(e) => onChange({ assignedUserId: e.target.value })}
        >
          <option value="">Nobody</option>
          {(assignees.data?.items ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        The conversation it opens is filed under the record and owned by this person. A staff member
        owns only conversations with their own clients.
      </p>
    </div>
  );
}

function Drafts({ currentId }: { currentId?: string }) {
  const list = useApiQuery([...KEY, 'list'], () => api.messages.outbound.list());
  const items = (list.data?.items ?? []).filter((m) => m.id !== currentId);
  if (items.length === 0) return null;
  return (
    <section aria-label="Drafts and Scheduled" className={card} data-testid="compose-drafts">
      <h2 className="text-base font-bold text-heading">Drafts and Scheduled</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              <span className="font-medium text-heading">{m.subject || m.body.slice(0, 40)}</span>
              <span className="text-muted">
                {' '}
                · {m.status === 'SCHEDULED' ? 'Scheduled' : 'Draft'} · {m.counts.total}{' '}
                {m.counts.total === 1 ? 'recipient' : 'recipients'}
              </span>
            </span>
            <Link href={`/messages/new?id=${m.id}`} className="shrink-0 font-medium text-link">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Sent (or canceled): who got it on which channel, who was skipped and why. */
function Outcome({ message, timeZone }: { message: OutboundMessage; timeZone: string }) {
  const sent = message.recipients.filter((r) => r.status === 'SENT');
  const title =
    message.status === 'CANCELED'
      ? 'Canceled: nothing was sent'
      : message.status === 'FAILED'
        ? 'Not sent'
        : message.status === 'PARTIAL'
          ? 'Sent to some'
          : 'Message sent';
  const channel = CHANNELS.find((c) => c.channel === message.channel)?.label ?? message.channel;
  return (
    <section aria-label="Sent" className={card} data-testid="compose-outcome">
      <h2 className="flex items-center gap-2 text-xl font-bold text-heading">
        <CheckCircle aria-hidden weight="fill" className="size-6 text-success" /> {title}
      </h2>
      <p className="text-sm text-text">
        {channel}
        {message.completedAt
          ? ` · ${localParts(message.completedAt, timeZone).date} ${localParts(message.completedAt, timeZone).time} (${timeZone})`
          : ''}
        {' · '}
        {sent.length} sent, {message.recipients.length - sent.length} not sent
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {message.recipients.map((r) => (
          <li
            key={`${r.kind}${r.id}`}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="font-medium text-heading">{r.name}</span>
            <span className="flex items-center gap-2 text-xs">
              {r.status === 'SENT' ? (
                <span className="rounded-md bg-success-soft px-2 py-0.5 text-success">Sent</span>
              ) : (
                <span className="text-danger">
                  {r.status === 'FAILED' ? 'Failed' : r.reason ? REASON[r.reason] : 'Not sent'}
                </span>
              )}
              {r.threadId ? (
                <Link href={`/messages?thread=${r.threadId}`} className="font-medium text-link">
                  Open conversation
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Link href="/messages" className={gold}>
          Back to Messages
        </Link>
        <Link
          href="/messages/new?fresh=1"
          className="inline-flex min-h-11 items-center rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-accent-soft"
        >
          New Message
        </Link>
      </div>
    </section>
  );
}

/**
 * Review (MSG-F15): each person's message with the merge fields filled from their record, who is
 * skipped and why, the timing, and the checks. Fields nobody can fill block until "send them as
 * written" is ticked. Nothing is sent until Send Message or Schedule Message here.
 */
function ReviewDialog({
  prepare,
  later,
  busy,
  onBack,
  onConfirm,
}: {
  prepare: () => Promise<OutboundMessage>;
  later: boolean;
  busy: boolean;
  onBack: () => void;
  onConfirm: (confirmUnresolved: boolean) => void;
}) {
  const review = useApiQuery([...KEY, 'review', later], async () =>
    api.messages.outbound.review((await prepare()).id),
  );
  const [confirm, setConfirm] = useState(false);
  const r = review.data;
  const blocked = r?.checks.some((c) => c.severity === 'BLOCK') ?? true;
  const needsConfirm = (r?.unresolved.length ?? 0) > 0;
  const tone = { BLOCK: 'text-danger', WARN: 'text-warning', OK: 'text-success' } as const;
  return (
    <Modal
      open
      title="Review Your Message"
      subtitle={
        r?.timing.mode === 'SCHEDULED' || later
          ? `Scheduled, in your firm's time zone (${r?.timing.timezone ?? ''}).`
          : 'Sends now.'
      }
      onClose={onBack}
      footer={
        <>
          <Button variant="secondary" onClick={onBack}>
            Back to Editing
          </Button>
          <Button
            disabled={busy || !r || blocked || (needsConfirm && !confirm)}
            onClick={() => onConfirm(confirm)}
          >
            {later ? 'Schedule Message' : 'Send Message'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="compose-review">
        {review.isPending ? <p className={quiet}>Checking…</p> : null}
        {review.isError ? (
          <p role="alert" className={quiet}>
            {errorMessage(review.error)}
          </p>
        ) : null}
        <ul className="flex flex-col gap-1 text-sm" aria-label="Checks">
          {(r?.checks ?? []).map((c) => (
            <li key={c.code} className={tone[c.severity]}>
              {c.message}
            </li>
          ))}
        </ul>
        {needsConfirm ? (
          <Checkbox
            label="Send them as written where they cannot be filled"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
        ) : null}
        <ul
          className="flex max-h-80 flex-col gap-2 overflow-auto"
          aria-label="What each person gets"
        >
          {(r?.recipients ?? []).map((p) => (
            <li key={`${p.kind}${p.id}`} className="rounded-lg border border-divider p-2 text-sm">
              <p className="flex justify-between gap-2 font-semibold text-heading">
                {p.name}
                <span
                  className={`text-xs font-normal ${p.canReceive ? 'text-success' : 'text-danger'}`}
                >
                  {p.canReceive ? 'Receives it' : p.reason ? REASON[p.reason] : 'Skipped'}
                </span>
              </p>
              {p.subject ? <p className="text-xs text-muted">Subject: {p.subject}</p> : null}
              <p className="mt-1 whitespace-pre-wrap text-text">{p.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
