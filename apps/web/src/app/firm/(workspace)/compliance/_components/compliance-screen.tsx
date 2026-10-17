'use client';

import type { ComplianceDeadlinesQuery } from '@firmivra/types';
import { KpiCard, Select, Toast, Toggle } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CalendarCheck,
  CheckCircle,
  Funnel,
  GearSix,
  ListChecks,
  Plus,
  ShieldCheck,
  Users,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  AtRiskCard,
  DeadlineCalendar,
  QuickActions,
  ResourcesCard,
  TypesCard,
} from './compliance-rail';
import { useClients, useMembers } from './compliance-data';
import { SettingsDialog } from './compliance-settings';
import { COMPLIANCE_KEY, STATUS_LABEL, TYPE_OPTIONS, outlined } from './compliance-shared';
import { ByClientView, ByTypeView, CalendarsView, TaxCalendarView } from './compliance-views';
import { DeadlineTable } from './deadline-table';
import { RecurringList } from './recurring-list';

type Tab = 'overview' | 'all' | 'client' | 'type' | 'calendars' | 'recurring' | 'completed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'all', label: 'All Deadlines' },
  { id: 'client', label: 'By Client' },
  { id: 'type', label: 'By Type' },
  { id: 'calendars', label: 'Government Calendars' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'completed', label: 'Completed' },
];

interface Filters {
  range: NonNullable<ComplianceDeadlinesQuery['range']>;
  type: string;
  clientId: string;
  status: string;
  assignedUserId: string;
  agency: string;
  mine: boolean;
}
const BLANK: Filters = {
  range: 'NEXT_30_DAYS',
  type: '',
  clientId: '',
  status: '',
  assignedUserId: '',
  agency: '',
  mine: false,
};
const RANGES: { value: Filters['range']; label: string }[] = [
  { value: 'ALL', label: 'All Dates' },
  { value: 'NEXT_7_DAYS', label: 'Next 7 Days' },
  { value: 'NEXT_30_DAYS', label: 'Next 30 Days' },
  { value: 'NEXT_90_DAYS', label: 'Next 90 Days' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'THIS_QUARTER', label: 'This Quarter' },
  { value: 'THIS_YEAR', label: 'This Year' },
  { value: 'PAST_30_DAYS', label: 'Past 30 Days' },
];

/** /compliance: the overview, the other six views, the Tax Calendar and Settings. */
export function ComplianceScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [taxCalendar, setTaxCalendar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState<string>();
  const [filters, setFilters] = useState<Filters>(BLANK);
  const [date, setDate] = useState<string>();
  const [sort, setSort] = useState<Pick<ComplianceDeadlinesQuery, 'sort' | 'direction'>>({
    sort: 'dueOn',
    direction: 'asc',
  });
  const [page, setPage] = useState(1);
  const { clients } = useClients();
  const { members } = useMembers();
  const summary = useApiQuery([...COMPLIANCE_KEY, 'summary'], () => api.compliance.summary());
  const agencies = useApiQuery([...COMPLIANCE_KEY, 'agencies'], () =>
    api.compliance.deadlines({ pageSize: 100 }),
  );
  const s = summary.data;
  const agencyOptions = [
    ...new Set((agencies.data?.items ?? []).map((d) => d.agency).filter((a): a is string => !!a)),
  ].sort();

  const choose = (next: Tab) => {
    setTab(next);
    setTaxCalendar(false);
    setPage(1);
    setFilters((f) => ({ ...f, range: next === 'overview' ? 'NEXT_30_DAYS' : 'ALL' }));
  };
  const set = (change: Partial<Filters>) => {
    setFilters({ ...filters, ...change });
    setPage(1);
  };
  const query: ComplianceDeadlinesQuery = {
    tab: tab === 'completed' ? 'COMPLETED' : 'ALL',
    range: filters.range,
    ...(filters.type
      ? { type: filters.type as NonNullable<ComplianceDeadlinesQuery['type']> }
      : {}),
    ...(filters.status
      ? { status: filters.status as NonNullable<ComplianceDeadlinesQuery['status']> }
      : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
    ...(filters.agency ? { agency: filters.agency } : {}),
    ...(filters.mine ? { mine: true } : {}),
    ...(date ? { from: date, to: date } : {}),
    ...sort,
    page,
  };
  const onQuery = (change: Partial<ComplianceDeadlinesQuery>) => {
    if (change.sort) setSort({ sort: change.sort, direction: change.direction ?? 'asc' });
    if (change.page) setPage(Number(change.page));
    else setPage(1);
  };
  const showFilters = tab === 'overview' || tab === 'all' || tab === 'completed';
  const filterSelect = (
    label: string,
    key: keyof Filters,
    options: { value: string; label: string }[],
  ) => (
    <Select
      label={label}
      value={String(filters[key])}
      onChange={(e) => set({ [key]: e.target.value } as Partial<Filters>)}
      options={options}
    />
  );
  const card = (
    id: string,
    icon: typeof ListChecks,
    tone: 'green' | 'red' | 'amber' | 'purple' | 'blue',
    label: string,
    value: number | undefined,
    onClick: () => void,
    extra?: {
      trend?: { text: string; direction: 'up' | 'down' | 'flat'; good?: boolean };
      note?: string;
    },
  ) => (
    <li key={id}>
      <button
        type="button"
        data-testid={`kpi-${id}`}
        onClick={onClick}
        className="block w-full rounded-xl text-left hover:ring-2 hover:ring-action"
      >
        <KpiCard
          icon={icon}
          tone={tone}
          value={value ?? '–'}
          label={label}
          loading={summary.isPending}
          {...(extra?.trend ? { trend: extra.trend } : {})}
          {...(extra?.note ? { note: extra.note } : {})}
        />
      </button>
    </li>
  );
  const trendOf = (k?: { changePercent: number | null }) =>
    k && k.changePercent !== null
      ? {
          trend: {
            text: `${Math.abs(k.changePercent)}%`,
            direction: (k.changePercent > 0 ? 'up' : k.changePercent < 0 ? 'down' : 'flat') as
              'up' | 'down' | 'flat',
            good: k.changePercent >= 0,
          },
          note: 'vs last month',
        }
      : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="compliance-page">
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
        <span className="font-semibold text-heading">Compliance &amp; Deadlines</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <ShieldCheck aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">
              Compliance &amp; Deadlines
            </h1>
            <p className="text-base text-muted">Stay compliant. Never miss a deadline.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/compliance/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-base font-medium text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-5" /> Add Deadline
          </Link>
          <button
            type="button"
            aria-pressed={taxCalendar}
            onClick={() => setTaxCalendar(!taxCalendar)}
            className={outlined}
          >
            <CalendarCheck aria-hidden weight="fill" className="size-4" /> Tax Calendar
          </button>
          <button type="button" onClick={() => setSettings(true)} className={outlined}>
            <GearSix aria-hidden weight="fill" className="size-4" /> Settings
          </button>
        </div>
      </header>
      {message ? (
        <Toast message={message} tone="success" onDismiss={() => setMessage(undefined)} />
      ) : null}

      <nav
        aria-label="Compliance views"
        role="tablist"
        className="flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={!taxCalendar && tab === t.id}
            onClick={() => choose(t.id)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${!taxCalendar && tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <ul
        data-testid="compliance-kpis"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6"
      >
        {card(
          'total',
          ListChecks,
          'green',
          'Total Deadlines',
          s?.kpis.total.value,
          () => choose('all'),
          trendOf(s?.kpis.total),
        )}
        {card('next30', Warning, 'red', 'Upcoming (Next 30 Days)', s?.kpis.next30Days, () =>
          choose('overview'),
        )}
        {card('overdue', Warning, 'amber', 'Overdue', s?.kpis.overdue, () => {
          choose('all');
          setFilters({ ...BLANK, range: 'ALL', status: 'OVERDUE' });
        })}
        {card(
          'done',
          CheckCircle,
          'green',
          'Completed (This Month)',
          s?.kpis.completedThisMonth.value,
          () => choose('completed'),
          trendOf(s?.kpis.completedThisMonth),
        )}
        {card(
          'recurring',
          ArrowsClockwise,
          'purple',
          'Recurring Deadlines',
          s?.kpis.recurring,
          () => choose('recurring'),
        )}
        {card(
          'risk',
          Users,
          'blue',
          'Clients at Risk',
          s?.kpis.clientsAtRisk,
          () => choose('client'),
          s && s.kpis.clientsAtRisk > 0 ? { note: 'Action needed' } : undefined,
        )}
      </ul>

      {taxCalendar ? <TaxCalendarView /> : null}
      {!taxCalendar && tab === 'client' ? <ByClientView /> : null}
      {!taxCalendar && tab === 'type' ? <ByTypeView /> : null}
      {!taxCalendar && tab === 'calendars' ? <CalendarsView /> : null}
      {!taxCalendar && tab === 'recurring' ? (
        <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" aria-label="Recurring">
          <RecurringList />
        </section>
      ) : null}

      {!taxCalendar && showFilters ? (
        <div className="grid items-start gap-4 xl:grid-cols-[16rem_minmax(0,1fr)]">
          <form
            aria-label="Filters"
            data-testid="filters"
            className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface p-4 shadow-md"
            onSubmit={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-heading">
                <Funnel aria-hidden weight="fill" className="size-5 text-action" /> Filters
              </h2>
              <button
                type="button"
                className="text-sm font-medium text-link"
                onClick={() => {
                  setFilters({ ...BLANK, range: tab === 'overview' ? 'NEXT_30_DAYS' : 'ALL' });
                  setDate(undefined);
                  setPage(1);
                }}
              >
                Reset
              </button>
            </div>
            {filterSelect('Date Range', 'range', RANGES)}
            {filterSelect('Deadline Type', 'type', [
              { value: '', label: 'All Types' },
              ...TYPE_OPTIONS,
            ])}
            {filterSelect('Client', 'clientId', [
              { value: '', label: 'All Clients' },
              ...clients.map((c) => ({ value: c.id, label: c.displayName })),
            ])}
            {filterSelect('Status', 'status', [
              { value: '', label: 'All Statuses' },
              ...(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((value) => ({
                value,
                label: STATUS_LABEL[value],
              })),
            ])}
            {filterSelect('Assigned To', 'assignedUserId', [
              { value: '', label: 'All Team Members' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ])}
            {filterSelect('Agency', 'agency', [
              { value: '', label: 'All Agencies' },
              ...agencyOptions.map((a) => ({ value: a, label: a })),
            ])}
            <div className="flex items-center gap-3 pt-1">
              <Toggle
                label="Show only my deadlines"
                checked={filters.mine}
                onChange={(on: boolean) => set({ mine: on })}
              />
              <span className="text-sm text-text">Show only my deadlines</span>
            </div>
          </form>
          <section
            className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
            aria-label={
              tab === 'overview' ? 'Upcoming Deadlines' : TABS.find((t) => t.id === tab)?.label
            }
          >
            <header className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-3 font-display text-lg font-bold text-heading">
                <span
                  aria-hidden
                  className="flex size-9 items-center justify-center rounded-lg bg-info-soft text-action"
                >
                  <CalendarCheck weight="fill" className="size-5" />
                </span>
                {tab === 'overview'
                  ? 'Upcoming Deadlines'
                  : tab === 'completed'
                    ? 'Completed Deadlines'
                    : 'All Deadlines'}
              </h2>
              {tab === 'overview' ? (
                <button
                  type="button"
                  onClick={() => choose('all')}
                  className="inline-flex items-center gap-1 text-sm font-medium text-link"
                >
                  View All <ArrowRight aria-hidden weight="bold" className="size-3" />
                </button>
              ) : null}
            </header>
            {date ? (
              <p className="mb-2 text-sm text-text">
                Due on {date}.{' '}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => setDate(undefined)}
                >
                  Show all dates
                </button>
              </p>
            ) : null}
            <DeadlineTable
              query={query}
              onQuery={onQuery}
              caption={tab === 'overview' ? 'Upcoming deadlines' : 'Deadlines'}
              pageSize={tab === 'overview' ? 8 : 10}
              compact={tab === 'overview'}
              hideBulk={tab === 'overview'}
              emptyText={
                tab === 'completed'
                  ? 'No completed deadlines yet.'
                  : tab === 'overview'
                    ? 'Nothing is due in this period.'
                    : 'Add a deadline to get started.'
              }
            />
          </section>
        </div>
      ) : null}

      {!taxCalendar && tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <DeadlineCalendar
            selected={date}
            onDate={setDate}
            filters={{
              ...(filters.type ? { type: filters.type } : {}),
              ...(filters.clientId ? { clientId: filters.clientId } : {}),
              ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}),
              ...(filters.mine ? { mine: true } : {}),
            }}
          />
          <TypesCard summary={s} loading={summary.isPending} failed={summary.isError} />
          <AtRiskCard
            summary={s}
            loading={summary.isPending}
            failed={summary.isError}
            onAll={() => choose('client')}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <QuickActions onBulk={() => choose('all')} />
        <ResourcesCard />
      </div>

      {settings ? (
        <SettingsDialog
          onClose={() => setSettings(false)}
          onDone={(text) => {
            setSettings(false);
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}
