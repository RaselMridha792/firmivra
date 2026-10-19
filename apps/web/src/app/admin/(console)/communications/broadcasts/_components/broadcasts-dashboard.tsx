'use client';

import {
  Badge,
  Button,
  Card,
  IconButton,
  Input,
  KpiCard,
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
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  getAdminBroadcastDashboard,
  type AdminBroadcastChannel,
  type AdminBroadcastDashboardFixture,
  type AdminBroadcastFixture,
  type AdminBroadcastStatus,
} from '../../../../../../mocks/admin-communications-broadcasts';

type BroadcastTab = 'ALL' | AdminBroadcastStatus;
type ChannelFilter = 'ALL' | AdminBroadcastChannel;
type DateRange = { from: string; to: string };

const statusLabel: Record<AdminBroadcastStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  SENT: 'Sent',
  FAILED: 'Failed',
};

const statusTone: Record<AdminBroadcastStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  SENT: 'success',
  FAILED: 'danger',
};

const actionLabels: Record<AdminBroadcastStatus, { label: string; danger?: boolean }[]> = {
  SENT: [
    { label: 'View details / performance' },
    { label: 'Preview' },
    { label: 'Duplicate' },
    { label: 'View recipients' },
    { label: 'Export' },
    { label: 'Archive' },
  ],
  DRAFT: [
    { label: 'Edit' },
    { label: 'Preview' },
    { label: 'Duplicate' },
    { label: 'Send test' },
    { label: 'Schedule' },
    { label: 'Delete', danger: true },
  ],
  SCHEDULED: [
    { label: 'Edit' },
    { label: 'Reschedule' },
    { label: 'Send now' },
    { label: 'Duplicate' },
    { label: 'Cancel', danger: true },
  ],
  FAILED: [
    { label: 'View error' },
    { label: 'Retry' },
    { label: 'Duplicate' },
    { label: 'Archive' },
  ],
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

function CreateBroadcastPanel({ onNext }: { onNext: () => void }) {
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<AdminBroadcastChannel>('EMAIL');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a broadcast name to continue.');
      return;
    }
    setError('');
    onNext();
  }

  return (
    <Card variant="outlined" className="min-w-0 p-4 sm:p-5">
      <h2 className="mb-3 font-display text-lg font-bold text-heading">Create New Broadcast</h2>
      <BroadcastSteps />

      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
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
            { value: 'sales', label: 'Sales' },
            { value: 'onboarding', label: 'Onboarding' },
            { value: 'support', label: 'Support' },
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
          <Button type="submit">
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
  broadcast: AdminBroadcastFixture;
  onAction: (message: string) => void;
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
          {actionLabels[broadcast.status].map(({ label, danger }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                onAction(`${label} is preview-only until the Communications API is available.`);
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

export function BroadcastsDashboard() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<AdminBroadcastDashboardFixture | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<BroadcastTab>('ALL');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('ALL');
  const [audienceFilter, setAudienceFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AdminBroadcastStatus>('ALL');
  const [creatorFilter, setCreatorFilter] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState('');

  useEffect(() => {
    let current = true;
    void getAdminBroadcastDashboard()
      .then((value) => {
        if (!current) return;
        setDashboard(value);
        setLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setDashboard(null);
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reloadKey]);

  const broadcasts = useMemo(() => dashboard?.broadcasts ?? [], [dashboard]);
  const metrics = dashboard?.metrics;
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return broadcasts.filter((broadcast) => {
      if (activeTab !== 'ALL' && broadcast.status !== activeTab) return false;
      if (statusFilter !== 'ALL' && broadcast.status !== statusFilter) return false;
      if (channelFilter !== 'ALL' && broadcast.channel !== channelFilter) return false;
      if (audienceFilter !== 'ALL' && broadcast.audience !== audienceFilter) return false;
      if (creatorFilter !== 'ALL' && broadcast.createdBy !== creatorFilter) return false;
      if (dateRange.from && (!broadcast.date || broadcast.date < dateRange.from)) return false;
      if (dateRange.to && (!broadcast.date || broadcast.date > dateRange.to)) return false;
      if (
        query &&
        !`${broadcast.name} ${broadcast.description} ${broadcast.audience} ${broadcast.createdBy}`
          .toLocaleLowerCase()
          .includes(query)
      )
        return false;
      return true;
    });
  }, [
    activeTab,
    audienceFilter,
    broadcasts,
    channelFilter,
    creatorFilter,
    dateRange,
    search,
    statusFilter,
  ]);

  function clearFilters() {
    setActiveTab('ALL');
    setSearch('');
    setDateRange({ from: '', to: '' });
    setChannelFilter('ALL');
    setAudienceFilter('ALL');
    setStatusFilter('ALL');
    setCreatorFilter('ALL');
  }

  const tabs = [
    { id: 'ALL', label: 'All Broadcasts', count: metrics?.total },
    { id: 'DRAFT', label: 'Drafts', count: metrics?.drafts },
    { id: 'SCHEDULED', label: 'Scheduled', count: metrics?.scheduled },
    { id: 'SENT', label: 'Sent', count: metrics?.sent },
    { id: 'FAILED', label: 'Failed', count: metrics?.failed },
  ];

  const columns: Column<AdminBroadcastFixture>[] = [
    {
      id: 'broadcast',
      label: 'Broadcast Name',
      cell: (broadcast) => (
        <div className="min-w-32 max-w-52">
          <p className="font-semibold text-heading">{broadcast.name}</p>
          <p className="truncate text-xs text-muted" title={broadcast.description}>
            {broadcast.description}
          </p>
        </div>
      ),
    },
    {
      id: 'channel',
      label: 'Channel',
      cell: (broadcast) => {
        const Glyph = broadcast.channel === 'EMAIL' ? EnvelopeSimple : ChatCircleDots;
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-text">
            <Glyph aria-hidden weight="fill" className="size-4 text-action" />
            {broadcast.channel === 'EMAIL' ? 'Email' : 'SMS'}
          </span>
        );
      },
    },
    {
      id: 'audience',
      label: 'Audience',
      cell: (broadcast) => <span className="block max-w-36 text-text">{broadcast.audience}</span>,
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
      cell: (broadcast) => <span className="text-text">{broadcast.recipients}</span>,
      sortValue: (broadcast) => broadcast.recipients,
    },
    { id: 'open-rate', label: 'Open Rate', cell: (broadcast) => broadcast.openRate },
    { id: 'click-rate', label: 'Click Rate', cell: (broadcast) => broadcast.clickRate },
    {
      id: 'date',
      label: 'Scheduled Date',
      cell: (broadcast) => (
        <span className="whitespace-nowrap text-text">
          {broadcast.dateLabel}
          {broadcast.timeLabel ? (
            <span className="block text-muted">{broadcast.timeLabel}</span>
          ) : null}
        </span>
      ),
    },
    { id: 'creator', label: 'Created By', cell: (broadcast) => broadcast.createdBy },
  ];

  const summaryCards = [
    { icon: Megaphone, tone: 'blue' as const, key: 'total' as const, label: 'Total Broadcasts' },
    { icon: FileText, tone: 'grey' as const, key: 'drafts' as const, label: 'Drafts' },
    { icon: Clock, tone: 'purple' as const, key: 'scheduled' as const, label: 'Scheduled' },
    { icon: PaperPlaneTilt, tone: 'green' as const, key: 'sent' as const, label: 'Sent' },
    { icon: WarningCircle, tone: 'red' as const, key: 'failed' as const, label: 'Failed' },
  ];

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
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"
          >
            {summaryCards.map(({ icon, tone, key, label }) => (
              <KpiCard
                key={key}
                icon={icon}
                tone={tone}
                label={label}
                value={loading || loadError ? '—' : (metrics?.[key] ?? 0)}
                loading={loading}
              />
            ))}
          </section>

          <section className="flex min-w-0 flex-col gap-3" aria-label="Broadcast list">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1 overflow-hidden [&_[role=tablist]]:overflow-y-hidden [&_[role=tablist]]:pb-px">
                <Tabs
                  items={tabs}
                  value={activeTab}
                  onChange={(value) => setActiveTab(value as BroadcastTab)}
                  label="Broadcast status"
                  variant="underline"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:w-[22rem]">
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
                  { value: 'All Firms', label: 'All Firms' },
                  { value: 'Firms with Pending Docs', label: 'Pending Docs' },
                  { value: 'Firms in Progress Apps', label: 'In Progress Apps' },
                  { value: 'New Firms (last 30 days)', label: 'New Firms' },
                  { value: 'Past Due Accounts', label: 'Past Due Accounts' },
                  { value: 'Trial Firms', label: 'Trial Firms' },
                ]}
                className="text-sm"
              />
              <Select
                label="Status"
                hideLabel
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'ALL' | AdminBroadcastStatus)
                }
                options={[
                  { value: 'ALL', label: 'Status: All' },
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'SCHEDULED', label: 'Scheduled' },
                  { value: 'SENT', label: 'Sent' },
                  { value: 'FAILED', label: 'Failed' },
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
                  { value: 'Octavia Holder', label: 'Octavia Holder' },
                  { value: 'Team Member', label: 'Team Member' },
                  { value: 'System', label: 'System' },
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
                  ) : broadcasts.length ? (
                    <MagnifyingGlass aria-hidden weight="bold" className="size-6" />
                  ) : (
                    <Megaphone aria-hidden weight="fill" className="size-7" />
                  )}
                </span>
                <h2 id="broadcast-list-state-title" className="text-lg font-semibold text-heading">
                  {loadError
                    ? 'Broadcasts are unavailable'
                    : broadcasts.length
                      ? 'No matching broadcasts'
                      : 'No broadcasts yet'}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted">
                  {loadError
                    ? 'We could not connect to the Communications service. Check the connection and try again.'
                    : broadcasts.length
                      ? 'Try changing your search or filters to find the broadcast you need.'
                      : 'Your broadcasts will appear here. Create one to reach firms by email or SMS.'}
                </p>
                <div className="mt-5">
                  {loadError ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setLoading(true);
                        setLoadError(false);
                        setReloadKey((current) => current + 1);
                      }}
                    >
                      Try Again
                    </Button>
                  ) : broadcasts.length ? (
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
                  key={`${activeTab}-${channelFilter}-${audienceFilter}-${statusFilter}-${creatorFilter}-${search}-${dateRange.from}-${dateRange.to}`}
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
                    <BroadcastRowActions broadcast={broadcast} onAction={setActionNotice} />
                  )}
                />
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <CreateBroadcastPanel onNext={() => router.push('/communications/broadcasts/new')} />
        </aside>
      </div>
    </main>
  );
}
