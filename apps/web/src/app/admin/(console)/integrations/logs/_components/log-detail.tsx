'use client';

import { Button, Drawer } from '@firmivra/ui';
import { ArrowSquareOut, CaretLeft, CaretRight } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  ENVIRONMENT_LABELS,
  LOG_SOURCE_LABELS,
  type IntegrationLog,
  type LogRecord,
} from '../../../../../../mocks/admin-integrations';
import {
  ActivityDot,
  EnvironmentBadge,
  IntegrationStatusBadge,
  LogSeverityBadge,
  OutcomeBadge,
  RunStatusBadge,
} from '../../_components/integration-badges';
import { formatDateTime, formatDuration, formatNumber } from '../../_components/integration-format';
import { loadError, QuietLine, SkeletonLines } from '../../_components/integration-states';
import { LinkButton, platformHref } from '../../_components/integrations-shell';

/**
 * One log record in a side panel (docx §9 Log record): time, integration, environment, action,
 * outcome, error code, actor and source; the request and response metadata (redacted: secrets
 * never show), the request and correlation ids, the run it belongs to, the other events with the
 * same correlation id, and the next step for an error (Reconnect, Update Credential, Retry Sync,
 * View Provider Status), only where that integration supports it.
 */

/**
 * A second guard on top of the API's redaction: any long unbroken token (a key, secret or bearer
 * token) shows only its last four characters.
 */
export const maskSecrets = (text: string) =>
  text.replace(/[A-Za-z0-9_+=]{28,}/g, (token) => `••••${token.slice(-4)}`);

const ACTOR_LABELS: Record<IntegrationLog['actor']['type'], string> = {
  USER: 'Person',
  SYSTEM: 'System',
  PROVIDER: 'Provider',
};

/** A label and its value, in the panel's two-column list. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2 sm:grid-cols-3 sm:gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 wrap-anywhere text-heading sm:col-span-2">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-base font-bold text-heading">{title}</h3>
      {children}
    </section>
  );
}

const linkLook =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-control bg-action px-5 py-1.5 text-sm font-semibold whitespace-nowrap text-on-action transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** The error's next step: an admin page, the provider's status page, or what the firm must do. */
function Resolution({ log }: { log: IntegrationLog }) {
  const next = log.resolution;
  if (!next) return <QuietLine>No action is needed for this record.</QuietLine>;
  if (next.href?.startsWith('/'))
    return (
      <div className="py-2">
        <LinkButton href={next.href} variant="primary" size="sm">
          {next.label}
        </LinkButton>
      </div>
    );
  if (next.href?.startsWith('https://'))
    return (
      <div className="py-2">
        <a href={next.href} target="_blank" rel="noopener noreferrer" className={linkLook}>
          {next.label}
          <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    );
  return (
    <QuietLine>
      {next.label}: {log.firm ? `${log.firm.name} does this` : 'the firm does this'} from its own
      workspace. Firmivra cannot reconnect a firm&apos;s account for it.
    </QuietLine>
  );
}

/** The sync or test run that wrote this record (docx §5: drill-down between runs and logs). */
function RelatedRun({ integrationId, log }: { integrationId: string; log: IntegrationLog }) {
  const runs = useApiQuery(['admin-integrations', 'platform', integrationId, 'runs', 'log'], () =>
    adminIntegrations.platformRuns(integrationId, { pageSize: 100 }),
  );
  if (runs.isPending) return <SkeletonLines rows={2} label="Loading the related run" />;
  if (runs.isError) return <QuietLine>{loadError(runs.error)}</QuietLine>;
  const run =
    runs.data.items.find((item) => item.logId === log.id) ??
    (log.correlationId
      ? runs.data.items.find((item) => item.correlationId === log.correlationId)
      : undefined);
  if (!run) return <QuietLine>No sync or test run is linked to this record.</QuietLine>;
  return (
    <dl data-testid="related-run" className="divide-y divide-divider text-sm">
      <Fact label="Run">
        <span className="inline-flex flex-wrap items-center gap-2">
          {run.kind === 'SYNC' ? 'Synchronization' : 'Connection test'}
          <RunStatusBadge status={run.status} />
        </span>
      </Fact>
      <Fact label="Started">{run.startedAt ? formatDateTime(run.startedAt) : 'Not started'}</Fact>
      <Fact label="Duration">{formatDuration(run.durationMs)}</Fact>
      {run.kind === 'SYNC' ? (
        <Fact label="Objects">
          {formatNumber(run.objectCount)} processed
          {run.failedCount ? `, ${formatNumber(run.failedCount)} failed` : ''}
        </Fact>
      ) : null}
      <Fact label="Retries">{formatNumber(run.retries)}</Fact>
      {run.errorMessage ? <Fact label="Error">{run.errorMessage}</Fact> : null}
      <Fact label="Trigger">
        {run.trigger === 'SCHEDULE'
          ? 'Schedule'
          : `Manual${run.requestedBy ? `, ${run.requestedBy}` : ''}`}
      </Fact>
    </dl>
  );
}

function RecordBody({ record, onOpen }: { record: LogRecord; onOpen: (id: string) => void }) {
  const { log, integration, related } = record;
  const gone = log.integrationId !== null && integration === null;
  return (
    <div data-testid="log-detail" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <LogSeverityBadge severity={log.severity} />
          <OutcomeBadge succeeded={log.succeeded} />
          {log.environment ? <EnvironmentBadge environment={log.environment} /> : null}
        </div>
        <p data-testid="log-message" className="text-lg font-semibold text-heading">
          {log.message}
        </p>
      </div>

      <dl className="divide-y divide-divider text-sm">
        <Fact label="Time">
          <time dateTime={log.at}>{formatDateTime(log.at)}</time>
          <span className="block text-xs text-muted">{log.at} (UTC)</span>
        </Fact>
        <Fact label="Integration">
          {integration ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link
                href={platformHref(integration.id)}
                className="font-semibold text-link hover:underline"
              >
                {integration.name}
              </Link>
              <IntegrationStatusBadge status={integration.status} />
            </span>
          ) : (
            <>
              {log.integrationName ?? LOG_SOURCE_LABELS[log.source]}
              {gone ? (
                <span className="block text-xs text-muted">
                  This integration no longer exists; the record is kept for the audit trail.
                </span>
              ) : null}
            </>
          )}
        </Fact>
        <Fact label="Source">{LOG_SOURCE_LABELS[log.source]}</Fact>
        {log.provider ? (
          <Fact label="Provider">
            <code className="font-mono">{log.provider}</code>
          </Fact>
        ) : null}
        <Fact label="Environment">
          {log.environment ? ENVIRONMENT_LABELS[log.environment] : 'Not environment-specific'}
        </Fact>
        <Fact label="Action">{log.action}</Fact>
        <Fact label="Event type">
          <code className="font-mono">{log.eventType}</code>
        </Fact>
        <Fact label="Outcome">
          {log.succeeded ? 'Success' : 'Failed'}
          {log.errorCode ? (
            <code className="ml-2 font-mono text-danger">{log.errorCode}</code>
          ) : null}
        </Fact>
        <Fact label="Actor">
          {log.actor.name} <span className="text-muted">({ACTOR_LABELS[log.actor.type]})</span>
        </Fact>
        {log.firm ? <Fact label="Firm">{log.firm.name}</Fact> : null}
      </dl>

      <Section title="Request & response metadata">
        <p className="text-xs text-muted">
          Sensitive fields are redacted; secrets and tokens never appear here.
        </p>
        <dl data-testid="log-metadata" className="divide-y divide-divider text-sm">
          <Fact label="Endpoint">
            {log.endpoint ? <code className="font-mono">{maskSecrets(log.endpoint)}</code> : '—'}
          </Fact>
          <Fact label="Request ID">
            {log.requestId ? <code className="font-mono select-all">{log.requestId}</code> : '—'}
          </Fact>
          <Fact label="Correlation ID">
            {log.correlationId ? (
              <code className="font-mono select-all">{log.correlationId}</code>
            ) : (
              '—'
            )}
          </Fact>
          {log.details.map((row) => (
            <Fact key={row.label} label={row.label}>
              {maskSecrets(row.value)}
            </Fact>
          ))}
        </dl>
      </Section>

      <Section title="Next step">
        <Resolution log={log} />
      </Section>

      <Section title="Related run">
        {log.integrationId ? (
          <RelatedRun integrationId={log.integrationId} log={log} />
        ) : (
          <QuietLine>Runs belong to platform integrations; this record has none.</QuietLine>
        )}
      </Section>

      <Section title="Related events">
        {related.length ? (
          <ul className="divide-y divide-divider" data-testid="related-events">
            {related.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 flex">
                    <ActivityDot severity={item.severity} succeeded={item.succeeded} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-heading">{item.message}</span>
                    <time dateTime={item.at} className="block text-xs text-muted">
                      {formatDateTime(item.at)}
                    </time>
                  </span>
                </span>
                <Button variant="ghost" onClick={() => onOpen(item.id)}>
                  Open<span className="sr-only"> {item.message}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <QuietLine>No other events share this correlation ID.</QuietLine>
        )}
      </Section>
    </div>
  );
}

export function LogDetailDrawer({
  logId,
  onOpen,
  onClose,
}: {
  logId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const record = useApiQuery(['admin-integrations', 'logs', 'record', logId], () =>
    adminIntegrations.getLog(logId),
  );
  const data = record.data;
  return (
    <Drawer
      open
      title="Log Record"
      subtitle={data ? data.log.action : undefined}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={!data?.previousId}
            onClick={() => data?.previousId && onOpen(data.previousId)}
          >
            <CaretLeft aria-hidden weight="bold" className="size-4" />
            Newer
          </Button>
          <Button
            variant="secondary"
            disabled={!data?.nextId}
            onClick={() => data?.nextId && onOpen(data.nextId)}
          >
            Older
            <CaretRight aria-hidden weight="bold" className="size-4" />
          </Button>
        </>
      }
    >
      {record.isPending ? (
        <SkeletonLines rows={8} label="Loading the log record" />
      ) : record.isError ? (
        <QuietLine>{loadError(record.error)}</QuietLine>
      ) : (
        <RecordBody record={record.data} onOpen={onOpen} />
      )}
    </Drawer>
  );
}
