'use client';

import {
  Badge,
  Button,
  IconButton,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Table,
  Tabs,
  type Column,
} from '@firmivra/ui';
import {
  Bell,
  CalendarBlank,
  ChatCircleDots,
  Clock,
  DotsThreeVertical,
  EnvelopeSimple,
  FileText,
  MagnifyingGlass,
  Megaphone,
  PaperPlaneTilt,
  Plus,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  ADMIN_COMM_BROADCAST_ERRORS,
  type AdminCommBroadcast,
  type AdminCommBroadcastChannel,
  type CommBroadcastStatus,
  type ListAdminCommBroadcastsQuery,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { stepHref } from '../new/_components/broadcast-draft';

type TabStatus = 'ALL' | 'DRAFT' | 'SCHEDULED' | 'SENT' | 'FAILED';
type ChannelFilter = 'ALL' | AdminCommBroadcastChannel;
type DateRange = { from: string; to: string };
type RowAction =
  | 'edit'
  | 'preview'
  | 'duplicate'
  | 'test'
  | 'schedule'
  | 'delete'
  | 'send'
  | 'cancel'
  | 'details'
  | 'recipients'
  | 'error'
  | 'retry'
  | 'archive';

const BROADCASTS = ['admin-communications', 'broadcasts'] as const;

const statusLabel: Record<CommBroadcastStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  SENDING: 'Sending',
  SENT: 'Sent',
  PARTIALLY_SENT: 'Partially Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

const statusTone: Record<
  CommBroadcastStatus,
  'neutral' | 'info' | 'success' | 'danger' | 'warning'
> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENDING: 'info',
  SENT: 'success',
  PARTIALLY_SENT: 'warning',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const channelLabel: Record<AdminCommBroadcastChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  IN_APP: 'In-App',
};
const channelIcon = { EMAIL: EnvelopeSimple, SMS: ChatCircleDots, IN_APP: Bell };

/** What each status offers, as the design's menus list it. */
const actionLabels: Record<
  CommBroadcastStatus,
  { id: RowAction; label: string; danger?: boolean }[]
> = {
  SENT: [
    { id: 'details', label: 'View details' },
    { id: 'preview', label: 'Preview' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'recipients', label: 'View recipients' },
    { id: 'archive', label: 'Archive' },
  ],
  PARTIALLY_SENT: [
    { id: 'details', label: 'View details' },
    { id: 'preview', label: 'Preview' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'recipients', label: 'View recipients' },
    { id: 'archive', label: 'Archive' },
  ],
  DRAFT: [
    { id: 'edit', label: 'Edit' },
    { id: 'preview', label: 'Preview' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'test', label: 'Send test' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'delete', label: 'Delete', danger: true },
  ],
  SCHEDULED: [
    { id: 'edit', label: 'Edit' },
    { id: 'schedule', label: 'Reschedule' },
    { id: 'send', label: 'Send now' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'cancel', label: 'Cancel', danger: true },
  ],
  SENDING: [
    { id: 'details', label: 'View details' },
    { id: 'preview', label: 'Preview' },
  ],
  FAILED: [
    { id: 'error', label: 'View error' },
    { id: 'retry', label: 'Retry' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'archive', label: 'Archive' },
  ],
  CANCELLED: [
    { id: 'preview', label: 'Preview' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'archive', label: 'Archive' },
  ],
};

const whenOf = (b: AdminCommBroadcast) => b.scheduledAt ?? b.finishedAt ?? b.sendStartedAt;
const dayOf = (iso: string) => iso.slice(0, 10);
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
/** The line under the name: the first channel's subject, else its text. */
const summaryOf = (b: AdminCommBroadcast) => {
  const first = b.channels[0];
  return first ? (first.subject ?? first.body) : 'No message yet';
};

function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value.from && value.to ? `${value.from} – ${value.to}` : 'Select date range';

  return (
    <div className="relative min-w-0 flex-1">
      <Button
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-start text-muted"
      >
        <CalendarBlank aria-hidden weight="fill" className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 grid w-full min-w-64 gap-3 rounded-xl border border-divider bg-surface p-4 shadow-lg">
          <Input
            label="From"
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
          />
          <Input
            label="To"
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
          />
          <Button variant="ghost" onClick={() => setOpen(false)} className="justify-self-end">
            Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function BroadcastRowActions({
  broadcast,
  onAction,
}: {
  broadcast: AdminCommBroadcast;
  onAction: (action: RowAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <IconButton
        icon={DotsThreeVertical}
        label={`Actions for ${broadcast.name}`}
        weight="bold"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div
          role="menu"
          aria-label={`Actions for ${broadcast.name}`}
          className="absolute top-full right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-divider bg-surface p-1 shadow-lg"
        >
          {actionLabels[broadcast.status].map(({ id, label, danger }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                onAction(id);
                setOpen(false);
              }}
              className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-canvas ${danger ? 'text-danger' : 'text-text'}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RecipientsList({ broadcastId }: { broadcastId: string }) {
  const recipients = useApiQuery([...BROADCASTS, 'recipients', broadcastId], () =>
    api.adminBroadcasts.broadcasts.recipients(broadcastId, { pageSize: 100 }),
  );
  if (recipients.isPending) return <p className="text-sm text-muted">Loading recipients…</p>;
  if (recipients.isError)
    return <p className="text-sm text-danger">The recipients could not be loaded.</p>;
  if (!recipients.data.items.length)
    return <p className="text-sm text-muted">No one was reached by this broadcast.</p>;
  return (
    <ul className="max-h-80 divide-y divide-divider overflow-y-auto text-sm">
      {recipients.data.items.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0">
            <span className="block truncate font-medium text-heading">{r.name}</span>
            <span className="block truncate text-xs text-muted">
              {channelLabel[r.channel]} · {r.address}
            </span>
          </span>
          <Badge
            tone={r.status === 'FAILED' ? 'danger' : r.status === 'PENDING' ? 'neutral' : 'success'}
          >
            {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function BroadcastsDashboard() {
  const router = useRouter();
  const client = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabStatus>('ALL');
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const [audienceFilter, setAudienceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CommBroadcastStatus>('ALL');
  const [creatorFilter, setCreatorFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState('');
  const [dialog, setDialog] = useState<{
    mode: 'preview' | 'recipients' | 'error' | 'delete' | 'cancel';
    broadcast: AdminCommBroadcast;
  } | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchText(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const status = statusFilter !== 'ALL' ? statusFilter : activeTab !== 'ALL' ? activeTab : null;
  const query: ListAdminCommBroadcastsQuery = {
    ...(status ? { status } : {}),
    ...(channelFilter !== 'ALL' ? { channel: channelFilter } : {}),
    ...(searchText ? { search: searchText } : {}),
    pageSize: 100,
  };
  const list = useApiQuery([...BROADCASTS, query], () =>
    api.adminBroadcasts.broadcasts.list(query),
  );
  const summary = useApiQuery([...BROADCASTS, 'summary'], () =>
    api.adminBroadcasts.broadcasts.summary(),
  );
  const loading = list.isPending;
  const loadError = list.isError;
  const broadcasts = useMemo(() => list.data?.items ?? [], [list.data]);
  const metrics = summary.data;

  // Audience, creator and dates are not list filters in the contract: they narrow the rows read.
  const audiences = [...new Set(broadcasts.flatMap((b) => (b.segment ? [b.segment.name] : [])))];
  const creators = [...new Set(broadcasts.map((b) => b.createdBy?.name ?? 'System'))];
  const filteredRows = useMemo(
    () =>
      broadcasts.filter((b) => {
        const when = whenOf(b);
        if (audienceFilter !== 'ALL' && b.segment?.name !== audienceFilter) return false;
        if (creatorFilter !== 'ALL' && (b.createdBy?.name ?? 'System') !== creatorFilter)
          return false;
        if (dateRange.from && (!when || dayOf(when) < dateRange.from)) return false;
        if (dateRange.to && (!when || dayOf(when) > dateRange.to)) return false;
        return true;
      }),
    [broadcasts, audienceFilter, creatorFilter, dateRange],
  );
  const anyFilter =
    activeTab !== 'ALL' ||
    statusFilter !== 'ALL' ||
    channelFilter !== 'ALL' ||
    audienceFilter !== 'ALL' ||
    creatorFilter !== 'ALL' ||
    searchText !== '' ||
    dateRange.from !== '' ||
    dateRange.to !== '';

  function clearFilters() {
    setActiveTab('ALL');
    setSearch('');
    setSearchText('');
    setDateRange({ from: '', to: '' });
    setChannelFilter('ALL');
    setAudienceFilter('ALL');
    setStatusFilter('ALL');
    setCreatorFilter('ALL');
  }

  async function change(work: () => Promise<string>) {
    try {
      setActionNotice(await work());
    } catch (error) {
      setActionNotice(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
    } finally {
      setDialog(null);
      await client.invalidateQueries({ queryKey: BROADCASTS });
    }
  }

  function act(broadcast: AdminCommBroadcast, action: RowAction) {
    const id = broadcast.id;
    if (action === 'edit') return router.push(stepHref('', id));
    if (action === 'test' || action === 'schedule' || action === 'details')
      return router.push(stepHref('review', id));
    if (action === 'preview' || action === 'recipients' || action === 'error')
      return setDialog({ mode: action, broadcast });
    if (action === 'delete' || action === 'cancel') return setDialog({ mode: action, broadcast });
    if (action === 'duplicate')
      return void change(async () => {
        const copy = await api.adminBroadcasts.broadcasts.duplicate(id);
        return `Duplicated as ${copy.name}.`;
      });
    if (action === 'send')
      return void change(async () => {
        await api.adminBroadcasts.broadcasts.send(id, { idempotencyKey: crypto.randomUUID() });
        return `${broadcast.name} is going out now.`;
      });
    if (action === 'retry')
      return void change(async () => {
        await api.adminBroadcasts.broadcasts.retry(id, { idempotencyKey: crypto.randomUUID() });
        return `Retrying ${broadcast.name}.`;
      });
    if (action === 'archive')
      return void change(async () => {
        await api.adminBroadcasts.broadcasts.archive(id);
        return `${broadcast.name} archived.`;
      });
  }

  const tabs = [
    { id: 'ALL', label: 'All Broadcasts', count: metrics?.total },
    { id: 'DRAFT', label: 'Drafts', count: metrics?.drafts },
    { id: 'SCHEDULED', label: 'Scheduled', count: metrics?.scheduled },
    { id: 'SENT', label: 'Sent', count: metrics?.sent },
    { id: 'FAILED', label: 'Failed', count: metrics?.failed },
  ];

  const columns: Column<AdminCommBroadcast>[] = [
    {
      id: 'broadcast',
      label: 'Broadcast Name',
      cell: (broadcast) => (
        <div className="min-w-32 max-w-52">
          <p className="font-semibold text-heading">{broadcast.name}</p>
          <p className="truncate text-xs text-muted" title={summaryOf(broadcast)}>
            {summaryOf(broadcast)}
          </p>
        </div>
      ),
    },
    {
      id: 'channel',
      label: 'Channel',
      cell: (broadcast) =>
        broadcast.channels.length ? (
          <span className="flex flex-col gap-1">
            {broadcast.channels.map((c) => {
              const Glyph = channelIcon[c.channel];
              return (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap text-text"
                >
                  <Glyph aria-hidden weight="fill" className="size-4 text-action" />
                  {channelLabel[c.channel]}
                </span>
              );
            })}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      id: 'audience',
      label: 'Audience',
      cell: (broadcast) => (
        <span className="block max-w-36 text-text">{broadcast.segment?.name ?? '—'}</span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      cell: (broadcast) => (
        <Badge tone={statusTone[broadcast.status]}>{statusLabel[broadcast.status]}</Badge>
      ),
    },
    {
      id: 'recipients',
      label: 'Recipients',
      cell: (broadcast) => <span className="text-text">{broadcast.recipientCount ?? '—'}</span>,
      sortValue: (broadcast) => broadcast.recipientCount ?? -1,
    },
    // Opens and clicks are not tracked yet (no email events): the columns stay, quietly empty.
    { id: 'open-rate', label: 'Open Rate', cell: () => <span className="text-muted">—</span> },
    { id: 'click-rate', label: 'Click Rate', cell: () => <span className="text-muted">—</span> },
    {
      id: 'date',
      label: 'Scheduled Date',
      cell: (broadcast) => {
        const when = whenOf(broadcast);
        return when ? (
          <span className="whitespace-nowrap text-text">
            {dateLabel(when)}
            <span className="block text-muted">{timeLabel(when)}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
    {
      id: 'creator',
      label: 'Created By',
      cell: (broadcast) => broadcast.createdBy?.name ?? 'System',
    },
  ];

  const summaryCards = [
    { icon: Megaphone, tone: 'blue' as const, key: 'total' as const, label: 'Total Broadcasts' },
    { icon: FileText, tone: 'grey' as const, key: 'drafts' as const, label: 'Drafts' },
    { icon: Clock, tone: 'purple' as const, key: 'scheduled' as const, label: 'Scheduled' },
    { icon: PaperPlaneTilt, tone: 'green' as const, key: 'sent' as const, label: 'Sent' },
    { icon: WarningCircle, tone: 'red' as const, key: 'failed' as const, label: 'Failed' },
  ];
  const shown = dialog?.broadcast;

  return (
    <main className="flex min-w-0 flex-col gap-4 pb-4">
      <PageHeader
        title="Broadcasts"
        subtitle="Send messages to multiple recipients using email or SMS. Reach your audience quickly and efficiently."
        actions={
          <Button
            onClick={() => router.push('/communications/broadcasts/new')}
            className="shrink-0"
          >
            <Plus aria-hidden weight="bold" className="size-4" />
            Create Broadcast
          </Button>
        }
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          <section
            aria-label="Broadcast summary"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 [&>div>span]:rounded-xl xl:[&>div]:gap-2.5 xl:[&>div]:p-3 xl:[&>div>span]:size-10 xl:[&>div>span>svg]:size-5 xl:[&>div>div>span:nth-child(2)]:text-heading"
          >
            {summaryCards.map(({ icon, tone, key, label }) => (
              <KpiCard
                key={key}
                icon={icon}
                tone={tone}
                label={label}
                value={summary.isPending || summary.isError ? '—' : (metrics?.[key] ?? 0)}
                loading={summary.isPending}
              />
            ))}
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-label="Broadcast list">
            <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div className="min-w-0 flex-1 overflow-hidden [&_[role=tablist]]:overflow-y-hidden [&_[role=tablist]]:pb-px">
                <Tabs
                  items={tabs}
                  value={activeTab}
                  onChange={(value) => setActiveTab(value as TabStatus)}
                  label="Broadcast status"
                  variant="underline"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row 2xl:w-[22rem]">
                <SearchField
                  label="Search broadcasts"
                  minWidth="8rem"
                  className="!bg-surface"
                  placeholder="Search broadcasts..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <DateRangeFilter value={dateRange} onChange={setDateRange} />
              </div>
            </div>

            <div className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4">
              <Select
                label="Channel"
                hideLabel
                value={channelFilter}
                onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
                options={[
                  { value: 'ALL', label: 'Channel: All' },
                  { value: 'EMAIL', label: 'Channel: Email' },
                  { value: 'SMS', label: 'Channel: SMS' },
                  { value: 'IN_APP', label: 'Channel: In-App' },
                ]}
                className="text-sm"
              />
              <Select
                label="Audience"
                hideLabel
                value={audienceFilter}
                onChange={(event) => setAudienceFilter(event.target.value)}
                options={[
                  { value: 'ALL', label: 'Audience: All' },
                  ...audiences.map((name) => ({ value: name, label: name })),
                ]}
                className="text-sm"
              />
              <Select
                label="Status"
                hideLabel
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'ALL' | CommBroadcastStatus)
                }
                options={[
                  { value: 'ALL', label: 'Status: All' },
                  ...(Object.keys(statusLabel) as CommBroadcastStatus[]).map((value) => ({
                    value,
                    label: statusLabel[value],
                  })),
                ]}
                className="text-sm"
              />
              <Select
                label="Created By"
                hideLabel
                value={creatorFilter}
                onChange={(event) => setCreatorFilter(event.target.value)}
                options={[
                  { value: 'ALL', label: 'Created By: All' },
                  ...creators.map((name) => ({ value: name, label: name })),
                ]}
                className="text-sm"
              />
            </div>

            {actionNotice ? (
              <div
                role="status"
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-info-soft px-4 py-2 text-sm text-text"
              >
                {actionNotice}
                <IconButton
                  icon={X}
                  label="Dismiss message"
                  onClick={() => setActionNotice('')}
                  className="size-7 border-0 bg-transparent"
                />
              </div>
            ) : null}

            {!loading && (loadError || filteredRows.length === 0) ? (
              <section
                role={loadError ? 'alert' : 'status'}
                aria-labelledby="broadcast-list-state-title"
                className="flex min-h-72 flex-col items-center justify-center rounded-card border border-border bg-surface px-5 py-10 text-center sm:min-h-80 sm:px-8"
              >
                <span
                  className={`mb-4 grid size-14 place-items-center rounded-full ${loadError ? 'bg-danger-soft text-danger' : 'bg-info-soft text-action'}`}
                >
                  {loadError ? (
                    <WarningCircle aria-hidden weight="fill" className="size-7" />
                  ) : anyFilter ? (
                    <MagnifyingGlass aria-hidden weight="bold" className="size-6" />
                  ) : (
                    <Megaphone aria-hidden weight="fill" className="size-7" />
                  )}
                </span>
                <h2 id="broadcast-list-state-title" className="text-lg font-semibold text-heading">
                  {loadError
                    ? 'Broadcasts are unavailable'
                    : anyFilter
                      ? 'No matching broadcasts'
                      : 'No broadcasts yet'}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  {loadError
                    ? 'We could not connect to the Communications service. Check the connection and try again.'
                    : anyFilter
                      ? 'Try changing your search or filters to find the broadcast you need.'
                      : 'Your broadcasts will appear here. Create one to reach firms by email or SMS.'}
                </p>
                <div className="mt-5">
                  {loadError ? (
                    <Button
                      variant="secondary"
                      onClick={() => void client.invalidateQueries({ queryKey: BROADCASTS })}
                    >
                      Try Again
                    </Button>
                  ) : anyFilter ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear Filters
                    </Button>
                  ) : (
                    <Button onClick={() => router.push('/communications/broadcasts/new')}>
                      <Plus aria-hidden weight="bold" className="size-4" />
                      Create Broadcast
                    </Button>
                  )}
                </div>
              </section>
            ) : (
              <div className="min-w-0 overflow-hidden rounded-card border border-border bg-surface p-3 sm:p-4">
                <Table
                  key={`${activeTab}-${channelFilter}-${audienceFilter}-${statusFilter}-${creatorFilter}-${searchText}-${dateRange.from}-${dateRange.to}`}
                  rows={filteredRows}
                  columns={columns}
                  rowKey={(broadcast) => broadcast.id}
                  caption="Broadcasts"
                  dense
                  loading={loading}
                  pageSize={8}
                  noun="broadcasts"
                  selection={{ selected: selectedIds, onChange: setSelectedIds }}
                  rowActions={(broadcast) => (
                    <BroadcastRowActions
                      broadcast={broadcast}
                      onAction={(action) => act(broadcast, action)}
                    />
                  )}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'recipients'
            ? 'Recipients'
            : dialog?.mode === 'error'
              ? 'Why it failed'
              : dialog?.mode === 'delete'
                ? 'Delete draft?'
                : dialog?.mode === 'cancel'
                  ? 'Cancel scheduled broadcast?'
                  : 'Preview'
        }
        subtitle={shown?.name}
        footer={
          dialog?.mode === 'delete' || dialog?.mode === 'cancel' ? (
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Keep it
              </Button>
              <Button
                onClick={() => {
                  if (!shown) return;
                  const mode = dialog.mode;
                  void change(async () => {
                    if (mode === 'delete') await api.adminBroadcasts.broadcasts.remove(shown.id);
                    else await api.adminBroadcasts.broadcasts.cancel(shown.id);
                    return mode === 'delete'
                      ? `${shown.name} deleted.`
                      : `${shown.name} cancelled.`;
                  });
                }}
              >
                {dialog.mode === 'delete' ? 'Delete' : 'Cancel broadcast'}
              </Button>
            </>
          ) : undefined
        }
      >
        {dialog?.mode === 'recipients' && shown ? <RecipientsList broadcastId={shown.id} /> : null}
        {dialog?.mode === 'error' ? (
          <p className="text-sm text-text">
            {shown?.errorMessage ?? 'The provider gave no reason. Retry to send it again.'}
          </p>
        ) : null}
        {dialog?.mode === 'delete' ? (
          <p className="text-sm text-muted">The draft and its content are removed for good.</p>
        ) : null}
        {dialog?.mode === 'cancel' ? (
          <p className="text-sm text-muted">It will not go out. You can duplicate it later.</p>
        ) : null}
        {dialog?.mode === 'preview' ? (
          shown?.channels.length ? (
            <div className="space-y-3 text-sm">
              {shown.channels.map((c) => (
                <section key={c.id} className="rounded-control border border-divider p-3">
                  <h3 className="mb-1 font-semibold text-heading">{channelLabel[c.channel]}</h3>
                  {c.subject ? <p className="mb-1 font-medium text-heading">{c.subject}</p> : null}
                  <p className="whitespace-pre-wrap text-text">{c.body}</p>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No message yet: write it in step 3.</p>
          )
        ) : null}
      </Modal>
    </main>
  );
}
