'use client';

import { Table, textTones, Toggle, type Column, type TileTone } from '@firmivra/ui';
import {
  ArrowRight,
  CheckCircle,
  Key,
  MinusCircle,
  PauseCircle,
  PencilCircle,
  ProhibitInset,
  SlidersHorizontal,
  ShieldSlash,
  Timer,
  Trash,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  type ConnectionTestResult,
  type IntegrationLog,
  type IntegrationStatus,
  type PlatformIntegrationDetail,
} from '../../../../../../../mocks/admin-integrations';
import { CatalogStatusBadge, OutcomeBadge } from '../../../_components/integration-badges';
import { formatDate, formatDateTime, formatMetric } from '../../../_components/integration-format';
import { Loaded, loadError, QuietLine } from '../../../_components/integration-states';
import { LinkButton, logsHref, setupHref } from '../../../_components/integrations-shell';
import { CopyButton, DetailRows, ExternalUrl, OutlineButton, Panel } from './detail-parts';

/**
 * The Overview tab (stripe-integration-admin-dashboard.jpg): Connection Status with the health,
 * the latest test and Reconnect; the last 30 days' usage in the provider's units; the
 * environment and its switch; Integration Details; Quick Actions; Recent Activity from the
 * central log; and what depends on the integration (docx §5). Never a raw secret.
 */

type Detail = UseQueryResult<PlatformIntegrationDetail>;

/** What the signed-in admin may do and what each button calls (the page owns the dialogs). */
export interface OverviewActions {
  canConfigure: boolean;
  canSecrets: boolean;
  canLifecycle: boolean;
  testing: boolean;
  lastTest: ConnectionTestResult | null;
  onTest: () => void;
  onReconnect: () => void;
  onCredentials: () => void;
  onEdit: () => void;
  onEnvironment: () => void;
  onLifecycle: (kind: 'disable' | 'enable' | 'remove') => void;
  onOpenLog: (logId: string) => void;
}

const HEALTH: Record<IntegrationStatus, { title: string; tone: TileTone; icon: Icon }> = {
  ACTIVE: { title: 'Connected', tone: 'green', icon: CheckCircle },
  NEEDS_ATTENTION: { title: 'Needs Attention', tone: 'amber', icon: WarningCircle },
  ERROR: { title: 'Connection Error', tone: 'red', icon: XCircle },
  INACTIVE: { title: 'Inactive', tone: 'grey', icon: PauseCircle },
  DISABLED: { title: 'Disabled', tone: 'grey', icon: ProhibitInset },
  DRAFT: { title: 'Not Connected Yet', tone: 'blue', icon: PencilCircle },
  REMOVED: { title: 'Removed', tone: 'grey', icon: MinusCircle },
};

function healthText(integration: PlatformIntegrationDetail): string {
  const { status, name, statusReason, latestError } = integration;
  if (status === 'ACTIVE') return `Your ${name} integration is active and working properly.`;
  if (status === 'ERROR')
    return (
      latestError?.message ?? statusReason?.message ?? 'The connection or its last sync failed.'
    );
  if (status === 'DISABLED')
    return `Turned off${integration.disabledAt ? ` on ${formatDate(integration.disabledAt)}` : ''}. Scheduled jobs and new calls are stopped; the configuration is kept.`;
  if (status === 'DRAFT')
    return 'This integration is a draft. Finish its setup and pass a connection test to activate it.';
  if (status === 'REMOVED')
    return `Removed${integration.removedAt ? ` on ${formatDate(integration.removedAt)}` : ''}. Its credentials were revoked; the record is kept for the audit trail.`;
  return statusReason?.message ?? 'Configured, but not processing right now.';
}

/** "Last tested Oct 14, 2026 10:42 AM: passed", or why there is no test. */
function lastTestLine(integration: PlatformIntegrationDetail): string {
  if (!integration.supportsTest)
    return "This provider has no test endpoint. Check it in the provider's console.";
  if (!integration.lastCheckAt) return 'Not tested yet.';
  const result =
    integration.lastCheckOk === true
      ? 'passed'
      : integration.lastCheckOk === false
        ? 'failed'
        : 'not checked since the credentials changed';
  return `Last tested ${formatDateTime(integration.lastCheckAt)}: ${result}.`;
}

function ConnectionStatusCard({ detail, actions }: { detail: Detail; actions: OverviewActions }) {
  return (
    <Panel
      testId="connection-status"
      title="Connection Status"
      className="md:col-span-1 xl:col-span-5"
    >
      <Loaded query={detail} rows={3}>
        {(integration) => {
          const look = HEALTH[integration.status];
          const Glyph = look.icon;
          const failedTest =
            actions.lastTest &&
            !actions.lastTest.ok &&
            actions.lastTest.integration.id === integration.id
              ? actions.lastTest
              : null;
          return (
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex items-start gap-4">
                <Glyph
                  aria-hidden
                  weight="fill"
                  className={`size-16 shrink-0 ${textTones[look.tone]}`}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p
                    data-testid="health-title"
                    className={`text-xl font-semibold ${textTones[look.tone]}`}
                  >
                    {look.title}
                  </p>
                  <p className="text-sm text-text">{healthText(integration)}</p>
                  {integration.statusReason && integration.status !== 'ACTIVE' ? (
                    <p className="text-sm text-muted">
                      Recommended: {integration.statusReason.recommendedAction}
                    </p>
                  ) : null}
                  <p data-testid="last-test" className="text-xs text-muted">
                    {lastTestLine(integration)}
                  </p>
                </div>
              </div>
              {failedTest ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-lg bg-danger-soft p-3 text-sm text-text"
                >
                  <p className="font-semibold text-danger">{failedTest.message}</p>
                  <p className="text-xs text-text">
                    {failedTest.errorCode ? `Code ${failedTest.errorCode} · ` : ''}Request ID{' '}
                    <code>{failedTest.requestId}</code>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <OutlineButton onClick={actions.onTest} disabled={actions.testing}>
                      Retry Test
                    </OutlineButton>
                    <OutlineButton onClick={() => actions.onOpenLog(failedTest.logId)}>
                      View Log
                    </OutlineButton>
                    {failedTest.kind === 'PROVIDER_UNAVAILABLE' && integration.statusUrl ? (
                      <a
                        href={integration.statusUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-link hover:underline"
                      >
                        Provider status
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : integration.status === 'ERROR' && integration.latestError ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>
                    {integration.latestError.title} · {formatDateTime(integration.latestError.at)}
                    {integration.latestError.requestId
                      ? ` · Request ID ${integration.latestError.requestId}`
                      : ''}
                  </span>
                  <Link
                    href={logsHref(integration.id)}
                    className="font-semibold text-link hover:underline"
                  >
                    View in logs
                  </Link>
                </p>
              ) : null}
              <div className="mt-auto flex justify-end">
                {integration.status === 'DRAFT' ? (
                  <LinkButton href={setupHref(integration)}>Continue Setup</LinkButton>
                ) : (
                  <OutlineButton
                    onClick={actions.onReconnect}
                    disabled={!actions.canSecrets || integration.status === 'REMOVED'}
                  >
                    Reconnect
                  </OutlineButton>
                )}
              </div>
            </div>
          );
        }}
      </Loaded>
    </Panel>
  );
}

function UsageCard({ detail }: { detail: Detail }) {
  return (
    <Panel
      testId="usage-highlights"
      title="Usage (Last 30 Days)"
      className="md:col-span-1 xl:col-span-5"
    >
      <Loaded query={detail} rows={2}>
        {(integration) => {
          // The card holds three numbers; Success Rate stays on the Usage & Analytics tab.
          const shown =
            integration.highlights.length > 3
              ? integration.highlights.filter((item) => item.key !== 'successRate')
              : integration.highlights;
          return shown.some((item) => item.value !== null) ? (
            <dl className="flex flex-wrap gap-y-3">
              {shown.map((item) => (
                <div
                  key={item.key}
                  className="flex min-w-0 flex-col-reverse gap-1 border-divider pr-5 not-first:border-l not-first:pl-5"
                >
                  <dt className="text-xs text-muted">{item.label}</dt>
                  <dd
                    data-testid={`usage-${item.key}`}
                    className="text-2xl leading-tight font-bold text-heading"
                  >
                    {formatMetric(item.value, item.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <QuietLine>No usage recorded in the last 30 days.</QuietLine>
          );
        }}
      </Loaded>
    </Panel>
  );
}

function EnvironmentCard({
  detail,
  disabled,
  onSwitch,
}: {
  detail: Detail;
  disabled: boolean;
  onSwitch: () => void;
}) {
  const integration = detail.data;
  return (
    <Panel testId="environment" title="Environment" className="md:col-span-2 xl:col-span-2">
      <div className="flex flex-1 flex-col gap-4">
        <Loaded query={detail} rows={1}>
          {(data) => (
            <p
              data-testid="environment-value"
              className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${data.environment === 'LIVE' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
            >
              <span aria-hidden className="size-2.5 rounded-full bg-current" />
              {ENVIRONMENT_LABELS[data.environment]}
            </p>
          )}
        </Loaded>
        <OutlineButton
          onClick={onSwitch}
          disabled={disabled || !integration || integration.status === 'REMOVED'}
          className="mt-auto w-full"
        >
          Switch to {integration?.environment === 'TEST' ? 'Live' : 'Test'}
        </OutlineButton>
      </div>
    </Panel>
  );
}

function IntegrationDetailsCard({
  detail,
  canEdit,
  onEdit,
}: {
  detail: Detail;
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <Panel
      testId="integration-details"
      title="Integration Details"
      className="xl:col-span-7"
      action={
        <OutlineButton
          onClick={onEdit}
          disabled={!canEdit || !detail.data || detail.data.status === 'REMOVED'}
          size="wide"
        >
          Edit
        </OutlineButton>
      }
    >
      <Loaded query={detail} rows={6}>
        {(integration) => (
          <DetailRows
            rows={[
              { label: 'Integration ID', value: integration.reference },
              { label: 'Category', value: CATEGORY_LABELS[integration.category] },
              {
                label: 'Connected Since',
                value: integration.activatedAt ? (
                  <time dateTime={integration.activatedAt}>
                    {formatDateTime(integration.activatedAt)}
                  </time>
                ) : (
                  <span className="text-muted">Not activated yet</span>
                ),
              },
              {
                label: 'Provider Website',
                value: integration.websiteUrl ? (
                  <ExternalUrl href={integration.websiteUrl} label="provider website" />
                ) : (
                  <span className="text-muted">None</span>
                ),
              },
              {
                label: 'Documentation',
                value: integration.docsUrl ? (
                  <ExternalUrl href={integration.docsUrl} label="documentation" linked />
                ) : (
                  <span className="text-muted">None</span>
                ),
              },
              {
                label: 'Webhook URL',
                ruled: true,
                value: integration.connection.webhookUrl ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 wrap-anywhere">
                      {integration.connection.webhookUrl}
                    </span>
                    <CopyButton
                      value={integration.connection.webhookUrl}
                      label="Copy webhook URL"
                    />
                  </span>
                ) : (
                  <span className="text-muted">This provider sends no webhooks</span>
                ),
              },
            ]}
          />
        )}
      </Loaded>
    </Panel>
  );
}

/** One row of Quick Actions: tile, title and line, and an arrow (or the row's own control). */
function QuickRow({
  icon: Glyph,
  title,
  text,
  danger,
  onClick,
  href,
  disabled,
  control,
}: {
  icon: Icon;
  title: string;
  text: string;
  danger?: boolean;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  control?: ReactNode;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${danger ? 'bg-danger-soft text-danger' : 'bg-info-soft text-action'}`}
      >
        <Glyph weight="fill" className="size-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={`text-sm font-semibold ${danger && !control ? 'text-danger' : 'text-heading'}`}
        >
          {title}
        </span>
        <span className={`text-sm ${danger && !control ? 'text-danger' : 'text-text'}`}>
          {text}
        </span>
      </span>
    </>
  );
  const rowClass = `flex w-full items-center gap-4 px-3 py-2.5 text-left ${danger && !control ? 'rounded-lg bg-danger-soft/60' : ''}`;
  if (control)
    return (
      <li className={rowClass}>
        {body}
        {control}
      </li>
    );
  if (href)
    return (
      <li>
        <Link href={href} className={`${rowClass} rounded-lg hover:bg-canvas`}>
          {body}
          <ArrowRight aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
        </Link>
      </li>
    );
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${rowClass} rounded-lg hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent`}
      >
        {body}
        {danger ? null : (
          <ArrowRight aria-hidden weight="bold" className="size-4 shrink-0 text-heading" />
        )}
      </button>
    </li>
  );
}

function QuickActionsCard({ detail, actions }: { detail: Detail; actions: OverviewActions }) {
  const integration = detail.data;
  const status = integration?.status;
  const gone = !integration || status === 'REMOVED';
  const running =
    status !== undefined && ['ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION', 'ERROR'].includes(status);
  const oauth = !!integration?.connection.oauth;
  return (
    <Panel testId="quick-actions" title="Quick Actions" className="xl:col-span-5">
      {detail.isError ? <QuietLine>{loadError(detail.error)}</QuietLine> : null}
      <ul className="flex flex-col divide-y divide-divider">
        <QuickRow
          icon={Key}
          title={oauth ? 'Reconnect Account' : 'Update API Keys'}
          text={oauth ? 'Sign in to the provider again' : 'Change your API credentials'}
          onClick={oauth ? actions.onReconnect : actions.onCredentials}
          disabled={gone || !actions.canSecrets || status === 'DRAFT'}
        />
        <QuickRow
          icon={SlidersHorizontal}
          title="View Webhook Events"
          text="See recent webhook activity"
          href="/integrations/api-webhooks"
        />
        <QuickRow
          icon={Timer}
          title="Test Connection"
          text={
            integration && !integration.supportsTest
              ? 'This provider has no test endpoint'
              : 'Verify the integration is working'
          }
          onClick={actions.onTest}
          disabled={
            !integration ||
            gone ||
            !integration.supportsTest ||
            status === 'DRAFT' ||
            actions.testing
          }
        />
        <QuickRow
          icon={ShieldSlash}
          danger
          title="Disable Integration"
          text={
            status === 'DISABLED'
              ? 'Turned off. Switch it off again to enable the integration.'
              : 'Temporarily turn off this integration'
          }
          control={
            <Toggle
              label="Disable Integration"
              checked={status === 'DISABLED'}
              disabled={!actions.canLifecycle || (!running && status !== 'DISABLED')}
              onChange={(on) => actions.onLifecycle(on ? 'disable' : 'enable')}
            />
          }
        />
        <QuickRow
          icon={Trash}
          danger
          title="Remove Integration"
          text="Permanently remove this integration"
          onClick={() => actions.onLifecycle('remove')}
          disabled={gone || !actions.canLifecycle}
        />
      </ul>
    </Panel>
  );
}

/** "Processed 126 transactions" or the record's own one line. */
const detailsOf = (log: IntegrationLog) =>
  log.details.length
    ? log.details.map((row) => `${row.label}: ${row.value}`).join(' · ')
    : log.message;

function RecentActivityCard({ integrationId }: { integrationId: string }) {
  const activity = useApiQuery(['admin-integrations', 'logs', 'integration', integrationId], () =>
    adminIntegrations.listLogs({ integrationId, pageSize: 6 }),
  );
  const columns: Column<IntegrationLog>[] = [
    {
      id: 'at',
      label: 'Date & Time',
      className: 'whitespace-nowrap',
      cell: (log) => <time dateTime={log.at}>{formatDateTime(log.at)}</time>,
    },
    { id: 'event', label: 'Event', cell: (log) => log.action },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (log) => <OutcomeBadge succeeded={log.succeeded} />,
    },
    {
      id: 'details',
      label: 'Details',
      className: 'min-w-48',
      cell: (log) => <span className="wrap-anywhere">{detailsOf(log)}</span>,
    },
  ];
  return (
    <Panel
      testId="recent-activity"
      title="Recent Activity"
      subtitle="Latest actions and events for this integration."
      flush
      action={<LinkButton href={logsHref(integrationId)}>View All Activity</LinkButton>}
    >
      {activity.isError ? (
        <div className="px-5">
          <QuietLine>{loadError(activity.error)}</QuietLine>
        </div>
      ) : activity.data && !activity.data.items.length ? (
        <div className="px-5">
          <QuietLine>No activity for this integration yet.</QuietLine>
        </div>
      ) : (
        <div className="px-2">
          <Table
            caption="Recent activity for this integration"
            rows={activity.data?.items ?? []}
            loading={activity.isPending}
            columns={columns}
            rowKey={(log) => log.id}
            showPagination={false}
          />
        </div>
      )}
    </Panel>
  );
}

function DependentsCard({ detail }: { detail: Detail }) {
  return (
    <Panel
      testId="dependents"
      title="Dependents"
      subtitle="Customer catalog entries and webhooks that rely on this integration. Disabling or removing it affects them."
    >
      <Loaded query={detail} rows={2}>
        {({ dependents }) =>
          dependents.catalog.length || dependents.webhooks.length ? (
            <ul className="flex flex-col divide-y divide-divider text-sm">
              {dependents.catalog.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={`/integrations/catalog/${encodeURIComponent(entry.id)}`}
                      className="font-semibold text-heading hover:text-action hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <span className="text-xs text-muted">Customer catalog entry</span>
                  </span>
                  <CatalogStatusBadge status={entry.status} />
                </li>
              ))}
              {dependents.webhooks.map((hook) => (
                <li
                  key={hook.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="wrap-anywhere text-heading">{hook.url}</span>
                    <span className="text-xs text-muted">Inbound webhook endpoint</span>
                  </span>
                  <Link
                    href="/integrations/api-webhooks"
                    className="text-sm font-semibold text-link hover:underline"
                  >
                    API & Webhooks
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <QuietLine>Nothing depends on this integration.</QuietLine>
          )
        }
      </Loaded>
    </Panel>
  );
}

export function OverviewTab({
  integrationId,
  detail,
  actions,
}: {
  integrationId: string;
  detail: Detail;
  actions: OverviewActions;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-12">
        <ConnectionStatusCard detail={detail} actions={actions} />
        <UsageCard detail={detail} />
        <EnvironmentCard
          detail={detail}
          disabled={!actions.canConfigure}
          onSwitch={actions.onEnvironment}
        />
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-12">
        <IntegrationDetailsCard
          detail={detail}
          canEdit={actions.canConfigure}
          onEdit={actions.onEdit}
        />
        <QuickActionsCard detail={detail} actions={actions} />
      </div>
      <RecentActivityCard integrationId={integrationId} />
      <DependentsCard detail={detail} />
    </div>
  );
}
