'use client';

import {
  ActionMenu,
  Avatar,
  Button,
  Callout,
  Card,
  DateRangePicker,
  FilterBar,
  FilterGroup,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Table,
  Tabs,
  Toast,
  type Column,
} from '@firmivra/ui';
import {
  ArrowSquareOut,
  Buildings,
  Copy,
  Database,
  DotsThreeVertical,
  DownloadSimple,
  FileCsv,
  FileText,
  GearSix,
  Info,
  LinkSimple,
  Shield,
  User,
  UserGear,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useEffect, useState } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminAuditSecurity,
  ALERT_STATES,
  AUDIT_VIEWS,
  OUTCOMES,
  SEVERITIES,
  type AuditEvent,
  type AuditEventQuery,
  type AuditExport,
  type AuditView,
  type ExportFormat,
} from '../../../../../mocks/admin-audit-security';
import { AuditKpis } from './audit-kpis';
import {
  ALERT_LABELS,
  formatDate,
  formatTime,
  LinkButton,
  loadError,
  OUTCOME_LABELS,
  QuietLine,
  SEVERITY_LABELS,
  SeverityBadge,
} from './audit-parts';

/**
 * Audit & Security dashboard (S02, audit-and-security-dashboard.jpg; docx §2 Page A). The tabs
 * are the docx §5 supporting areas (login history, role changes, data changes, integration
 * activity, security alerts, policy changes) as filters of one event list.
 */
const VIEWS: { id: AuditView; label: string; icon: Icon; text: string }[] = [
  {
    id: 'audit',
    label: 'Audit Logs',
    icon: FileText,
    text: 'View a detailed history of important actions performed in Firmivra. Use filters to find specific activity, export logs, or investigate changes.',
  },
  {
    id: 'security',
    label: 'Security Events',
    icon: Warning,
    text: 'Security alerts and suspicious activity across the platform. Open an event to investigate it and respond.',
  },
  {
    id: 'login',
    label: 'Login History',
    icon: UserGear,
    text: 'Successful and failed logins, logouts, MFA challenges, password resets and revoked sessions.',
  },
  {
    id: 'permissions',
    label: 'Role & Permission Changes',
    icon: UserGear,
    text: 'Every role assigned or removed, permission change and admin access change, with who made it.',
  },
  {
    id: 'data',
    label: 'Data Changes',
    icon: Database,
    text: 'Records created, updated, deleted and exported, with their safe field-level changes.',
  },
  {
    id: 'integrations',
    label: 'Integration Activity',
    icon: LinkSimple,
    text: 'Connections, tests, credential changes, webhook failures and authentication failures of integrations.',
  },
  {
    id: 'policies',
    label: 'Security Policies',
    icon: Shield,
    text: "Changes to security policies, by Firmivra and by firm admins. Change the platform's policies in Security Settings.",
  },
];

type SortId = NonNullable<AuditEventQuery['sort']>;
const SORTS: readonly SortId[] = ['at', 'user', 'firm', 'action', 'severity'];
const ALERT_FILTERS = [...ALERT_STATES, 'NONE'] as const;
const PAGE_SIZE = 8;

interface Filters {
  view: AuditView;
  search: string;
  firm: string;
  user: string;
  action: string;
  severity: string;
  outcome: string;
  alert: string;
  resource: string;
  /** `YYYY-MM-DD` on the viewer's calendar. */
  from: string;
  to: string;
  sort: SortId;
  descending: boolean;
  page: number;
}

const pad = (value: number) => String(value).padStart(2, '0');
const dayText = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** The last 14 days, today included. */
function defaultFilters(): Filters {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13);
  return {
    view: 'audit',
    search: '',
    firm: '',
    user: '',
    action: '',
    severity: '',
    outcome: '',
    alert: '',
    resource: '',
    from: dayText(from),
    to: dayText(today),
    sort: 'at',
    descending: true,
    page: 1,
  };
}
const oneOf = <T extends string>(list: readonly T[], value: string | null): T | undefined =>
  list.find((item) => item === value);

/** The page's query string, as the server passes it (`?view=login&user=…`). */
export type AddressQuery = Record<string, string | string[] | undefined>;

/** The filters live in the address, so a filtered view can be reopened or shared (docx §2). */
function readFilters(address: AddressQuery): Filters {
  const base = defaultFilters();
  const get = (key: string) => {
    const value = address[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
  const text = (key: string) => (get(key) ?? '').slice(0, 100);
  const date = (key: string, fallback: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(text(key)) ? text(key) : fallback;
  const page = Number(get('page'));
  return {
    ...base,
    view: oneOf(AUDIT_VIEWS, get('view')) ?? base.view,
    search: text('q'),
    firm: text('firm'),
    user: text('user'),
    action: text('action'),
    severity: oneOf(SEVERITIES, get('severity')) ?? '',
    outcome: oneOf(OUTCOMES, get('outcome')) ?? '',
    alert: oneOf(ALERT_FILTERS, get('alert')) ?? '',
    resource: text('resource'),
    from: date('from', base.from),
    to: date('to', base.to),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
function addressOf(filters: Filters): string {
  const base = defaultFilters();
  const params = new URLSearchParams();
  const put = (key: string, value: string, fallback = '') => {
    if (value !== fallback) params.set(key, value);
  };
  put('view', filters.view, base.view);
  put('q', filters.search);
  put('firm', filters.firm);
  put('user', filters.user);
  put('action', filters.action);
  put('severity', filters.severity);
  put('outcome', filters.outcome);
  put('alert', filters.alert);
  put('resource', filters.resource);
  put('from', filters.from, base.from);
  put('to', filters.to, base.to);
  put('page', String(filters.page), '1');
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

/** Whole days on the viewer's calendar, as ISO moments. */
const startOf = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const endOf = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);
const eventHref = (id: string) => `/audit-security/events/${id}`;

/** Hands the export to the browser as a file; the link is short-lived and the export is logged. */
function saveFile(file: AuditExport) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AuditDashboard({ address }: { address: AddressQuery }) {
  const router = useRouter();
  const [filters, setFilters] = useState(() => readFilters(address));
  // The default range for this visit, to tell whether any filter is on.
  const [base] = useState(defaultFilters);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  // Typing in the search box stays quick; the list follows a moment later.
  const shown = useDeferredValue(filters);

  useEffect(() => {
    const next = addressOf(filters);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [filters]);

  const update = (patch: Partial<Filters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  const clearFilters = () => setFilters({ ...defaultFilters(), view: filters.view });
  const filtered =
    !!(filters.search || filters.firm || filters.user || filters.action || filters.severity) ||
    !!(filters.outcome || filters.alert || filters.resource) ||
    filters.from !== base.from ||
    filters.to !== base.to;

  const range = { from: startOf(shown.from), to: endOf(shown.to) };
  const query: AuditEventQuery = {
    view: shown.view,
    search: shown.search || undefined,
    firm: shown.firm || undefined,
    user: shown.user || undefined,
    action: shown.action || undefined,
    severity: oneOf(SEVERITIES, shown.severity),
    outcome: oneOf(OUTCOMES, shown.outcome),
    alert: oneOf(ALERT_FILTERS, shown.alert),
    resource: shown.resource || undefined,
    ...range,
    sort: shown.sort,
    descending: shown.descending,
    page: shown.page,
    pageSize: PAGE_SIZE,
  };
  const summary = useApiQuery(['admin-audit-security', 'summary', range.from, range.to], () =>
    adminAuditSecurity.summary(range),
  );
  const facets = useApiQuery(['admin-audit-security', 'facets'], () => adminAuditSecurity.facets());
  const events = useApiQuery(['admin-audit-security', 'events', query], () =>
    adminAuditSecurity.events(query),
  );
  const exporter = useApiMutation(
    (format: ExportFormat) =>
      adminAuditSecurity.exportEvents({
        query: { ...query, page: undefined, pageSize: undefined },
        format,
      }),
    { invalidate: ['admin-audit-security'] },
  );

  function exportAs(format: ExportFormat) {
    setNotice(null);
    exporter.mutate(format, {
      onSuccess: (file) => {
        saveFile(file);
        const noun = file.rowCount === 1 ? 'event' : 'events';
        setNotice({
          tone: 'success',
          text: `Exported ${file.rowCount} ${noun} as ${format}. The export was added to the audit log.`,
        });
      },
      onError: (error) => setNotice({ tone: 'error', text: errorMessage(error) }),
    });
  }

  const view = VIEWS.find((item) => item.id === filters.view) ?? VIEWS[0];
  const option = (value: string, label: string) => ({ value, label });

  const columns: Column<AuditEvent>[] = [
    {
      id: 'at',
      label: 'Date & Time',
      sortable: true,
      className: 'whitespace-nowrap',
      cell: (event) => (
        <time dateTime={event.at}>
          <span className="block">{formatDate(event.at)}</span>
          <span className="block">{formatTime(event.at)}</span>
        </time>
      ),
    },
    {
      id: 'user',
      label: 'User',
      sortable: true,
      className: 'min-w-44',
      cell: (event) => (
        <span className="flex items-center gap-3">
          <Avatar name={event.actor.name} size="lg" />
          <span className="min-w-0">
            <span className="block font-semibold text-heading">{event.actor.name}</span>
            <span className="block text-xs text-muted">{event.actor.role}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'firm',
      label: 'Firm',
      sortable: true,
      className: 'min-w-32',
      cell: (event) => event.firm.name,
    },
    {
      id: 'action',
      label: 'Action',
      sortable: true,
      className: 'min-w-32',
      cell: (event) => (
        <Link href={eventHref(event.id)} className="hover:text-action hover:underline">
          {event.action}
        </Link>
      ),
    },
    { id: 'details', label: 'Details', className: 'min-w-44', cell: (event) => event.details },
    {
      id: 'ip',
      label: 'IP Address',
      className: 'whitespace-nowrap',
      cell: (event) => event.device.ip ?? '—',
    },
    {
      id: 'device',
      label: 'Device',
      cell: (event) => (
        <>
          <span className="block">{event.device.browserName}</span>
          <span className="block">{event.device.osName}</span>
        </>
      ),
    },
    {
      id: 'severity',
      label: 'Severity',
      sortable: true,
      cell: (event) => <SeverityBadge severity={event.severity} />,
    },
  ];

  const page = events.data;
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const first = page ? (page.page - 1) * page.pageSize + 1 : 0;
  const last = page ? Math.min(page.page * page.pageSize, page.total) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Audit & Security"
        subtitle="Monitor activity, review security events, and maintain a secure platform."
        actions={
          <>
            <ActionMenu
              label="Export Logs"
              trigger={
                <span className="inline-flex items-center gap-2 text-action">
                  <DownloadSimple aria-hidden weight="fill" className="size-4" />
                  {exporter.isPending ? 'Exporting…' : 'Export Logs'}
                </span>
              }
              sections={[
                {
                  title: 'Filtered results',
                  items: [
                    { label: 'Export as CSV', icon: FileCsv, onSelect: () => exportAs('CSV') },
                    { label: 'Export as JSON', icon: FileText, onSelect: () => exportAs('JSON') },
                  ],
                },
              ]}
            />
            <LinkButton href="/audit-security/settings" variant="primary">
              <GearSix aria-hidden weight="fill" className="size-5" />
              Security Settings
            </LinkButton>
          </>
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <AuditKpis query={summary} />

      {/* The seven tabs wrap on a phone instead of widening the page. */}
      <div className="min-w-0 max-lg:[&_[role=tablist]]:flex-wrap max-lg:[&_[role=tablist]]:gap-x-4">
        <Tabs
          label="Event categories"
          variant="underline"
          value={filters.view}
          onChange={(id) => update({ view: oneOf(AUDIT_VIEWS, id) ?? 'audit' })}
          items={VIEWS.map((item) => ({ id: item.id, label: item.label, icon: item.icon }))}
        />
      </div>

      {view ? (
        <div data-testid="view-intro">
          <Callout size="compact" surface="info" icon={Info} title={view.label}>
            <span>
              {view.text}
              {view.id === 'policies' ? (
                <>
                  {' '}
                  <Link
                    href="/audit-security/settings"
                    className="font-semibold text-link hover:underline"
                  >
                    Open Security Settings
                  </Link>
                </>
              ) : null}
            </span>
          </Callout>
        </div>
      ) : null}

      <div data-testid="audit-filters">
        <FilterBar
          onReset={filtered ? clearFilters : undefined}
          resetLabel="Clear Filters"
          onClear={() => update({ outcome: '', alert: '', resource: '' })}
          more={
            <>
              <FilterGroup title="Outcome">
                <Select
                  label="Outcome"
                  hideLabel
                  value={filters.outcome}
                  onChange={(event) => update({ outcome: event.target.value })}
                  options={[
                    option('', 'Any outcome'),
                    ...OUTCOMES.map((value) => option(value, OUTCOME_LABELS[value])),
                  ]}
                />
              </FilterGroup>
              <FilterGroup title="Alert State">
                <Select
                  label="Alert state"
                  hideLabel
                  value={filters.alert}
                  onChange={(event) => update({ alert: event.target.value })}
                  options={[
                    option('', 'Any alert state'),
                    ...ALERT_STATES.map((value) => option(value, ALERT_LABELS[value])),
                    option('NONE', 'No alert'),
                  ]}
                />
              </FilterGroup>
              <FilterGroup title="Resource Type">
                <Select
                  label="Resource type"
                  hideLabel
                  value={filters.resource}
                  onChange={(event) => update({ resource: event.target.value })}
                  options={[
                    option('', 'All resources'),
                    ...(facets.data?.resources ?? []).map((value) => option(value, value)),
                  ]}
                />
              </FilterGroup>
            </>
          }
        >
          <SearchField
            label="Search events"
            placeholder="Search by user, action, or details..."
            maxLength={100}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <div className="w-full sm:w-40">
            <Select
              label="Firm"
              hideLabel
              value={filters.firm}
              onChange={(event) => update({ firm: event.target.value })}
              options={[
                option('', 'All Firms'),
                ...(facets.data?.firms ?? []).map((firm) => option(firm.id, firm.name)),
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="User"
              hideLabel
              value={filters.user}
              onChange={(event) => update({ user: event.target.value })}
              options={[
                option('', 'All Users'),
                ...(facets.data?.users ?? []).map((user) => option(user.id, user.name)),
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="Action"
              hideLabel
              value={filters.action}
              onChange={(event) => update({ action: event.target.value })}
              options={[
                option('', 'All Actions'),
                ...(facets.data?.actions ?? []).map((action) => option(action, action)),
              ]}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select
              label="Severity"
              hideLabel
              value={filters.severity}
              onChange={(event) => update({ severity: event.target.value })}
              options={[
                option('', 'All Severity'),
                ...SEVERITIES.map((value) => option(value, SEVERITY_LABELS[value])),
              ]}
            />
          </div>
          <DateRangePicker
            label="Date range"
            value={{ from: filters.from, to: filters.to }}
            onChange={(next) => update({ from: next.from, to: next.to })}
          />
        </FilterBar>
      </div>

      <Card data-testid="audit-events" className="min-w-0 overflow-hidden p-0! contain-paint">
        {events.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(events.error)}</QuietLine>
          </div>
        ) : page && !page.items.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            <p className="font-semibold text-heading">No events match these filters.</p>
            <p className="text-sm text-muted">
              Change the date range or the filters, or clear them to see more activity.
            </p>
            {filtered ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear Filters
              </Button>
            ) : null}
          </div>
        ) : (
          <Table
            caption="Audit and security events"
            rows={page?.items ?? []}
            loading={events.isPending}
            columns={columns}
            rowKey={(event) => event.id}
            noun="logs"
            showPagination={false}
            server={{
              page: page?.page ?? 1,
              total: page?.total,
              hasNext: page ? page.page < pageCount : false,
              hasPrevious: (page?.page ?? 1) > 1,
              onNext: () => update({ page: (page?.page ?? 1) + 1 }),
              onPrevious: () => update({ page: (page?.page ?? 2) - 1 }),
              onPage: (next) => update({ page: next }),
              sort: { id: filters.sort, descending: filters.descending },
              onSort: (sort) =>
                update({ sort: oneOf(SORTS, sort.id) ?? 'at', descending: sort.descending }),
            }}
            rowActions={(event) => (
              <>
                <LinkButton href={eventHref(event.id)} size="sm">
                  View<span className="sr-only"> event {event.reference}</span>
                </LinkButton>
                <ActionMenu
                  label={`More actions for ${event.reference}`}
                  trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                  sections={[
                    {
                      items: [
                        {
                          label: 'Open Event',
                          icon: ArrowSquareOut,
                          onSelect: () => router.push(eventHref(event.id)),
                        },
                        ...(event.actor.id
                          ? [
                              {
                                label: "Show This User's Events",
                                icon: User,
                                onSelect: () => update({ user: event.actor.id ?? '' }),
                              },
                            ]
                          : []),
                        {
                          label: "Show This Firm's Events",
                          icon: Buildings,
                          onSelect: () => update({ firm: event.firm.id ?? 'platform' }),
                        },
                        {
                          label: 'Copy Event ID',
                          icon: Copy,
                          onSelect: () => void navigator.clipboard?.writeText(event.reference),
                        },
                      ],
                    },
                  ]}
                />
              </>
            )}
          />
        )}
      </Card>

      {page && page.total > 0 ? (
        <Pagination
          page={page.page}
          pageCount={pageCount}
          onPage={(next) => update({ page: next })}
          summary={`Showing ${first} – ${last} of ${page.total} logs`}
        />
      ) : null}
    </div>
  );
}
