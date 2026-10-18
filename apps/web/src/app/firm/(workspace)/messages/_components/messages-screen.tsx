'use client';

import type { MessageThread } from '@firmivra/types';
import { Avatar, Button, Input, Modal, Textarea, Toast } from '@firmivra/ui';
import {
  CalendarBlank,
  ChatCircleDots,
  Envelope,
  MagnifyingGlass,
  PaperPlaneRight,
  Phone,
  Plus,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

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

const TABS = [
  { id: 'all', label: 'All Messages' },
  { id: 'unread', label: 'Unread' },
  { id: 'appointment', label: 'Appointments' },
  { id: 'invoice', label: 'Invoices' },
  { id: 'document_request', label: 'Documents' },
] as const;
type TabId = (typeof TABS)[number]['id'];
const relatedLabel = (t: MessageThread) =>
  t.related ? t.related.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Client';

/** /messages: the firm's inbox, the open conversation and the client beside it. */
export function MessagesScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string>();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const inbox = useApiQuery([...KEY, 'inbox'], () => api.messages.inbox({ limit: 100 }));
  const unread = useApiQuery([...KEY, 'unread'], () => api.messages.unreadCount());
  const all = inbox.data?.items ?? [];
  const term = search.trim().toLowerCase();
  const rows = all
    .filter((t) =>
      tab === 'all' ? true : tab === 'unread' ? t.unreadCount > 0 : t.related?.type === tab,
    )
    .filter(
      (t) =>
        !term ||
        `${t.client.displayName} ${t.subject} ${t.lastMessage?.excerpt ?? ''}`
          .toLowerCase()
          .includes(term),
    );
  const current = all.find((t) => t.id === (openId ?? rows[0]?.id));
  const refresh = () => qc.invalidateQueries({ queryKey: [...KEY] });
  const count = (id: TabId) =>
    id === 'all'
      ? all.length
      : id === 'unread'
        ? (unread.data?.total ?? 0)
        : all.filter((t) => t.related?.type === id).length;

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
        <div className="flex flex-wrap gap-2">
          <button type="button" className={gold} onClick={() => setComposing(true)}>
            <Plus aria-hidden weight="bold" className="size-5" /> New Message
          </button>
          <Link href="/communications" className={subtle}>
            Send Bulk Message
          </Link>
          <Link href="/templates" className={subtle}>
            Message Templates
          </Link>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Message views"
          className="relative flex overflow-x-auto border-b border-divider"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setOpenId(undefined);
              }}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
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
        <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus sm:w-64">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
          <span className="sr-only">Search messages</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
      </div>

      {inbox.isError ? (
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
          {inbox.isPending ? <p className={quiet}>Loading…</p> : null}
          {!inbox.isPending && rows.length === 0 ? (
            <p className={quiet}>
              {all.length === 0
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
                  onClick={() => setOpenId(t.id)}
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
                      <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                        {relatedLabel(t)}
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
            Showing {rows.length} of {all.length} conversations
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

      {composing ? (
        <NewMessageDialog
          onClose={() => setComposing(false)}
          onSent={(t) => {
            setComposing(false);
            setOpenId(t.id);
            setMessage({ text: 'Message sent.', tone: 'success' });
            void refresh();
          }}
        />
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
          <Link href={`/clients/${clientId}`} className="text-sm font-medium text-link">
            Open client
          </Link>
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

function NewMessageDialog({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (t: MessageThread) => void;
}) {
  const clients = useApiQuery([...KEY, 'clients'], () => api.clients.list({ limit: 100 }));
  const [clientId, setClientId] = useState('');
  const [subject, setSubject] = useState('');
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
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
          >
            <option value="">
              {clients.isError ? 'Clients are not available' : 'Choose a client…'}
            </option>
            {(clients.data?.items ?? []).map((c) => (
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
