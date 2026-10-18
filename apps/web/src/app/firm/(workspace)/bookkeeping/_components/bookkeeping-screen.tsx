'use client';

import type { BookkeepingClientRow, BookkeepingOverviewPeriod } from '@firmivra/types';
import {
  Button,
  DonutChart,
  KpiCard,
  Modal,
  Select,
  Table,
  Toast,
  type Column,
  type ChartTone,
} from '@firmivra/ui';
import {
  ArrowsClockwise,
  ChartBar,
  CreditCard,
  CurrencyDollar,
  FileText,
  Funnel,
  Gear,
  MagnifyingGlass,
  Plugs,
  Plus,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { ClientMenu, ConnectDialog, useAct, type Notice } from './bookkeeping-actions';
import {
  BK_ERRORS,
  BK_KEY,
  STATUS_LABEL,
  SoftwareTile,
  StatusPill,
  card,
  dateTimeText,
  dayText,
  linkBtn,
  moneyWhole,
  outlined,
  primary,
  quiet,
  subtle,
  trendOf,
} from './bookkeeping-shared';

const TABS = [
  { id: 'ALL', label: 'All Clients' },
  { id: 'ON_TRACK', label: 'On Track' },
  { id: 'NEEDS_ATTENTION', label: 'Needs Attention' },
  { id: 'MISSING_DOCUMENTS', label: 'Missing Documents' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'NOT_STARTED', label: 'Not Started' },
  { id: 'UPCOMING', label: 'Upcoming Reports' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const PERIODS: { value: BookkeepingOverviewPeriod; label: string }[] = [
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'LAST_MONTH', label: 'Last Month' },
  { value: 'THIS_QUARTER', label: 'This Quarter' },
  { value: 'THIS_YEAR', label: 'This Year' },
];
const STATUS_TONE: Record<string, ChartTone> = {
  ON_TRACK: 'green',
  NEEDS_ATTENTION: 'yellow',
  MISSING_DOCUMENTS: 'purple',
  OVERDUE: 'red',
  NOT_STARTED: 'grey',
};
const SORT_KEY: Record<string, 'clientName' | 'plan' | 'status' | 'nextReportDueOn'> = {
  name: 'clientName',
  plan: 'plan',
  status: 'status',
  due: 'nextReportDueOn',
};
const dueRange = (v: string) => {
  const today = new Date().toISOString().slice(0, 10);
  const add = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  if (v === 'WEEK') return { reportDueFrom: today, reportDueTo: add(7) };
  if (v === 'MONTH') return { reportDueFrom: today, reportDueTo: add(31) };
  if (v === 'OVERDUE') return { reportDueTo: add(-1) };
  return {};
};

/** /bookkeeping: the module home: KPIs, status and monthly charts, software, and the client list. */
export function BookkeepingScreen() {
  const [period, setPeriod] = useState<BookkeepingOverviewPeriod>('THIS_MONTH');
  const [tab, setTab] = useState<TabId>('ALL');
  const [type, setType] = useState('');
  const [plan, setPlan] = useState('');
  const [software, setSoftware] = useState('');
  const [status, setStatus] = useState('');
  const [due, setDue] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{ id: string; descending: boolean }>({
    id: 'name',
    descending: false,
  });
  const [dialog, setDialog] = useState<'connect' | 'add'>();
  const [connectFor, setConnectFor] = useState<{ id: string; name: string }>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const act = useAct(notice);
  const term = useDeferredValue(search.trim());
  const overview = useApiQuery([...BK_KEY, 'overview', period], () =>
    api.bookkeeping.overview({ period }),
  );
  const list = useApiQuery(
    [
      ...BK_KEY,
      'clients',
      tab,
      type,
      plan,
      software,
      status,
      due,
      term,
      page,
      pageSize,
      sort.id,
      sort.descending,
    ],
    () =>
      api.bookkeeping.clients({
        tab,
        ...(type ? { clientType: type as 'INDIVIDUAL' | 'BUSINESS' } : {}),
        ...(plan ? { plan } : {}),
        ...(software ? { software } : {}),
        ...(status ? { status: status as BookkeepingClientRow['status'] } : {}),
        ...dueRange(due),
        ...(term ? { search: term } : {}),
        sort: SORT_KEY[sort.id] ?? 'clientName',
        direction: sort.descending ? 'desc' : 'asc',
        page,
        pageSize,
      }),
  );
  const allPlans = useApiQuery([...BK_KEY, 'plans'], () =>
    api.bookkeeping.clients({ pageSize: 100 }),
  );
  const planOptions = [
    ...new Set((allPlans.data?.items ?? []).map((r) => r.plan).filter((p): p is string => !!p)),
  ];
  const o = overview.data;
  const k = o?.kpis;
  const noFigures = !!o && o.kpis.clientsWithFigures === 0;
  const reset = () => {
    setType('');
    setPlan('');
    setSoftware('');
    setStatus('');
    setDue('');
    setSearch('');
    setPage(1);
  };
  const anyFilter = !!(type || plan || software || status || due || search);

  const columns: Column<BookkeepingClientRow>[] = [
    {
      id: 'name',
      label: 'Client Name',
      sortable: true,
      cell: (r) => (
        <Link
          href={`/bookkeeping/clients/${r.id}`}
          data-testid="bk-link"
          className="font-semibold text-link hover:underline"
        >
          {r.client.displayName}
        </Link>
      ),
    },
    { id: 'plan', label: 'Plan Type', sortable: true, cell: (r) => r.plan ?? '—' },
    {
      id: 'sw',
      label: 'Accounting Software',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <SoftwareTile
            provider={r.software?.key ?? null}
            label={r.software?.label ?? 'Not Connected'}
          />
          {r.software?.label ?? 'Not Connected'}
        </span>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (r) => <StatusPill status={r.status} reason={r.statusReason} />,
    },
    {
      id: 'synced',
      label: 'Last Synced',
      cell: (r) => (r.lastSyncedAt ? dateTimeText(r.lastSyncedAt) : '—'),
    },
    {
      id: 'due',
      label: 'Next Report Due',
      sortable: true,
      cell: (r) => (r.nextReportDueOn ? dayText(r.nextReportDueOn) : '—'),
    },
  ];

  const monthMax = Math.max(
    1,
    ...(o?.monthly ?? []).flatMap((m) => [m.incomeCents, m.expensesCents]),
  );
  const tabCount = (id: TabId) => list.data?.tabCounts[id];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bookkeeping-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <ChartBar weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Bookkeeping
            </h1>
            <p className="text-base text-muted">
              Manage your bookkeeping clients, integrations, documents, and reports — all in one
              place.
            </p>
          </div>
        </div>
        <div className="w-44">
          <Select
            label="Period"
            hideLabel
            value={period}
            onChange={(e) => setPeriod(e.target.value as BookkeepingOverviewPeriod)}
            options={PERIODS}
          />
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Bookkeeping actions">
          <button type="button" className={primary} onClick={() => setDialog('connect')}>
            <Plugs aria-hidden weight="bold" className="size-5" /> Connect Accounting Software
          </button>
          <button
            type="button"
            className={subtle}
            onClick={() =>
              void act(
                () => api.bookkeeping.syncAll(),
                'Sync requested for every connected client.',
              )
            }
          >
            <ArrowsClockwise aria-hidden weight="bold" className="size-4" /> Sync All Clients
          </button>
          <Link href="/documents" className={subtle}>
            <FileText aria-hidden weight="bold" className="size-4" /> Request Documents
          </Link>
          <Link href="/bookkeeping/reports" className={subtle}>
            <ChartBar aria-hidden weight="bold" className="size-4" /> View Reports
          </Link>
          <button type="button" className={outlined} onClick={() => setDialog('add')}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add Client
          </button>
        </div>
        <Link href="/bookkeeping/settings" className={subtle}>
          <Gear aria-hidden weight="bold" className="size-4" /> Bookkeeping Settings
        </Link>
      </div>

      {overview.isError ? (
        <p role="alert" className={quiet} data-testid="bk-error">
          Bookkeeping is not available right now. We could not load it. Try again in a moment.
        </p>
      ) : null}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="bk-kpis">
        <li>
          <KpiCard
            icon={UsersThree}
            tone="blue"
            value={k?.activeClients.value ?? '—'}
            label="Active Bookkeeping Clients"
            loading={overview.isPending}
            {...(k && trendOf(k.activeClients)
              ? { trend: trendOf(k.activeClients)!, note: 'vs last period' }
              : {})}
          />
        </li>
        <li>
          <KpiCard
            icon={CurrencyDollar}
            tone="blue"
            value={k && !noFigures ? moneyWhole(k.totalIncomeCents.value) : '—'}
            label="Total Income (Active Clients)"
            loading={overview.isPending}
            {...(k && !noFigures && trendOf(k.totalIncomeCents)
              ? { trend: trendOf(k.totalIncomeCents)!, note: 'vs last period' }
              : noFigures
                ? { note: 'No figures entered yet' }
                : {})}
          />
        </li>
        <li>
          <KpiCard
            icon={CreditCard}
            tone="blue"
            value={k && !noFigures ? moneyWhole(k.totalExpensesCents.value) : '—'}
            label="Total Expenses (Active Clients)"
            loading={overview.isPending}
            {...(k && !noFigures && trendOf(k.totalExpensesCents, true)
              ? { trend: trendOf(k.totalExpensesCents, true)!, note: 'vs last period' }
              : noFigures
                ? { note: 'No figures entered yet' }
                : {})}
          />
        </li>
        <li>
          <KpiCard
            icon={ChartBar}
            tone="blue"
            value={k && !noFigures ? moneyWhole(k.netProfitCents.value) : '—'}
            label="Net Profit (Active Clients)"
            loading={overview.isPending}
            {...(k && !noFigures && trendOf(k.netProfitCents)
              ? { trend: trendOf(k.netProfitCents)!, note: 'vs last period' }
              : noFigures
                ? { note: 'No figures entered yet' }
                : {})}
          />
        </li>
        <li>
          <KpiCard
            icon={FileText}
            tone="blue"
            value={k?.clientsWithUpcomingReports.value ?? '—'}
            label="Clients with Upcoming Reports"
            loading={overview.isPending}
          />
        </li>
      </ul>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_minmax(0,5fr)]">
        <section className={card} aria-label="Client bookkeeping status" data-testid="status-chart">
          <h2 className="mb-3 font-display text-lg font-bold text-heading">
            Client Bookkeeping Status
          </h2>
          <DonutChart
            size="md"
            legend
            centerValue={o?.statusBreakdown.total ?? 0}
            centerLabel="Clients"
            segments={(o?.statusBreakdown.items ?? []).map((i) => ({
              label: STATUS_LABEL[i.status],
              value: i.count,
              tone: STATUS_TONE[i.status] ?? 'grey',
            }))}
            emptyText="No bookkeeping clients yet"
          />
        </section>
        <section
          className={card}
          aria-label="Monthly income versus expenses"
          data-testid="monthly-chart"
        >
          <h2 className="mb-3 font-display text-lg font-bold text-heading">
            Monthly Income vs. Expenses
          </h2>
          {o && o.monthly.length > 0 ? (
            <>
              <ul
                className="flex h-40 items-end gap-2 border-b border-divider"
                role="img"
                aria-label="Income and expenses by month"
              >
                {o.monthly.map((m) => (
                  <li key={m.month} className="flex h-full flex-1 items-end justify-center gap-0.5">
                    <span
                      className="w-2.5 rounded-t-sm bg-action"
                      style={{ height: `${(m.incomeCents / monthMax) * 100}%` }}
                    />
                    <span
                      className="w-2.5 rounded-t-sm bg-gold"
                      style={{ height: `${(m.expensesCents / monthMax) * 100}%` }}
                    />
                  </li>
                ))}
              </ul>
              <ul className="mt-1 flex gap-2 text-[10px] text-muted">
                {o.monthly.map((m) => (
                  <li key={m.month} className="flex-1 text-center">
                    {new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-US', {
                      month: 'short',
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex gap-4 text-xs text-muted">
                <span className="flex items-center gap-1">
                  <span aria-hidden className="size-2.5 bg-action" /> Income
                </span>
                <span className="flex items-center gap-1">
                  <span aria-hidden className="size-2.5 bg-gold" /> Expenses
                </span>
              </p>
            </>
          ) : (
            <p className={quiet}>
              {overview.isPending ? 'Loading…' : 'No monthly figures have been entered yet.'}
            </p>
          )}
        </section>
        <section className={card} aria-label="Connected accounting software" data-testid="software">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-heading">
              Connected Accounting Software
            </h2>
            <Link href="/modules/integrations" className={linkBtn}>
              Manage Integrations
            </Link>
          </div>
          {o && o.software.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {o.software.map((s) => (
                <li
                  key={s.key ?? 'none'}
                  className="flex items-center gap-3 rounded-lg bg-canvas p-2"
                >
                  <SoftwareTile provider={s.key} label={s.label} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-heading">
                      {s.label}
                    </span>
                    <span className="block text-xs text-muted">
                      {s.clientCount} {s.clientCount === 1 ? 'Client' : 'Clients'}
                      {s.key ? ' Connected' : ''}
                    </span>
                  </span>
                  <span
                    className={`rounded-pill px-2 py-1 text-xs font-medium ${s.connected ? 'bg-success-soft text-success' : 'bg-disabled text-muted'}`}
                  >
                    {s.connected ? 'Connected' : 'Not Connected'}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              {overview.isPending ? 'Loading…' : 'No accounting software connected yet.'}
            </p>
          )}
        </section>
      </div>

      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Bookkeeping clients"
        data-testid="bk-clients"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Client views"
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
                  setPage(1);
                }}
                className={`-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
              >
                {t.label}
                {tabCount(t.id) !== undefined && t.id !== 'ALL' ? (
                  <span className="ml-1 text-xs text-muted">({tabCount(t.id)})</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border sm:w-64 sm:flex-none border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
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
              aria-pressed={filters}
              className={outlined}
              onClick={() => setFilters(!filters)}
            >
              <Funnel aria-hidden weight="fill" className="size-4" /> Filters
            </button>
          </div>
        </div>
        {filters ? (
          <div
            className="grid grid-cols-2 items-end gap-3 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]"
            data-testid="bk-filters"
          >
            <Select
              label="Client Type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Types' },
                { value: 'BUSINESS', label: 'Business' },
                { value: 'INDIVIDUAL', label: 'Individual' },
              ]}
            />
            <Select
              label="Plan Type"
              value={plan}
              onChange={(e) => {
                setPlan(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Plans' },
                ...planOptions.map((p) => ({ value: p, label: p })),
              ]}
            />
            <Select
              label="Accounting Software"
              value={software}
              onChange={(e) => {
                setSoftware(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Software' },
                ...(o?.software ?? []).map((s) => ({
                  value: s.key ?? 'NOT_CONNECTED',
                  label: s.label,
                })),
              ]}
            />
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Statuses' },
                ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
            <Select
              label="Report Due"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Dates' },
                { value: 'WEEK', label: 'Next 7 days' },
                { value: 'MONTH', label: 'Next 31 days' },
                { value: 'OVERDUE', label: 'Past due' },
              ]}
            />
            <button
              type="button"
              disabled={!anyFilter}
              className={`${linkBtn} justify-self-end pb-2 disabled:opacity-50`}
              onClick={reset}
            >
              Clear All
            </button>
          </div>
        ) : null}
        <div className="relative">
          <Table
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            caption="Bookkeeping clients"
            dense
            noun="clients"
            pageSize={pageSize}
            pageSizes={[10, 25, 50]}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            loading={list.isPending}
            emptyTitle={
              list.isError
                ? 'Bookkeeping clients are not available'
                : anyFilter || tab !== 'ALL'
                  ? 'No clients match'
                  : 'No bookkeeping clients yet'
            }
            emptyText={
              list.isError
                ? 'We could not load the clients. Try again in a moment.'
                : anyFilter || tab !== 'ALL'
                  ? 'Try another tab or clear the filters.'
                  : 'Add a client to start tracking their bookkeeping.'
            }
            rowActions={(r) => <ClientMenu row={r} onNotice={notice} />}
            server={{
              page: list.data?.page ?? 1,
              total: list.data?.total ?? 0,
              hasNext: (list.data?.page ?? 1) * pageSize < (list.data?.total ?? 0),
              hasPrevious: (list.data?.page ?? 1) > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(Math.max(1, page - 1)),
              onPage: (n: number) => setPage(n),
              sort,
              onSort: (s) => {
                setSort(s);
                setPage(1);
              },
            }}
          />
        </div>
      </section>

      {dialog === 'connect' ? (
        <PickClient
          title="Connect Accounting Software"
          confirm="Choose"
          onClose={() => setDialog(undefined)}
          onPick={(c) => {
            setDialog(undefined);
            setConnectFor(c);
          }}
        />
      ) : null}
      {connectFor ? (
        <ConnectDialog
          clientId={connectFor.id}
          name={connectFor.name}
          onClose={() => setConnectFor(undefined)}
          onNotice={notice}
        />
      ) : null}
      {dialog === 'add' ? (
        <AddClientDialog onClose={() => setDialog(undefined)} onNotice={notice} />
      ) : null}
    </div>
  );
}

/** Picks one bookkeeping client (for Connect Accounting Software). */
function PickClient({
  title,
  confirm,
  onClose,
  onPick,
}: {
  title: string;
  confirm: string;
  onClose: () => void;
  onPick: (c: { id: string; name: string }) => void;
}) {
  const list = useApiQuery([...BK_KEY, 'pick'], () => api.bookkeeping.clients({ pageSize: 100 }));
  const [id, setId] = useState('');
  const items = list.data?.items ?? [];
  return (
    <Modal
      open
      title={title}
      subtitle="Choose the client whose accounting software you are connecting."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!id}
            onClick={() => {
              const c = items.find((x) => x.id === id);
              if (c) onPick({ id: c.id, name: c.client.displayName });
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {items.length === 0 && !list.isPending ? (
        <p className={quiet}>There are no bookkeeping clients yet.</p>
      ) : (
        <Select
          label="Client"
          value={id}
          onChange={(e) => setId(e.target.value)}
          options={[
            { value: '', label: 'Choose a client…' },
            ...items.map((c) => ({ value: c.id, label: c.client.displayName })),
          ]}
        />
      )}
    </Modal>
  );
}

function AddClientDialog({ onClose, onNotice }: { onClose: () => void; onNotice: Notice }) {
  const act = useAct(onNotice);
  const clients = useApiQuery([...BK_KEY, 'firm-clients'], () => api.clients.list({ limit: 50 }));
  const [clientId, setClientId] = useState('');
  const [plan, setPlan] = useState('');
  const [error, setError] = useState<string>();
  const rows = (clients.data?.items ?? []) as { id: string; displayName: string }[];
  return (
    <Modal
      open
      title="Add Bookkeeping Client"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId}
            onClick={async () => {
              try {
                await api.bookkeeping.addClient({
                  clientId,
                  ...(plan.trim() ? { plan: plan.trim() } : {}),
                });
                await act(async () => undefined, 'Bookkeeping client added.');
                onClose();
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
              }
            }}
          >
            Add Client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-client">
        <Select
          label="Client"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            {
              value: '',
              label: clients.isError ? 'Clients are not available' : 'Choose a client…',
            },
            ...rows.map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
        <label className="flex flex-col gap-1 text-sm font-medium text-heading">
          Plan (optional)
          <input
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm font-normal text-text"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
