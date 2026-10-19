'use client';

import {
  ActionMenu,
  Button,
  Card,
  DateRangePicker,
  FilterBar,
  FilterChip,
  FilterGroup,
  Input,
  Pagination,
  SearchField,
  Select,
  Table,
  Toast,
  type Column,
} from '@firmivra/ui';
import { DownloadSimple, FileCsv, FileText } from '@phosphor-icons/react';
import { useDeferredValue, useEffect, useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  LOG_OUTCOMES,
  LOG_SEVERITIES,
  LOG_SEVERITY_LABELS,
  LOG_SOURCE_LABELS,
  LOG_SOURCES,
  type ExportFormat,
  type IntegrationLog,
  type LogExport,
} from '../../../../../../mocks/admin-integrations';
import { LogSeverityBadge, OutcomeBadge } from '../../_components/integration-badges';
import { formatDate, formatTime } from '../../_components/integration-format';
import {
  integrationErrorMessage,
  loadError,
  QuietLine,
} from '../../_components/integration-states';
import { IntegrationsHeader, IntegrationsNav } from '../../_components/integrations-shell';
import type { Notice } from '../../_components/platform-actions';
import { LogDetailDrawer } from './log-detail';
import {
  addressOf,
  addressValue,
  EMPTY_FILTERS,
  isFiltered,
  queryOf,
  readFilters,
  type AddressQuery,
  type LogFilters,
} from './log-filters';

/**
 * Integration Logs (docx §9; no design frame, built in the dashboard's look): the central,
 * searchable log of every integration's syncs, tests, webhooks, API calls and firm connections.
 * Filters combine with AND and live in the address (`?integration=<id>` from a platform
 * integration pre-fills the filter); a record opens in a side panel (`?log=<id>`); Export
 * downloads the filtered rows as CSV or JSON, redacted, and the export is audited.
 */

const OUTCOME_LABELS = { SUCCESS: 'Success', FAILURE: 'Failed' } as const;
/** The "More Filters" fields, and the change that clears each one. */
type MoreKey = 'source' | 'eventType' | 'environment' | 'requestId' | 'firm';
const CLEAR_MORE: Record<MoreKey, Partial<LogFilters>> = {
  source: { source: '' },
  eventType: { eventType: '' },
  environment: { environment: '' },
  requestId: { requestId: '' },
  firm: { firm: '' },
};
const option = (value: string, label: string) => ({ value, label });

/** Hands the export to the browser as a file; the link is short-lived. */
function saveFile(file: LogExport) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** The slim "View" button of a row (the dashboard's "Manage" look). */
function ViewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative inline-flex min-h-9 items-center justify-center rounded-control border border-border bg-surface px-5 py-1.5 text-sm font-semibold whitespace-nowrap text-action transition-colors hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      View<span className="sr-only"> {label}</span>
    </button>
  );
}

export function IntegrationLogs({ address }: { address: AddressQuery }) {
  const [filters, setFilters] = useState(() => readFilters(address));
  const [logId, setLogId] = useState<string | null>(() => addressValue(address, 'log') || null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Typing in the search stays quick; the list follows a moment later.
  const shown = useDeferredValue(filters);

  useEffect(() => {
    const next = addressOf(filters, logId);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [filters, logId]);

  const update = (patch: Partial<LogFilters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const filtered = isFiltered(filters);

  const query = queryOf(shown);
  const facets = useApiQuery(['admin-integrations', 'logs', 'facets'], () =>
    adminIntegrations.logFacets(),
  );
  const logs = useApiQuery(['admin-integrations', 'logs', 'list', query], () =>
    adminIntegrations.listLogs(query),
  );
  const exporter = useApiMutation(
    (format: ExportFormat) =>
      adminIntegrations.exportLogs({
        query: { ...query, page: undefined, pageSize: undefined },
        format,
      }),
    { invalidate: ['admin-integrations'] },
  );

  function exportAs(format: ExportFormat) {
    setNotice(null);
    exporter.mutate(format, {
      onSuccess: (file) => {
        saveFile(file);
        setNotice({
          tone: 'success',
          text: `Exported ${file.rowCount} ${file.rowCount === 1 ? 'record' : 'records'} as ${format}, with sensitive fields redacted. The export was added to the audit log.`,
        });
      },
      onError: (error) => setNotice({ tone: 'error', text: integrationErrorMessage(error) }),
    });
  }

  // A deep link may name an integration the log has no records for yet: keep it choosable.
  const integrations = facets.data?.integrations ?? [];
  const integrationOptions = [
    option('', 'All Integrations'),
    ...integrations.map((item) => option(item.id, item.name)),
    ...(filters.integration && !integrations.some((item) => item.id === filters.integration)
      ? [option(filters.integration, facets.data ? 'Selected integration' : 'Loading…')]
      : []),
  ];
  const integrationName =
    integrations.find((item) => item.id === filters.integration)?.name ?? 'Selected integration';

  // The "More Filters" values, shown as chips so a deep-linked filter is never hidden.
  const firmName = facets.data?.firms.find((firm) => firm.id === filters.firm)?.name;
  const chips: { key: MoreKey; label: string }[] = [
    filters.source
      ? { key: 'source', label: `Source: ${LOG_SOURCE_LABELS[filters.source]}` }
      : null,
    filters.eventType ? { key: 'eventType', label: `Event: ${filters.eventType}` } : null,
    filters.environment
      ? { key: 'environment', label: `Environment: ${ENVIRONMENT_LABELS[filters.environment]}` }
      : null,
    filters.requestId ? { key: 'requestId', label: `ID: ${filters.requestId}` } : null,
    filters.firm ? { key: 'firm', label: `Firm: ${firmName ?? 'Selected firm'}` } : null,
  ].filter((chip): chip is { key: MoreKey; label: string } => chip !== null);

  const columns: Column<IntegrationLog>[] = [
    {
      id: 'at',
      label: 'Time',
      sortable: true,
      className: 'whitespace-nowrap',
      cell: (log) => (
        <time dateTime={log.at} className="text-heading">
          <span className="block">{formatDate(log.at)}</span>
          <span className="block text-xs text-muted">{formatTime(log.at)}</span>
        </time>
      ),
    },
    {
      id: 'integration',
      label: 'Integration',
      className: 'min-w-36',
      cell: (log) => (
        <span className="flex flex-col">
          <span className="font-semibold text-heading">
            {log.integrationName ?? LOG_SOURCE_LABELS[log.source]}
          </span>
          <span className="text-xs text-muted">
            {LOG_SOURCE_LABELS[log.source]}
            {log.environment ? ` · ${ENVIRONMENT_LABELS[log.environment]}` : ''}
          </span>
          {log.firm ? <span className="text-xs text-muted">{log.firm.name}</span> : null}
        </span>
      ),
    },
    {
      id: 'event',
      label: 'Event',
      className: 'min-w-56',
      cell: (log) => (
        <span className="flex flex-col">
          <span className="text-heading">{log.message}</span>
          <code className="font-mono text-xs text-muted">{log.eventType}</code>
        </span>
      ),
    },
    {
      id: 'severity',
      label: 'Severity',
      cell: (log) => <LogSeverityBadge severity={log.severity} />,
    },
    {
      id: 'outcome',
      label: 'Outcome',
      className: 'whitespace-nowrap',
      cell: (log) => (
        <span className="flex flex-col items-start gap-1">
          <OutcomeBadge succeeded={log.succeeded} />
          {log.errorCode ? (
            <code className="font-mono text-xs text-danger">{log.errorCode}</code>
          ) : null}
        </span>
      ),
    },
    {
      id: 'request',
      label: 'Request ID',
      className: 'whitespace-nowrap',
      cell: (log) =>
        log.requestId ? (
          <code className="font-mono text-xs text-text">{log.requestId}</code>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  const page = logs.data;
  const pageCount = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
  const first = page ? (page.page - 1) * page.pageSize + 1 : 0;
  const last = page ? Math.min(page.page * page.pageSize, page.total) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Integration Logs"
        subtitle="Search sync events, connection tests, webhooks, API calls and errors across every integration."
        crumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Integration Logs' }]}
        actions={
          logs.isError ? (
            <Button variant="secondary" disabled>
              <DownloadSimple aria-hidden weight="fill" className="size-4" />
              Export
            </Button>
          ) : (
            <ActionMenu
              label="Export"
              trigger={
                <span className="inline-flex items-center gap-2 text-action">
                  <DownloadSimple aria-hidden weight="fill" className="size-4" />
                  {exporter.isPending ? 'Exporting…' : 'Export'}
                </span>
              }
              sections={[
                {
                  title: 'Filtered results, redacted',
                  items: [
                    { label: 'Export as CSV', icon: FileCsv, onSelect: () => exportAs('CSV') },
                    { label: 'Export as JSON', icon: FileText, onSelect: () => exportAs('JSON') },
                  ],
                },
              ]}
            />
          )
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <IntegrationsNav current="logs" />

      <div data-testid="log-filters" className="flex flex-col gap-3">
        <FilterBar
          onReset={filtered ? clearFilters : undefined}
          resetLabel="Clear Filters"
          onClear={() =>
            update({ source: '', eventType: '', environment: '', requestId: '', firm: '' })
          }
          more={
            <>
              <FilterGroup title="Source">
                <Select
                  label="Source"
                  hideLabel
                  value={filters.source}
                  onChange={(event) =>
                    update({
                      source: LOG_SOURCES.find((value) => value === event.target.value) ?? '',
                    })
                  }
                  options={[
                    option('', 'All sources'),
                    ...LOG_SOURCES.map((value) => option(value, LOG_SOURCE_LABELS[value])),
                  ]}
                />
              </FilterGroup>
              <FilterGroup title="Event Type">
                <Select
                  label="Event type"
                  hideLabel
                  value={filters.eventType}
                  onChange={(event) => update({ eventType: event.target.value })}
                  options={[
                    option('', 'All event types'),
                    ...(facets.data?.eventTypes ?? []).map((value) => option(value, value)),
                    ...(filters.eventType && !facets.data?.eventTypes.includes(filters.eventType)
                      ? [option(filters.eventType, filters.eventType)]
                      : []),
                  ]}
                />
              </FilterGroup>
              <FilterGroup title="Environment">
                <Select
                  label="Environment"
                  hideLabel
                  value={filters.environment}
                  onChange={(event) =>
                    update({
                      environment: ENVIRONMENTS.find((value) => value === event.target.value) ?? '',
                    })
                  }
                  options={[
                    option('', 'All environments'),
                    ...ENVIRONMENTS.map((value) => option(value, ENVIRONMENT_LABELS[value])),
                  ]}
                />
              </FilterGroup>
              <FilterGroup title="Request or Correlation ID">
                <Input
                  label="Request or correlation ID"
                  hideLabel
                  placeholder="req_… or corr_…"
                  maxLength={100}
                  autoComplete="off"
                  value={filters.requestId}
                  onChange={(event) => update({ requestId: event.target.value })}
                />
              </FilterGroup>
              <FilterGroup title="Firm">
                <Select
                  label="Firm"
                  hideLabel
                  value={filters.firm}
                  onChange={(event) => update({ firm: event.target.value })}
                  options={[
                    option('', 'All firms'),
                    ...(facets.data?.firms ?? []).map((firm) => option(firm.id, firm.name)),
                    ...(filters.firm && !facets.data?.firms.some((firm) => firm.id === filters.firm)
                      ? [option(filters.firm, 'Selected firm')]
                      : []),
                  ]}
                />
              </FilterGroup>
            </>
          }
        >
          <SearchField
            label="Search logs"
            placeholder="Search by message, integration, request ID or firm..."
            maxLength={100}
            value={filters.search}
            onChange={(event) => update({ search: event.target.value })}
          />
          <div className="w-full sm:w-44">
            <Select
              label="Integration"
              hideLabel
              value={filters.integration}
              onChange={(event) => update({ integration: event.target.value })}
              options={integrationOptions}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select
              label="Severity"
              hideLabel
              value={filters.severity}
              onChange={(event) =>
                update({
                  severity: LOG_SEVERITIES.find((value) => value === event.target.value) ?? '',
                })
              }
              options={[
                option('', 'All Severity'),
                ...LOG_SEVERITIES.map((value) => option(value, LOG_SEVERITY_LABELS[value])),
              ]}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select
              label="Outcome"
              hideLabel
              value={filters.outcome}
              onChange={(event) =>
                update({
                  outcome: LOG_OUTCOMES.find((value) => value === event.target.value) ?? '',
                })
              }
              options={[
                option('', 'Any Outcome'),
                ...LOG_OUTCOMES.map((value) => option(value, OUTCOME_LABELS[value])),
              ]}
            />
          </div>
          <DateRangePicker
            label="Date range"
            value={{ from: filters.from, to: filters.to }}
            onChange={(next) => update({ from: next.from, to: next.to })}
          />
        </FilterBar>
        {chips.length || filters.integration ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Applied filters">
            {filters.integration ? (
              <FilterChip
                label={`Integration: ${integrationName}`}
                onRemove={() => update({ integration: '' })}
              />
            ) : null}
            {chips.map((chip) => (
              <FilterChip
                key={chip.key}
                label={chip.label}
                onRemove={() => update(CLEAR_MORE[chip.key])}
              />
            ))}
          </div>
        ) : null}
      </div>

      <Card data-testid="integration-logs" className="min-w-0 overflow-hidden p-0! contain-paint">
        {logs.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(logs.error)}</QuietLine>
          </div>
        ) : page && !page.items.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            {filtered ? (
              <>
                <p className="font-semibold text-heading">No logs match these filters.</p>
                <p className="text-sm text-muted">
                  Change the filters or the date range, or clear them to see all activity.
                </p>
                <Button variant="secondary" onClick={clearFilters}>
                  Clear Filters
                </Button>
              </>
            ) : (
              <>
                <p className="font-semibold text-heading">No integration logs yet.</p>
                <p className="max-w-xl text-sm text-muted">
                  Sync runs, connection tests, webhooks, API calls and firm connections write their
                  events here as soon as they happen.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="px-2 pt-2">
            <Table
              caption="Integration logs"
              rows={page?.items ?? []}
              loading={logs.isPending}
              columns={columns}
              rowKey={(log) => log.id}
              noun="records"
              showPagination={false}
              server={{
                page: page?.page ?? 1,
                total: page?.total,
                hasNext: page ? page.page < pageCount : false,
                hasPrevious: (page?.page ?? 1) > 1,
                onNext: () => update({ page: (page?.page ?? 1) + 1 }),
                onPrevious: () => update({ page: (page?.page ?? 2) - 1 }),
                onPage: (next) => update({ page: next }),
                sort: { id: 'at', descending: filters.descending },
                onSort: (sort) => update({ descending: sort.descending }),
              }}
              rowActions={(log) => (
                <ViewButton label={log.message} onClick={() => setLogId(log.id)} />
              )}
            />
          </div>
        )}
      </Card>

      {page && page.total > 0 ? (
        <Pagination
          page={page.page}
          pageCount={pageCount}
          onPage={(next) => update({ page: next })}
          summary={`Showing ${first} – ${last} of ${page.total} records`}
        />
      ) : null}

      {logId ? (
        <LogDetailDrawer logId={logId} onOpen={setLogId} onClose={() => setLogId(null)} />
      ) : null}
    </div>
  );
}
