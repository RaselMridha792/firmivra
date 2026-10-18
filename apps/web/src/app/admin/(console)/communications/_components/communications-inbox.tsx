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
  ClockCounterClockwise,
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
  type Icon,
} from '@phosphor-icons/react';
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
  loadAdminCommunicationsMock,
  type CommunicationChannel,
  type CommunicationConversation,
  type CommunicationsMock,
} from '../../../../../mocks/admin-communications-inbox';

const avatarTones = {
  blue: 'bg-info-soft text-info',
  green: 'bg-success-soft text-success',
  amber: 'bg-warning-soft text-warning',
  purple: 'bg-purple-soft text-purple',
  grey: 'bg-disabled text-muted',
};

const channelTabs: {
  id: 'All' | CommunicationChannel;
  label: string;
  icon: Icon;
}[] = [
  { id: 'All', label: 'All', icon: Bell },
  { id: 'Email', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'Internal', label: 'Internal', icon: CheckCircle },
];

const activityIcons = {
  email: EnvelopeSimple,
  sent: PaperPlaneTilt,
  tag: Plus,
  status: CheckCircle,
  created: ClockCounterClockwise,
};
const activityTones = {
  email: 'text-action',
  sent: 'text-action',
  tag: 'text-purple',
  status: 'text-success',
  created: 'text-info',
};

const tabs = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'assigned', label: 'Assigned to Me' },
  { id: 'unassigned', label: 'Unassigned' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'all', label: 'All Messages' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'templates', label: 'Templates' },
  { id: 'broadcasts', label: 'Broadcasts' },
];

function ConversationAvatar({
  conversation,
  size = 'lg',
}: {
  conversation: CommunicationConversation;
  size?: 'md' | 'lg' | 'xl';
}) {
  return (
    <span
      aria-label={conversation.name}
      role="img"
      className={
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold ' +
        (size === 'xl'
          ? 'size-14 text-lg '
          : size === 'lg'
            ? 'size-10 text-sm '
            : 'size-8 text-xs ') +
        avatarTones[conversation.avatarTone]
      }
    >
      {conversation.initials}
    </span>
  );
}

function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3 xl:px-3 xl:py-1">
      <h2 className="text-sm font-semibold text-heading">{children}</h2>
      {action}
    </div>
  );
}

export function CommunicationsInbox() {
  const router = useRouter();
  const [response, setResponse] = useState<CommunicationsMock | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('inbox');
  const [channel, setChannel] = useState<'All' | CommunicationChannel>('All');
  const [selectedId, setSelectedId] = useState('blue-ridge');
  const [search, setSearch] = useState('');
  const [contactType, setContactType] = useState('all');
  const [status, setStatus] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortNewest, setSortNewest] = useState(true);
  const [composeChannel, setComposeChannel] = useState<CommunicationChannel>('Email');
  const [draft, setDraft] = useState('');
  const [assigned, setAssigned] = useState(true);
  const [editingContact, setEditingContact] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    loadAdminCommunicationsMock()
      .then((data) => {
        if (!live) return;
        setResponse(data);
        setLoadError(null);
        setSelectedId(data.conversations[0]?.id ?? '');
        setAssigned(data.conversations[0]?.assignedTo === data.currentAdmin);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadError(error instanceof Error ? error.message : 'Unable to load communications.');
      });
    return () => {
      live = false;
    };
  }, []);

  const conversations = useMemo(() => response?.conversations ?? [], [response?.conversations]);
  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = conversations.filter((item) => {
      const tabMatch =
        activeTab === 'assigned'
          ? item.assignedTo === response?.currentAdmin
          : activeTab === 'unassigned'
            ? item.assignedTo === null
            : activeTab === 'mentions'
              ? item.mention
              : activeTab === 'scheduled'
                ? item.scheduled
                : true;
      const channelMatch = channel === 'All' || item.channel === channel;
      const queryMatch = !query || (item.name + ' ' + item.preview).toLowerCase().includes(query);
      const typeMatch = contactType === 'all' || item.contactType.toLowerCase() === contactType;
      const statusMatch = status === 'all' || (status === 'unread' ? item.unread : !item.unread);
      return tabMatch && channelMatch && queryMatch && typeMatch && statusMatch;
    });
    return sortNewest ? filtered : [...filtered].reverse();
  }, [
    activeTab,
    channel,
    contactType,
    conversations,
    response?.currentAdmin,
    search,
    sortNewest,
    status,
  ]);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const summary = response?.summary;

  const onMainTab = (id: string) => {
    if (id === 'templates' || id === 'broadcasts') {
      router.push('/communications/' + id);
      return;
    }
    setActiveTab(id);
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || !selected || !response) return;
    const nextMessage = {
      id: 'local-' + Date.now(),
      from: 'admin' as const,
      sender: response.currentAdmin,
      body: draft.trim(),
      time: 'Just now',
      channel: composeChannel,
    };
    const updated = response.conversations.map((item) =>
      item.id === selected.id
        ? {
            ...item,
            preview: draft.trim(),
            time: 'Just now',
            unread: false,
            messages: [...item.messages, nextMessage],
          }
        : item,
    );
    setResponse({ ...response, conversations: updated });
    setDraft('');
  };

  const resetFilters = () => {
    setSearch('');
    setContactType('all');
    setStatus('all');
    setChannel('All');
  };

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
              aria-label="New message options"
              className="border-l border-on-action/20 px-3 hover:bg-action-hover"
            >
              <CaretDown aria-hidden weight="bold" className="size-4" />
            </button>
          </div>
        }
      />

      <section
        aria-label="Communication summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 xl:[&>div]:gap-3 xl:[&>div]:p-3 xl:[&>div>span]:size-12 xl:[&>div>span>svg]:size-6 xl:[&>div>div]:gap-0 xl:[&>div>div>span:first-child]:text-xl xl:[&>div>div>span:nth-child(2)]:whitespace-nowrap xl:[&>div>div>span:nth-child(2)]:text-xs"
      >
        <KpiCard
          icon={EnvelopeSimple}
          tone="red"
          value={summary?.unread ?? (response ? 0 : '—')}
          label="Unread Messages"
          trend={summary?.trends.unread}
          note={summary?.trendNote}
        />
        <KpiCard
          icon={ChatCircleDots}
          tone="blue"
          value={summary?.open ?? (response ? 0 : '—')}
          label="Open Conversations"
          trend={summary?.trends.open}
        />
        <KpiCard
          icon={Clock}
          tone="amber"
          value={summary?.waiting ?? (response ? 0 : '—')}
          label="Waiting on Reply"
          trend={summary?.trends.waiting}
        />
        <KpiCard
          icon={PaperPlaneTilt}
          tone="blue"
          value={summary?.scheduled ?? (response ? 0 : '—')}
          label="Scheduled Messages"
          trend={summary?.trends.scheduled}
        />
        <KpiCard
          icon={Warning}
          tone="red"
          value={summary?.failed ?? (response ? 0 : '—')}
          label="Failed / Undelivered"
          trend={summary?.trends.failed}
        />
      </section>

      <section
        className="flex flex-col gap-3 xl:flex-row xl:items-center"
        aria-label="Conversation filters"
      >
        <div className="min-w-0 flex-1 [&_[role=tablist]]:overflow-y-hidden [&_[role=tablist]]:pb-px xl:[&_[role=tablist]]:gap-3">
          <Tabs
            items={tabs}
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
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Funnel aria-hidden weight="fill" className="size-4" />
            Filters
          </Button>
          <Button variant="secondary" onClick={() => setSortNewest(!sortNewest)}>
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
            onChange={(event) => setContactType(event.target.value)}
            options={[
              { value: 'all', label: 'All Contact Types' },
              { value: 'client', label: 'Client' },
              { value: 'lead', label: 'Lead' },
              { value: 'support', label: 'Support' },
              { value: 'internal', label: 'Internal' },
            ]}
          />
          <Select
            label="Message status"
            hideLabel
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'unread', label: 'Unread' },
              { value: 'read', label: 'Read' },
            ]}
          />
          <Button variant="ghost" onClick={resetFilters}>
            Clear filters
          </Button>
        </section>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="rounded-card border border-danger bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {loadError.toLowerCase().includes('403') || loadError.toLowerCase().includes('forbidden')
            ? 'You do not have permission to view communications.'
            : loadError}
        </div>
      ) : null}

      <section
        className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-12"
        aria-label="Communications inbox"
      >
        <Card className="!p-0 flex min-w-0 flex-col overflow-hidden lg:col-span-3">
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
                    onClick={() => setChannel(item.id)}
                    className={
                      'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-control border px-2.5 text-xs font-medium ' +
                      (active
                        ? 'border-action bg-info-soft text-action'
                        : 'border-divider bg-surface text-muted hover:bg-canvas')
                    }
                  >
                    <Glyph aria-hidden weight="fill" className="size-3.5" />
                    {item.label} ({summary?.channels[item.id] ?? '—'})
                  </button>
                );
              })}
            </div>
          </div>
          <div className="divide-y divide-divider xl:[&>button>span:last-child>span:last-child>span:last-child]:px-2 xl:[&>button>span:last-child>span:last-child>span:last-child]:py-0">
            {filteredConversations.length ? (
              filteredConversations.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(item.id);
                    setAssigned(item.assignedTo === response?.currentAdmin);
                  }}
                  className={
                    'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors xl:py-0.5 ' +
                    (selectedId === item.id ? 'bg-info-soft' : 'bg-surface hover:bg-canvas')
                  }
                >
                  <span className="relative">
                    <ConversationAvatar conversation={item} />
                    {item.unread ? (
                      <span
                        aria-label="Unread"
                        className="absolute -left-2 top-1/2 size-2 -translate-y-1/2 rounded-full bg-action"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-heading">
                        {item.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{item.time}</span>
                    </span>
                    <span className="mt-1 flex min-w-0 items-center justify-between gap-2 xl:mt-0">
                      <span className="block min-w-0 flex-1 truncate text-xs text-muted">
                        {item.preview}
                      </span>
                      <Badge
                        tone={
                          item.contactType === 'Lead'
                            ? 'info'
                            : item.contactType === 'Support'
                              ? 'warning'
                              : item.contactType === 'Internal'
                                ? 'purple'
                                : 'success'
                        }
                      >
                        {item.contactType}
                      </Badge>
                      {item.channel === 'SMS' ? (
                        <ChatCircleDots aria-label="SMS" className="size-4 text-muted" />
                      ) : item.channel === 'Internal' ? (
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
                    response
                      ? 'No conversations found'
                      : loadError
                        ? 'Inbox unavailable'
                        : 'Loading conversations'
                  }
                  description={
                    response
                      ? 'Try another view or clear your filters.'
                      : loadError
                        ? 'The inbox could not connect. Check the API or enable the adminCommunications mock.'
                        : 'Your inbox will appear here when it is ready.'
                  }
                  action={
                    response ? (
                      <Button variant="secondary" onClick={resetFilters}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-divider p-3">
            <Pagination
              page={page}
              onPage={setPage}
              pageCount={6}
              summary={
                '1 – ' +
                Math.min(filteredConversations.length, 10) +
                ' of ' +
                (response?.summary.open ?? 0) +
                ' conversations'
              }
            />
          </div>
        </Card>

        <Card className="!p-0 flex min-w-0 flex-col overflow-hidden lg:col-span-6">
          {selected ? (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-divider p-3 sm:p-4 xl:flex-nowrap xl:gap-2 xl:p-3">
                <ConversationAvatar conversation={selected} size="xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-semibold text-heading">
                      {selected.name}
                    </h2>
                    <Badge tone="success">{selected.contactType}</Badge>
                  </div>
                  <p className="mt-1 break-all text-xs text-muted sm:text-sm xl:truncate xl:whitespace-nowrap xl:text-xs">
                    {response?.contactDetails?.email ?? '—'} <span className="px-1">|</span>{' '}
                    {response?.contactDetails?.phone ?? '—'}
                  </p>
                </div>
                <IconButton
                  icon={DotsThreeVertical}
                  label="More conversation actions"
                  weight="bold"
                />
                <Button onClick={() => setAssigned(!assigned)}>
                  <UserPlus aria-hidden weight="fill" className="size-4" />
                  {assigned ? 'Assigned' : 'Assign'}
                </Button>
              </header>
              <div className="flex min-h-72 flex-1 flex-col gap-4 overflow-y-auto bg-canvas p-3 sm:min-h-96 sm:p-5 xl:gap-3 xl:p-4">
                {selected.messages.length ? (
                  selected.messages.map((message) => (
                    <div
                      key={message.id}
                      className={
                        'flex items-start gap-2 ' +
                        (message.from === 'admin' ? 'justify-end' : 'justify-start')
                      }
                    >
                      {message.from === 'contact' ? (
                        <ConversationAvatar conversation={selected} size="md" />
                      ) : null}
                      <div
                        className={
                          'max-w-md rounded-card px-3 py-3 sm:px-4 xl:px-3 xl:py-2 ' +
                          (message.from === 'admin'
                            ? 'bg-info-soft text-heading'
                            : 'bg-surface text-text shadow-card')
                        }
                      >
                        <p className="whitespace-pre-line text-sm leading-5 xl:text-xs xl:leading-4">
                          {message.body}
                        </p>
                        <p className="mt-2 text-xs text-muted xl:mt-1">{message.time}</p>
                      </div>
                      {message.from === 'admin' ? (
                        <Avatar name={response?.currentAdmin ?? 'Super Admin'} size="md" />
                      ) : null}
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No messages yet"
                    description="Start the conversation by sending a message."
                  />
                )}
              </div>
              <form
                onSubmit={sendMessage}
                className="shrink-0 border-t border-divider p-3 sm:p-4 xl:p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider">
                  <div className="flex gap-1" role="tablist" aria-label="Reply channel">
                    {(['Email', 'SMS', 'Internal'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="tab"
                        aria-selected={composeChannel === item}
                        onClick={() => setComposeChannel(item)}
                        className={
                          'min-h-9 border-b-2 px-3 text-xs font-medium ' +
                          (composeChannel === item
                            ? 'border-action text-action'
                            : 'border-transparent text-muted hover:text-heading')
                        }
                      >
                        {item === 'Internal' ? 'Internal Note' : item}
                      </button>
                    ))}
                  </div>
                  <Select
                    label="Choose a template"
                    hideLabel
                    className="min-h-9 py-1 text-xs"
                    options={[{ value: '', label: 'Templates' }]}
                  />
                </div>
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
                    <IconButton icon={Paperclip} label="Attach file" />
                    <IconButton icon={Smiley} label="Add emoji" />
                    <span className="mx-1 h-5 border-l border-divider" />
                    <IconButton icon={TextB} label="Bold" />
                    <IconButton icon={TextItalic} label="Italic" />
                    <IconButton icon={ListBullets} label="Bulleted list" />
                    <IconButton icon={ListNumbers} label="Numbered list" />
                    <IconButton icon={LinkSimple} label="Insert link" />
                  </div>
                  <Button type="submit" disabled={!draft.trim()}>
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                    Send
                    <CaretDown aria-hidden weight="bold" className="size-3.5" />
                  </Button>
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

        <aside className="flex min-w-0 flex-col gap-3 lg:col-span-3 xl:gap-2">
          <Card className="!p-0 overflow-hidden">
            <SectionTitle
              action={
                <Button
                  variant="secondary"
                  className="min-h-8 px-2.5 py-1 text-xs"
                  onClick={() => setEditingContact(!editingContact)}
                >
                  <PencilSimple aria-hidden weight="fill" className="size-3.5" />
                  {editingContact ? 'Done' : 'Edit'}
                </Button>
              }
            >
              Contact Details
            </SectionTitle>
            {selected ? (
              <div className="space-y-3 p-4 xl:space-y-2 xl:p-3">
                <div className="flex items-center gap-3">
                  <ConversationAvatar conversation={selected} size="xl" />
                  <div>
                    <p className="text-sm font-semibold text-heading">{selected.name}</p>
                    <Badge tone="success">{selected.contactType}</Badge>
                  </div>
                </div>
                <dl className="space-y-2.5 text-xs xl:space-y-1">
                  <div className="flex items-center gap-2">
                    <User aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Primary Contact</dt>
                    <dd className="ml-auto text-right font-medium text-text">
                      {response?.contactDetails?.primaryContact ?? '—'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <EnvelopeSimple aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Email</dt>
                    <dd className="ml-auto break-all text-right text-link">
                      {response?.contactDetails?.email ?? '—'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Phone</dt>
                    <dd className="ml-auto text-right text-text">
                      {response?.contactDetails?.phone ?? '—'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Buildings aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Firm</dt>
                    <dd className="ml-auto text-right text-text">{selected.name}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Plan</dt>
                    <dd className="ml-auto text-right text-text">
                      {response?.contactDetails?.plan ?? '—'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Status</dt>
                    <dd className="ml-auto">
                      <Badge tone="success">{response?.contactDetails?.status ?? '—'}</Badge>
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <User aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Assigned To</dt>
                    <dd className="ml-auto text-right text-text">
                      {assigned ? response?.currentAdmin : 'Unassigned'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe aria-hidden className="size-4 text-action" />
                    <dt className="text-muted">Source</dt>
                    <dd className="ml-auto text-right text-text">
                      {response?.contactDetails?.source ?? '—'}
                    </dd>
                  </div>
                </dl>
                {editingContact ? (
                  <p className="rounded-control bg-info-soft p-2 text-xs text-muted">
                    Contact editing is available when the communications API is connected.
                  </p>
                ) : null}
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
                <Button variant="secondary" className="min-h-8 px-2.5 py-1 text-xs">
                  <Plus aria-hidden weight="bold" className="size-3.5" />
                  Add Tag
                </Button>
              }
            >
              Tags
            </SectionTitle>
            <div className="flex flex-wrap gap-2 p-4 xl:px-3 xl:py-2">
              {(response?.tags ?? []).map((tag) => (
                <Badge key={tag.label} tone={tag.tone}>
                  {tag.label}
                </Badge>
              ))}
            </div>
          </Card>

          <Card className="!p-0 overflow-hidden">
            <SectionTitle
              action={
                <Button variant="ghost" className="min-h-8 px-1 py-1 text-xs">
                  View All <CaretRight aria-hidden weight="bold" className="size-3" />
                </Button>
              }
            >
              Recent Activity
            </SectionTitle>
            <ul className="space-y-3 p-4 text-xs xl:space-y-1 xl:p-3">
              {(response?.activity ?? []).map((item) => {
                const ActivityGlyph = activityIcons[item.kind];
                return (
                  <li key={item.id} className="flex items-center gap-2">
                    <ActivityGlyph aria-hidden className={'size-4 ' + activityTones[item.kind]} />
                    <span className="flex-1 text-text">{item.title}</span>
                    <time className="text-muted">{item.time}</time>
                  </li>
                );
              })}
            </ul>
          </Card>
        </aside>
      </section>
    </main>
  );
}
