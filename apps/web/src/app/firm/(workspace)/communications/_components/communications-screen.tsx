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
  type Column,
} from '@firmivra/ui';
import {
  CaretRight,
  ChatCircleDots,
  CheckCircle,
  Clock,
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
  gold,
  hrefOf,
  linkBtn,
  percent,
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

  const columns: Column<CommunicationRow>[] = [
    {
      id: 'name',
      label: 'Communication',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <ChannelTile channel={r.channel} size="sm" />
          <span className="min-w-0">
            <Link
              href={hrefOf(r)}
              data-testid="comm-link"
              className="block font-medium text-link hover:underline"
            >
              {r.name}
            </Link>
            <span className="block truncate text-xs text-muted">
              {r.subject ?? channelOf(r.channel).label}
            </span>
          </span>
        </span>
      ),
    },
    { id: 'type', label: 'Type', cell: (r) => channelOf(r.channel).noun },
    {
      id: 'aud',
      label: 'Audience',
      cell: (r) => (r.finalCount === null ? '—' : `${r.finalCount} recipients`),
    },
    { id: 'status', label: 'Status', cell: (r) => <StatusPill status={r.status} /> },
    {
      id: 'when',
      label: 'Date',
      cell: (r) =>
        r.scheduledFor
          ? dateTimeText(r.scheduledFor)
          : r.sentAt
            ? dayText(r.sentAt)
            : dayText(r.updatedAt),
    },
    { id: 'open', label: 'Open Rate', cell: (r) => percent(r.openRatePercent) },
  ];

  const quick = (channel: CommunicationRow['channel'] | 'template' | 'draft') => {
    const meta =
      channel === 'template' ? undefined : channel === 'draft' ? undefined : channelOf(channel);
    const title = meta
      ? `New ${meta.label}`
      : channel === 'template'
        ? 'Use a Template'
        : 'Resume Draft';
    const text = meta
      ? {
          EMAIL: 'Send an email to clients or leads.',
          SMS: 'Send a quick text message.',
          ANNOUNCEMENT: 'Post to the client portal.',
        }[meta.channel]
      : channel === 'template'
        ? 'Start from a saved message.'
        : 'Pick up where you left off.';
    const Glyph = meta?.icon ?? (channel === 'template' ? FileText : NotePencil);
    return (
      <button
        key={title}
        type="button"
        disabled={!canCreate}
        data-testid={`quick-${channel.toLowerCase()}`}
        onClick={() =>
          meta ? void create(meta.channel) : setPicker(channel as 'template' | 'draft')
        }
        className="flex h-full w-full flex-col items-start gap-3 rounded-xl bg-surface p-4 text-left shadow-md hover:ring-2 hover:ring-action disabled:opacity-60"
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-xl bg-info-soft text-info"
        >
          <Glyph weight="fill" className="size-6" />
        </span>
        <span>
          <span className="block text-base font-semibold text-heading">{title}</span>
          <span className="block text-sm text-muted">{text}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="communications-page">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action"
          >
            <PaperPlaneTilt weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Communications</h1>
            <p className="text-base text-muted">
              Reach clients and leads by email, text and portal announcements.
            </p>
          </div>
        </div>
        {canCreate ? (
          <ActionMenu
            label="Create New"
            trigger={
              <span className={gold}>
                <Plus aria-hidden weight="bold" className="size-5" /> Create New
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
        <>
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
            aria-label="Start a new communication"
            data-testid="quick-cards"
          >
            {(['EMAIL', 'SMS', 'ANNOUNCEMENT', 'template', 'draft'] as const).map((c) => (
              <li key={c}>{quick(c)}</li>
            ))}
          </ul>
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="comm-kpis"
          >
            <li>
              <KpiCard
                icon={PaperPlaneTilt}
                tone="blue"
                value={o?.kpis.sent ?? '—'}
                label="Communications Sent"
                loading={overview.isPending}
              />
            </li>
            <li>
              <KpiCard
                icon={UsersThree}
                tone="purple"
                value={o?.kpis.recipientsReached ?? '—'}
                label="Recipients Reached"
                loading={overview.isPending}
              />
            </li>
            <li>
              <KpiCard
                icon={CheckCircle}
                tone="green"
                value={o ? percent(o.kpis.deliveryRatePercent) : '—'}
                label="Delivery Rate"
                loading={overview.isPending}
              />
            </li>
            <li>
              <KpiCard
                icon={EnvelopeSimple}
                tone="amber"
                value={o ? percent(o.kpis.openRatePercent) : '—'}
                label="Open Rate"
                loading={overview.isPending}
              />
            </li>
          </ul>
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className={card} aria-label="Recent communications" data-testid="recent">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold text-heading">
                  Recent Communications
                </h2>
                <button type="button" className={linkBtn} onClick={() => setTab('sent')}>
                  View all <CaretRight aria-hidden weight="bold" className="size-3" />
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
            <aside className="flex min-w-0 flex-col gap-4" aria-label="Communication tools">
              <section className={card} aria-label="Upcoming communications" data-testid="upcoming">
                <h2 className="mb-2 font-display text-lg font-bold text-heading">
                  Upcoming Communications
                </h2>
                {o && o.scheduled.length > 0 ? (
                  <ul>
                    {o.scheduled.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center gap-3 border-t border-divider py-2 first:border-t-0"
                      >
                        <ChannelTile channel={r.channel} size="sm" />
                        <Link href={hrefOf(r)} className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-link">
                            {r.name}
                          </span>
                          <span className="block text-xs text-muted">
                            {r.scheduledFor ? dateTimeText(r.scheduledFor) : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={quiet}>Nothing is scheduled.</p>
                )}
              </section>
              <section className={card} aria-label="Saved templates" data-testid="saved-templates">
                <h2 className="mb-2 font-display text-lg font-bold text-heading">
                  Saved Templates
                </h2>
                {o && o.templates.length > 0 ? (
                  <ul>
                    {o.templates.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 border-t border-divider py-2 first:border-t-0"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-heading">
                            {t.name}
                          </span>
                          <span className="block text-xs text-muted">{t.category ?? t.kind}</span>
                        </span>
                        <button
                          type="button"
                          disabled={!canCreate}
                          className={linkBtn}
                          onClick={() =>
                            void create(
                              t.kind === 'SMS'
                                ? 'SMS'
                                : t.kind === 'ANNOUNCEMENT'
                                  ? 'ANNOUNCEMENT'
                                  : 'EMAIL',
                              t.id,
                            )
                          }
                        >
                          Use
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={quiet}>No saved templates yet.</p>
                )}
                <Link href="/templates" className={`${linkBtn} mt-2`}>
                  Manage templates <CaretRight aria-hidden weight="bold" className="size-3" />
                </Link>
              </section>
              <section className={card} aria-label="Quick actions" data-testid="quick-actions">
                <h2 className="mb-2 font-display text-lg font-bold text-heading">Quick Actions</h2>
                <ul>
                  {[
                    { label: 'View Scheduled', icon: Clock, onClick: () => setTab('scheduled') },
                    {
                      label: 'Manage Segments & Lists',
                      icon: UsersThree,
                      onClick: () => setTab('segments'),
                    },
                    { label: 'Sent History', icon: CheckCircle, onClick: () => setTab('sent') },
                  ].map((a) => (
                    <li key={a.label}>
                      <button
                        type="button"
                        onClick={a.onClick}
                        className="flex w-full items-center gap-3 border-t border-divider py-2 text-left text-sm font-medium text-heading first:border-t-0 hover:text-action"
                      >
                        <a.icon aria-hidden weight="fill" className="size-5 text-action" />{' '}
                        {a.label}
                        <CaretRight
                          aria-hidden
                          weight="bold"
                          className="ml-auto size-3 text-muted"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {o && o.segments.total > 0 ? (
                <section className={card} aria-label="Grow your reach" data-testid="reach">
                  <h2 className="mb-1 font-display text-lg font-bold text-heading">
                    Grow Your Reach
                  </h2>
                  <p className="text-sm text-text">
                    You have {o.segments.total} segments covering {o.segments.totalMembers}{' '}
                    contacts. Group clients to send the right message to the right people.
                  </p>
                </section>
              ) : null}
            </aside>
          </div>
        </>
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
