'use client';

import type {
  PayrollClientRow,
  PayrollClientsQuery,
  PayrollClientTab,
  PayrollOverviewPeriod,
} from '@firmivra/types';
import {
  BulkBar,
  Button,
  type Column,
  Input,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
} from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowsClockwise,
  Calendar,
  ChartBar,
  CurrencyDollar,
  DotsThreeVertical,
  FileText,
  Funnel,
  Gear,
  MagnifyingGlass,
  Plus,
  Plugs,
  UserSwitch,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ClientActionMenu } from './client-actions';
import {
  ByProviderCard,
  ProvidersCard,
  ResourcesCard,
  StatusCard,
  UpcomingCard,
  VolumeCard,
} from './payroll-widgets';
import {
  ClientStatusPill,
  FREQUENCY_LABEL,
  FREQUENCY_OPTIONS,
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  PROVIDER_OPTIONS,
  Selectbox,
  card,
  dayText,
  daysUntil,
  moneyShort,
  outlined,
  quiet,
} from './payroll-shared';

const TABS: { id: PayrollClientTab; label: string }[] = [
  { id: 'ALL', label: 'All Clients' },
  { id: 'ON_TRACK', label: 'On Track' },
  { id: 'PROCESSING', label: 'Processing' },
  { id: 'ACTION_REQUIRED', label: 'Action Required' },
  { id: 'PAST_DUE', label: 'Past Due' },
  { id: 'NOT_STARTED', label: 'Not Started' },
  { id: 'UPCOMING', label: 'Upcoming Payroll Runs' },
];
const PERIODS: { value: PayrollOverviewPeriod; label: string }[] = [
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'LAST_MONTH', label: 'Last Month' },
  { value: 'THIS_QUARTER', label: 'This Quarter' },
  { value: 'THIS_YEAR', label: 'This Year' },
];
const BLANK = {
  clientType: '',
  providerKey: '',
  frequency: '',
  status: '',
  assignedUserId: '',
  syncStatus: '',
};

/** /payroll: the overview. KPI cards, charts, the client table with its seven views, and the side widgets. */
export function PayrollScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<PayrollOverviewPeriod>('THIS_MONTH');
  const [tab, setTab] = useState<PayrollClientTab>('ALL');
  const [filters, setFilters] = useState(BLANK);
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Pick<PayrollClientsQuery, 'sort' | 'direction'>>({
    sort: 'clientName',
    direction: 'asc',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    'settings' | 'add' | 'connect' | 'reports' | 'assign' | undefined
  >();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });

  const overview = useApiQuery([...PAYROLL_KEY, 'overview', period], () =>
    api.payroll.overview({ period }),
  );
  const query: PayrollClientsQuery = {
    tab,
    ...(filters.clientType ? { clientType: filters.clientType as 'BUSINESS' } : {}),
    ...(filters.providerKey ? { providerKey: filters.providerKey } : {}),
    ...(filters.frequency ? { frequency: filters.frequency as 'WEEKLY' } : {}),
    ...(filters.status ? { status: filters.status as 'ON_TRACK' } : {}),
    ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
    ...(filters.syncStatus ? { syncStatus: filters.syncStatus as 'SYNCED' } : {}),
    ...(term ? { search: term } : {}),
    ...sort,
    page,
    pageSize: 10,
  };
  const list = useApiQuery([...PAYROLL_KEY, 'clients', query], () => api.payroll.clients(query));
  const team = useApiQuery([...PAYROLL_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const k = overview.data?.kpis;
  const rows = list.data?.items ?? [];
  const set = (change: Partial<typeof BLANK>) => {
    setFilters({ ...filters, ...change });
    setPage(1);
  };
  const choose = (next: PayrollClientTab) => {
    setTab(next);
    setPage(1);
    setSelected([]);
  };
  const sync = useApiMutation(
    async (ids: string[]) => {
      for (const id of ids) await api.payroll.sync(id);
      return ids.length;
    },
    { invalidate: [...PAYROLL_KEY] },
  );

  const kpi = (
    id: string,
    icon: typeof UsersThree,
    tone: 'blue' | 'amber' | 'green' | 'purple' | 'red',
    label: string,
    value: string | number | undefined,
    change: number | null | undefined,
    goodWhenDown = false,
  ) => (
    <li key={id} data-testid={`kpi-${id}`}>
      <KpiCard
        icon={icon}
        tone={tone}
        value={value ?? '–'}
        label={label}
        loading={overview.isPending}
        {...(change !== null && change !== undefined
          ? {
              trend: {
                text: `${Math.abs(change)}%`,
                direction:
                  change > 0 ? ('up' as const) : change < 0 ? ('down' as const) : ('flat' as const),
                good: goodWhenDown ? change <= 0 : change >= 0,
              },
              note: 'vs last period',
            }
          : {})}
      />
    </li>
  );

  const columns: Column<PayrollClientRow>[] = [
    {
      id: 'clientName',
      label: 'Client Name',
      sortable: true,
      cell: (r) => (
        <Link
          href={`/payroll/clients/${r.id}`}
          data-testid="client-link"
          className="font-semibold text-link hover:underline"
        >
          {r.client.displayName}
        </Link>
      ),
    },
    {
      id: 'provider',
      label: 'Payroll Provider',
      sortable: true,
      cell: (r) => r.provider?.label ?? 'Not Connected',
    },
    {
      id: 'frequency',
      label: 'Frequency',
      sortable: true,
      cell: (r) => (r.frequency ? FREQUENCY_LABEL[r.frequency] : '—'),
    },
    {
      id: 'employees',
      label: 'Employees',
      sortable: true,
      cell: (r) => (r.employeeCount === null ? '—' : r.employeeCount),
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (r) => <ClientStatusPill status={r.status} />,
    },
    {
      id: 'nextPayrollOn',
      label: 'Next Payroll Date',
      sortable: true,
      cell: (r) =>
        r.nextPayrollOn ? (
          <span
            className={`whitespace-nowrap ${daysUntil(r.nextPayrollOn) <= 3 ? 'font-semibold text-danger' : ''}`}
          >
            {dayText(r.nextPayrollOn)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'lastRunOn',
      label: 'Last Run',
      sortable: true,
      cell: (r) => (r.lastRunOn ? dayText(r.lastRunOn) : '—'),
    },
  ];
  const sortState = { id: query.sort ?? 'clientName', descending: query.direction === 'desc' };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="payroll-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/" aria-label="Home" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/" className="text-link">
          Home
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Payroll</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <Calendar aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Payroll</h1>
            <p className="text-base text-muted">
              Manage client payroll, stay compliant, and keep teams paid on time.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={outlined} onClick={() => setDialog('connect')}>
            <Plugs aria-hidden weight="fill" className="size-4" /> Connect Payroll Provider
          </button>
          <button type="button" className={outlined} onClick={() => setDialog('reports')}>
            <ChartBar aria-hidden weight="fill" className="size-4" /> View Reports
          </button>
          <Link href="/modules/document-requests" className={outlined}>
            <FileText aria-hidden weight="fill" className="size-4" /> Request Documents
          </Link>
          <button type="button" className={outlined} onClick={() => setDialog('settings')}>
            <Gear aria-hidden weight="fill" className="size-4" /> Payroll Settings
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="w-44">
          <Select
            label="Period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PayrollOverviewPeriod)}
            options={PERIODS}
          />
        </div>
      </div>
      <ul
        data-testid="payroll-kpis"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5"
      >
        {kpi(
          'clients',
          UsersThree,
          'blue',
          'Active Payroll Clients',
          k?.activeClients.value,
          k?.activeClients.changePercent,
        )}
        {kpi(
          'processed',
          CurrencyDollar,
          'amber',
          'Total Payroll Processed',
          k ? moneyShort(k.totalProcessedCents.value) : undefined,
          k?.totalProcessedCents.changePercent,
        )}
        {kpi(
          'employees',
          FileText,
          'amber',
          'Total Employees',
          k?.totalEmployees.value,
          k?.totalEmployees.changePercent,
        )}
        {kpi('runs', Calendar, 'blue', 'Payroll Runs', k?.runs.value, k?.runs.changePercent)}
        {kpi(
          'attention',
          Warning,
          'red',
          'Items Need Attention',
          k?.needAttention.value,
          k?.needAttention.changePercent,
          true,
        )}
      </ul>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatusCard
              data={overview.data}
              loading={overview.isPending}
              failed={overview.isError}
            />
            <VolumeCard
              data={overview.data}
              loading={overview.isPending}
              failed={overview.isError}
            />
            <ByProviderCard
              data={overview.data}
              loading={overview.isPending}
              failed={overview.isError}
            />
            <ProvidersCard
              data={overview.data}
              loading={overview.isPending}
              failed={overview.isError}
              onConnect={() => setDialog('connect')}
            />
          </div>
          <nav
            aria-label="Payroll views"
            role="tablist"
            className="flex overflow-x-auto border-b border-divider"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => choose(t.id)}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
              >
                {t.label}
                {list.data && tab === t.id ? (
                  <span className="sr-only"> ({list.data.tabCounts[t.id]})</span>
                ) : null}
              </button>
            ))}
          </nav>
          <section className={card} aria-label="Payroll clients">
            <form
              aria-label="Payroll filters"
              className="mb-3 flex flex-col gap-3"
              onSubmit={(e) => e.preventDefault()}
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-36">
                  <Select
                    label="Client Type"
                    value={filters.clientType}
                    onChange={(e) => set({ clientType: e.target.value })}
                    options={[
                      { value: '', label: 'All Types' },
                      { value: 'BUSINESS', label: 'Business' },
                      { value: 'INDIVIDUAL', label: 'Individual' },
                    ]}
                  />
                </div>
                <div className="w-44">
                  <Select
                    label="Payroll Provider"
                    value={filters.providerKey}
                    onChange={(e) => set({ providerKey: e.target.value })}
                    options={[{ value: '', label: 'All Providers' }, ...PROVIDER_OPTIONS]}
                  />
                </div>
                <div className="w-44">
                  <Select
                    label="Payroll Frequency"
                    value={filters.frequency}
                    onChange={(e) => set({ frequency: e.target.value })}
                    options={[{ value: '', label: 'All Frequencies' }, ...FREQUENCY_OPTIONS]}
                  />
                </div>
                <div className="w-40">
                  <Select
                    label="Status"
                    value={filters.status}
                    onChange={(e) => set({ status: e.target.value })}
                    options={[
                      { value: '', label: 'All Statuses' },
                      { value: 'ON_TRACK', label: 'On Track' },
                      { value: 'PROCESSING', label: 'Processing' },
                      { value: 'ACTION_REQUIRED', label: 'Action Required' },
                      { value: 'PAST_DUE', label: 'Past Due' },
                      { value: 'NOT_STARTED', label: 'Not Started' },
                      { value: 'ON_HOLD', label: 'On Hold' },
                    ]}
                  />
                </div>
                <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
                  <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
                  <span className="sr-only">Search clients</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search clients, business name, or EIN..."
                    className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
                  />
                </label>
                <button
                  type="button"
                  aria-expanded={more}
                  onClick={() => setMore(!more)}
                  className={outlined}
                >
                  <Funnel aria-hidden weight="fill" className="size-4" /> Filters
                </button>
                <button
                  type="button"
                  className="text-sm font-medium text-link"
                  onClick={() => {
                    setFilters(BLANK);
                    setSearch('');
                    setPage(1);
                  }}
                >
                  Clear
                </button>
              </div>
              {more ? (
                <div className="flex flex-wrap items-end gap-3" data-testid="more-filters">
                  <div className="w-48">
                    <Select
                      label="Assigned Staff"
                      value={filters.assignedUserId}
                      onChange={(e) => set({ assignedUserId: e.target.value })}
                      options={[
                        { value: '', label: 'All Staff' },
                        ...members.map((m) => ({ value: m.user.id, label: m.user.name })),
                      ]}
                    />
                  </div>
                  <div className="w-48">
                    <Select
                      label="Sync Status"
                      value={filters.syncStatus}
                      onChange={(e) => set({ syncStatus: e.target.value })}
                      options={[
                        { value: '', label: 'All Sync States' },
                        { value: 'SYNCED', label: 'Synced' },
                        { value: 'STALE', label: 'Stale' },
                        { value: 'NEVER', label: 'Never synced' },
                        { value: 'NOT_CONNECTED', label: 'Not connected' },
                      ]}
                    />
                  </div>
                </div>
              ) : null}
            </form>
            {selected.length > 0 ? (
              <div className="mb-3">
                <BulkBar
                  count={selected.length}
                  noun="clients"
                  actions={[
                    { label: 'Assign Staff', icon: UserSwitch, onClick: () => setDialog('assign') },
                    {
                      label: 'Sync Now',
                      icon: ArrowsClockwise,
                      onClick: () =>
                        sync.mutate(selected, {
                          onSuccess: (n) => {
                            setSelected([]);
                            notice(`Sync queued for ${n} client(s).`, 'success');
                          },
                          onError: (e) => notice(errorMessage(e, PAYROLL_ERRORS), 'error'),
                        }),
                    },
                  ]}
                />
              </div>
            ) : null}
            <div data-testid="client-table" className="relative">
              <Table
                rows={rows}
                columns={columns}
                rowKey={(r) => r.id}
                caption={TABS.find((t) => t.id === tab)?.label ?? 'Payroll clients'}
                dense
                noun="clients"
                pageSize={10}
                loading={list.isPending}
                emptyTitle={
                  list.isError ? 'Payroll clients are not available' : 'No payroll clients'
                }
                emptyText={
                  list.isError
                    ? 'We could not load the payroll clients. Try again in a moment.'
                    : 'Add a client with a payroll service to get started.'
                }
                emptyAction={
                  <button
                    type="button"
                    onClick={() => setDialog('add')}
                    className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action"
                  >
                    Add Payroll Client
                  </button>
                }
                selection={{ selected, onChange: setSelected }}
                rowActions={(r) => (
                  <ClientActionMenu
                    client={r}
                    label={`Actions for ${r.client.displayName}`}
                    onNotice={notice}
                    trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                  />
                )}
                server={{
                  page: list.data?.page ?? 1,
                  total: list.data?.total ?? 0,
                  hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
                  hasPrevious: (list.data?.page ?? 1) > 1,
                  onNext: () => setPage(page + 1),
                  onPrevious: () => setPage(Math.max(1, page - 1)),
                  onPage: (next: number) => setPage(next),
                  sort: sortState,
                  onSort: (next: { id: string; descending: boolean }) => {
                    setSort({
                      sort: next.id as PayrollClientsQuery['sort'],
                      direction: next.descending ? 'desc' : 'asc',
                    });
                    setPage(1);
                  },
                }}
              />
            </div>
            <p className="mt-3 text-sm">
              <button
                type="button"
                className="font-medium text-link"
                onClick={() => setDialog('add')}
              >
                <Plus aria-hidden weight="bold" className="mr-1 inline size-4" />
                Add Payroll Client
              </button>
            </p>
          </section>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <UpcomingCard
            data={overview.data}
            loading={overview.isPending}
            failed={overview.isError}
            onAll={() => choose('UPCOMING')}
          />
          <ResourcesCard />
        </div>
      </div>
      {dialog === 'settings' ? (
        <SettingsDialog
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Settings saved.', 'success');
          }}
        />
      ) : null}
      {dialog === 'add' ? (
        <AddClientDialog
          onClose={() => setDialog(undefined)}
          onDone={(id) => {
            setDialog(undefined);
            router.push(`/payroll/clients/${id}`);
          }}
        />
      ) : null}
      {dialog === 'connect' || dialog === 'reports' ? (
        <PickClientDialog
          mode={dialog}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined);
            notice(text, 'success');
          }}
        />
      ) : null}
      {dialog === 'assign' ? (
        <BulkAssignDialog
          ids={selected}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined);
            setSelected([]);
            notice(text, 'success');
          }}
        />
      ) : null}
    </div>
  );
}

function SettingsDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const settings = useApiQuery([...PAYROLL_KEY, 'settings'], () => api.payroll.settings());
  const team = useApiQuery([...PAYROLL_KEY, 'members'], () => api.team.list());
  if (!settings.data) {
    return (
      <Modal
        open
        title="Payroll Settings"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className={quiet}>
          {settings.isError ? 'Settings are not available right now.' : 'Loading…'}
        </p>
      </Modal>
    );
  }
  return (
    <SettingsForm
      initial={{
        assignee: settings.data.defaultAssignee?.userId ?? '',
        days: String(settings.data.reminderDaysBefore),
        hours: String(settings.data.staleAfterHours),
      }}
      members={(team.data ?? [])
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({ value: m.user.id, label: m.user.name }))}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function SettingsForm({
  initial,
  members,
  onClose,
  onDone,
}: {
  initial: { assignee: string; days: string; hours: string };
  members: { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState(initial);
  const save = useApiMutation(
    () =>
      api.payroll.saveSettings({
        defaultAssigneeId: f.assignee || null,
        reminderDaysBefore: Number(f.days),
        staleAfterHours: Number(f.hours),
      }),
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title="Payroll Settings"
      subtitle="Defaults for the whole firm. Provider sign-in stays under Integrations."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onDone })}
          >
            Save Settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="settings-form">
        <Select
          label="Default payroll staff"
          value={f.assignee}
          onChange={(e) => setF({ ...f, assignee: e.target.value })}
          options={[{ value: '', label: 'No default' }, ...members]}
        />
        <Input
          label="Remind this many days before a pay date"
          type="number"
          min={0}
          max={30}
          value={f.days}
          onChange={(e) => setF({ ...f, days: e.target.value })}
        />
        <Input
          label="Warn when a sync is older than (hours)"
          type="number"
          min={1}
          max={720}
          value={f.hours}
          onChange={(e) => setF({ ...f, hours: e.target.value })}
        />
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function AddClientDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const clients = useApiQuery([...PAYROLL_KEY, 'all-clients'], () =>
    api.clients.list({ limit: 100 }),
  );
  const [clientId, setClientId] = useState('');
  const [frequency, setFrequency] = useState('');
  const [provider, setProvider] = useState('');
  const [industry, setIndustry] = useState('');
  const send = useApiMutation(
    () =>
      api.payroll.addClient({
        clientId,
        ...(frequency ? { frequency: frequency as 'MONTHLY' } : {}),
        ...(provider ? { providerKey: provider } : {}),
        ...(industry.trim() ? { industry: industry.trim() } : {}),
      }),
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title="Add Payroll Client"
      subtitle="The client needs a payroll service."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: (r) => onDone(r.id) })}
          >
            Add Client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-client-form">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            { value: '', label: 'Select client' },
            ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
        <Select
          label="Payroll frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          options={[{ value: '', label: 'Not set' }, ...FREQUENCY_OPTIONS]}
        />
        <Select
          label="Payroll provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          options={[{ value: '', label: 'Not connected' }, ...PROVIDER_OPTIONS]}
        />
        <Input
          label="Industry"
          value={industry}
          maxLength={100}
          onChange={(e) => setIndustry(e.target.value)}
        />
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Connect Payroll Provider (pick the client and the provider) and View Reports (pick the client). */
function PickClientDialog({
  mode,
  onClose,
  onDone,
}: {
  mode: 'connect' | 'reports';
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const router = useRouter();
  const list = useApiQuery([...PAYROLL_KEY, 'pick'], () => api.payroll.clients({ pageSize: 100 }));
  const [clientId, setClientId] = useState('');
  const [provider, setProvider] = useState('gusto');
  const send = useApiMutation(() => api.payroll.updateClient(clientId, { providerKey: provider }), {
    invalidate: [...PAYROLL_KEY],
  });
  return (
    <Modal
      open
      title={mode === 'connect' ? 'Connect Payroll Provider' : 'View Reports'}
      subtitle={
        mode === 'connect'
          ? 'Providers are connected one client at a time.'
          : 'Reports are kept for each payroll client.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || send.isPending}
            onClick={() =>
              mode === 'reports'
                ? router.push(`/payroll/clients/${clientId}?tab=reports`)
                : send.mutate(undefined, { onSuccess: () => onDone('Provider connected.') })
            }
          >
            {mode === 'connect' ? 'Connect' : 'Open Reports'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Selectbox
          label="Payroll client"
          value={clientId}
          onChange={setClientId}
          options={[
            { value: '', label: 'Select client' },
            ...(list.data?.items ?? []).map((c) => ({ value: c.id, label: c.client.displayName })),
          ]}
        />
        {mode === 'connect' ? (
          <>
            <Selectbox
              label="Payroll provider"
              value={provider}
              onChange={setProvider}
              options={PROVIDER_OPTIONS}
            />
            <p className="text-xs text-muted">
              Sign-in to the provider happens in the provider’s own authorization page, never in a
              form here.
            </p>
          </>
        ) : null}
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function BulkAssignDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const team = useApiQuery([...PAYROLL_KEY, 'members'], () => api.team.list());
  const [who, setWho] = useState('');
  const send = useApiMutation(
    async () => {
      for (const id of ids) await api.payroll.assign(id, { assignedUserId: who || null });
      return ids.length;
    },
    { invalidate: [...PAYROLL_KEY] },
  );
  return (
    <Modal
      open
      title="Assign Staff"
      subtitle={`${ids.length} client(s)`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() =>
              send.mutate(undefined, { onSuccess: (n) => onDone(`${n} client(s) assigned.`) })
            }
          >
            Assign
          </Button>
        </>
      }
    >
      <Select
        label="Assign to"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        options={[
          { value: '', label: 'Unassigned' },
          ...(team.data ?? [])
            .filter((m) => m.status === 'ACTIVE')
            .map((m) => ({ value: m.user.id, label: m.user.name })),
        ]}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error, PAYROLL_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
