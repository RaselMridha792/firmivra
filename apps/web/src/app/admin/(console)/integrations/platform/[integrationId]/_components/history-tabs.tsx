'use client';

import {
  Button,
  DateRangePicker,
  FilterBar,
  SearchField,
  Select,
  Table,
  type Column,
  type DateRange,
} from '@firmivra/ui';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  LOG_SEVERITIES,
  LOG_SEVERITY_LABELS,
  RUN_KINDS,
  RUN_STATUS_LABELS,
  RUN_STATUSES,
  type IntegrationLog,
  type LogOutcome,
  type LogSeverity,
  type Page,
  type PlatformRun,
  type RunKind,
  type RunStatus,
} from '../../../_components/integrations-contract';
import { LogSeverityBadge, RunStatusBadge } from '../../../_components/integration-badges';
import {
  formatDateTime,
  formatDuration,
  formatNumber,
} from '../../../_components/integration-format';
import { loadError, QuietLine } from '../../../_components/integration-states';
import { LinkButton, logsHref } from '../../../_components/integrations-shell';
import { OutlineButton, Panel } from './detail-parts';

/**
 * Sync History and Error Logs (docx §5): the integration's runs (time, duration, result, objects
 * processed, retries, correlation id) and its log records (date, severity, code, event, request
 * id), each with a drill-down to the log record and a link to the central log.
 */

const PAGE_SIZE = 10;
const KIND_LABELS: Record<RunKind, string> = { SYNC: 'Sync', TEST: 'Connection test' };

/** The kit table's paging over one page of an offset-paged answer. */
function paging<T>(data: Page<T> | undefined, page: number, onPage: (page: number) => void) {
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return {
    page,
    total: data?.total ?? 0,
    hasNext: page < pages,
    hasPrevious: page > 1,
    onNext: () => onPage(page + 1),
    onPrevious: () => onPage(page - 1),
    onPage,
    onSort: () => undefined,
  };
}

const oneOf = <T extends string>(list: readonly T[], value: string): T | '' =>
  list.find((item) => item === value) ?? '';

export function SyncHistoryTab({
  integrationId,
  canSync,
  syncing,
  onSync,
  onOpenLog,
}: {
  integrationId: string;
  /** A running integration, and the data loaded. */
  canSync: boolean;
  syncing: boolean;
  onSync: () => void;
  onOpenLog: (logId: string) => void;
}) {
  const [kind, setKind] = useState<RunKind | ''>('');
  const [status, setStatus] = useState<RunStatus | ''>('');
  const [page, setPage] = useState(1);
  const runs = useApiQuery(
    ['admin-integrations', 'platform', integrationId, 'runs', kind, status, page],
    () =>
      adminIntegrations.platformRuns(integrationId, {
        kind: kind || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  );
  const filtered = !!(kind || status);
  const clear = () => {
    setKind('');
    setStatus('');
    setPage(1);
  };
  const columns: Column<PlatformRun>[] = [
    {
      id: 'time',
      label: 'Time',
      className: 'whitespace-nowrap',
      cell: (run) => <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>,
    },
    {
      id: 'type',
      label: 'Type',
      cell: (run) => (
        <span className="flex flex-col">
          <span className="text-heading">{KIND_LABELS[run.kind]}</span>
          <span className="text-xs text-muted">
            {run.trigger === 'MANUAL'
              ? `Manual${run.requestedBy ? ` · ${run.requestedBy}` : ''}`
              : 'Scheduled'}
          </span>
        </span>
      ),
    },
    {
      id: 'duration',
      label: 'Duration',
      className: 'whitespace-nowrap',
      cell: (run) => formatDuration(run.durationMs),
    },
    {
      id: 'result',
      label: 'Result',
      cell: (run) => (
        <span className="flex flex-col items-start gap-1">
          <RunStatusBadge status={run.status} />
          {run.errorCode ? <code className="text-xs text-danger">{run.errorCode}</code> : null}
        </span>
      ),
    },
    {
      id: 'objects',
      label: 'Objects',
      className: 'whitespace-nowrap',
      cell: (run) =>
        run.kind === 'TEST'
          ? 'N/A'
          : `${formatNumber(run.objectCount)}${run.failedCount ? ` · ${formatNumber(run.failedCount)} failed` : ''}`,
    },
    { id: 'retries', label: 'Retries', cell: (run) => formatNumber(run.retries) },
    {
      id: 'correlation',
      label: 'Correlation ID',
      cell: (run) => <code className="text-xs wrap-anywhere">{run.correlationId}</code>,
    },
  ];
  return (
    <Panel
      testId="sync-history"
      title="Sync History"
      subtitle="Every sync and connection test, newest first. Open a run to see its log record."
      action={
        <Button onClick={onSync} disabled={!canSync || syncing}>
          <ArrowsClockwise aria-hidden weight="bold" className="size-5" />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <FilterBar onReset={filtered ? clear : undefined} resetLabel="Clear filters">
          <div className="w-full sm:w-48">
            <Select
              label="Type"
              hideLabel
              value={kind}
              options={[
                { value: '', label: 'All runs' },
                ...RUN_KINDS.map((value) => ({ value, label: KIND_LABELS[value] })),
              ]}
              onChange={(event) => {
                setKind(oneOf(RUN_KINDS, event.target.value));
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              label="Result"
              hideLabel
              value={status}
              options={[
                { value: '', label: 'All results' },
                ...RUN_STATUSES.map((value) => ({ value, label: RUN_STATUS_LABELS[value] })),
              ]}
              onChange={(event) => {
                setStatus(oneOf(RUN_STATUSES, event.target.value));
                setPage(1);
              }}
            />
          </div>
        </FilterBar>
        {runs.isError ? (
          <QuietLine>{loadError(runs.error)}</QuietLine>
        ) : (
          <Table
            caption="Sync and test runs"
            rows={runs.data?.items ?? []}
            loading={runs.isPending}
            columns={columns}
            rowKey={(run) => run.id}
            noun="runs"
            pageSize={PAGE_SIZE}
            server={paging(runs.data, page, setPage)}
            emptyTitle={filtered ? 'No runs match these filters' : 'No runs yet'}
            emptyText={
              filtered
                ? 'Clear the filters to see every run.'
                : 'Syncs and connection tests appear here when they run.'
            }
            emptyAction={
              filtered ? (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
            rowActions={(run) =>
              run.logId ? (
                <OutlineButton size="sm" onClick={() => run.logId && onOpenLog(run.logId)}>
                  View Log
                </OutlineButton>
              ) : null
            }
          />
        )}
      </div>
    </Panel>
  );
}

/** Whole days on the viewer's calendar, as ISO moments. */
const startOf = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const endOf = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);
const OUTCOMES: readonly LogOutcome[] = ['FAILURE', 'SUCCESS'];

export function ErrorLogsTab({
  integrationId,
  onOpenLog,
}: {
  integrationId: string;
  onOpenLog: (logId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState<LogSeverity | ''>('');
  // Error Logs opens on the failures; "All results" shows the rest of the record.
  const [outcome, setOutcome] = useState<LogOutcome | ''>('FAILURE');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const typed = useDeferredValue(search.trim());
  const logs = useApiQuery(
    [
      'admin-integrations',
      'logs',
      'integration',
      integrationId,
      typed,
      severity,
      outcome,
      range.from,
      range.to,
      page,
    ],
    () =>
      adminIntegrations.listLogs({
        integrationId,
        search: typed || undefined,
        severity: severity || undefined,
        outcome: outcome || undefined,
        from: startOf(range.from),
        to: endOf(range.to),
        page,
        pageSize: PAGE_SIZE,
      }),
  );
  const filtered = !!(search || severity || outcome !== 'FAILURE' || range.from || range.to);
  const clear = () => {
    setSearch('');
    setSeverity('');
    setOutcome('FAILURE');
    setRange({ from: '', to: '' });
    setPage(1);
  };
  const columns: Column<IntegrationLog>[] = [
    {
      id: 'at',
      label: 'Date & Time',
      className: 'whitespace-nowrap',
      cell: (log) => <time dateTime={log.at}>{formatDateTime(log.at)}</time>,
    },
    {
      id: 'severity',
      label: 'Severity',
      cell: (log) => <LogSeverityBadge severity={log.severity} />,
    },
    {
      id: 'event',
      label: 'Event',
      cell: (log) => (
        <span className="flex flex-col">
          <span className="text-heading">{log.action}</span>
          <code className="text-xs text-muted">{log.eventType}</code>
        </span>
      ),
    },
    {
      id: 'code',
      label: 'Error Code',
      cell: (log) =>
        log.errorCode ? (
          <code className="text-xs">{log.errorCode}</code>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      id: 'request',
      label: 'Request ID',
      cell: (log) =>
        log.requestId ? (
          <code className="text-xs wrap-anywhere">{log.requestId}</code>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      id: 'message',
      label: 'Message',
      className: 'min-w-48',
      cell: (log) => <span className="wrap-anywhere">{log.message}</span>,
    },
  ];
  return (
    <Panel
      testId="error-logs"
      title="Error Logs"
      subtitle="This integration's log records. Secret values and full tokens are never logged."
      action={<LinkButton href={logsHref(integrationId)}>Open Integration Logs</LinkButton>}
    >
      <div className="flex flex-col gap-4">
        <FilterBar onReset={filtered ? clear : undefined} resetLabel="Clear filters">
          <SearchField
            label="Search error code, event or request ID"
            placeholder="Search code, event or request ID…"
            minWidth="12rem"
            value={search}
            maxLength={100}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <div className="w-full sm:w-44">
            <Select
              label="Severity"
              hideLabel
              value={severity}
              options={[
                { value: '', label: 'All severities' },
                ...LOG_SEVERITIES.map((value) => ({ value, label: LOG_SEVERITY_LABELS[value] })),
              ]}
              onChange={(event) => {
                setSeverity(oneOf(LOG_SEVERITIES, event.target.value));
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Outcome"
              hideLabel
              value={outcome}
              options={[
                { value: 'FAILURE', label: 'Failures only' },
                { value: 'SUCCESS', label: 'Successes only' },
                { value: '', label: 'All results' },
              ]}
              onChange={(event) => {
                setOutcome(oneOf(OUTCOMES, event.target.value));
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-auto">
            <DateRangePicker
              label="Date"
              value={range}
              onChange={(next) => {
                setRange(next);
                setPage(1);
              }}
            />
          </div>
        </FilterBar>
        {logs.isError ? (
          <QuietLine>{loadError(logs.error)}</QuietLine>
        ) : (
          <Table
            caption="Log records for this integration"
            rows={logs.data?.items ?? []}
            loading={logs.isPending}
            columns={columns}
            rowKey={(log) => log.id}
            noun="records"
            pageSize={PAGE_SIZE}
            server={paging(logs.data, page, setPage)}
            emptyTitle={filtered ? 'No log records match these filters' : 'No errors recorded'}
            emptyText={
              filtered
                ? 'Clear the filters to see the failures again.'
                : 'Failed calls, syncs and tests of this integration appear here.'
            }
            emptyAction={
              filtered ? (
                <Button variant="secondary" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
            rowActions={(log) => (
              <OutlineButton size="sm" onClick={() => onOpenLog(log.id)}>
                View
                <span className="sr-only"> {log.action}</span>
              </OutlineButton>
            )}
          />
        )}
      </div>
    </Panel>
  );
}
