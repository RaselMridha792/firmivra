'use client';

import {
  ApiRequestError,
  type IntegrationConnectionDetail,
  type UpdateIntegrationSettingsRequest,
} from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import { useState, type ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  ConnectionDetails,
  ConnectionHealth,
  MappingPreview,
  RecentActivity,
  SyncControls,
  SyncData,
} from './manage-overview-panels';
import { Breadcrumb, integrationError, ManageHeader, ManageTabsNav } from './manage-shell';

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
    (body: UpdateIntegrationSettingsRequest) =>
      api.integrations.updateSettings(integrationId, body),
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
        onSettings={() => undefined}
        onSave={() => undefined}
        onTest={() => undefined}
        onDisconnect={() => undefined}
        notice={
          <Card
            data-testid="manage-overview-offline"
            role="alert"
            className="flex items-center justify-between gap-4"
          >
            <p className="text-sm text-danger">{integrationError(query.error)}</p>
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
            onSettings={(body) => save.mutate(body)}
            onSave={() => save.mutate({ entities: selected })}
            onTest={() => test.mutate(undefined)}
            onDisconnect={() => setDisconnectOpen(true)}
            notice={
              mutationError ? (
                <Card role="alert">
                  <p className="text-sm text-danger">{integrationError(mutationError)}</p>
                </Card>
              ) : save.isSuccess ? (
                <Card role="status">
                  <p className="text-sm text-success">Sync settings saved.</p>
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
  onSettings,
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
  onSettings: (body: UpdateIntegrationSettingsRequest) => void;
  onSave: () => void;
  onTest: () => void;
  onDisconnect: () => void;
  notice: ReactNode;
}) {
  return (
    <div data-testid="manage-integration-overview" className="flex min-w-0 flex-col gap-4">
      <Breadcrumb name={detail?.provider.name} />
      {notice}
      <ManageHeader integrationId={integrationId} detail={detail} busy={busy} onSync={onSync} />
      <ManageTabsNav integrationId={integrationId} current="" />
      {/* The design's column widths: the details widest, Sync Data narrowest. */}
      <div className="grid gap-4 xl:grid-cols-[34fr_32fr_29fr]">
        <div className="min-w-0">
          <ConnectionDetails detail={detail} onDisconnect={onDisconnect} />
        </div>
        <div className="min-w-0">
          <SyncControls
            detail={detail}
            busy={busy}
            onSync={onSync}
            onPause={onPause}
            onSettings={onSettings}
          />
        </div>
        <div className="min-w-0">
          <SyncData
            detail={detail}
            selected={selected}
            busy={busy}
            onToggle={onToggle}
            onSave={onSave}
          />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[34fr_38fr_23fr]">
        <div className="min-w-0">
          <RecentActivity detail={detail} />
        </div>
        <div className="min-w-0">
          <MappingPreview detail={detail} />
        </div>
        <div className="min-w-0">
          <ConnectionHealth detail={detail} busy={busy} onTest={onTest} />
        </div>
      </div>
    </div>
  );
}
