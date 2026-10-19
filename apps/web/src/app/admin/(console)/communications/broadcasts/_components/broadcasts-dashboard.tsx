'use client';

import {
  Badge,
  Button,
  Card,
  IconButton,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  SearchField,
  Select,
  Table,
  Tabs,
  Textarea,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  Bell,
  CalendarBlank,
  ChatCircleDots,
  Clock,
  DotsThreeVertical,
  EnvelopeSimple,
  FileText,
  Lightbulb,
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
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  saveBroadcastDraft,
  initialBroadcastDraft,
  stepHref,
} from '../new/_components/broadcast-draft';

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

function BroadcastSteps() {
  const steps = ['Basic Information', 'Audience', 'Message', 'Review & Send'];
  return (
    <ol
      aria-label="Broadcast creation steps"
      className="relative flex flex-col gap-1 before:absolute before:top-5 before:bottom-5 before:left-4 before:w-px before:bg-border"
    >
      {steps.map((step, index) => {
        const current = index === 0;
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            className={`relative flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm ${current ? 'bg-info-soft font-semibold text-action' : 'text-muted'}`}
          >
            <span
              className={`z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${current ? 'bg-action text-on-action' : 'border border-border bg-surface text-text'}`}
            >
              {index + 1}
            </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}

/** Step 1 in the side panel: the draft is made here, then the wizard continues at Audience. */
function CreateBroadcastPanel() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<'EMAIL' | 'SMS'>('EMAIL');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const categories = useApiQuery(['admin-communications', 'categories'], () =>
    api.adminCommunications.categories.list(),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a broadcast name to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.adminBroadcasts.broadcasts.create({ name: name.trim() });
      saveBroadcastDraft(
        { ...initialBroadcastDraft, name: name.trim(), description, category, channels: [channel] },
        created.id,
      );
      router.push(stepHref('audience', created.id));
    } catch (e) {
      setError(errorMessage(e, ADMIN_COMM_BROADCAST_ERRORS));
      setBusy(false);
    }
  }

  return (
    <Card variant="outlined" className="min-w-0 p-4 sm:p-5">
      <h2 className="mb-3 font-display text-lg font-bold text-heading">Create New Broadcast</h2>
      <BroadcastSteps />

      <form onSubmit={(event) => void submit(event)} className="mt-4 flex flex-col gap-4">
        <Input
          label="Broadcast Name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Monthly Newsletter"
          error={error}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">
            Channel <span className="text-danger">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(['EMAIL', 'SMS'] as const).map((item) => {
              const active = channel === item;
              const Glyph = item === 'EMAIL' ? EnvelopeSimple : ChatCircleDots;
              return (
                <Button
                  key={item}
                  type="button"
                  variant={active ? 'outline' : 'secondary'}
                  aria-pressed={active}
                  onClick={() => setChannel(item)}
                  className={`min-w-0 px-2 ${active ? 'bg-info-soft' : ''}`}
                >
                  <Glyph aria-hidden weight="fill" className="size-4 shrink-0" />
                  {item === 'EMAIL' ? 'Email' : 'SMS'}
                </Button>
              );
            })}
          </div>
        </fieldset>

        <Select
          label="Category (Optional)"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={[
            { value: '', label: 'Select a category' },
            ...(categories.data?.items ?? [])
              .filter((c) => c.isActive)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
          className="text-sm"
        />

        <Textarea
          label="Description (Optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Brief description of this broadcast..."
          rows={3}
          className="text-sm"
        />

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setName('');
              setCategory('');
              setDescription('');
              setError('');
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Next <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Button>
        </div>
      </form>

      <section className="mt-4 rounded-xl bg-info-soft p-4" aria-labelledby="broadcast-tips-title">
        <h3
          id="broadcast-tips-title"
          className="mb-2 flex items-center gap-2 text-sm font-semibold text-heading"
        >
          <Lightbulb aria-hidden weight="fill" className="size-4 text-action" />
          Tips for Broadcasts
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text">
          <li>Use a clear and concise subject line</li>
          <li>Segment your audience for better results</li>
          <li>Consider sending a test first</li>
          <li>Review and confirm before sending</li>
          <li>Track performance after sending</li>
        </ul>
      </section>
    </Card>
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

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(18rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <section
            aria-label="Broadcast summary"
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:[&>div]:gap-2.5 xl:[&>div]:p-3 xl:[&>div>span]:size-10 xl:[&>div>span>svg]:size-5"
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

        <aside className="min-w-0 xl:sticky xl:top-4">
          <CreateBroadcastPanel />
        </aside>
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
