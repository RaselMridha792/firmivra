'use client';

import { ApiRequestError, type IntegrationConnectionDetail } from '@firmivra/types';
import { Badge, Button, Card, Modal } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  DotsThreeVertical,
  Plugs,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  ConnectionDetails,
  ConnectionHealth,
  MappingPreview,
  RecentActivity,
  SyncControls,
  SyncData,
} from './manage-overview-panels';
import { ConnectionBadge, manageTabs, relativeTime } from './manage-integration-shared';

const code = (error: unknown) => (error instanceof ApiRequestError ? error.code : undefined);

export function ManageIntegrationOverviewScreen({ integrationId }: { integrationId: string }) {
  const query = useApiQuery(['integrations', 'connection', integrationId], () =>
    api.integrations.connection(integrationId),
  );
  const [selectedOverride, setSelectedOverride] = useState<string[] | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const sync = useApiMutation(() => api.integrations.sync(integrationId), {
    invalidate: ['integrations', 'connection', integrationId],
  });
  const pause = useApiMutation(
    (paused: boolean) =>
      paused ? api.integrations.resume(integrationId) : api.integrations.pause(integrationId),
    { invalidate: ['integrations', 'connection', integrationId] },
  );
  const save = useApiMutation(
    (entities: string[]) => api.integrations.updateSettings(integrationId, { entities }),
    { invalidate: ['integrations', 'connection', integrationId] },
  );
  const test = useApiMutation(() => api.integrations.test(integrationId), {
    invalidate: ['integrations', 'connection', integrationId],
  });
  const disconnect = useApiMutation(
    () => api.integrations.disconnect(integrationId, { confirm: true }),
    { invalidate: ['integrations'] },
  );
  const detail = query.data;
  const selected = selectedOverride ?? detail?.entities ?? [];
  const busy =
    sync.isPending || pause.isPending || save.isPending || test.isPending || disconnect.isPending;
  const mutationError = sync.error ?? pause.error ?? save.error ?? test.error ?? disconnect.error;

  if (
    query.isError &&
    query.data === undefined &&
    !['FORBIDDEN', 'NOT_FOUND'].includes(code(query.error) ?? '')
  ) {
    return (
      <OverviewFrame
        integrationId={integrationId}
        detail={null}
        selected={[]}
        busy={false}
        onToggle={() => undefined}
        onSync={() => undefined}
        onPause={() => undefined}
        onSave={() => undefined}
        onTest={() => undefined}
        onDisconnect={() => undefined}
        notice={
          <Card
            data-testid="manage-overview-offline"
            role="alert"
            className="flex items-center justify-between gap-4"
          >
            <p className="text-sm text-danger">{errorMessage(query.error)}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Card>
        }
      />
    );
  }

  return (
    <PageState query={query} isEmpty={() => false}>
      {(data) => (
        <>
          <OverviewFrame
            integrationId={integrationId}
            detail={data}
            selected={selected}
            busy={busy}
            onToggle={(key, checked) =>
              setSelectedOverride((current) => {
                const values = current ?? data.entities;
                return checked
                  ? [...new Set([...values, key])]
                  : values.filter((item) => item !== key);
              })
            }
            onSync={() => sync.mutate(undefined)}
            onPause={() => pause.mutate(data.paused)}
            onSave={() => save.mutate(selected)}
            onTest={() => test.mutate(undefined)}
            onDisconnect={() => setDisconnectOpen(true)}
            notice={
              mutationError ? (
                <Card role="alert">
                  <p className="text-sm text-danger">{errorMessage(mutationError)}</p>
                </Card>
              ) : test.isSuccess ? (
                <Card role="status">
                  <p className="text-sm text-success">{test.data.summary}</p>
                </Card>
              ) : null
            }
          />
          <Modal
            open={disconnectOpen}
            title={`Disconnect ${data.provider.name}?`}
            subtitle="Provider access will be revoked. Records already imported into LVP Pro and sync history will remain available."
            onClose={() => setDisconnectOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setDisconnectOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-danger"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    disconnect.mutate(undefined, { onSuccess: () => setDisconnectOpen(false) })
                  }
                >
                  {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted">You can reconnect this provider later.</p>
          </Modal>
        </>
      )}
    </PageState>
  );
}

function OverviewFrame({
  integrationId,
  detail,
  selected,
  busy,
  onToggle,
  onSync,
  onPause,
  onSave,
  onTest,
  onDisconnect,
  notice,
}: {
  integrationId: string;
  detail: IntegrationConnectionDetail | null;
  selected: string[];
  busy: boolean;
  onToggle: (key: string, checked: boolean) => void;
  onSync: () => void;
  onPause: () => void;
  onSave: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  notice: ReactNode;
}) {
  return (
    <div data-testid="manage-integration-overview" className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/integrations" className="text-link">
          Integrations
        </Link>
        <ArrowRight className="size-4 text-muted" />
        <span className="text-text">{detail?.provider.name ?? 'Integration'}</span>
      </nav>
      {notice}
      <Card className="!p-4" data-testid="integration-header">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 gap-4">
            <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-success-soft text-3xl font-bold text-success">
              {detail?.provider.name.charAt(0) ?? <Plugs weight="fill" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-heading">
                  {detail?.provider.name ?? 'Integration unavailable'}
                </h1>
                {detail ? (
                  <ConnectionBadge status={detail.status} />
                ) : (
                  <Badge tone="neutral">Unavailable</Badge>
                )}
              </div>
              <p className="mt-1 text-base text-info">
                {detail?.provider.summary ?? 'Connection details could not be loaded.'}
              </p>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                {detail?.provider.description ?? 'Retry when the integration service is available.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-stretch gap-3 lg:justify-end">
            <div className="grid min-w-56 grid-cols-1 divide-y divide-divider rounded-control border border-border px-4 text-sm">
              <div className="flex items-center gap-3 py-2">
                <CheckCircle weight="fill" className="size-5 text-success" />
                <span>
                  <strong className="block text-text">Last Sync</strong>
                  <span className="text-link">{relativeTime(detail?.lastSyncAt ?? null)}</span>
                </span>
              </div>
              <div className="flex items-center gap-3 py-2">
                <CheckCircle weight="fill" className="size-5 text-success" />
                <span>
                  <strong className="block text-text">Next Sync</strong>
                  <span className="text-link">
                    {relativeTime(detail?.nextSyncAt ?? null)}
                    {detail?.syncMode === 'AUTO' ? ' (Auto)' : ''}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex min-w-48 flex-col gap-2">
              <Button disabled={!detail?.canManage || detail.syncing || busy} onClick={onSync}>
                <ArrowsClockwise weight="fill" className="size-5" /> Sync Now
              </Button>
              <Link
                href={`/integrations/${integrationId}/sync-history`}
                className="inline-flex items-center justify-center gap-2 text-sm font-medium text-link"
              >
                View Sync History <ArrowRight className="size-4" />
              </Link>
            </div>
            <Button
              variant="ghost"
              aria-label="More integration actions"
              className="self-start px-3"
            >
              <DotsThreeVertical weight="fill" className="size-6" />
            </Button>
          </div>
        </div>
      </Card>
      <nav
        aria-label="Integration management"
        className="flex overflow-x-auto border-b border-divider"
      >
        {manageTabs.map((tab) => (
          <Link
            key={tab.label}
            href={`/integrations/${integrationId}${tab.suffix}`}
            aria-current={tab.suffix === '' ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-6 py-3 text-sm font-medium ${tab.suffix === '' ? 'border-action bg-accent-soft text-action' : 'border-transparent text-muted hover:text-heading'}`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <ConnectionDetails detail={detail} onDisconnect={onDisconnect} />
        </div>
        <div className="xl:col-span-4">
          <SyncControls detail={detail} busy={busy} onSync={onSync} onPause={onPause} />
        </div>
        <div className="xl:col-span-4">
          <SyncData
            detail={detail}
            selected={selected}
            busy={busy}
            onToggle={onToggle}
            onSave={onSave}
          />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <RecentActivity detail={detail} />
        </div>
        <div className="xl:col-span-5">
          <MappingPreview detail={detail} />
        </div>
        <div className="xl:col-span-3">
          <ConnectionHealth detail={detail} busy={busy} onTest={onTest} />
        </div>
      </div>
    </div>
  );
}
