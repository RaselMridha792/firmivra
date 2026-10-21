'use client';

import type {
  IntegrationConnectionDetail,
  IntegrationSyncRun,
  IntegrationSyncRunStatus,
} from '@firmivra/types';
import { Badge, Button, Card, Drawer, Pagination, Select } from '@firmivra/ui';
import { useSearchParams } from 'next/navigation';
import {
  ArrowsClockwise,
  CheckCircle,
  Clock,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { EmptyLine, formatDate, shortTime } from '../../_components/manage-integration-shared';
import { integrationError, ManageShell, Notice } from '../../_components/manage-shell';

/**
 * Sync History (the spec: result, time, record count and status of every run; a failed run opens
 * useful error details). Filters by result, object and who started it; `?status=FAILED` opens it
 * filtered (Troubleshooting links here). A run opens its detail with the provider's guidance.
 */

const PAGE_SIZE = 20;
const STATUSES: IntegrationSyncRunStatus[] = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
];
const STATUS_LABELS: Record<IntegrationSyncRunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  PARTIAL: 'Partial',
  FAILED: 'Failed',
};
const STATUS_TONES = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
} as const;
type Started = '' | 'true' | 'false';

/** The Overview's Recent Sync Activity marks: a green check, a warning, a clock. */
const RESULT_MARKS: Record<IntegrationSyncRunStatus, { icon: Icon; tone: string }> = {
  QUEUED: { icon: Clock, tone: 'text-muted' },
  RUNNING: { icon: ArrowsClockwise, tone: 'text-info' },
  SUCCEEDED: { icon: CheckCircle, tone: 'text-success' },
  PARTIAL: { icon: WarningCircle, tone: 'text-warning' },
  FAILED: { icon: WarningCircle, tone: 'text-danger' },
};

function RunResult({ status }: { status: IntegrationSyncRunStatus }) {
  const { icon: Mark, tone } = RESULT_MARKS[status];
  return (
    <span className={`flex items-center gap-2 font-medium whitespace-nowrap ${tone}`}>
      <Mark aria-hidden weight="fill" className="size-5 shrink-0" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function RunStatus({ status }: { status: IntegrationSyncRunStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

const duration = (run: IntegrationSyncRun) => {
  if (!run.startedAt || !run.finishedAt) return '—';
  const seconds = Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000);
  return seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
};

export function SyncHistoryTab({ integrationId }: { integrationId: string }) {
  return (
    <ManageShell integrationId={integrationId} current="/sync-history" testId="sync-history-tab">
      {(detail) => <History integrationId={integrationId} detail={detail} />}
    </ManageShell>
  );
}

function History({
  integrationId,
  detail,
}: {
  integrationId: string;
  detail: IntegrationConnectionDetail | null;
}) {
  const params = useSearchParams();
  const [status, setStatus] = useState<IntegrationSyncRunStatus | ''>(
    () => STATUSES.find((s) => s === params.get('status')) ?? '',
  );
  const [entity, setEntity] = useState('');
  const [started, setStarted] = useState<Started>('');
  const [page, setPage] = useState(1);
  const [runId, setRunId] = useState<string | null>(null);
  const query = useApiQuery(
    ['integrations', 'history', integrationId, status, entity, started, page],
    () =>
      api.integrations.history(integrationId, {
        ...(status ? { status } : {}),
        ...(entity ? { entity } : {}),
        ...(started ? { manual: started === 'true' } : {}),
        page,
        pageSize: PAGE_SIZE,
      }),
  );
  const data = query.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(status || entity || started);
  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <Card data-testid="sync-history" className="flex min-w-0 flex-col gap-4 p-5!">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-heading">Sync History</h2>
          <p className="text-sm text-muted">Every sync, test and webhook run, newest first.</p>
        </div>
        <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto">
          <Select
            label="Result"
            hideLabel
            value={status}
            onChange={(event) =>
              reset(() => setStatus(STATUSES.find((s) => s === event.target.value) ?? ''))
            }
            options={[
              { value: '', label: 'All results' },
              ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            ]}
          />
          <Select
            label="Object"
            hideLabel
            value={entity}
            onChange={(event) => reset(() => setEntity(event.target.value))}
            options={[
              { value: '', label: 'All objects' },
              ...(detail?.provider.entities ?? []).map((e) => ({ value: e.key, label: e.label })),
              { value: 'test', label: 'Connection tests' },
              { value: 'webhook', label: 'Webhooks' },
            ]}
          />
          <Select
            label="Started by"
            hideLabel
            value={started}
            onChange={(event) =>
              reset(() =>
                setStarted(
                  event.target.value === 'true' || event.target.value === 'false'
                    ? event.target.value
                    : '',
                ),
              )
            }
            options={[
              { value: '', label: 'Manual and scheduled' },
              { value: 'true', label: 'Manual only' },
              { value: 'false', label: 'Scheduled only' },
            ]}
          />
        </div>
      </div>

      {query.isError ? (
        <Notice tone="error" onRetry={() => void query.refetch()}>
          {integrationError(query.error)}
        </Notice>
      ) : !data ? (
        <EmptyLine>Sync runs show when they load.</EmptyLine>
      ) : !data.items.length ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <EmptyLine>
            {filtered ? 'No runs match these filters.' : 'No syncs have run yet.'}
          </EmptyLine>
          {filtered ? (
            <Button
              variant="secondary"
              onClick={() =>
                reset(() => {
                  setStatus('');
                  setEntity('');
                  setStarted('');
                })
              }
            >
              Clear Filters
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="relative w-full max-w-full min-w-0 overflow-x-auto rounded-control border border-divider">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Sync runs</caption>
            <thead>
              <tr className="bg-table-head text-left text-xs text-heading">
                {[
                  'Time',
                  'Object',
                  'Started by',
                  'Result',
                  'Records',
                  'Failed',
                  'Duration',
                  '',
                ].map((label) => (
                  <th key={label || 'actions'} scope="col" className="px-3 py-2 font-semibold">
                    {label || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {data.items.map((run) => (
                // A failed run is the pink row of the Overview's Recent Sync Activity.
                <tr key={run.id} className={run.status === 'FAILED' ? 'bg-danger-soft' : undefined}>
                  <td className="px-3 py-2 whitespace-nowrap text-heading">
                    <time dateTime={run.createdAt} title={formatDate(run.createdAt)}>
                      {shortTime(run.createdAt)}
                    </time>
                  </td>
                  <td className="px-3 py-2 text-heading">{run.entityLabel}</td>
                  <td className="px-3 py-2 text-text">
                    {run.manual ? (run.requestedBy?.name ?? 'Manual') : 'Scheduled'}
                  </td>
                  <td className="px-3 py-2">
                    <RunResult status={run.status} />
                  </td>
                  <td className="px-3 py-2 text-text">{run.recordCount}</td>
                  <td className={`px-3 py-2 ${run.failedCount ? 'text-danger' : 'text-text'}`}>
                    {run.failedCount}
                  </td>
                  <td className="px-3 py-2 text-text">{duration(run)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="secondary"
                      className="min-h-9! border-action! px-4! py-1! text-action!"
                      onClick={() => setRunId(run.id)}
                    >
                      View<span className="sr-only"> {run.entityLabel} run</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 0 ? (
        <Pagination
          page={data.page}
          pageCount={pageCount}
          onPage={setPage}
          summary={`Showing ${(data.page - 1) * data.pageSize + 1} – ${Math.min(data.page * data.pageSize, data.total)} of ${data.total} runs`}
        />
      ) : null}

      {runId ? (
        <RunDrawer integrationId={integrationId} runId={runId} onClose={() => setRunId(null)} />
      ) : null}
    </Card>
  );
}

function RunDrawer({
  integrationId,
  runId,
  onClose,
}: {
  integrationId: string;
  runId: string;
  onClose: () => void;
}) {
  const query = useApiQuery(['integrations', 'run', integrationId, runId], () =>
    api.integrations.run(integrationId, runId),
  );
  const run = query.data;
  return (
    <Drawer
      open
      title={run ? `${run.entityLabel} run` : 'Sync run'}
      subtitle={run ? formatDate(run.createdAt) : undefined}
      onClose={onClose}
    >
      {query.isError ? (
        <Notice tone="error" onRetry={() => void query.refetch()}>
          {integrationError(query.error)}
        </Notice>
      ) : !run ? (
        <EmptyLine>The run shows when it loads.</EmptyLine>
      ) : (
        <div data-testid="run-detail" className="flex flex-col gap-4 text-sm">
          <RunStatus status={run.status} />
          <dl className="grid grid-cols-2 gap-3">
            {[
              ['Started by', run.manual ? (run.requestedBy?.name ?? 'Manual') : 'Scheduled'],
              ['Records', String(run.recordCount)],
              ['Failed', String(run.failedCount)],
              ['Duration', duration(run)],
              ['Started', formatDate(run.startedAt)],
              ['Finished', formatDate(run.finishedAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-medium text-heading">{value}</dd>
              </div>
            ))}
          </dl>
          {run.errorMessage ? (
            <div className="rounded-control bg-danger-soft px-3 py-2 text-danger">
              <p className="font-medium">{run.errorMessage}</p>
              {run.errorCode ? <p className="font-mono text-xs">{run.errorCode}</p> : null}
            </div>
          ) : null}
          {run.guidance.length ? (
            <div>
              <h3 className="font-semibold text-heading">What to do</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-text">
                {run.guidance.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
