'use client';

import type { ComplianceDeadlinesQuery } from '@firmivra/types';
import { Input, KpiCard, Select, Toast, Toggle } from '@firmivra/ui';
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
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
import {
  COMPLIANCE_KEY,
  PRIORITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  TYPE_OPTIONS,
  outlined,
} from './compliance-shared';
import { TypeAheadFilter } from './type-ahead';
import { ByClientView, ByTypeView, CalendarsView, TaxCalendarView } from './compliance-views';
import { DeadlineTable } from './deadline-table';
import { RecurringList } from './recurring-list';
import { ComplianceHelp } from './compliance-help';

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
  /** CD-F04: name, client, agency or form. */
  search: string;
  /** CD-F04: a custom From and To (YYYY-MM-DD) in place of a named range. */
  start: string;
  end: string;
  /** CD-F04: the deadline's own fields (More filters). */
  taxYear: string;
  priority: string;
  source: string;
  jurisdiction: string;
  /** 'yes' made by a recurring definition, 'no' one-time. */
  recurring: string;
}
const BLANK: Filters = {
  range: 'NEXT_30_DAYS',
  type: '',
  clientId: '',
  status: '',
  assignedUserId: '',
  agency: '',
  mine: false,
  search: '',
  start: '',
  end: '',
  taxYear: '',
  priority: '',
  source: '',
  jurisdiction: '',
  recurring: '',
};
/** The Assigned To choice for deadlines with no one assigned. */
const UNASSIGNED = 'none';
const JURISDICTIONS = { FEDERAL: 'Federal', STATE: 'State', LOCAL: 'Local', INTERNAL: 'Internal' };
/** Tax years from two ahead back to 2000. */
const TAX_YEARS = Array.from({ length: new Date().getFullYear() + 2 - 2000 + 1 }, (_, i) =>
  String(new Date().getFullYear() + 2 - i),
);
/** A value from the address that is one of the choices, or none. */
const oneOf = (v: string | null, choices: readonly string[]) => (v && choices.includes(v) ? v : '');
const MORE: (keyof Filters)[] = ['taxYear', 'priority', 'source', 'jurisdiction', 'recurring'];
/** The Date Range choice that shows From and To. */
const CUSTOM = 'CUSTOM';
const NO_DATES = { start: '', end: '' };
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
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
  // CD-F03, F05 (Octavia, Oct 28): the view, date range, filters, sort and page live in the
  // address, so Back from a client, a deadline or Add Deadline returns to exactly this list.
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab;
  const filters: Filters = {
    range:
      RANGES.find((r) => r.value === params.get('range'))?.value ??
      (tab === 'overview' ? 'NEXT_30_DAYS' : 'ALL'),
    type: params.get('type') ?? '',
    clientId: params.get('client') ?? '',
    status: params.get('status') ?? '',
    assignedUserId: params.get('assignee') ?? '',
    agency: params.get('agency') ?? '',
    mine: params.get('mine') === '1',
    search: params.get('q') ?? '',
    start: dayOf(params.get('start')),
    end: dayOf(params.get('end')),
    taxYear: oneOf(params.get('year'), TAX_YEARS),
    priority: oneOf(params.get('priority'), Object.keys(PRIORITY_LABEL)),
    source: oneOf(params.get('source'), Object.keys(SOURCE_LABEL)),
    jurisdiction: oneOf(params.get('jurisdiction'), Object.keys(JURISDICTIONS)),
    recurring: oneOf(params.get('recurring'), ['yes', 'no']),
  };
  // CD-F04 (Octavia, Oct 28): a custom From and To, kept in the address like the named ranges
  // ("from" there is the way back, so they are start and end).
  const custom = params.get('range') === CUSTOM || !!filters.start || !!filters.end;
  const badDates = !!filters.start && !!filters.end && filters.start > filters.end;
  const date = params.get('date') ?? undefined;
  const sort = {
    sort: (params.get('sort') ?? 'dueOn') as NonNullable<ComplianceDeadlinesQuery['sort']>,
    direction: (params.get('dir') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  /** One change to the address (every key at once, so none undoes another); page 1 unless set. */
  const go = (over: Record<string, string | null>, push = false) => {
    // The address as it is now, not as last drawn: two changes in a row never undo each other.
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in over)) next.delete('page');
    const href = `${pathname}${next.toString() ? `?${next.toString()}` : ''}`;
    if (push) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };
  const FILTER_KEYS = {
    type: 'type',
    clientId: 'client',
    status: 'status',
    assignedUserId: 'assignee',
    agency: 'agency',
    search: 'q',
    start: 'start',
    end: 'end',
    taxYear: 'year',
    priority: 'priority',
    source: 'source',
    jurisdiction: 'jurisdiction',
    recurring: 'recurring',
  } as const;
  const filterParams = (f: Partial<Filters>): Record<string, string | null> => ({
    ...('range' in f ? { range: f.range ?? null } : {}),
    ...Object.fromEntries(
      Object.entries(FILTER_KEYS)
        .filter(([k]) => k in f)
        .map(([k, p]) => [p, (f[k as keyof typeof FILTER_KEYS] as string | undefined) || null]),
    ),
    ...('mine' in f ? { mine: f.mine ? '1' : null } : {}),
  });
  const [taxCalendar, setTaxCalendar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState<string>();
  // What is typed shows at once; the address (and the list) follows it.
  const [term, setTerm] = useState(filters.search);
  const [dates, setDates] = useState({ start: filters.start, end: filters.end });
  const moreSet = MORE.filter((k) => filters[k]).length;
  const [more, setMore] = useState(moreSet > 0);
  const risk = params.get('risk');
  // An at-risk client's link is a new list (no search or dates): the fields start again from it.
  const [riskShown, setRiskShown] = useState(risk);
  if (riskShown !== risk) {
    setRiskShown(risk);
    setTerm(filters.search);
    setDates({ start: filters.start, end: filters.end });
  }
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

  /** Another view: a history step of its own, so browser Back returns to the view before. */
  const choose = (next: Tab, change: Partial<Filters> = {}) => {
    setTaxCalendar(false);
    // Each view starts on its own date range; a card's filters replace the search as well.
    setDates(NO_DATES);
    if ('search' in change) setTerm(change.search ?? '');
    go(
      {
        tab: next === 'overview' ? null : next,
        range: null,
        date: null,
        start: null,
        end: null,
        ...filterParams(change),
      },
      true,
    );
  };
  // A changed filter ends the at-risk banner (CD-F03): the list is no longer that client's.
  const set = (change: Partial<Filters>) => go({ ...filterParams(change), risk: null });
  const query: ComplianceDeadlinesQuery = {
    // CD-F02 (Octavia, Oct 28): the overview's list is what is still to do (no Completed or Not
    // Applicable), like its Upcoming card; every range is on the effective due date.
    tab: tab === 'completed' ? 'COMPLETED' : tab === 'overview' ? 'UPCOMING' : 'ALL',
    range: custom ? 'ALL' : filters.range,
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    ...(filters.type
      ? { type: filters.type as NonNullable<ComplianceDeadlinesQuery['type']> }
      : {}),
    ...(filters.status
      ? { status: filters.status as NonNullable<ComplianceDeadlinesQuery['status']> }
      : {}),
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
    ...(filters.assignedUserId === UNASSIGNED
      ? { unassigned: true }
      : filters.assignedUserId
        ? { assignedUserId: filters.assignedUserId }
        : {}),
    ...(filters.agency ? { agency: filters.agency } : {}),
    ...(filters.mine ? { mine: true } : {}),
    ...(filters.taxYear ? { taxYear: Number(filters.taxYear) } : {}),
    ...(filters.priority
      ? { priority: filters.priority as NonNullable<ComplianceDeadlinesQuery['priority']> }
      : {}),
    ...(filters.source
      ? { source: filters.source as NonNullable<ComplianceDeadlinesQuery['source']> }
      : {}),
    ...(filters.jurisdiction
      ? {
          jurisdiction: filters.jurisdiction as NonNullable<
            ComplianceDeadlinesQuery['jurisdiction']
          >,
        }
      : {}),
    ...(filters.recurring ? { recurring: filters.recurring === 'yes' } : {}),
    // A day picked on the calendar wins; an end before the start is not sent (its field says so).
    ...(date
      ? { from: date, to: date }
      : custom
        ? {
            ...(filters.start ? { from: filters.start } : {}),
            ...(filters.end && !badDates ? { to: filters.end } : {}),
          }
        : {}),
    ...sort,
    page,
  };
  const onQuery = (change: Partial<ComplianceDeadlinesQuery>) =>
    go({
      ...(change.sort
        ? {
            sort: change.sort === 'dueOn' ? null : change.sort,
            dir: change.direction === 'desc' ? 'desc' : null,
          }
        : {}),
      ...(change.page && Number(change.page) > 1 ? { page: String(change.page) } : {}),
    });
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
            <h1 className="flex items-center gap-2 font-display text-4xl font-bold text-heading">
              Compliance &amp; Deadlines <ComplianceHelp area="overview" />
            </h1>
            <p className="text-base text-muted">Stay compliant. Never miss a deadline.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <OriginLink
            href="/compliance/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-5 text-base font-medium text-on-action hover:bg-action-hover"
          >
            <Plus aria-hidden weight="bold" className="size-5" /> Add Deadline
          </OriginLink>
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
        {card('overdue', Warning, 'amber', 'Overdue', s?.kpis.overdue, () =>
          choose('all', { ...BLANK, range: 'ALL', status: 'OVERDUE' }),
        )}
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
                <Funnel aria-hidden weight="fill" className="size-5 text-action" /> Filters{' '}
                <ComplianceHelp area="filters" />
              </h2>
              <button
                type="button"
                className="text-sm font-medium text-link"
                onClick={() => {
                  setTerm('');
                  setDates(NO_DATES);
                  go({ ...filterParams({ ...BLANK, range: undefined }), range: null, date: null });
                }}
              >
                Reset
              </button>
            </div>
            <Input
              label="Search"
              type="search"
              maxLength={100}
              placeholder="Deadline, client or form"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                set({ search: e.target.value.trim() });
              }}
            />
            <Select
              label="Date Range"
              value={custom ? CUSTOM : filters.range}
              onChange={(e) => {
                const v = e.target.value;
                if (v !== CUSTOM) setDates(NO_DATES);
                go(
                  v === CUSTOM
                    ? { range: CUSTOM, date: null, risk: null }
                    : { range: v, start: null, end: null, date: null, risk: null },
                );
              }}
              options={[...RANGES, { value: CUSTOM, label: 'Custom Dates' }]}
            />
            {custom ? (
              <div className="flex flex-col gap-2" data-testid="custom-dates">
                <Input
                  label="From"
                  type="date"
                  value={dates.start}
                  max={dates.end || undefined}
                  onChange={(e) => {
                    setDates((d) => ({ ...d, start: e.target.value }));
                    go({ range: CUSTOM, start: e.target.value, date: null, risk: null });
                  }}
                />
                <Input
                  label="To"
                  type="date"
                  value={dates.end}
                  min={dates.start || undefined}
                  error={badDates ? 'The end date is before the start date' : undefined}
                  onChange={(e) => {
                    setDates((d) => ({ ...d, end: e.target.value }));
                    go({ range: CUSTOM, end: e.target.value, date: null, risk: null });
                  }}
                />
              </div>
            ) : null}
            {filterSelect('Deadline Type', 'type', [
              { value: '', label: 'All Types' },
              ...TYPE_OPTIONS,
            ])}
            <TypeAheadFilter
              label="Client"
              placeholder="All Clients"
              value={filters.clientId}
              options={clients.map((c) => ({ value: c.id, label: c.displayName }))}
              onPick={(v) => set({ clientId: v })}
            />
            {filterSelect('Status', 'status', [
              { value: '', label: 'All Statuses' },
              ...(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((value) => ({
                value,
                label: STATUS_LABEL[value],
              })),
            ])}
            <TypeAheadFilter
              label="Assigned To"
              placeholder="All Team Members"
              value={filters.assignedUserId}
              options={[
                { value: UNASSIGNED, label: 'Unassigned' },
                ...members.map((m) => ({ value: m.userId, label: m.name })),
              ]}
              onPick={(v) => set({ assignedUserId: v })}
            />
            {filterSelect('Agency', 'agency', [
              { value: '', label: 'All Agencies' },
              ...agencyOptions.map((a) => ({ value: a, label: a })),
            ])}
            <button
              type="button"
              aria-expanded={more}
              aria-controls="more-filters"
              className="self-start text-sm font-medium text-link"
              onClick={() => setMore(!more)}
            >
              {more ? 'Fewer filters' : `More filters${moreSet ? ` (${moreSet})` : ''}`}
            </button>
            {more ? (
              <div id="more-filters" className="flex flex-col gap-3" data-testid="more-filters">
                {filterSelect('Tax Year', 'taxYear', [
                  { value: '', label: 'All Tax Years' },
                  ...TAX_YEARS.map((y) => ({ value: y, label: y })),
                ])}
                {filterSelect('Priority', 'priority', [
                  { value: '', label: 'All Priorities' },
                  ...Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label })),
                ])}
                {filterSelect('Source', 'source', [
                  { value: '', label: 'All Sources' },
                  ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label })),
                ])}
                {filterSelect('Jurisdiction', 'jurisdiction', [
                  { value: '', label: 'All Jurisdictions' },
                  ...Object.entries(JURISDICTIONS).map(([value, label]) => ({ value, label })),
                ])}
                {filterSelect('Recurring', 'recurring', [
                  { value: '', label: 'Recurring and One-Time' },
                  { value: 'yes', label: 'Recurring Only' },
                  { value: 'no', label: 'One-Time Only' },
                ])}
              </div>
            ) : null}
            <div className="flex items-center gap-3 pt-1">
              <Toggle
                label="Show only my deadlines"
                checked={filters.mine}
                onChange={(on: boolean) => set({ mine: on })}
              />
              <span className="text-sm text-text">Show only my deadlines</span>
            </div>
          </form>
          {risk && filters.clientId ? (
            <p
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm text-heading"
              data-testid="risk-banner"
            >
              <span>
                <strong>
                  {clients.find((c) => c.id === filters.clientId)?.displayName ?? 'This client'}
                </strong>{' '}
                is at risk: {risk}.
              </span>
              <button
                type="button"
                className="font-medium text-link"
                onClick={() => go({ client: null, risk: null })}
              >
                Show all clients
              </button>
            </p>
          ) : null}
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
                <span className="flex flex-col">
                  {tab === 'overview'
                    ? 'Upcoming Deadlines'
                    : tab === 'completed'
                      ? 'Completed Deadlines'
                      : 'All Deadlines'}
                  <span
                    className="font-sans text-xs font-normal text-muted"
                    data-testid="date-basis"
                  >
                    {tab === 'overview'
                      ? 'Open deadlines only, by effective due date (the extended date when an extension was filed).'
                      : 'Dates and ranges use the effective due date (the extended date when an extension was filed).'}
                  </span>
                </span>
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
                  onClick={() => go({ date: null })}
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
            onDate={(d) => go({ date: d ?? null })}
            filters={{
              ...(filters.type ? { type: filters.type } : {}),
              ...(filters.clientId ? { clientId: filters.clientId } : {}),
              ...(filters.assignedUserId && filters.assignedUserId !== UNASSIGNED
                ? { assignedUserId: filters.assignedUserId }
                : {}),
              ...(filters.mine ? { mine: true } : {}),
            }}
          />
          <TypesCard summary={s} loading={summary.isPending} failed={summary.isError} />
          <AtRiskCard
            summary={s}
            loading={summary.isPending}
            failed={summary.isError}
            onAll={() => choose('client')}
            viewHref={(clientId, reason) =>
              `${pathname}?${new URLSearchParams({ tab: 'all', range: 'ALL', client: clientId, risk: reason }).toString()}`
            }
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
