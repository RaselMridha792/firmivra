'use client';

import type { MessageThread } from '@firmivra/types';
import {
  Avatar,
  Button,
  FilterChip,
  FilterGroup,
  Input,
  Modal,
  Textarea,
  Toast,
} from '@firmivra/ui';
import {
  CalendarBlank,
  ChatCircleDots,
  Envelope,
  FileText,
  Funnel,
  Gear,
  MagnifyingGlass,
  PaperPlaneRight,
  PaperPlaneTilt,
  Phone,
  Plus,
} from '@phosphor-icons/react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { shouldRetry, useApiQuery } from '../../../../../lib/query';
import {
  activeFilters,
  addressOf,
  inView,
  type MessagesView,
  readView,
  REPLIES,
  SINCE,
  STARTED,
  TABS,
  type TabId,
} from './messages-view';

const KEY = ['messages'] as const;
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const hm = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? hm.format(d) : when.format(d);
};
const card = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
const quiet = 'rounded-lg bg-canvas p-4 text-center text-sm text-muted';
const gold =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-gold px-5 text-sm font-semibold text-on-action hover:opacity-90 disabled:opacity-50';
const subtle =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas disabled:opacity-50';
/** MSG-F04: the blue secondary actions beside the gold New Message. */
const blue =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-semibold text-action hover:bg-accent-soft';
const select =
  'h-10 w-full rounded-lg border border-divider bg-surface px-3 text-sm font-normal text-text';
const tag = 'rounded-md bg-canvas px-2 py-0.5 text-xs font-medium text-muted';

const relatedLabel = (t: MessageThread) =>
  t.related ? t.related.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Client';
const EMPTY: Partial<Record<TabId, string>> = {
  leads: 'No conversations with leads yet.',
  automations: 'No conversations opened by an automation.',
  archived: 'No archived conversations.',
};

/** The search text, a moment after typing stops: the API searches it (MSG-F01). */
function useSettled(value: string, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** /messages: the firm's inbox, the open conversation and the client beside it. */
export function MessagesScreen({
  initialView = readView({}),
}: {
  /** The view from the address: tab, search, open thread, filters (MSG-F08), client (SH5). */
  initialView?: MessagesView;
} = {}) {
  const qc = useQueryClient();
  const [view, setView] = useState(initialView);
  const update = (patch: Partial<MessagesView>) => setView((v) => ({ ...v, ...patch }));
  const scoped = useApiQuery([...KEY, 'scoped-client', view.clientId], async () =>
    view.clientId ? api.clients.get(view.clientId) : null,
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useSettled(view.q.trim());
  const search = term ? { search: term } : {};
  // The previous results stay while a new search loads: the open thread and its panel stay.
  const inbox = useQuery({
    queryKey: [...KEY, 'inbox', term],
    queryFn: () => api.messages.inbox({ ...search, limit: 100 }),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
  const archive = useQuery({
    queryKey: [...KEY, 'inbox', 'archived', term],
    queryFn: () => api.messages.inbox({ ...search, archived: 'true', limit: 100 }),
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
  const unread = useApiQuery([...KEY, 'unread'], () => api.messages.unreadCount());
  const all = inbox.data?.items ?? [];
  const archived = archive.data?.items ?? [];
  const source = view.tab === 'archived' ? archive : inbox;
  const pool = view.tab === 'archived' ? archived : all;
  // The client filter (SH5): the threads' clients, and the one a workspace opened with.
  const clientChoices = [
    ...new Map([
      ...(scoped.data ? [[scoped.data.id, scoped.data.displayName] as const] : []),
      ...[...all, ...archived].map((t) => [t.client.id, t.client.displayName] as const),
    ]).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = pool.filter((t) => inView(t, view));
  // The chosen thread, or the list's first when a new search no longer has it.
  const chosen = [...all, ...archived].find((t) => t.id === view.thread);
  const current = chosen ?? rows[0];
  const loaded = !inbox.isPending && !archive.isPending;
  // The address follows the view, so Back to Messages returns to this thread, list and search;
  // a thread the loaded lists no longer have is left out of it.
  const address = addressOf(loaded && !chosen ? { ...view, thread: '' } : view);
  useEffect(() => {
    if (address !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', address);
  }, [address]);
  const refresh = () => qc.invalidateQueries({ queryKey: [...KEY] });
  const unfiltered = { clientId: '', since: '', replies: '', started: '' } as const;
  const count = (id: TabId) =>
    id === 'unread'
      ? (unread.data?.total ?? 0)
      : id === 'archived'
        ? archived.length
        : all.filter((t) => inView(t, { ...view, ...unfiltered, tab: id })).length;
  const filters = activeFilters(view);
  const filtered = filters.length > 0 || view.clientId !== '';

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="messages-page">
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
            <p className="text-base text-muted">
              Stay connected with your clients — all in one place.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 xl:items-end">
          <div className="flex flex-wrap gap-2">
            {/* MSG-F09: New Message is its own page (Frame 2), for this client when one is chosen. */}
            <OriginLink
              href={`/messages/new${view.clientId ? `?${new URLSearchParams({ clientId: view.clientId, ...(view.service ? { subject: view.service } : {}) }).toString()}` : ''}`}
              className={gold}
              data-testid="messages-new"
            >
              <Plus aria-hidden weight="bold" className="size-5" /> New Message
            </OriginLink>
            <OriginLink href="/communications" className={blue} data-testid="messages-bulk">
              <PaperPlaneTilt aria-hidden weight="fill" className="size-5" /> Send Bulk Message
            </OriginLink>
            {/* MSG-F07: the shared Templates library, on its message templates. */}
            <OriginLink
              href="/templates/library/portal-message"
              className={blue}
              data-testid="messages-templates"
            >
              <FileText aria-hidden weight="fill" className="size-5" /> Message Templates
            </OriginLink>
          </div>
          {/* MSG-F02: message-specific settings, with Back to Messages (Frame 1: under the actions). */}
          <OriginLink href="/messages/settings" className={blue} data-testid="messages-settings">
            <Gear aria-hidden weight="fill" className="size-5" /> Settings
          </OriginLink>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Message views"
          className="relative flex max-w-full overflow-x-auto border-b border-divider"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view.tab === t.id}
              onClick={() => update({ tab: t.id, thread: '' })}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${view.tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {t.label}
              {t.id === 'all' || t.id === 'unread' || count(t.id) > 0 ? (
                <span className="ml-1 rounded-pill bg-info-soft px-1.5 text-xs text-info">
                  {count(t.id)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <label className="flex h-10 min-w-0 items-center gap-2 text-sm text-heading">
            <span className="sr-only">Client</span>
            <select
              aria-label="Client"
              data-testid="messages-client"
              value={view.clientId}
              onChange={(e) => update({ clientId: e.target.value, thread: '' })}
              className="h-10 max-w-60 rounded-lg border border-divider bg-surface px-3 text-sm text-text"
            >
              <option value="">All clients</option>
              {clientChoices.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="order-first flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus sm:order-none sm:w-64">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
            <span className="sr-only">Search messages</span>
            <input
              type="search"
              value={view.q}
              onChange={(e) => update({ q: e.target.value })}
              placeholder="Search messages..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
          <FilterButton view={view} onChange={update} />
        </div>
      </div>
      {filters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="messages-filters">
          {filters.map((f) => (
            <FilterChip key={f.key} label={f.label} onRemove={() => update({ [f.key]: '' })} />
          ))}
          <button
            type="button"
            className="text-sm font-medium text-link underline"
            onClick={() => update({ since: '', replies: '', started: '' })}
          >
            Clear Filters
          </button>
        </div>
      ) : null}

      {source.isError ? (
        <p role="alert" className={quiet} data-testid="messages-error">
          Messages are not available right now. We could not load them. Try again in a moment.
        </p>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[22rem_minmax(0,1fr)_20rem]">
        <section
          className={`${card} flex flex-col gap-2`}
          aria-label="Conversations"
          data-testid="thread-list"
        >
          {source.isPending ? <p className={quiet}>Loading…</p> : null}
          {!source.isPending && rows.length === 0 ? (
            <p className={quiet}>
              {view.clientId && !term && view.tab === 'all' && filters.length === 0
                ? `No conversations with ${scoped.data?.displayName ?? 'this client'} yet. Start one with New Message.`
                : !term && !filtered && EMPTY[view.tab]
                  ? EMPTY[view.tab]
                  : pool.length === 0 && !term
                    ? 'No conversations yet. Start one with New Message.'
                    : 'No conversations match.'}
            </p>
          ) : null}
          <ul className="flex max-h-176 flex-col gap-2 overflow-auto">
            {rows.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="thread-row"
                  aria-current={current?.id === t.id}
                  onClick={() => update({ thread: t.id })}
                  className={`flex w-full gap-3 rounded-lg border p-3 text-left hover:bg-canvas ${current?.id === t.id ? 'border-action bg-info-soft' : 'border-divider'}`}
                >
                  <Avatar name={t.client.displayName} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm ${t.unreadCount ? 'font-bold' : 'font-semibold'} text-heading`}
                      >
                        {t.client.displayName}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {day(t.lastMessage?.createdAt ?? t.createdAt)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {t.lastMessage?.excerpt ?? t.subject}
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="flex flex-wrap gap-1">
                        <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                          {relatedLabel(t)}
                        </span>
                        {t.automated ? <span className={tag}>Automation</span> : null}
                        {t.archivedAt ? <span className={tag}>Archived</span> : null}
                      </span>
                      {t.unreadCount ? (
                        <span className="rounded-pill bg-action px-2 text-xs font-semibold text-on-action">
                          {t.unreadCount}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Showing {rows.length} of {pool.length} conversations
          </p>
        </section>

        {current ? (
          <Conversation
            key={current.id}
            thread={current}
            onChanged={refresh}
            onNotice={(text, tone) => setMessage({ text, tone })}
          />
        ) : (
          <section className={card} aria-label="Conversation">
            <p className={quiet}>Choose a conversation to read it.</p>
          </section>
        )}
        {current ? (
          <ContactPanel
            key={`c${current.client.id}`}
            clientId={current.client.id}
            name={current.client.displayName}
          />
        ) : (
          <aside className={card} aria-label="Client" />
        )}
      </div>
    </div>
  );
}

/** MSG-F05: Filter beside Search: when the last message was, replies open or closed, who began. */
function FilterButton({
  view,
  onChange,
}: {
  view: MessagesView;
  onChange: (patch: Partial<MessagesView>) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const applied = activeFilters(view).length;
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const choice = <K extends 'since' | 'replies' | 'started'>(
    key: K,
    title: string,
    options: readonly { id: MessagesView[K]; label: string }[],
  ) => (
    <FilterGroup title={title}>
      <select
        aria-label={title}
        className={select}
        value={view[key]}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<MessagesView>)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </FilterGroup>
  );
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-semibold text-action hover:bg-canvas"
      >
        <Funnel aria-hidden weight="fill" className="size-4.5" />
        Filter
        {applied > 0 ? (
          <span className="rounded-pill bg-action px-1.5 text-xs text-on-action">{applied}</span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Filter conversations"
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          className="absolute top-full right-0 z-20 mt-2 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-lg"
        >
          {choice('since', 'Last message', SINCE)}
          {choice('replies', 'Replies', REPLIES)}
          {choice('started', 'Started by', STARTED)}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => onChange({ since: '', replies: '', started: '' })}
            >
              Clear Filters
            </Button>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Conversation({
  thread,
  onChanged,
  onNotice,
}: {
  thread: MessageThread;
  onChanged: () => void;
  onNotice: (t: string, tone: 'success' | 'error') => void;
}) {
  const detail = useApiQuery([...KEY, 'thread', thread.id], () => api.messages.get(thread.id));
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const d = detail.data;
  // Only a client's message can be marked unread for the firm.
  const fromClient = d?.messages.some((m) => m.direction === 'CLIENT_TO_FIRM') ?? false;
  const run = (call: () => Promise<unknown>) =>
    void call()
      .then(onChanged)
      .catch((e: unknown) => onNotice(errorMessage(e), 'error'));
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.messages.send(thread.id, { body: body.trim() });
      setBody('');
      await detail.refetch();
      onChanged();
    } catch (e) {
      onNotice(errorMessage(e), 'error');
    }
    setBusy(false);
  };
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Conversation"
      data-testid="conversation"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-3">
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={thread.client.displayName} size="lg" />
          <span className="min-w-0">
            <span className="block truncate font-display text-xl font-bold text-heading">
              {thread.client.displayName}
            </span>
            <span className="block truncate text-xs text-muted">{thread.subject}</span>
          </span>
        </span>
        <span className="flex gap-2">
          {thread.unreadCount > 0 ? (
            <button
              type="button"
              className={`${subtle} min-h-9`}
              onClick={() => run(() => api.messages.markRead(thread.id))}
            >
              Mark read
            </button>
          ) : fromClient ? (
            <button
              type="button"
              className={`${subtle} min-h-9`}
              onClick={() => run(() => api.messages.markUnread(thread.id))}
            >
              Mark unread
            </button>
          ) : null}
          <button
            type="button"
            className={`${subtle} min-h-9`}
            onClick={() =>
              run(() => api.messages.update(thread.id, { repliesEnabled: !thread.repliesEnabled }))
            }
          >
            {thread.repliesEnabled ? 'Close replies' : 'Allow replies'}
          </button>
        </span>
      </header>
      {detail.isError ? (
        <p role="alert" className={quiet}>
          This conversation is not available right now.
        </p>
      ) : null}
      {detail.isPending ? <p className={quiet}>Loading…</p> : null}
      <ul className="flex max-h-120 flex-col gap-3 overflow-auto" aria-label="Messages">
        {(d?.messages ?? []).map((m) => {
          const mine = m.sender.kind === 'STAFF';
          return (
            <li key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <p
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${mine ? 'bg-info-soft text-heading' : 'bg-canvas text-text'}`}
              >
                {m.body}
              </p>
              <span className="mt-0.5 text-xs text-muted">
                {m.sender.name} · {day(m.createdAt)}
                {/* MSG-F10: every conversation message is a portal message. */}
                {' · '}
                <span data-testid="message-channel">Portal</span>
                {mine && m.readAt ? ' · Read' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <form
        className="flex items-end gap-2 border-t border-divider pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="min-w-0 flex-1">
          <Textarea
            label="Type a message"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button
          type="submit"
          aria-label="Send message"
          disabled={busy || !body.trim()}
          className="flex size-12 shrink-0 items-center justify-center rounded-control bg-gold text-on-action disabled:opacity-50"
        >
          <PaperPlaneRight aria-hidden weight="fill" className="size-5" />
        </button>
      </form>
    </section>
  );
}

function ContactPanel({ clientId, name }: { clientId: string; name: string }) {
  const qc = useQueryClient();
  const client = useApiQuery([...KEY, 'client', clientId], () => api.clients.get(clientId));
  const notes = useApiQuery([...KEY, 'notes', clientId], () => api.clientNotes.list(clientId));
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const c = client.data;
  const addr = c
    ? [c.profile.address.city, c.profile.address.state].filter(Boolean).join(', ')
    : '';
  return (
    <aside
      className={`${card} flex flex-col gap-4`}
      aria-label="Client"
      data-testid="contact-panel"
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} size="xl" />
        <div className="min-w-0">
          <p className="truncate font-display text-xl font-bold text-heading">{name}</p>
          {/* D7: Open Client is the way to edit; Back returns to this thread (MSG-F08). */}
          <OriginLink href={`/clients/${clientId}`} className="text-sm font-medium text-link">
            Open Client
          </OriginLink>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs font-medium text-heading">
        {[
          { label: 'Call', icon: Phone, href: c?.phone ? `tel:${c.phone}` : undefined },
          { label: 'Email', icon: Envelope, href: c?.email ? `mailto:${c.email}` : undefined },
          { label: 'Schedule', icon: CalendarBlank, href: '/calendar' },
        ].map((a) =>
          a.href ? (
            <a
              key={a.label}
              href={a.href}
              className="flex flex-col items-center gap-1 rounded-lg border border-divider p-2 hover:bg-canvas"
            >
              <a.icon aria-hidden weight="fill" className="size-5 text-action" /> {a.label}
            </a>
          ) : (
            <span
              key={a.label}
              className="flex flex-col items-center gap-1 rounded-lg border border-divider p-2 opacity-50"
            >
              <a.icon aria-hidden weight="fill" className="size-5 text-action" /> {a.label}
            </span>
          ),
        )}
      </div>
      <section aria-label="Contact information">
        <h3 className="mb-1 font-display text-lg font-bold text-heading">Contact Information</h3>
        {client.isError ? (
          <p className={quiet}>Contact details are not available right now.</p>
        ) : null}
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="sr-only">Phone</dt>
            <dd>{c?.phone ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Email</dt>
            <dd className="break-all">{c?.email ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="sr-only">Location</dt>
            <dd>{addr || '—'}</dd>
          </div>
        </dl>
      </section>
      <section aria-label="Client details">
        <h3 className="mb-1 font-display text-lg font-bold text-heading">Client Details</h3>
        <p className="flex justify-between text-sm">
          <span className="text-muted">Client Since</span>
          <span className="text-heading">
            {c
              ? new Date(c.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '—'}
          </span>
        </p>
      </section>
      <section aria-label="Notes" data-testid="contact-notes">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-heading">Notes</h3>
          <button
            type="button"
            className="text-sm font-medium text-link"
            onClick={() => setAdding(!adding)}
          >
            + Add Note
          </button>
        </div>
        {adding ? (
          <form
            className="mb-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void api.clientNotes.create(clientId, { body: note.trim() }).then(() => {
                setNote('');
                setAdding(false);
                return qc.invalidateQueries({ queryKey: [...KEY, 'notes', clientId] });
              });
            }}
          >
            <Textarea
              label="New note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button type="submit" disabled={!note.trim()}>
              Save Note
            </Button>
          </form>
        ) : null}
        {notes.data?.length === 0 ? <p className={quiet}>No notes yet.</p> : null}
        <ul className="flex flex-col gap-2">
          {(notes.data ?? []).slice(0, 3).map((n) => (
            <li key={n.id} className="rounded-lg bg-warning-soft p-2 text-sm text-heading">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-xs text-muted">
                {n.author.name} · {day(n.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/**
 * New Message (SH5): to a client chosen here, or the client a workspace opened Messages for, with
 * the service as the subject to start from. Nothing is sent until Send Message. Tax Returns can
 * open it in place from a return (TX-F05).
 */
export function NewMessageDialog({
  clientId: initialClientId,
  clientName,
  subject: initialSubject,
  onClose,
  onSent,
}: {
  clientId?: string;
  clientName?: string;
  subject?: string;
  onClose: () => void;
  onSent: (t: MessageThread) => void;
}) {
  const clients = useApiQuery([...KEY, 'clients'], () => api.clients.list({ limit: 100 }));
  const [clientId, setClientId] = useState(initialClientId ?? '');
  const [subject, setSubject] = useState(initialSubject ?? '');
  const listed = clients.data?.items ?? [];
  const options = [
    ...(initialClientId && clientName && !listed.some((c) => c.id === initialClientId)
      ? [{ id: initialClientId, displayName: clientName }]
      : []),
    ...listed,
  ];
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="New Message"
      subtitle="Start a conversation with a client."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !clientId || !subject.trim() || !body.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const t = await api.messages.create(clientId, {
                  subject: subject.trim(),
                  body: body.trim(),
                });
                onSent(t);
              } catch (e) {
                setError(errorMessage(e));
                setBusy(false);
              }
            }}
          >
            Send Message
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="new-message">
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          To
          <select
            aria-label="To"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
          >
            <option value="">
              {clients.isError ? 'Clients are not available' : 'Choose a client…'}
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </label>
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <Textarea label="Message" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
