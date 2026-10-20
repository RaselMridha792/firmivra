'use client';

import {
  ArrowsDownUp,
  Bell,
  Buildings,
  CaretDown,
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Clock,
  DotsThreeVertical,
  EnvelopeSimple,
  Funnel,
  Globe,
  LinkSimple,
  ListBullets,
  ListNumbers,
  Paperclip,
  PaperPlaneTilt,
  Phone,
  Plus,
  PencilSimple,
  Smiley,
  TextB,
  TextItalic,
  User,
  UserPlus,
  Warning,
  X,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  KpiCard,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Tabs,
  Textarea,
} from '@firmivra/ui';
import {
  ADMIN_COMM_ERRORS,
  FIRM_PLANS,
  type AdminCommConversation,
  type AdminCommMessage,
  type AdminCommView,
  type CommContactType,
  type ListAdminCommConversationsQuery,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

type ChannelFilter = 'ALL' | 'EMAIL' | 'SMS' | 'INTERNAL';
type ReplyChannel = 'EMAIL' | 'SMS' | 'INTERNAL';
type SortOrder = 'NEWEST' | 'OLDEST' | 'UNREAD_FIRST';

const COMMS = ['admin-communications'] as const;
const pageSize = 10;

const avatarTones = [
  'bg-info-soft text-info',
  'bg-success-soft text-success',
  'bg-warning-soft text-warning',
  'bg-purple-soft text-purple',
  'bg-disabled text-muted',
];

const channelTabs: { id: ChannelFilter; label: string; icon: Icon }[] = [
  { id: 'ALL', label: 'All', icon: Bell },
  { id: 'EMAIL', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'INTERNAL', label: 'Internal', icon: CheckCircle },
];

const tabs: { id: string; label: string; view?: AdminCommView }[] = [
  { id: 'inbox', label: 'Inbox', view: 'INBOX' },
  { id: 'assigned', label: 'Assigned to Me', view: 'ASSIGNED_TO_ME' },
  { id: 'unassigned', label: 'Unassigned', view: 'UNASSIGNED' },
  { id: 'mentions', label: 'Mentions', view: 'MENTIONS' },
  { id: 'all', label: 'All Messages', view: 'ALL' },
  { id: 'scheduled', label: 'Scheduled', view: 'SCHEDULED' },
  { id: 'templates', label: 'Templates' },
  { id: 'broadcasts', label: 'Broadcasts' },
];

/** A firm is Firmivra's client; a firm's own clients are never contacts here (B6). */
const contactLabels: Record<CommContactType, string> = {
  FIRM: 'Client',
  LEAD: 'Lead',
  TEAM: 'Internal',
};
const contactTones: Record<CommContactType, 'success' | 'info' | 'purple'> = {
  FIRM: 'success',
  LEAD: 'info',
  TEAM: 'purple',
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
const toneOf = (name: string) =>
  avatarTones[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarTones.length];
/** The conversation's name: the firm, else the person. */
const displayName = (c: AdminCommConversation) => c.contact.business?.name ?? c.contact.name;
const humanize = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

function listTime(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (at.toDateString() === today.toDateString())
    return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const fullTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function NameAvatar({ name, size = 'lg' }: { name: string; size?: 'md' | 'lg' | 'xl' }) {
  return (
    <span
      aria-label={name}
      role="img"
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ' +
        (size === 'xl'
          ? 'size-14 text-lg '
          : size === 'lg'
            ? 'size-10 text-sm '
            : 'size-8 text-xs ') +
        toneOf(name)
      }
    >
      {initialsOf(name)}
    </span>
  );
}

function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3 xl:px-3 xl:py-1">
      <h2 className="font-display text-base font-bold text-heading">{children}</h2>
      {action}
    </div>
  );
}

/** The state line under a message that did not simply go out. */
function messageNote(message: AdminCommMessage): string | null {
  if (message.status === 'DRAFT') return 'Draft';
  if (message.status === 'SCHEDULED' && message.scheduledAt)
    return `Scheduled for ${fullTime(message.scheduledAt)}`;
  if (message.status === 'FAILED')
    return `Not delivered${message.errorMessage ? `: ${message.errorMessage}` : ''}`;
  if (message.status === 'PARTIALLY_SENT') return 'Delivered to some recipients';
  if (message.status === 'CANCELLED') return 'Cancelled';
  return null;
}

/** The design's light-blue Filters and Sort buttons. */
const SOFT_BUTTON = 'border-transparent! bg-info-soft! text-action! hover:bg-info-soft/70!';

/** The composer toolbar's plain glyphs (the design draws them without a box). */
const PLAIN = { weight: 'bold', className: 'border-transparent bg-transparent' } as const;

export function CommunicationsInbox() {
  const router = useRouter();
  const client = useQueryClient();
  const { me } = useMe();
  const [activeTab, setActiveTab] = useState('inbox');
  const [channel, setChannel] = useState<ChannelFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [contactType, setContactType] = useState<'ALL' | CommContactType>('ALL');
  const [sort, setSort] = useState<SortOrder>('NEWEST');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [composeChannel, setComposeChannel] = useState<ReplyChannel>('EMAIL');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [draft, setDraft] = useState('');
  const [sendMenu, setSendMenu] = useState(false);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchText(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const view = tabs.find((tab) => tab.id === activeTab)?.view ?? 'INBOX';
  const query: ListAdminCommConversationsQuery = useMemo(
    () => ({
      view,
      sort,
      page,
      pageSize,
      ...(channel !== 'ALL' ? { channel } : {}),
      ...(contactType !== 'ALL' ? { contactType } : {}),
      ...(searchText ? { search: searchText } : {}),
    }),
    [view, sort, page, channel, contactType, searchText],
  );
  const list = useApiQuery([...COMMS, 'conversations', query], () =>
    api.adminCommunications.conversations.list(query),
  );
  const summary = useApiQuery([...COMMS, 'summary'], () => api.adminCommunications.summary());
  const conversations = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;

  // The first conversation is open until another is chosen.
  const activeId =
    selectedId && conversations.some((c) => c.id === selectedId)
      ? selectedId
      : (conversations[0]?.id ?? null);
  const thread = useApiQuery([...COMMS, 'conversation', activeId ?? 'none'], () =>
    activeId ? api.adminCommunications.conversations.get(activeId) : Promise.resolve(null),
  );
  const selected = thread.data ?? conversations.find((c) => c.id === activeId) ?? null;
  const businessId =
    selected?.contact.type === 'FIRM' ? (selected.contact.business?.id ?? null) : null;
  const firm = useApiQuery(['firms', 'detail', businessId ?? 'none'], () =>
    businessId ? api.firmApplications.getFirm(businessId) : Promise.resolve(null),
  );
  const templates = useApiQuery([...COMMS, 'templates', 'active', composeChannel], () =>
    composeChannel === 'INTERNAL'
      ? Promise.resolve(null)
      : api.adminCommunications.templates.list({
          status: 'ACTIVE',
          channel: composeChannel,
          sort: 'NAME',
          pageSize: 100,
        }),
  );

  // Opening an unread thread moves my read mark.
  useEffect(() => {
    const open = conversations.find((c) => c.id === activeId);
    if (!open?.unread) return;
    void api.adminCommunications.conversations
      .read(open.id)
      .then(() => client.invalidateQueries({ queryKey: COMMS }))
      .catch(() => undefined);
  }, [activeId, conversations, client]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const counts = summary.data;
  const byChannel = counts?.byChannel;
  const channelCount = (id: ChannelFilter) =>
    !byChannel
      ? '—'
      : id === 'ALL'
        ? byChannel.EMAIL + byChannel.SMS + byChannel.INTERNAL + byChannel.IN_APP
        : byChannel[id];
  const card = (value: number | undefined) =>
    summary.isPending || summary.isError || value === undefined ? '—' : value;
  const messages = thread.data?.messages ?? [];
  const lastEmailSubject = [...messages]
    .reverse()
    .find((m) => m.channel === 'EMAIL' && m.subject)?.subject;
  const derivedSubject = lastEmailSubject
    ? lastEmailSubject.startsWith('Re:')
      ? lastEmailSubject
      : `Re: ${lastEmailSubject}`
    : (selected?.subject ?? '');
  const emailSubject = subject || derivedSubject;
  const assignedToMe = selected?.assignedTo?.userId === me.user.id;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;

  const onMainTab = (id: string) => {
    if (id === 'templates' || id === 'broadcasts') {
      router.push('/communications/' + id);
      return;
    }
    setActiveTab(id);
    setPage(1);
  };

  async function change(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await work();
      if (done) setNotice({ message: done });
      return true;
    } catch (error) {
      setNotice({ message: errorMessage(error, ADMIN_COMM_ERRORS), error: true });
      return false;
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: COMMS });
    }
  }

  async function send(mode: 'SEND' | 'DRAFT') {
    if (!selected || !draft.trim()) return;
    const ok = await change(
      () =>
        api.adminCommunications.messages.create({
          conversationId: selected.id,
          channel: composeChannel,
          ...(composeChannel === 'EMAIL' && emailSubject ? { subject: emailSubject } : {}),
          body: draft.trim(),
          ...(templateId ? { templateId } : {}),
          mode: composeChannel === 'INTERNAL' ? 'SEND' : mode,
          idempotencyKey: crypto.randomUUID(),
        }),
      mode === 'DRAFT' && composeChannel !== 'INTERNAL'
        ? 'Draft saved.'
        : composeChannel === 'INTERNAL'
          ? 'Note added.'
          : 'Message sent.',
    );
    if (ok) {
      setDraft('');
      setSubject('');
      setTemplateId('');
    }
  }

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send('SEND');
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templates.data?.items.find((t) => t.id === id);
    if (!template) return;
    setDraft(template.body);
    if (template.subject) setSubject(template.subject);
  };

  const saveTags = (tags: string[]) => {
    if (!selected) return;
    void change(() => api.adminCommunications.conversations.update(selected.id, { tags }));
  };

  const resetFilters = () => {
    setSearch('');
    setSearchText('');
    setContactType('ALL');
    setSort('NEWEST');
    setChannel('ALL');
    setPage(1);
  };

  const filtered = channel !== 'ALL' || contactType !== 'ALL' || searchText !== '';
  const firmRecord = firm.data;

  return (
    <main className="space-y-4">
      <PageHeader
        title="Communications"
        subtitle="Stay connected with your firms, leads, clients, and team. Manage all messages in one place."
        actions={
          <div className="flex overflow-hidden rounded-control bg-action text-on-action">
            <Button className="rounded-none" onClick={() => router.push('/communications/new')}>
              <Plus aria-hidden weight="bold" className="size-4" />
              New Message
            </Button>
            <button
              type="button"
              aria-label="New broadcast"
              title="New broadcast"
              onClick={() => router.push('/communications/broadcasts/new')}
              className="border-l border-on-action/20 px-3 hover:bg-action-hover"
            >
              <CaretDown aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        }
      />

      <section
        aria-label="Communication summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:[&>div]:gap-3 xl:[&>div]:p-3 [&>div>span]:rounded-xl xl:[&>div>span]:size-12 xl:[&>div>span>svg]:size-6 xl:[&>div>div]:gap-0.5 xl:[&>div>div>span:first-child]:text-xl xl:[&>div>div>span:nth-child(2)]:text-sm xl:[&>div>div>span:nth-child(2)]:leading-tight xl:[&>div>div>span:nth-child(2)]:text-heading"
      >
        <KpiCard
          icon={EnvelopeSimple}
          tone="red"
          value={card(counts?.unread)}
          label="Unread Messages"
        />
        <KpiCard
          icon={ChatCircleDots}
          tone="blue"
          value={card(counts?.open)}
          label="Open Conversations"
        />
        <KpiCard
          icon={Clock}
          tone="amber"
          value={card(counts?.waitingOnReply)}
          label="Waiting on Reply"
        />
        <KpiCard
          icon={PaperPlaneTilt}
          tone="blue"
          value={card(counts?.scheduled)}
          label="Scheduled Messages"
        />
        <KpiCard
          icon={Warning}
          tone="red"
          value={card(counts?.failed)}
          label="Failed / Undelivered"
        />
      </section>

      <section
        className="flex flex-col gap-3 xl:flex-row xl:items-center"
        aria-label="Conversation filters"
      >
        <div className="min-w-0 flex-1 [&_[role=tablist]]:overflow-y-hidden [&_[role=tablist]]:pb-px xl:[&_[role=tablist]]:gap-3">
          <Tabs
            items={tabs.map(({ id, label }) => ({ id, label }))}
            value={activeTab}
            onChange={onMainTab}
            label="Communication views"
            variant="underline"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            label="Search conversations"
            minWidth="12rem"
            placeholder="Search conversations..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            variant={filtersOpen ? 'primary' : 'secondary'}
            className={filtersOpen ? '' : SOFT_BUTTON}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Funnel aria-hidden weight="fill" className="size-4" />
            Filters
          </Button>
          <Button
            variant="secondary"
            className={SOFT_BUTTON}
            onClick={() => {
              setSort(sort === 'NEWEST' ? 'OLDEST' : 'NEWEST');
              setPage(1);
            }}
            aria-label={sort === 'OLDEST' ? 'Sort newest first' : 'Sort oldest first'}
          >
            <ArrowsDownUp aria-hidden weight="bold" className="size-4" />
            Sort
          </Button>
        </div>
      </section>

      {filtersOpen ? (
        <section
          className="grid gap-3 rounded-card border border-divider bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="More conversation filters"
        >
          <Select
            label="Contact type"
            hideLabel
            value={contactType}
            onChange={(event) => {
              setContactType(event.target.value as 'ALL' | CommContactType);
              setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'All Contact Types' },
              { value: 'FIRM', label: 'Client' },
              { value: 'LEAD', label: 'Lead' },
              { value: 'TEAM', label: 'Internal' },
            ]}
          />
          <Select
            label="Order"
            hideLabel
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as SortOrder);
              setPage(1);
            }}
            options={[
              { value: 'NEWEST', label: 'Newest first' },
              { value: 'OLDEST', label: 'Oldest first' },
              { value: 'UNREAD_FIRST', label: 'Unread first' },
            ]}
          />
          <Button variant="ghost" onClick={resetFilters}>
            Clear filters
          </Button>
        </section>
      ) : null}

      {list.isError ? (
        <div
          role="alert"
          className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          Communications API is unavailable. Try again in a moment.
        </div>
      ) : null}

      <section
        className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-20"
        aria-label="Communications inbox"
      >
        <Card className="!p-0 flex min-w-0 flex-col overflow-hidden lg:col-span-6">
          <div className="shrink-0 border-b border-divider px-3 pt-3">
            <div
              className="flex gap-1 overflow-x-auto overflow-y-hidden pb-2"
              role="tablist"
              aria-label="Message channel"
            >
              {channelTabs.map((item) => {
                const Glyph = item.icon;
                const active = channel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setChannel(item.id);
                      setPage(1);
                    }}
                    className={
                      'inline-flex min-h-9 shrink-0 items-center gap-1 rounded-control border px-2 text-xs font-medium ' +
                      (active
                        ? 'border-action bg-info-soft text-action'
                        : 'border-divider bg-surface text-muted hover:bg-canvas')
                    }
                  >
                    <Glyph aria-hidden weight="fill" className="size-3.5" />
                    {item.label} ({channelCount(item.id)})
                  </button>
                );
              })}
            </div>
          </div>
          <div className="divide-y divide-divider xl:[&>button>span:last-child>span:last-child>span:last-child]:px-2 xl:[&>button>span:last-child>span:last-child>span:last-child]:py-0">
            {conversations.length ? (
              conversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={
                    'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors xl:py-1.5 ' +
                    (activeId === item.id ? 'bg-info-soft' : 'bg-surface hover:bg-canvas')
                  }
                >
                  <span className="relative">
                    <NameAvatar name={displayName(item)} />
                    {item.unread ? (
                      <span
                        aria-label="Unread"
                        className="absolute -left-2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-action"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-sm text-heading ${item.unread ? 'font-semibold' : 'font-medium'}`}
                      >
                        {displayName(item)}
                      </span>
                      <span className="shrink-0 text-xs text-muted">
                        {listTime(item.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center justify-between gap-2 xl:mt-0">
                      <span className="block min-w-0 flex-1 truncate text-xs text-muted">
                        {item.lastMessage?.excerpt ?? 'Draft only'}
                      </span>
                      <Badge tone={contactTones[item.contact.type]}>
                        {contactLabels[item.contact.type]}
                      </Badge>
                      {item.hasFailed ? (
                        <Warning
                          aria-label="A message failed"
                          weight="fill"
                          className="size-4 text-danger"
                        />
                      ) : item.lastMessage?.channel === 'SMS' ? (
                        <ChatCircleDots aria-label="SMS" className="size-4 text-muted" />
                      ) : item.lastMessage?.channel === 'INTERNAL' ? (
                        <CheckCircle aria-label="Internal note" className="size-4 text-muted" />
                      ) : null}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="p-4">
                <EmptyState
                  title={
                    list.isError
                      ? 'Inbox unavailable'
                      : list.isPending
                        ? 'Loading conversations'
                        : filtered
                          ? 'No conversations found'
                          : 'No conversations yet'
                  }
                  description={
                    list.isError
                      ? 'The inbox could not connect. Try again in a moment.'
                      : list.isPending
                        ? 'Your inbox will appear here when it is ready.'
                        : filtered
                          ? 'Try another view or clear your filters.'
                          : 'Start one with New Message.'
                  }
                  action={
                    list.isError ? (
                      <Button
                        variant="secondary"
                        onClick={() => void client.invalidateQueries({ queryKey: COMMS })}
                      >
                        Try Again
                      </Button>
                    ) : filtered && !list.isPending ? (
                      <Button variant="secondary" onClick={resetFilters}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
          <div className="mt-auto shrink-0 border-t border-divider p-3">
            <Pagination
              page={page}
              onPage={setPage}
              pageCount={pageCount}
              summary={`${from} – ${Math.min(page * pageSize, total)} of ${total} conversations`}
            />
          </div>
        </Card>

        <Card className="!p-0 flex min-w-0 flex-col overflow-hidden lg:col-span-9">
          {selected ? (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-divider p-3 sm:p-4 xl:flex-nowrap xl:gap-2 xl:p-3">
                <NameAvatar name={displayName(selected)} size="xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-display text-lg font-bold text-heading">
                      {displayName(selected)}
                    </h2>
                    <Badge tone={contactTones[selected.contact.type]}>
                      {contactLabels[selected.contact.type]}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all text-xs text-heading sm:text-sm xl:truncate xl:whitespace-nowrap">
                    {selected.contact.email ?? '—'} <span className="px-1">|</span>{' '}
                    {selected.contact.phone ?? '—'}
                  </p>
                </div>
                <IconButton
                  icon={DotsThreeVertical}
                  label={selected.status === 'OPEN' ? 'Close conversation' : 'Reopen conversation'}
                  weight="bold"
                  className="border-transparent bg-transparent"
                  onClick={() =>
                    void change(
                      () =>
                        api.adminCommunications.conversations.update(selected.id, {
                          status: selected.status === 'OPEN' ? 'CLOSED' : 'OPEN',
                        }),
                      selected.status === 'OPEN'
                        ? 'Conversation closed.'
                        : 'Conversation reopened.',
                    )
                  }
                />
                <Button
                  disabled={busy}
                  onClick={() =>
                    void change(
                      () =>
                        api.adminCommunications.conversations.update(selected.id, {
                          assignedToUserId: assignedToMe ? null : me.user.id,
                        }),
                      assignedToMe ? 'Unassigned.' : 'Assigned to you.',
                    )
                  }
                >
                  <UserPlus aria-hidden weight="fill" className="size-4" />
                  {assignedToMe ? 'Assigned' : 'Assign'}
                </Button>
              </header>
              <div className="flex min-h-72 flex-1 flex-col gap-4 overflow-y-auto bg-surface p-3 sm:min-h-96 sm:p-5 xl:gap-3 xl:p-4">
                {messages.length ? (
                  messages.map((message) => {
                    const inbound = message.direction === 'INBOUND';
                    const note = messageNote(message);
                    const author = message.sender?.name ?? me.user.name;
                    return (
                      <div
                        key={message.id}
                        className={
                          'flex items-start gap-2 ' + (inbound ? 'justify-start' : 'justify-end')
                        }
                      >
                        {inbound ? <NameAvatar name={displayName(selected)} size="md" /> : null}
                        <div className="max-w-sm">
                          <div
                            className={
                              'rounded-card px-3 py-3 sm:px-4 xl:px-3 xl:py-2 ' +
                              (inbound
                                ? 'bg-canvas text-text'
                                : message.direction === 'INTERNAL'
                                  ? 'border border-warning bg-warning-soft text-heading'
                                  : 'bg-info-soft text-heading')
                            }
                          >
                            {message.direction === 'INTERNAL' ? (
                              <p className="mb-1 text-xs font-semibold text-warning">
                                Internal note
                              </p>
                            ) : null}
                            <p className="whitespace-pre-line text-sm leading-5">{message.body}</p>
                            {note ? (
                              <p
                                className={`mt-2 text-xs ${message.status === 'FAILED' ? 'text-danger' : 'text-muted'}`}
                              >
                                {note}
                              </p>
                            ) : null}
                          </div>
                          <p
                            className={`mt-1 text-xs text-muted ${inbound ? 'text-left' : 'text-right'}`}
                          >
                            {fullTime(message.sentAt ?? message.createdAt)}
                          </p>
                        </div>
                        {!inbound ? <Avatar name={author} size="md" /> : null}
                      </div>
                    );
                  })
                ) : (
                  <EmptyState
                    title={thread.isPending ? 'Loading messages' : 'No messages yet'}
                    description={
                      thread.isError
                        ? 'The thread could not be loaded. Try again in a moment.'
                        : 'Start the conversation by sending a message.'
                    }
                  />
                )}
              </div>
              <form
                onSubmit={sendMessage}
                className="shrink-0 border-t border-divider p-3 sm:p-4 xl:p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider">
                  <div className="flex gap-1" role="tablist" aria-label="Reply channel">
                    {(['EMAIL', 'SMS', 'INTERNAL'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="tab"
                        aria-selected={composeChannel === item}
                        onClick={() => {
                          setComposeChannel(item);
                          setTemplateId('');
                        }}
                        className={
                          'min-h-9 border-b-2 px-3 text-xs font-medium ' +
                          (composeChannel === item
                            ? 'border-action text-action'
                            : 'border-transparent text-muted hover:text-heading')
                        }
                      >
                        {item === 'INTERNAL' ? 'Internal Note' : item === 'EMAIL' ? 'Email' : 'SMS'}
                      </button>
                    ))}
                  </div>
                  <Select
                    label="Choose a template"
                    hideLabel
                    className="min-h-9 py-1 text-xs"
                    value={templateId}
                    disabled={composeChannel === 'INTERNAL' || !templates.data?.items.length}
                    onChange={(event) => applyTemplate(event.target.value)}
                    options={[
                      { value: '', label: 'Templates' },
                      ...(templates.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
                    ]}
                  />
                </div>
                {composeChannel === 'EMAIL' && !derivedSubject ? (
                  <input
                    aria-label="Subject"
                    placeholder="Subject"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    className="mt-2 h-9 w-full rounded-control border border-divider bg-surface px-2 text-sm text-text"
                  />
                ) : null}
                <div className="[&_label]:sr-only [&>div]:gap-0 [&_textarea]:min-h-24 [&_textarea]:resize-none [&_textarea]:border-0 [&_textarea]:bg-transparent [&_textarea]:px-2 [&_textarea]:py-3 [&_textarea]:text-sm [&_textarea]:shadow-none [&_textarea]:focus:outline-none xl:[&_textarea]:min-h-20">
                  <Textarea
                    label="Type your message"
                    rows={3}
                    placeholder="Type your message here..."
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-2">
                  <div className="flex items-center gap-1 text-action">
                    <IconButton icon={Paperclip} label="Attach file" {...PLAIN} />
                    <IconButton icon={Smiley} label="Add emoji" {...PLAIN} />
                    <span className="mx-1 h-5 border-l border-divider" />
                    <IconButton icon={TextB} label="Bold" {...PLAIN} />
                    <IconButton icon={TextItalic} label="Italic" {...PLAIN} />
                    <IconButton icon={ListBullets} label="Bulleted list" {...PLAIN} />
                    <IconButton icon={ListNumbers} label="Numbered list" {...PLAIN} />
                    <IconButton icon={LinkSimple} label="Insert link" {...PLAIN} />
                  </div>
                  <div className="relative flex overflow-hidden rounded-control">
                    <Button
                      type="submit"
                      className="rounded-none"
                      disabled={
                        busy || !draft.trim() || (composeChannel === 'EMAIL' && !emailSubject)
                      }
                    >
                      <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                      Send
                    </Button>
                    <button
                      type="button"
                      aria-label="More send options"
                      aria-expanded={sendMenu}
                      disabled={composeChannel === 'INTERNAL'}
                      onClick={() => setSendMenu(!sendMenu)}
                      className="border-l border-on-action/20 bg-action px-2 text-on-action hover:bg-action-hover disabled:opacity-60"
                    >
                      <CaretDown aria-hidden weight="bold" className="size-3.5" />
                    </button>
                    {sendMenu ? (
                      <div
                        role="menu"
                        className="absolute right-0 bottom-full z-20 mb-1 w-40 rounded-xl border border-divider bg-surface p-1.5 shadow-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busy || !draft.trim()}
                          onClick={() => {
                            setSendMenu(false);
                            void send('DRAFT');
                          }}
                          className="flex w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-canvas disabled:opacity-50"
                        >
                          Save as Draft
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </form>
            </>
          ) : (
            <div className="grid min-h-96 place-items-center p-6">
              <EmptyState
                title="Choose a conversation"
                description="Select a conversation from your inbox to view the thread and reply."
              />
            </div>
          )}
        </Card>

        <aside className="flex min-w-0 flex-col gap-3 lg:col-span-5 xl:gap-2">
          <Card className="!p-0 overflow-hidden">
            <SectionTitle
              action={
                businessId ? (
                  <Link
                    href={`/firms/${businessId}`}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-control bg-info-soft px-2.5 py-1 text-xs font-medium text-action hover:bg-info-soft/70"
                  >
                    <PencilSimple aria-hidden weight="fill" className="size-3.5" />
                    Edit
                  </Link>
                ) : undefined
              }
            >
              Contact Details
            </SectionTitle>
            {selected ? (
              <div className="space-y-3 p-4 xl:space-y-2 xl:p-3">
                <div className="flex items-center gap-3">
                  <NameAvatar name={displayName(selected)} size="xl" />
                  <div>
                    <p className="text-sm font-semibold text-heading">{displayName(selected)}</p>
                    <Badge tone={contactTones[selected.contact.type]}>
                      {contactLabels[selected.contact.type]}
                    </Badge>
                  </div>
                </div>
                <dl className="space-y-2.5 text-xs xl:space-y-1">
                  <Detail icon={User} label="Primary Contact">
                    {selected.contact.name}
                  </Detail>
                  <Detail icon={EnvelopeSimple} label="Email">
                    {selected.contact.email ? (
                      <span className="break-all text-link">{selected.contact.email}</span>
                    ) : (
                      '—'
                    )}
                  </Detail>
                  <Detail icon={Phone} label="Phone">
                    {selected.contact.phone ?? '—'}
                  </Detail>
                  <Detail icon={Buildings} label="Firm">
                    {selected.contact.business?.name ?? '—'}
                  </Detail>
                  <Detail icon={CheckCircle} label="Plan">
                    {firmRecord?.plan ? FIRM_PLANS[firmRecord.plan] : '—'}
                  </Detail>
                  <Detail icon={CheckCircle} label="Status">
                    {firmRecord ? <Badge tone="success">{humanize(firmRecord.status)}</Badge> : '—'}
                  </Detail>
                  <Detail icon={User} label="Assigned To">
                    {selected.assignedTo?.name ?? 'Unassigned'}
                  </Detail>
                  <Detail icon={Globe} label="Source">
                    {firmRecord?.application ? 'Firm application' : '—'}
                  </Detail>
                </dl>
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="No contact selected"
                  description="Contact details will appear here."
                />
              </div>
            )}
          </Card>

          <Card className="!p-0 overflow-hidden">
            <SectionTitle
              action={
                <Button
                  variant="secondary"
                  className={`min-h-8! px-2.5! py-1! text-xs ${SOFT_BUTTON}`}
                  disabled={!selected}
                  onClick={() => setTagDraft(tagDraft === null ? '' : null)}
                >
                  <Plus aria-hidden weight="bold" className="size-3.5" />
                  Add Tag
                </Button>
              }
            >
              Tags
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-2 p-4 xl:px-3 xl:py-2">
              {(selected?.tags ?? []).map((tag) => (
                <Badge key={tag} tone="info">
                  <span className="inline-flex items-center gap-1">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => saveTags((selected?.tags ?? []).filter((t) => t !== tag))}
                    >
                      <X aria-hidden weight="bold" className="size-3" />
                    </button>
                  </span>
                </Badge>
              ))}
              {tagDraft !== null && selected ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const tag = tagDraft.trim();
                    if (tag && !selected.tags.includes(tag)) saveTags([...selected.tags, tag]);
                    setTagDraft(null);
                  }}
                >
                  <input
                    aria-label="New tag"
                    autoFocus
                    maxLength={40}
                    value={tagDraft}
                    onChange={(event) => setTagDraft(event.target.value)}
                    className="h-7 w-28 rounded-control border border-divider bg-surface px-2 text-xs text-text"
                  />
                </form>
              ) : null}
              {!selected?.tags.length && tagDraft === null ? (
                <p className="text-xs text-muted">No tags yet.</p>
              ) : null}
            </div>
          </Card>

          <Card className="!p-0 overflow-hidden">
            <SectionTitle
              action={
                <Link
                  href="/audit-security"
                  className="inline-flex min-h-8 items-center gap-1 px-1 py-1 text-xs font-medium text-action"
                >
                  View All <CaretRight aria-hidden weight="bold" className="size-3" />
                </Link>
              }
            >
              Recent Activity
            </SectionTitle>
            <div className="p-4 xl:p-3">
              <EmptyState
                title="No recent activity"
                description="Changes to this conversation are kept in Audit & Security."
              />
            </div>
          </Card>
        </aside>
      </section>

      {notice ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-40 flex max-w-sm items-center gap-3 rounded-card border border-divider bg-surface px-4 py-3 text-sm text-heading shadow-lg"
        >
          {notice.error ? (
            <Warning aria-hidden weight="fill" className="size-5 shrink-0 text-danger" />
          ) : (
            <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
          )}
          <span>{notice.message}</span>
        </div>
      ) : null}
    </main>
  );
}

function Detail({
  icon: Glyph,
  label,
  children,
}: {
  icon: Icon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1rem_5.75rem_minmax(0,1fr)] items-center gap-x-2">
      <Glyph aria-hidden className="size-4 text-action" />
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-heading">{children}</dd>
    </div>
  );
}
