'use client';

import { ApiRequestError } from '@firmivra/types';
import { ActionMenu, Card, IconButton, Toast } from '@firmivra/ui';
import {
  ArrowsClockwise,
  ChartBar,
  CheckCircle,
  CircleNotch,
  DotsThreeVertical,
  FileText,
  MinusCircle,
  PauseCircle,
  PencilCircle,
  Power,
  ProhibitInset,
  Trash,
  WarningCircle,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  STATUS_LABELS,
  type ConnectionTestResult,
  type IntegrationStatus,
  type PlatformIntegrationDetail,
} from '../../../../../../../mocks/admin-integrations';
import { EnvironmentBadge, ServiceLogo } from '../../../_components/integration-badges';
import {
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../../_components/integration-format';
import { integrationErrorMessage, Loaded } from '../../../_components/integration-states';
import {
  IntegrationsHeader,
  LinkButton,
  logsHref,
  setupHref,
} from '../../../_components/integrations-shell';
import { LifecycleDialog, type Notice } from '../../../_components/platform-actions';
import { AccessTab } from './access-tab';
import { ConnectionTab } from './connection-tab';
import { BoxTabs, NotFoundCard, OutlineButton } from './detail-parts';
import {
  ConnectionFieldsDialog,
  CredentialsDialog,
  EditDetailsDialog,
  EnvironmentDialog,
  LogDrawer,
} from './detail-dialogs';
import { ErrorLogsTab, SyncHistoryTab } from './history-tabs';
import { OverviewTab } from './overview-tab';
import { UsageTab } from './usage-tab';

/**
 * Manage Platform Integration (stripe-integration-admin-dashboard.jpg, Stripe as the example;
 * docx §5): the header with Test Connection and the lifecycle menu, the summary card (status,
 * environment, last sync, uptime) and six tabs: Overview, Connection Settings, Usage & Analytics,
 * Sync History, Error Logs and Access Control (with the audit trail). Secrets never show in full;
 * credential changes are Super Admin only; disable, enable and remove confirm their impact.
 */

type DetailTab = 'overview' | 'connection' | 'usage' | 'history' | 'errors' | 'access';
type Lifecycle = 'disable' | 'enable' | 'remove';
type Dialog =
  | { kind: 'credentials' }
  | { kind: 'connection' }
  | { kind: 'details' }
  | { kind: 'environment' }
  | { kind: 'lifecycle'; lifecycle: Lifecycle };

const RUNNING: IntegrationStatus[] = ['ACTIVE', 'NEEDS_ATTENTION', 'ERROR'];
const LIFECYCLE_ON: IntegrationStatus[] = ['ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION', 'ERROR'];

const STATUS_LOOK: Record<IntegrationStatus, { className: string; icon: Icon }> = {
  ACTIVE: { className: 'bg-success-soft text-success', icon: CheckCircle },
  NEEDS_ATTENTION: { className: 'bg-warning-soft text-warning', icon: WarningCircle },
  ERROR: { className: 'bg-danger-soft text-danger', icon: XCircle },
  INACTIVE: { className: 'bg-disabled text-muted', icon: PauseCircle },
  DISABLED: { className: 'bg-disabled text-muted', icon: ProhibitInset },
  DRAFT: { className: 'bg-info-soft text-info', icon: PencilCircle },
  REMOVED: { className: 'bg-disabled text-muted', icon: MinusCircle },
};

/** The header card's larger status chip ("✓ Active"). */
function StatusChip({ status }: { status: IntegrationStatus }) {
  const look = STATUS_LOOK[status];
  const Glyph = look.icon;
  return (
    <span
      data-testid="integration-status"
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-base font-medium ${look.className}`}
    >
      <Glyph aria-hidden weight="fill" className="size-5" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function SummaryCard({ detail }: { detail: ReturnType<typeof useDetail> }) {
  return (
    <Card data-testid="integration-summary" className="p-5!">
      <Loaded query={detail} rows={2}>
        {(integration) => (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex min-w-0 items-center gap-4">
                <ServiceLogo category={integration.category} size="lg" />
                <div className="min-w-0">
                  <h2 data-testid="integration-name" className="text-2xl font-bold text-heading">
                    {integration.name}
                  </h2>
                  <p className="text-sm text-text">{integration.description}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={integration.status} />
                <EnvironmentBadge environment={integration.environment} />
              </div>
            </div>
            <dl className="flex flex-wrap gap-y-3">
              <div className="flex flex-col gap-1 pr-6">
                <dt className="text-sm text-text">Last Sync</dt>
                <dd className="text-base text-heading">
                  {integration.lastSyncAt ? (
                    <time dateTime={integration.lastSyncAt}>
                      {formatDateTime(integration.lastSyncAt)}
                    </time>
                  ) : (
                    'Never synced'
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-1 border-l border-divider pl-6">
                <dt className="text-sm text-text">Uptime (30 days)</dt>
                <dd data-testid="integration-uptime" className="text-base text-heading">
                  {integration.uptime30d === null ? 'N/A' : formatPercent(integration.uptime30d)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function useDetail(integrationId: string) {
  return useApiQuery(['admin-integrations', 'platform', integrationId], () =>
    adminIntegrations.getPlatform(integrationId),
  );
}

export function PlatformDetail({ integrationId }: { integrationId: string }) {
  const router = useRouter();
  const detail = useDetail(integrationId);
  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const providers = useApiQuery(['admin-integrations', 'providers'], () =>
    adminIntegrations.providers(),
  );
  const [tab, setTab] = useState<DetailTab>('overview');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<ConnectionTestResult | null>(null);

  const invalidate = { invalidate: ['admin-integrations'] };
  const test = useApiMutation(() => adminIntegrations.testPlatform(integrationId), invalidate);
  const reconnect = useApiMutation(
    () => adminIntegrations.reconnectPlatform(integrationId),
    invalidate,
  );
  const sync = useApiMutation(() => adminIntegrations.syncPlatform(integrationId), invalidate);

  const integration: PlatformIntegrationDetail | undefined = detail.data;
  const rights = access.data;
  const canConfigure = !!rights?.canManageConfiguration;
  const canSecrets = !!rights?.canManageSecrets;
  const canLifecycle = !!rights?.canLifecycle;
  const status = integration?.status;
  const canTest =
    !!integration && integration.supportsTest && status !== 'DRAFT' && status !== 'REMOVED';
  const canSync = !!status && RUNNING.includes(status);
  const failed = (error: unknown) =>
    setNotice({ tone: 'error', text: integrationErrorMessage(error) });
  const done = (text: string) => {
    setDialog(null);
    setNotice({ tone: 'success', text });
  };
  const reload = () => {
    setDialog(null);
    void detail.refetch();
  };

  function runTest() {
    setNotice(null);
    test.mutate(undefined, {
      onSuccess: (result) => {
        setLastTest(result);
        setNotice({
          tone: result.ok ? 'success' : 'error',
          text: `${result.integration.name}: ${result.message}`,
        });
      },
      onError: failed,
    });
  }
  function runReconnect() {
    if (!integration) return;
    // Key-based providers re-authenticate by updating their credentials (docx §5 Reconnect).
    if (!integration.connection.oauth) {
      setDialog({ kind: 'credentials' });
      return;
    }
    setNotice(null);
    reconnect.mutate(undefined, {
      onSuccess: (result) => {
        setLastTest(result);
        setNotice({
          tone: result.ok ? 'success' : 'error',
          text: result.ok
            ? `${result.integration.name} reconnected. ${result.message}`
            : `${result.integration.name}: ${result.message} The previous connection is kept.`,
        });
      },
      onError: failed,
    });
  }
  function runSync() {
    setNotice(null);
    sync.mutate(undefined, {
      onSuccess: (run) =>
        setNotice(
          run.status === 'FAILED'
            ? {
                tone: 'error',
                text: `Sync failed: ${run.errorMessage ?? 'the provider did not answer'}. It is in Sync History and the logs.`,
              }
            : {
                tone: 'success',
                text: `Sync completed: ${formatNumber(run.objectCount)} objects processed.`,
              },
        ),
      onError: failed,
    });
  }
  const lifecycle = (kind: Lifecycle) => setDialog({ kind: 'lifecycle', lifecycle: kind });

  const notFound = detail.error instanceof ApiRequestError && detail.error.code === 'NOT_FOUND';
  const header = (
    <IntegrationsHeader
      title={integration ? `Manage Integration – ${integration.name}` : 'Manage Integration'}
      subtitle="View and manage connection details, settings, and activity for this integration."
      back={{ href: '/integrations', label: 'Back to Integrations' }}
      actions={
        notFound ? undefined : status === 'DRAFT' && integration ? (
          <LinkButton href={setupHref(integration)} variant="primary">
            Continue Setup
          </LinkButton>
        ) : (
          <>
            <OutlineButton
              onClick={runTest}
              disabled={!canTest || test.isPending}
              aria-busy={test.isPending}
            >
              {test.isPending ? (
                <CircleNotch
                  aria-hidden
                  weight="bold"
                  className="size-5 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {test.isPending ? 'Testing…' : 'Test Connection'}
            </OutlineButton>
            {integration ? (
              <ActionMenu
                label={`More actions for ${integration.name}`}
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                sections={[
                  {
                    items: [
                      ...(canSync
                        ? [
                            {
                              label: sync.isPending ? 'Syncing…' : 'Sync Now',
                              icon: ArrowsClockwise,
                              onSelect: runSync,
                            },
                          ]
                        : []),
                      {
                        label: 'View Logs',
                        icon: FileText,
                        onSelect: () => router.push(logsHref(integration.id)),
                      },
                      {
                        label: 'Usage & Analytics',
                        icon: ChartBar,
                        onSelect: () => setTab('usage'),
                      },
                    ],
                  },
                  ...(canLifecycle && status !== 'REMOVED'
                    ? [
                        {
                          items: [
                            ...(status && LIFECYCLE_ON.includes(status)
                              ? [
                                  {
                                    label: 'Disable',
                                    icon: ProhibitInset,
                                    onSelect: () => lifecycle('disable'),
                                  },
                                ]
                              : []),
                            ...(status === 'DISABLED'
                              ? [
                                  {
                                    label: 'Enable',
                                    icon: Power,
                                    onSelect: () => lifecycle('enable'),
                                  },
                                ]
                              : []),
                            {
                              label: 'Remove',
                              icon: Trash,
                              danger: true,
                              onSelect: () => lifecycle('remove'),
                            },
                          ],
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <IconButton icon={DotsThreeVertical} weight="bold" label="More actions" disabled />
            )}
          </>
        )
      }
    />
  );

  if (notFound)
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <NotFoundCard
          title="Integration not found"
          text="We couldn't find this platform integration. It may have been removed, or the link is wrong."
          href="/integrations/platform"
          linkLabel="Back to Platform Integrations"
        />
      </div>
    );

  const overviewActions = {
    canConfigure,
    canSecrets,
    canLifecycle,
    testing: test.isPending,
    lastTest,
    onTest: runTest,
    onReconnect: runReconnect,
    onCredentials: () => setDialog({ kind: 'credentials' }),
    onEdit: () => setDialog({ kind: 'details' }),
    onEnvironment: () => setDialog({ kind: 'environment' }),
    onLifecycle: lifecycle,
    onOpenLog: setLogId,
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {header}
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}
      <SummaryCard detail={detail} />
      <BoxTabs<DetailTab>
        label="Integration sections"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <OverviewTab
                integrationId={integrationId}
                detail={detail}
                actions={overviewActions}
              />
            ),
          },
          {
            id: 'connection',
            label: 'Connection Settings',
            content: (
              <ConnectionTab
                detail={detail}
                providers={providers}
                actions={{
                  canConfigure,
                  canSecrets,
                  accessKnown: !!rights,
                  onCredentials: () => setDialog({ kind: 'credentials' }),
                  onConnectionFields: () => setDialog({ kind: 'connection' }),
                  onEnvironment: () => setDialog({ kind: 'environment' }),
                  onReconnect: runReconnect,
                  onReload: reload,
                  onSaved: (text) => setNotice({ tone: 'success', text }),
                }}
              />
            ),
          },
          {
            id: 'usage',
            label: 'Usage & Analytics',
            content: <UsageTab integrationId={integrationId} />,
          },
          {
            id: 'history',
            label: 'Sync History',
            content: (
              <SyncHistoryTab
                integrationId={integrationId}
                canSync={canSync}
                syncing={sync.isPending}
                onSync={runSync}
                onOpenLog={setLogId}
              />
            ),
          },
          {
            id: 'errors',
            label: 'Error Logs',
            content: <ErrorLogsTab integrationId={integrationId} onOpenLog={setLogId} />,
          },
          {
            id: 'access',
            label: 'Access Control',
            content: <AccessTab integrationId={integrationId} detail={detail} access={access} />,
          },
        ]}
      />

      {integration && dialog?.kind === 'credentials' ? (
        <CredentialsDialog
          integration={integration}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {integration && dialog?.kind === 'connection' ? (
        <ConnectionFieldsDialog
          integration={integration}
          onClose={() => setDialog(null)}
          onDone={done}
          onReload={reload}
        />
      ) : null}
      {integration && dialog?.kind === 'details' ? (
        <EditDetailsDialog
          integration={integration}
          onClose={() => setDialog(null)}
          onDone={done}
          onReload={reload}
        />
      ) : null}
      {integration && dialog?.kind === 'environment' ? (
        <EnvironmentDialog
          integration={integration}
          onClose={() => setDialog(null)}
          onDone={done}
          onReload={reload}
        />
      ) : null}
      {integration && dialog?.kind === 'lifecycle' ? (
        <LifecycleDialog
          integration={integration}
          kind={dialog.lifecycle}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            if (dialog.lifecycle === 'remove') {
              router.push('/integrations/platform');
              return;
            }
            done(text);
          }}
        />
      ) : null}
      {logId ? (
        <LogDrawer logId={logId} integrationId={integrationId} onClose={() => setLogId(null)} />
      ) : null}
    </div>
  );
}
