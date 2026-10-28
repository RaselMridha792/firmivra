'use client';

import type { OutboundExclusion, OutboundMessage } from '@firmivra/types';
import { Button, Checkbox, Input, Stepper, Textarea, Toast, Toggle } from '@firmivra/ui';
import {
  CaretRight,
  ChatCircleDots,
  ChatText,
  CheckCircle,
  EnvelopeSimple,
  Info,
  MagnifyingGlass,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../../lib/unsaved';
import { addDays, localParts, todayIn, toInstant } from '../../../calendar/_components/time';

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
    clients: new Map(m.recipients.filter((r) => r.kind === 'CLIENT').map((r) => [r.id, r.name])),
    leads: new Map(m.recipients.filter((r) => r.kind === 'LEAD').map((r) => [r.id, r.name])),
    later: at !== null,
    date: at?.date ?? '',
    time: at?.time ?? '09:00',
  };
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
    : chosen === 0
      ? 'recipients'
      : !form.body.trim()
        ? 'details'
        : 'review';

  const payload = () => ({
    channel: form.channel,
    subject: form.subject.trim() || null,
    body: form.body.trim(),
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
  const run = async (what: 'draft' | 'send' | 'schedule') => {
    setBusy(true);
    setNotice(undefined);
    try {
      const draft = !saved || dirty ? await save() : saved;
      if (what === 'draft') setNotice({ text: 'Draft saved.', tone: 'success' });
      if (what === 'send') {
        const sent = await api.messages.outbound.send(draft.id, { version: draft.updatedAt });
        setSaved(sent);
      }
      if (what === 'schedule' && when) {
        const scheduled = await api.messages.outbound.schedule(draft.id, {
          version: draft.updatedAt,
          scheduledFor: when,
        });
        setSaved(scheduled);
        setNotice({ text: 'Message scheduled.', tone: 'success' });
      }
      await qc.invalidateQueries({ queryKey: ['messages'] });
    } catch (e) {
      setNotice({ text: errorMessage(e), tone: 'error' });
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
      setNotice({ text: errorMessage(e), tone: 'error' });
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
          </section>

          <div className="flex min-w-0 flex-col gap-4">
            <section aria-label="Additional Options" className={card}>
              <h2 className={h2}>3. Additional Options</h2>
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
                    onClick={() => void run('schedule')}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Schedule Message
                  </button>
                ) : (
                  <button
                    type="button"
                    className={gold}
                    disabled={sendDisabled}
                    onClick={() => void run('send')}
                  >
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Send Message
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
