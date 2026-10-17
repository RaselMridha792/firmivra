'use client';

import type { CommunicationRow, CommunicationTab } from '@firmivra/types';
import {
  ActionMenu,
  Button,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
  tileTones,
  type TileTone,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  CaretRight,
  DeviceMobile,
  ChatCircleDots,
  EnvelopeSimple,
  FileText,
  Megaphone,
  MagnifyingGlass,
  NotePencil,
  PaperPlaneTilt,
  Plus,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { CommunicationMenu } from './communication-actions';
import {
  CHANNELS,
  COMM_ERRORS,
  COMM_KEY,
  ChannelTile,
  StatusPill,
  card,
  channelOf,
  dateTimeText,
  dayText,
  hrefOf,
  linkBtn,
  quiet,
} from './communications-shared';
import { SegmentsPanel } from './segments-panel';

type TabId =
  | 'overview'
  | 'messages'
  | 'campaigns'
  | 'announcements'
  | 'segments'
  | 'templates'
  | 'scheduled'
  | 'sent';
const TABS: { id: TabId; label: string; href?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'messages', label: 'Messages', href: '/messages' },
  { id: 'campaigns', label: 'Bulk Campaigns' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'segments', label: 'Segments & Lists' },
  { id: 'templates', label: 'Templates', href: '/templates' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'sent', label: 'Sent History' },
];

interface RailItem {
  label: string;
  icon: typeof EnvelopeSimple;
  tone: TileTone;
  needsCreate?: boolean;
  onClick?: () => void;
  href?: string;
}

type Create = (channel: CommunicationRow['channel'], templateId?: string) => Promise<void>;

/** /communications: the overview and the lists behind its tabs. */
export function CommunicationsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('overview');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [picker, setPicker] = useState<'template' | 'draft'>();
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const overview = useApiQuery([...COMM_KEY, 'overview'], () => api.communications.overview());
  const o = overview.data;
  const canCreate = o?.canCreate ?? false;

  const create: Create = async (channel, templateId) => {
    try {
      const c = await api.communications.create({ channel, ...(templateId ? { templateId } : {}) });
      router.push(`/communications/${c.id}/edit`);
    } catch (e) {
      notice(errorMessage(e, COMM_ERRORS), 'error');
    }
  };

  const emails = useApiQuery([...COMM_KEY, 'count', 'EMAIL'], () =>
    api.communications.list({ tab: 'sent', channel: 'EMAIL', page: 1, pageSize: 1 }),
  );
  const texts = useApiQuery([...COMM_KEY, 'count', 'SMS'], () =>
    api.communications.list({ tab: 'sent', channel: 'SMS', page: 1, pageSize: 1 }),
  );

  const columns: Column<CommunicationRow>[] = [
    {
      id: 'type',
      label: 'Type',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <ChannelTile channel={r.channel} size="sm" />
          <span className="sr-only">{channelOf(r.channel).noun}</span>
        </span>
      ),
    },
    {
      id: 'name',
      label: 'Subject / Message',
      cell: (r) => (
        <span className="min-w-0">
          <Link
            href={hrefOf(r)}
            data-testid="comm-link"
            className="block font-medium text-link hover:underline"
          >
            {r.name}
          </Link>
          <span className="block max-w-56 truncate text-xs text-muted">
            {r.subject ?? channelOf(r.channel).label}
          </span>
        </span>
      ),
    },
    {
      id: 'aud',
      label: 'Audience',
      cell: (r) =>
        r.audienceSummary ? (
          <span className="inline-block max-w-40 truncate rounded-md bg-info-soft px-2 py-1 text-xs font-medium text-info">
            {r.audienceSummary}
          </span>
        ) : (
          '—'
        ),
    },
    { id: 'status', label: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    {
      id: 'when',
      label: 'Sent / Scheduled',
      cell: (r) => dateTimeText(r.scheduledFor ?? r.sentAt ?? r.updatedAt),
    },
  ];

  const toTab = (t: TabId) => () => setTab(t);
  const cards = [
    {
      id: 'email',
      title: 'Send Bulk Email',
      text: 'Send to a group or your entire list',
      icon: EnvelopeSimple,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('EMAIL'),
    },
    {
      id: 'sms',
      title: 'Send Bulk Text (SMS)',
      text: 'Text clients, leads or custom lists',
      icon: ChatCircleDots,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('SMS'),
    },
    {
      id: 'announcement',
      title: 'Create Announcement',
      text: 'Post to client portal and/or send via email/text',
      icon: Megaphone,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('ANNOUNCEMENT'),
    },
    {
      id: 'segments',
      title: 'Manage Segments',
      text: 'Create and manage your contact lists',
      icon: UsersThree,
      tone: 'blue' as const,
      needsCreate: false,
      onClick: toTab('segments'),
    },
    {
      id: 'templates',
      title: 'Message Templates',
      text: 'Use or create templates for email, text, and portal',
      icon: FileText,
      tone: 'blue' as const,
      needsCreate: false,
      onClick: () => router.push('/templates'),
    },
  ];
  const starts = [
    {
      title: 'Send an Email',
      text: 'Create and send a new email campaign.',
      icon: EnvelopeSimple,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('EMAIL'),
    },
    {
      title: 'Send a Text Message',
      text: 'Create and send a new SMS campaign.',
      icon: ChatCircleDots,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('SMS'),
    },
    {
      title: 'Create an Announcement',
      text: 'Post to client portal and/or send via email or text.',
      icon: Megaphone,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('ANNOUNCEMENT'),
    },
    {
      title: 'Choose Recipients',
      text: 'Select from segments, lists, or custom filters.',
      icon: UsersThree,
      tone: 'blue' as const,
      needsCreate: false,
      onClick: toTab('segments'),
    },
  ];
  const rail: RailItem[] = [
    {
      label: 'Send Bulk Email',
      icon: EnvelopeSimple,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('EMAIL'),
    },
    {
      label: 'Send Bulk Text (SMS)',
      icon: ChatCircleDots,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('SMS'),
    },
    {
      label: 'Create Announcement',
      icon: Megaphone,
      tone: 'blue' as const,
      needsCreate: true,
      onClick: () => void create('ANNOUNCEMENT'),
    },
    { label: 'View Messages', icon: ChatCircleDots, tone: 'blue' as const, href: '/messages' },
    {
      label: 'Manage Segments',
      icon: UsersThree,
      tone: 'blue' as const,
      needsCreate: false,
      onClick: toTab('segments'),
    },
    { label: 'Message Templates', icon: FileText, tone: 'blue' as const, href: '/templates' },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="communications-page">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 sm:size-20 items-center justify-center rounded-xl bg-action text-on-action"
          >
            <PaperPlaneTilt weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-heading">
              Communications
            </h1>
            <p className="text-base text-muted">
              Message. Email. Text. Announce. Keep your clients informed — all in one place.
            </p>
          </div>
        </div>
        {canCreate ? (
          <ActionMenu
            label="New Communication"
            trigger={
              <span className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-on-action">
                <Plus aria-hidden weight="bold" className="size-5" /> New Communication
              </span>
            }
            sections={[
              {
                items: [
                  {
                    label: 'New Email',
                    icon: EnvelopeSimple,
                    onSelect: () => void create('EMAIL'),
                  },
                  {
                    label: 'New Text Message',
                    icon: ChatCircleDots,
                    onSelect: () => void create('SMS'),
                  },
                  {
                    label: 'New Announcement',
                    icon: Megaphone,
                    onSelect: () => void create('ANNOUNCEMENT'),
                  },
                  {
                    label: 'Use a Template',
                    icon: FileText,
                    onSelect: () => setPicker('template'),
                  },
                  { label: 'Resume Draft', icon: NotePencil, onSelect: () => setPicker('draft') },
                ],
              },
            ]}
            align="right"
          />
        ) : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <nav
        aria-label="Communication views"
        role="tablist"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) =>
          t.href ? (
            <Link
              key={t.id}
              href={t.href}
              role="tab"
              aria-selected={false}
              className="-mb-px flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-4 text-sm font-medium whitespace-nowrap text-heading hover:text-action"
            >
              {t.label}
            </Link>
          ) : (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {t.label}
            </button>
          ),
        )}
      </nav>

      {overview.isError ? (
        <p role="alert" className={quiet} data-testid="comm-error">
          Communications are not available right now. We could not load them. Try again in a moment.
        </p>
      ) : null}

      {tab === 'overview' ? (
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-5">
            <ul
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
              aria-label="Quick start"
              data-testid="quick-cards"
            >
              {cards.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    data-testid={`quick-${c.id}`}
                    disabled={c.needsCreate && !canCreate}
                    onClick={c.onClick}
                    className="relative flex h-full w-full flex-col items-start gap-2 rounded-xl bg-surface p-3 pb-14 text-left shadow-md hover:ring-2 hover:ring-action disabled:opacity-60"
                  >
                    <span
                      aria-hidden
                      className={`flex size-12 items-center justify-center rounded-xl ${tileTones[c.tone]}`}
                    >
                      <c.icon weight="fill" className="size-6" />
                    </span>
                    <span className="block text-base font-semibold text-heading">{c.title}</span>
                    <span className="block text-sm text-muted">{c.text}</span>
                    <span
                      aria-hidden
                      className="absolute right-3 bottom-3 flex size-8 items-center justify-center rounded-full bg-action text-on-action"
                    >
                      <ArrowRight weight="bold" className="size-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <ul
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
              data-testid="comm-kpis"
            >
              <li>
                <KpiCard
                  icon={EnvelopeSimple}
                  tone="blue"
                  value={o?.kpis.sent ?? '—'}
                  label="Total Sent"
                  loading={overview.isPending}
                />
              </li>
              <li>
                <KpiCard
                  icon={ChatCircleDots}
                  tone="purple"
                  value={emails.data?.total ?? '—'}
                  label="Emails Sent"
                  loading={emails.isPending && !emails.isError}
                />
              </li>
              <li>
                <KpiCard
                  icon={DeviceMobile}
                  tone="green"
                  value={texts.data?.total ?? '—'}
                  label="Texts Sent"
                  loading={texts.isPending && !texts.isError}
                />
              </li>
              <li>
                <KpiCard
                  icon={UsersThree}
                  tone="amber"
                  value={o?.kpis.recipientsReached ?? '—'}
                  label="Total Recipients"
                  loading={overview.isPending}
                />
              </li>
            </ul>
            <section className={card} aria-label="Recent communications" data-testid="recent">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold text-heading">
                  Recent Communications
                </h2>
                <button type="button" className={linkBtn} onClick={() => setTab('sent')}>
                  View All
                </button>
              </div>
              <div className="relative">
                <Table
                  rows={o?.recent ?? []}
                  columns={columns}
                  rowKey={(r) => r.id}
                  caption="Recent communications"
                  dense
                  noun="communications"
                  pageSize={5}
                  loading={overview.isPending}
                  emptyTitle="No communications yet"
                  emptyText="Create your first email, text or announcement to see it here."
                  rowActions={(r) => (
                    <CommunicationMenu row={r} onNotice={notice} canManage={canCreate} />
                  )}
                />
              </div>
            </section>
            <section
              className={card}
              aria-label="Start a new communication"
              data-testid="start-new"
            >
              <h2 className="mb-3 font-display text-xl font-bold text-heading">
                Start a New Communication
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {starts.map((c) => (
                  <li key={c.title}>
                    <button
                      type="button"
                      disabled={c.needsCreate && !canCreate}
                      onClick={c.onClick}
                      className="flex h-full w-full items-center gap-3 rounded-lg border border-divider p-3 text-left hover:bg-canvas disabled:opacity-60"
                    >
                      <span
                        aria-hidden
                        className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${tileTones[c.tone]}`}
                      >
                        <c.icon weight="fill" className="size-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-heading">{c.title}</span>
                        <span className="block text-xs text-muted">{c.text}</span>
                      </span>
                      <CaretRight
                        aria-hidden
                        weight="bold"
                        className="size-4 shrink-0 text-muted"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-4" aria-label="Communication tools">
            <section className={card} aria-label="Quick actions" data-testid="quick-actions">
              <h2 className="mb-2 font-display text-lg font-bold text-heading">Quick Actions</h2>
              <ul className="flex flex-col gap-1.5">
                {rail.map((a) => (
                  <li key={a.label}>
                    {a.href ? (
                      <Link
                        href={a.href}
                        className="flex w-full items-center gap-3 rounded-lg bg-canvas p-2 text-sm font-medium text-heading hover:ring-1 hover:ring-action"
                      >
                        <span
                          aria-hidden
                          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tileTones[a.tone]}`}
                        >
                          <a.icon weight="fill" className="size-5" />
                        </span>
                        {a.label}
                        <CaretRight
                          aria-hidden
                          weight="bold"
                          className="ml-auto size-3 text-muted"
                        />
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={a.needsCreate && !canCreate}
                        onClick={a.onClick}
                        className="flex w-full items-center gap-3 rounded-lg bg-canvas p-2 text-left text-sm font-medium text-heading hover:ring-1 hover:ring-action disabled:opacity-60"
                      >
                        <span
                          aria-hidden
                          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tileTones[a.tone]}`}
                        >
                          <a.icon weight="fill" className="size-5" />
                        </span>
                        {a.label}
                        <CaretRight
                          aria-hidden
                          weight="bold"
                          className="ml-auto size-3 text-muted"
                        />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section className={card} aria-label="Upcoming communications" data-testid="upcoming">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">
                  Upcoming Communications
                </h2>
                <button type="button" className={linkBtn} onClick={() => setTab('scheduled')}>
                  View All
                </button>
              </div>
              {o && o.scheduled.length > 0 ? (
                <ul>
                  {o.scheduled.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
                    >
                      <span
                        aria-hidden
                        className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-canvas text-heading"
                      >
                        <span className="text-[10px] font-semibold uppercase">
                          {r.scheduledFor
                            ? new Date(r.scheduledFor).toLocaleDateString('en-US', {
                                month: 'short',
                              })
                            : ''}
                        </span>
                        <span className="text-lg leading-none font-bold">
                          {r.scheduledFor ? new Date(r.scheduledFor).getDate() : ''}
                        </span>
                      </span>
                      <Link href={hrefOf(r)} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-link">
                          {r.name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {channelOf(r.channel).noun}
                          {r.finalCount !== null ? ` • ${r.finalCount} recipients` : ''}
                        </span>
                      </Link>
                      <StatusPill status={r.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={quiet}>Nothing is scheduled.</p>
              )}
            </section>
            <section className={card} aria-label="Saved templates" data-testid="saved-templates">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">Saved Templates</h2>
                <Link href="/templates" className={linkBtn}>
                  View All
                </Link>
              </div>
              {o && o.templates.length > 0 ? (
                <ul>
                  {o.templates.map((t) => {
                    const channel =
                      t.kind === 'SMS'
                        ? 'SMS'
                        : t.kind === 'ANNOUNCEMENT'
                          ? 'ANNOUNCEMENT'
                          : 'EMAIL';
                    return (
                      <li
                        key={t.id}
                        className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
                      >
                        <ChannelTile channel={channel} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-heading">
                            {t.name}
                          </span>
                          <button
                            type="button"
                            disabled={!canCreate}
                            className="text-xs font-medium text-link disabled:opacity-50"
                            onClick={() => void create(channel, t.id)}
                          >
                            Use template
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={quiet}>No saved templates yet.</p>
              )}
            </section>
            <section
              className="flex items-center gap-3 rounded-xl bg-info-soft p-4"
              aria-label="Grow your reach"
              data-testid="reach"
            >
              <span
                aria-hidden
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-action text-on-action"
              >
                <UsersThree weight="fill" className="size-7" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-bold text-heading">Grow Your Reach</h2>
                <p className="text-sm text-text">
                  {o && o.segments.total > 0
                    ? `You have ${o.segments.total} segments covering ${o.segments.totalMembers} contacts. Use segments to send targeted messages.`
                    : 'Use segments to send targeted messages and increase engagement.'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Manage segments"
                onClick={() => setTab('segments')}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-action shadow-md"
              >
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </button>
            </section>
          </aside>
        </div>
      ) : tab === 'segments' ? (
        <SegmentsPanel canManage={o?.canManageSegments ?? false} onNotice={notice} />
      ) : (
        <ListPanel
          tab={tab as CommunicationTab}
          columns={columns}
          canManage={canCreate}
          onNotice={notice}
        />
      )}

      {picker === 'template' ? (
        <TemplatePicker
          onClose={() => setPicker(undefined)}
          onPick={(kind, id) => void create(kind, id)}
        />
      ) : null}
      {picker === 'draft' ? <DraftPicker onClose={() => setPicker(undefined)} /> : null}
    </div>
  );
}

function ListPanel({
  tab,
  columns,
  canManage,
  onNotice,
}: {
  tab: CommunicationTab;
  columns: Column<CommunicationRow>[];
  canManage: boolean;
  onNotice: (t: string, tone: 'success' | 'error') => void;
}) {
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const term = useDeferredValue(search.trim());
  const list = useApiQuery([...COMM_KEY, 'list', tab, term, channel, archived, page], () =>
    api.communications.list({
      tab,
      ...(term ? { search: term } : {}),
      ...(channel ? { channel: channel as CommunicationRow['channel'] } : {}),
      ...(archived ? { archived: true } : {}),
      page,
      pageSize: 10,
    }),
  );
  const titles: Record<string, string> = {
    campaigns: 'Bulk Campaigns',
    announcements: 'Announcements',
    scheduled: 'Scheduled',
    sent: 'Sent History',
    drafts: 'Drafts',
  };
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label={titles[tab]}
      data-testid="comm-list"
    >
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto font-display text-xl font-bold text-heading">{titles[tab]}</h2>
        <label className="flex h-10 w-64 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
          <span className="sr-only">Search communications</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search communications..."
            className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
        </label>
        {tab === 'campaigns' || tab === 'sent' || tab === 'scheduled' ? (
          <div className="w-40">
            <Select
              label="Type"
              hideLabel
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All types' },
                ...CHANNELS.filter((c) =>
                  tab === 'campaigns' ? c.channel !== 'ANNOUNCEMENT' : true,
                ).map((c) => ({ value: c.channel, label: c.label })),
              ]}
            />
          </div>
        ) : null}
        <Button variant="secondary" onClick={() => setArchived(!archived)}>
          {archived ? 'Hide archived' : 'Show archived'}
        </Button>
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          caption={titles[tab] ?? 'Communications'}
          dense
          noun="communications"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Communications are not available' : 'Nothing here yet'}
          emptyText={
            list.isError
              ? 'We could not load this list. Try again in a moment.'
              : 'Communications of this kind will appear here.'
          }
          rowActions={(r) => (
            <CommunicationMenu row={r} onNotice={onNotice} canManage={canManage} />
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
    </section>
  );
}

function TemplatePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (kind: CommunicationRow['channel'], id: string) => void;
}) {
  const list = useApiQuery([...COMM_KEY, 'template-picker'], () =>
    api.templates.list({ tab: 'all', page: 1, pageSize: 50 }),
  );
  const items = (list.data?.items ?? []).filter(
    (t) => ['EMAIL', 'SMS', 'ANNOUNCEMENT', 'CAMPAIGN'].includes(t.kind) && t.status === 'ACTIVE',
  );
  return (
    <Modal
      open
      title="Use a Template"
      subtitle="The message is copied into a new draft. The template is not changed."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ul className="max-h-80 overflow-auto" data-testid="template-picker">
        {items.length === 0 ? (
          <li className={quiet}>
            {list.isError ? 'Templates are not available right now.' : 'No active templates yet.'}
          </li>
        ) : null}
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-2 border-t border-divider py-2 first:border-t-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-heading">{t.name}</span>
              <span className="block text-xs text-muted">
                {t.kind === 'SMS'
                  ? 'Text Message'
                  : t.kind === 'ANNOUNCEMENT'
                    ? 'Announcement'
                    : 'Email'}
              </span>
            </span>
            <button
              type="button"
              className={linkBtn}
              onClick={() =>
                onPick(
                  t.kind === 'SMS' ? 'SMS' : t.kind === 'ANNOUNCEMENT' ? 'ANNOUNCEMENT' : 'EMAIL',
                  t.id,
                )
              }
            >
              Use
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function DraftPicker({ onClose }: { onClose: () => void }) {
  const list = useApiQuery([...COMM_KEY, 'draft-picker'], () =>
    api.communications.list({ tab: 'drafts', page: 1, pageSize: 20 }),
  );
  return (
    <Modal
      open
      title="Resume Draft"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ul className="max-h-80 overflow-auto" data-testid="draft-picker">
        {list.data?.items.length === 0 ? <li className={quiet}>You have no drafts.</li> : null}
        {list.isError ? <li className={quiet}>Drafts are not available right now.</li> : null}
        {(list.data?.items ?? []).map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
          >
            <ChannelTile channel={r.channel} size="sm" />
            <Link href={`/communications/${r.id}/edit`} className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-link">{r.name}</span>
              <span className="block text-xs text-muted">Edited {dayText(r.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
