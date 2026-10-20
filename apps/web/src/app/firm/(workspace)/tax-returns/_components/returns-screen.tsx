'use client';

import type {
  ClientAccountType,
  TaxReturnRow,
  TaxReturnSummary,
  TaxReturnTab,
  TaxReturnWorkflowStatus,
  TaxReturnsQuery,
} from '@firmivra/types';
import {
  BulkBar,
  DateRangePicker,
  DonutChart,
  type KpiTrend,
  Modal,
  SearchField,
  Select,
  Table,
  Toast,
  type Column,
  Skeleton,
  type TileTone,
  tileTones,
} from '@firmivra/ui';
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  Archive,
  Buildings,
  CalendarCheck,
  CheckCircle,
  ClockCountdown,
  FileArrowUp,
  FileText,
  Files,
  Funnel,
  type Icon,
  PaperPlaneTilt,
  PlusCircle,
  PlusSquare,
  Printer,
  Receipt,
  UploadSimple,
  User,
  UserSwitch,
  UsersThree,
  Warning,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { CreateReturnDialog, ImportDialog } from './create-return';
import { Dialog, ReturnMenu, useAct, useManager, useMembers, type Notice } from './return-actions';
import {
  FORM_TYPES,
  ReturnKind,
  STATUS_CHART,
  STATUS_LABEL,
  STATUS_ORDER,
  StatusBadge,
  TABS,
  TR_ERRORS,
  TR_KEY,
  card,
  linkText,
  numericDay,
  outlined,
  primary,
  quiet,
  shortName,
} from './tr-shared';

const TAB_ICON: Record<TaxReturnTab, Icon> = {
  all: FileText,
  personal: User,
  business: Buildings,
  quarterly: CalendarCheck,
  amended: Files,
  prior_year: ClockCounterClockwise,
};
const SORTS: Record<string, NonNullable<TaxReturnsQuery['sort']>> = {
  client: 'client',
  year: 'year',
  status: 'status',
  updated: 'updated',
};
const thisYear = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => String(thisYear - i));

type Card = {
  key: keyof Omit<TaxReturnSummary, 'taxYear' | 'progress'>;
  label: string;
  icon: Icon;
  tone: TileTone;
  /** The status the card filters to (Ready for Review/File spans three: no single filter). */
  status?: TaxReturnWorkflowStatus | null;
  /** More of it is bad news (In Preparation, Waiting, Rejected). */
  badWhenUp?: boolean;
};
const CARDS: Card[] = [
  { key: 'total', label: 'Total Returns', icon: FileText, tone: 'blue', status: null },
  {
    key: 'inPreparation',
    label: 'In Preparation',
    icon: ClockCountdown,
    tone: 'amber',
    status: 'IN_PREPARATION',
    badWhenUp: true,
  },
  {
    key: 'waitingOnClient',
    label: 'Waiting on Client',
    icon: UsersThree,
    tone: 'amber',
    status: 'WAITING_ON_CLIENT',
    badWhenUp: true,
  },
  { key: 'readyForReviewOrFile', label: 'Ready for Review/File', icon: Receipt, tone: 'purple' },
  {
    key: 'transmitted',
    label: 'Transmitted',
    icon: PaperPlaneTilt,
    tone: 'green',
    status: 'TRANSMITTED',
  },
  { key: 'accepted', label: 'Accepted', icon: CheckCircle, tone: 'green', status: 'ACCEPTED' },
  {
    key: 'rejected',
    label: 'Rejected',
    icon: Warning,
    tone: 'red',
    status: 'REJECTED',
    badWhenUp: true,
  },
];

/** "↑ 12% vs last month": against the figure at the start of the month, when there was one. */
function trendOf(
  value: number,
  previous: number | null,
  badWhenUp?: boolean,
): KpiTrend | undefined {
  if (previous === null || previous === 0) return undefined;
  const pct = Math.round(((value - previous) / previous) * 100);
  return {
    text: `${Math.abs(pct)}%`,
    direction: pct === 0 ? 'flat' : pct > 0 ? 'up' : 'down',
    good: badWhenUp ? pct <= 0 : pct >= 0,
  };
}

/**
 * /tax-returns (Frame 1, Tax Returns Overview): one return dataset with tax-type tabs, KPI cards
 * that filter, the filters and table, Tax Season Progress, Quick Actions and Helpful Links.
 */
export function ReturnsScreen() {
  const manager = useManager();
  const members = useMembers();
  const [tab, setTab] = useState<TaxReturnTab>('all');
  const [year, setYear] = useState('');
  const [formType, setFormType] = useState('');
  const [clientType, setClientType] = useState('');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [search, setSearch] = useState('');
  const [more, setMore] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState({ id: 'updated', descending: true });
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'create' | 'import' | 'bulk' | 'efile' | 'bulk-assign'>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const act = useAct(notice);
  const term = useDeferredValue(search.trim());

  const query: TaxReturnsQuery = {
    tab,
    ...(year ? { taxYear: Number(year) } : {}),
    ...(formType ? { formType } : {}),
    ...(clientType ? { clientType: clientType as ClientAccountType } : {}),
    ...(status ? { workflowStatus: status as TaxReturnWorkflowStatus } : {}),
    ...(assigned ? { assignedUserId: assigned } : {}),
    ...(range.from ? { updatedFrom: range.from } : {}),
    ...(range.to ? { updatedTo: range.to } : {}),
    ...(archived ? { archived: true } : {}),
    ...(term.length >= 2 ? { search: term } : {}),
    sort: SORTS[sort.id] ?? 'updated',
    page,
    pageSize,
  };
  const list = useApiQuery([...TR_KEY, 'list', query], () => api.taxReturnWorkspace.list(query));
  // The season in progress: this spring's returns are last year's (a chosen year overrides it).
  const season = year ? Number(year) : thisYear - 1;
  const summary = useApiQuery([...TR_KEY, 'summary', season], () =>
    api.taxReturnWorkspace.summary({ taxYear: season }),
  );
  const s = summary.data;
  const rows = list.data?.items ?? [];
  const filtered = !!(
    year ||
    formType ||
    clientType ||
    status ||
    assigned ||
    search ||
    range.from ||
    range.to ||
    archived
  );
  const reset = () => {
    setYear('');
    setFormType('');
    setClientType('');
    setStatus('');
    setAssigned('');
    setSearch('');
    setRange({ from: '', to: '' });
    setArchived(false);
    setPage(1);
  };
  const filter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
      setSelected([]);
    };

  const exportList = async () => {
    const link = await act(
      () => api.taxReturnWorkspace.exportList({ ...query, page: 1 }),
      'Export ready.',
    );
    if (link) window.open(link.url, '_blank', 'noopener');
  };
  const bulkArchive = async () => {
    const ids = selected;
    const done = await act(
      () => Promise.all(ids.map((id) => api.taxReturnWorkspace.archive(id))),
      `${ids.length} ${ids.length === 1 ? 'return' : 'returns'} archived.`,
    );
    if (done) setSelected([]);
  };

  const columns: Column<TaxReturnRow>[] = [
    {
      id: 'client',
      label: 'Client Name',
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col">
          <Link
            href={`/tax-returns/${r.id}`}
            data-testid="return-link"
            className="font-semibold text-heading hover:text-link hover:underline"
          >
            {r.client.name}
          </Link>
          <span className="text-muted">
            {r.client.maskedId
              ? r.client.accountType === 'BUSINESS'
                ? `EIN: ${r.client.maskedId}`
                : r.client.maskedId
              : r.client.accountType === 'BUSINESS'
                ? 'EIN not on file'
                : 'SSN not on file'}
          </span>
        </span>
      ),
    },
    { id: 'type', label: 'Return Type', cell: (r) => <ReturnKind row={r} /> },
    { id: 'year', label: 'Tax Year', sortable: true, cell: (r) => r.taxYear },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge status={r.workflowStatus} />
          {r.estimate?.overdue ? (
            <span className="text-xs font-medium text-danger">Overdue</span>
          ) : null}
          {r.archivedAt ? <span className="text-xs text-muted">Archived</span> : null}
        </span>
      ),
    },
    { id: 'updated', label: 'Last Updated', sortable: true, cell: (r) => numericDay(r.updatedAt) },
    {
      id: 'assigned',
      label: 'Assigned To',
      cell: (r) =>
        r.preparer || r.reviewer ? (
          <span
            title={[
              r.preparer && `Preparer: ${r.preparer.name}`,
              r.reviewer && `Reviewer: ${r.reviewer.name}`,
            ]
              .filter(Boolean)
              .join('\n')}
          >
            {shortName(r.preparer ?? r.reviewer)}
          </span>
        ) : (
          <span className="text-muted">Unassigned</span>
        ),
    },
  ];

  const progress = s?.progress ?? [];
  const done = progress
    .filter((p) => p.workflowStatus === 'ACCEPTED' || p.workflowStatus === 'CLOSED')
    .reduce((n, p) => n + p.count, 0);
  const pct = s && s.total.value ? Math.round((done / s.total.value) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="tax-returns-page">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <Receipt weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Tax Returns
            </h1>
            <p className="text-base text-muted">
              Manage, track, and file all client tax returns in one place.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={outlined} onClick={() => setDialog('import')}>
            <UploadSimple aria-hidden weight="bold" className="size-5" /> Import Return
          </button>
          <button type="button" className={primary} onClick={() => setDialog('create')}>
            <PlusCircle aria-hidden weight="fill" className="size-6" /> Create New Return
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div
        role="tablist"
        aria-label="Tax types"
        className="flex overflow-x-auto rounded-xl bg-surface p-1.5 shadow-md"
      >
        {TABS.map((t) => {
          const on = t.id === tab;
          const Glyph = TAB_ICON[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => filter(setTab)(t.id)}
              className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium whitespace-nowrap ${on ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
            >
              <Glyph aria-hidden weight="fill" className={`size-6 ${on ? '' : 'text-action'}`} />
              {t.label}
            </button>
          );
        })}
      </div>

      {summary.isError ? (
        <p role="alert" className={quiet} data-testid="summary-error">
          The return counts are not available right now. Try again in a moment.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="tr-kpis">
        {CARDS.map((c) => {
          const k = s?.[c.key];
          const trend = k ? trendOf(k.value, k.previous, c.badWhenUp) : undefined;
          const body = (
            <ReturnKpi
              icon={c.icon}
              tone={c.tone}
              value={k ? k.value : '—'}
              label={c.label}
              loading={summary.isPending}
              trend={trend}
            />
          );
          const on = c.status === null ? !status : c.status ? status === c.status : false;
          return (
            <li key={c.key}>
              {c.status !== undefined ? (
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`Show ${c.label}`}
                  className={`block w-full rounded-xl text-left ${on && c.status ? 'ring-2 ring-action' : ''}`}
                  onClick={() => filter(setStatus)(c.status ?? '')}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <section className={`${card} flex min-w-0 flex-col gap-4 p-3`} aria-label="Returns">
          <div className="flex flex-wrap items-end gap-2" data-testid="tr-filters">
            <div className="w-32">
              <Select
                label="Tax Year"
                value={year}
                onChange={(e) => filter(setYear)(e.target.value)}
                options={[
                  { value: '', label: 'All Years' },
                  ...YEARS.map((y) => ({ value: y, label: y })),
                ]}
              />
            </div>
            <div className="w-32">
              <Select
                label="Return Type"
                value={formType}
                onChange={(e) => filter(setFormType)(e.target.value)}
                options={[
                  { value: '', label: 'All Types' },
                  ...FORM_TYPES.map((f) => ({ value: f.value, label: f.value })),
                ]}
              />
            </div>
            <div className="w-32">
              <Select
                label="Client Type"
                value={clientType}
                onChange={(e) => filter(setClientType)(e.target.value)}
                options={[
                  { value: '', label: 'All Clients' },
                  { value: 'INDIVIDUAL', label: 'Individual' },
                  { value: 'BUSINESS', label: 'Business' },
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                label="Status"
                value={status}
                onChange={(e) => filter(setStatus)(e.target.value)}
                options={[
                  { value: '', label: 'All Statuses' },
                  ...STATUS_ORDER.map((v) => ({ value: v, label: STATUS_LABEL[v] })),
                ]}
              />
            </div>
            <div className="w-32">
              <Select
                label="Assigned Staff"
                value={assigned}
                onChange={(e) => filter(setAssigned)(e.target.value)}
                options={[{ value: '', label: 'All Staff' }, ...members]}
              />
            </div>
            <div className="min-w-48 flex-1">
              <SearchField
                label="Search returns"
                placeholder="Search by client name, SSN/EIN last 4, or return ID…"
                minWidth="10rem"
                value={search}
                onChange={(e) => filter(setSearch)(e.target.value)}
              />
            </div>
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore(!more)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-divider bg-canvas px-3 text-sm font-medium text-heading hover:bg-accent-soft"
            >
              <Funnel aria-hidden weight="fill" className="size-4 text-action" /> Filters
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={!filtered}
              className="min-h-10 px-1 text-sm font-medium text-danger hover:underline disabled:text-muted disabled:no-underline"
            >
              Clear
            </button>
          </div>
          {more ? (
            <div
              className="flex flex-wrap items-end gap-4 rounded-lg bg-canvas p-3"
              data-testid="more-filters"
            >
              <DateRangePicker
                label="Last updated"
                value={range}
                onChange={(v) => filter(setRange)(v)}
              />
              <label className="flex min-h-10 items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={archived}
                  onChange={(e) => filter(setArchived)(e.target.checked)}
                />
                Show archived returns only
              </label>
            </div>
          ) : null}
          {selected.length ? (
            <BulkBar
              count={selected.length}
              noun="returns"
              actions={[
                {
                  label: 'Assign Staff',
                  icon: UserSwitch,
                  onClick: () => setDialog('bulk-assign'),
                },
                { label: 'Archive', icon: Archive, onClick: () => void bulkArchive() },
              ]}
            />
          ) : null}
          {list.isError ? (
            <p role="alert" className={quiet} data-testid="list-error">
              Tax returns are not available right now. {errorMessage(list.error, TR_ERRORS)}
            </p>
          ) : (
            <Table
              dense
              caption="Tax returns"
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              loading={list.isPending}
              noun="returns"
              pageSize={pageSize}
              pageSizes={[10, 25, 50]}
              onPageSize={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              selection={{ selected, onChange: setSelected }}
              rowActions={(r) => <ReturnMenu row={r} onNotice={notice} />}
              server={{
                page,
                total: list.data?.total ?? 0,
                hasNext: page * pageSize < (list.data?.total ?? 0),
                hasPrevious: page > 1,
                onNext: () => setPage(page + 1),
                onPrevious: () => setPage(page - 1),
                onPage: setPage,
                sort,
                onSort: (next) => {
                  setSort(next);
                  setPage(1);
                },
              }}
              emptyTitle={filtered || tab !== 'all' ? 'No returns match' : 'No tax returns yet'}
              emptyText={
                filtered || tab !== 'all'
                  ? 'Try another tab, or clear the filters.'
                  : 'Create a client’s first return to start tracking it here.'
              }
              emptyAction={
                filtered ? (
                  <button type="button" className={outlined} onClick={reset}>
                    Clear Filters
                  </button>
                ) : (
                  <button type="button" className={primary} onClick={() => setDialog('create')}>
                    <PlusCircle aria-hidden weight="fill" className="size-5" /> Create New Return
                  </button>
                )
              }
            />
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <section
            className={`${card} p-4`}
            aria-label="Tax season progress"
            data-testid="season-progress"
          >
            <h2 className="mb-3 text-lg font-bold text-heading">
              Tax Season Progress{s ? ` (${s.taxYear})` : ''}
            </h2>
            {summary.isError ? (
              <p className={quiet}>Not available right now.</p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <DonutChart
                  size="sm"
                  legend={false}
                  label="Returns by status"
                  centerValue={`${pct}%`}
                  centerLabel="Completed"
                  segments={progress.map((p) => ({
                    label: STATUS_LABEL[p.workflowStatus],
                    value: p.count,
                    tone: STATUS_CHART[p.workflowStatus],
                  }))}
                  emptyText="No returns for this year yet"
                />
                {progress.length ? (
                  <ul className="flex w-full flex-col gap-1 text-sm">
                    {STATUS_ORDER.filter((st) => progress.some((p) => p.workflowStatus === st)).map(
                      (st) => (
                        <li key={st}>
                          <button
                            type="button"
                            onClick={() => filter(setStatus)(st)}
                            className="flex w-full items-center gap-2 rounded px-1 text-left hover:bg-canvas"
                          >
                            <span
                              aria-hidden
                              className={`size-3 shrink-0 rounded-full ${DOT[STATUS_CHART[st]]}`}
                            />
                            <span className="flex-1 text-text">{STATUS_LABEL[st]}</span>
                            <span className="font-semibold text-heading">
                              {progress.find((p) => p.workflowStatus === st)?.count}
                            </span>
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </div>
            )}
          </section>

          <section className={`${card} p-4`} aria-label="Quick actions" data-testid="quick-actions">
            <h2 className="mb-2 text-lg font-bold text-heading">Quick Actions</h2>
            <ul className="flex flex-col">
              {[
                { label: 'Create New Return', icon: PlusSquare, on: () => setDialog('create') },
                { label: 'Import Return', icon: UploadSimple, on: () => setDialog('import') },
                { label: 'Bulk Upload Returns', icon: FileArrowUp, on: () => setDialog('bulk') },
                { label: 'Generate E-File Reports', icon: FileText, on: () => setDialog('efile') },
                ...(manager
                  ? [{ label: 'Print / Export List', icon: Printer, on: () => void exportList() }]
                  : []),
              ].map((a) => (
                <li key={a.label}>
                  <button
                    type="button"
                    onClick={a.on}
                    className="flex min-h-9 w-full items-center gap-3 rounded px-1 text-left text-sm text-text hover:bg-canvas hover:text-link"
                  >
                    <a.icon aria-hidden weight="fill" className="size-5 text-action" />
                    {a.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={`${card} p-4`} aria-label="Helpful links" data-testid="helpful-links">
            <h2 className="mb-2 text-lg font-bold text-heading">Helpful Links</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {HELPFUL_LINKS.map((l) => (
                <li key={l.label}>
                  <Link
                    href={l.href}
                    {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className={`flex items-center gap-3 ${linkText} text-text`}
                  >
                    <ArrowSquareOut aria-hidden weight="bold" className="size-5 text-action" />
                    {l.label}
                    {l.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {dialog === 'create' ? <CreateReturnDialog onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'import' || dialog === 'bulk' ? (
        <ImportDialog bulk={dialog === 'bulk'} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'efile' ? (
        <EfileReportDialog
          year={year || (s ? String(s.taxYear) : '')}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {dialog === 'bulk-assign' ? (
        <BulkAssignDialog
          ids={selected}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setSelected([]);
            setDialog(undefined);
          }}
          onNotice={notice}
        />
      ) : null}
    </div>
  );
}

/**
 * One KPI card of the design's row of seven: the kit's tile tones in a narrower card than KpiCard
 * (value, label, then the change and "vs last month").
 */
function ReturnKpi({
  icon: Glyph,
  tone,
  value,
  label,
  loading,
  trend,
}: {
  icon: Icon;
  tone: TileTone;
  value: number | string;
  label: string;
  loading: boolean;
  trend: KpiTrend | undefined;
}) {
  const colour =
    trend?.direction === 'flat' ? 'text-muted' : trend?.good ? 'text-success' : 'text-danger';
  return (
    <div className="flex h-full items-center gap-2.5 rounded-xl bg-surface px-3 py-3 shadow-md">
      <span
        aria-hidden
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        <Glyph weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        {loading ? (
          <Skeleton className="h-7 w-10" />
        ) : (
          <span className="text-2xl leading-tight font-bold text-heading">{value}</span>
        )}
        <span className="text-xs leading-tight text-muted">{label}</span>
        {trend ? (
          <span className="mt-1 text-xs">
            <span className={`inline-flex items-center gap-0.5 font-semibold ${colour}`}>
              {trend.direction === 'up' ? (
                <ArrowUp aria-label="Up" weight="bold" className="size-3" />
              ) : trend.direction === 'down' ? (
                <ArrowDown aria-label="Down" weight="bold" className="size-3" />
              ) : null}
              {trend.text}
            </span>{' '}
            <span className="text-muted">vs last month</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

const DOT: Record<string, string> = {
  green: 'bg-chart-green',
  blue: 'bg-chart-blue',
  yellow: 'bg-chart-yellow',
  grey: 'bg-chart-grey',
  red: 'bg-chart-red',
  purple: 'bg-purple',
  navy: 'bg-heading',
};

/**
 * Helpful Links: places in Firmivra and public agency sites, the same for every firm (the guide
 * asks for firm-configured links; no table holds them yet).
 */
const HELPFUL_LINKS = [
  { label: 'Filing Deadlines (Compliance)', href: '/compliance', external: false },
  { label: 'Client Document Checklist', href: '/templates', external: false },
  {
    label: 'Common Tax Forms (IRS)',
    href: 'https://www.irs.gov/forms-instructions',
    external: true,
  },
  { label: 'IRS Tax Information', href: 'https://www.irs.gov', external: true },
  { label: 'State Tax Agencies', href: 'https://www.taxadmin.org/fta-members', external: true },
];

/** Generate E-File Reports: transmissions by jurisdiction and the open rejections. */
function EfileReportDialog({ year, onClose }: { year: string; onClose: () => void }) {
  const report = useApiQuery([...TR_KEY, 'efile', year], () =>
    api.taxReturnWorkspace.efileReport(year ? { taxYear: Number(year) } : {}),
  );
  const r = report.data;
  return (
    <Modal
      open
      title={`E-File Report${r ? ` (${r.taxYear})` : ''}`}
      subtitle="Transmissions, acknowledgments and rejections by jurisdiction"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4" data-testid="efile-report">
        {report.isError ? (
          <p role="alert" className={quiet}>
            The report is not available right now. Try again in a moment.
          </p>
        ) : report.isPending ? (
          <p className={quiet}>Loading…</p>
        ) : !r || r.byJurisdiction.length === 0 ? (
          <p className={quiet}>No filings recorded for this year yet.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Filings by jurisdiction</caption>
              <thead className="bg-table-head">
                <tr>
                  {[
                    'Jurisdiction',
                    'Not Filed',
                    'Transmitted',
                    'Accepted',
                    'Rejected',
                    'Paper',
                  ].map((h) => (
                    <th key={h} scope="col" className="px-2 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.byJurisdiction.map((j) => (
                  <tr key={j.jurisdiction} className="border-b border-divider">
                    <th scope="row" className="px-2 py-2 font-medium">
                      {j.jurisdiction === 'US' ? 'Federal' : j.jurisdiction}
                    </th>
                    <td className="px-2">{j.notFiled}</td>
                    <td className="px-2">{j.transmitted}</td>
                    <td className="px-2">{j.accepted}</td>
                    <td className="px-2">{j.rejected}</td>
                    <td className="px-2">{j.paperFiled}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h3 className="mb-1 font-semibold text-heading">Open Rejections</h3>
              {r.rejections.length === 0 ? (
                <p className={quiet}>No open rejections.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-divider text-sm">
                  {r.rejections.map((x) => (
                    <li
                      key={`${x.taxReturnId}-${x.jurisdiction}`}
                      className="flex flex-wrap justify-between gap-2 py-2"
                    >
                      <Link
                        href={`/tax-returns/${x.taxReturnId}/review#efile`}
                        className={linkText}
                      >
                        {x.clientName}
                      </Link>
                      <span className="text-muted">
                        {x.jurisdiction === 'US' ? 'Federal' : x.jurisdiction} ·{' '}
                        {x.rejectCode ?? 'No code'} · {numericDay(x.acknowledgedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Assign Staff for the selected returns: the same preparer and reviewer on each. */
function BulkAssignDialog({
  ids,
  onClose,
  onDone,
  onNotice,
}: {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const members = useMembers();
  const [preparer, setPreparer] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const done = await act(
      () =>
        Promise.all(
          ids.map((id) =>
            api.taxReturnWorkspace.updateDetails(id, {
              ...(preparer ? { preparerUserId: preparer } : {}),
              ...(reviewer ? { reviewerUserId: reviewer } : {}),
            }),
          ),
        ),
      `${ids.length} ${ids.length === 1 ? 'return' : 'returns'} assigned.`,
    );
    setBusy(false);
    if (done) onDone();
  };
  return (
    <Dialog
      title="Assign Staff"
      subtitle={`${ids.length} selected ${ids.length === 1 ? 'return' : 'returns'}`}
      confirm="Assign"
      busy={busy}
      disabled={!preparer && !reviewer}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="bulk-assign-dialog"
    >
      <Select
        label="Preparer"
        value={preparer}
        onChange={(e) => setPreparer(e.target.value)}
        options={[{ value: '', label: 'Keep as is' }, ...members]}
      />
      <Select
        label="Reviewer"
        value={reviewer}
        onChange={(e) => setReviewer(e.target.value)}
        options={[{ value: '', label: 'Keep as is' }, ...members]}
      />
    </Dialog>
  );
}
