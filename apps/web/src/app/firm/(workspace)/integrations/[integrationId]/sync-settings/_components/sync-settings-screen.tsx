'use client';

import { type IntegrationConnectionDetail, type IntegrationSyncDirection } from '@firmivra/types';
import { ActionMenu, Badge, Button, Callout, Card, Checkbox, Select, Toggle } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Database,
  DotsThreeVertical,
  Pause,
  Plugs,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  ConnectionBadge,
  entityIcons,
  formatDirection,
  relativeTime,
} from './sync-settings-shared';

type Draft = Pick<
  IntegrationConnectionDetail,
  'entities' | 'direction' | 'syncMode' | 'syncEveryMinutes' | 'options'
>;

function connectionSettings(detail: IntegrationConnectionDetail): Draft {
  return {
    entities: detail.entities,
    direction: detail.direction,
    syncMode: detail.syncMode,
    syncEveryMinutes: detail.syncEveryMinutes,
    options: detail.options,
  };
}

function frequencyLabel(minutes: number) {
  if (minutes < 60) return `Every ${minutes} minutes`;
  const hours = minutes / 60;
  return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function SyncSettingsScreen({ integrationId }: { integrationId: string }) {
  const router = useRouter();
  const query = useApiQuery(['integrations', 'connection', integrationId], () =>
    api.integrations.connection(integrationId),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const save = useApiMutation(
    (settings: Draft) => api.integrations.updateSettings(integrationId, settings),
    { invalidate: ['integrations', 'connection', integrationId] },
  );
  const pause = useApiMutation(
    (paused: boolean) =>
      paused ? api.integrations.resume(integrationId) : api.integrations.pause(integrationId),
    { invalidate: ['integrations', 'connection', integrationId] },
  );
  const sync = useApiMutation(() => api.integrations.sync(integrationId), {
    invalidate: ['integrations', 'connection', integrationId],
  });
  const detail = query.data;

  const settings = draft ?? (detail ? connectionSettings(detail) : null);
  const busy = save.isPending || pause.isPending || sync.isPending;
  const enabledEntities =
    detail?.provider.entities.filter((entity) => settings?.entities.includes(entity.key)) ?? [];
  const supportedDirections =
    detail?.provider.directions.filter((direction) =>
      enabledEntities.every((entity) => entity.directions.includes(direction)),
    ) ?? [];
  const currentDirection = settings?.direction ?? 'TWO_WAY';
  const canSave =
    !!detail?.canManage &&
    !!settings &&
    !query.isError &&
    !busy &&
    supportedDirections.includes(settings.direction) &&
    (settings.syncMode === 'MANUAL'
      ? settings.syncEveryMinutes === null
      : settings.syncEveryMinutes !== null &&
        detail.provider.frequencies.includes(settings.syncEveryMinutes)) &&
    JSON.stringify(settings) !== JSON.stringify(connectionSettings(detail));

  function changeSettings(changes: Partial<Draft>) {
    setDraft((current) => {
      const base = current ?? (detail ? connectionSettings(detail) : null);
      return base ? { ...base, ...changes } : null;
    });
    save.reset();
  }

  function changeEntity(key: string, enabled: boolean) {
    const entities = settings?.entities ?? [];
    const next = enabled
      ? [...new Set([...entities, key])]
      : entities.filter((entity) => entity !== key);
    const compatible =
      detail?.provider.directions.filter((direction) =>
        detail.provider.entities
          .filter((entity) => next.includes(entity.key))
          .every((entity) => entity.directions.includes(direction)),
      ) ?? [];
    changeSettings({
      entities: next,
      ...(compatible.includes(currentDirection) || !compatible[0]
        ? {}
        : { direction: compatible[0] }),
    });
  }

  function renderFrame(connection: IntegrationConnectionDetail | null) {
    const value = connection ? (draft ?? connectionSettings(connection)) : null;
    const controlsDisabled = !connection?.canManage || busy || query.isError;
    const LastSyncIcon = connection?.lastSyncAt ? CheckCircle : Clock;

    return (
      <div data-testid="integration-sync-settings" className="flex min-w-0 flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link href="/integrations" className="text-link hover:underline">
            Integrations
          </Link>
          <ArrowRight aria-hidden weight="fill" className="size-4 text-muted" />
          <Link href={`/integrations/${integrationId}`} className="text-link hover:underline">
            {connection?.provider.name ?? 'Integration'}
          </Link>
          <ArrowRight aria-hidden weight="fill" className="size-4 text-muted" />
          <span aria-current="page" className="text-text">
            Sync Settings
          </span>
        </nav>

        <Card data-testid="integration-header" className="!p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-success-soft text-3xl font-bold text-success">
                {connection?.provider.name.charAt(0) ?? <Plugs weight="fill" />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold text-heading">
                    {connection?.provider.name ?? 'Integration unavailable'}
                  </h1>
                  {connection ? (
                    <ConnectionBadge status={connection.status} />
                  ) : (
                    <Badge tone="neutral">Unavailable</Badge>
                  )}
                </div>
                <p className="mt-1 text-base text-info">
                  {connection?.provider.summary ?? 'Connection settings are unavailable.'}
                </p>
                <p className="mt-2 max-w-3xl text-sm text-muted">
                  {connection?.provider.description ??
                    'Retry when the integration service is available.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-3 lg:justify-end">
              <div className="grid min-w-56 grid-cols-1 divide-y divide-divider rounded-control border border-border px-4 text-sm">
                <div className="flex items-center gap-3 py-2">
                  <LastSyncIcon
                    weight="fill"
                    className={`size-5 ${connection?.lastSyncAt ? 'text-success' : 'text-muted'}`}
                  />
                  <span>
                    <strong className="block text-text">Last Sync</strong>
                    <span className="text-link">
                      {connection ? relativeTime(connection.lastSyncAt) : 'Not available'}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-3 py-2">
                  <Clock weight="fill" className="size-5 text-success" />
                  <span>
                    <strong className="block text-text">Next Sync</strong>
                    <span className="text-link">
                      {connection
                        ? connection.paused
                          ? 'Paused'
                          : relativeTime(connection.nextSyncAt)
                        : 'Not available'}
                      {connection?.syncMode === 'AUTO' ? ' (Auto)' : ''}
                    </span>
                  </span>
                </div>
              </div>
              <div className="flex min-w-48 flex-col justify-center gap-2">
                <Button
                  disabled={!connection?.canManage || connection.syncing || busy}
                  onClick={() => sync.mutate(undefined)}
                >
                  <ArrowsClockwise weight="fill" className="size-5" /> Sync Now
                </Button>
                <Link
                  href={`/integrations/${integrationId}/sync-history`}
                  className="inline-flex items-center justify-center gap-2 text-sm font-medium text-link"
                >
                  View Sync History <ArrowRight weight="fill" className="size-4" />
                </Link>
              </div>
              <ActionMenu
                label="Integration actions"
                trigger={<DotsThreeVertical weight="fill" className="size-6 text-action" />}
                sections={[
                  {
                    items: [
                      {
                        label: 'View overview',
                        onSelect: () => router.push(`/integrations/${integrationId}`),
                      },
                      {
                        label: 'View sync history',
                        onSelect: () => router.push(`/integrations/${integrationId}/sync-history`),
                      },
                      {
                        label: 'Refresh connection',
                        onSelect: () => {
                          void query.refetch();
                        },
                      },
                    ],
                  },
                ]}
              />
            </div>
          </div>
        </Card>

        <nav
          aria-label="Integration management"
          className="flex overflow-x-auto border-b border-divider"
        >
          {[
            { label: 'Overview', suffix: '' },
            { label: 'Sync Settings', suffix: '/sync-settings' },
            { label: 'Data Mapping', suffix: '/data-mapping' },
            { label: 'Permissions', suffix: '/permissions' },
            { label: 'Sync History', suffix: '/sync-history' },
            { label: 'Troubleshooting', suffix: '/troubleshooting' },
          ].map((tab) => (
            <Link
              key={tab.label}
              href={`/integrations/${integrationId}${tab.suffix}`}
              aria-current={tab.suffix === '/sync-settings' ? 'page' : undefined}
              className={`shrink-0 border-b-2 px-6 py-3 text-sm font-medium ${tab.suffix === '/sync-settings' ? 'border-action bg-accent-soft text-action' : 'border-transparent text-muted hover:text-heading'}`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        {query.isError ? (
          <Card
            role="alert"
            data-testid="sync-settings-error"
            className="flex items-center justify-between gap-4"
          >
            <p className="text-sm text-danger">{errorMessage(query.error)}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Card>
        ) : query.isPending ? (
          <Card role="status" className="text-sm text-muted">
            Loading sync settings…
          </Card>
        ) : null}

        <div className="grid min-w-0 gap-4 xl:grid-cols-12">
          <Card
            title="Sync Controls"
            data-testid="sync-settings-controls"
            className="flex min-w-0 flex-col !p-5 xl:col-span-7"
          >
            <p className="-mt-3 mb-4 text-sm text-muted">
              Automatically keep your data in sync between systems.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                disabled={!connection?.canManage || connection.syncing || busy}
                onClick={() => sync.mutate(undefined)}
              >
                <ArrowsClockwise weight="fill" className="size-5" />{' '}
                {connection?.syncing ? 'Syncing…' : 'Sync Now'}
              </Button>
              <Button
                variant="secondary"
                disabled={controlsDisabled}
                onClick={() => pause.mutate(!!connection?.paused)}
              >
                {connection?.paused ? (
                  <ArrowsClockwise weight="fill" className="size-5" />
                ) : (
                  <Pause weight="fill" className="size-5" />
                )}
                {connection?.paused ? 'Resume Auto Sync' : 'Pause Auto Sync'}
              </Button>
            </div>
            <div className="mt-4 divide-y divide-divider text-sm">
              <div className="flex min-h-14 items-center justify-between gap-4">
                <span>
                  <strong className="block text-text">Auto Sync</strong>
                  <span className="text-xs text-muted">
                    Automatically sync data on a set schedule.
                  </span>
                </span>
                <Toggle
                  checked={value?.syncMode === 'AUTO'}
                  disabled={controlsDisabled || !connection?.provider.frequencies.length}
                  label="Auto sync"
                  onChange={(checked) =>
                    changeSettings({
                      syncMode: checked ? 'AUTO' : 'MANUAL',
                      syncEveryMinutes: checked
                        ? (value?.syncEveryMinutes ?? connection?.provider.frequencies[0] ?? null)
                        : null,
                    })
                  }
                />
              </div>
              <div className="grid gap-2 py-3 sm:grid-cols-2 sm:items-center">
                <label htmlFor="sync-frequency" className="font-medium text-text">
                  Sync Frequency
                </label>
                <Select
                  id="sync-frequency"
                  label="Sync Frequency"
                  hideLabel
                  value={value?.syncEveryMinutes == null ? '' : String(value.syncEveryMinutes)}
                  disabled={controlsDisabled || value?.syncMode !== 'AUTO' || busy}
                  onChange={(event) =>
                    changeSettings({
                      syncEveryMinutes: event.target.value ? Number(event.target.value) : null,
                    })
                  }
                  options={[
                    { value: '', label: 'Select frequency' },
                    ...(connection?.provider.frequencies ?? []).map((minutes) => ({
                      value: String(minutes),
                      label: frequencyLabel(minutes),
                    })),
                  ]}
                />
              </div>
              <div className="grid gap-2 py-3 sm:grid-cols-2 sm:items-center">
                <label htmlFor="sync-direction" className="font-medium text-text">
                  Sync Direction
                </label>
                <Select
                  id="sync-direction"
                  label="Sync Direction"
                  hideLabel
                  value={value?.direction ?? ''}
                  disabled={controlsDisabled}
                  onChange={(event) =>
                    changeSettings({ direction: event.target.value as IntegrationSyncDirection })
                  }
                  options={[
                    { value: '', label: 'Select direction' },
                    ...supportedDirections.map((direction) => ({
                      value: direction,
                      label: formatDirection(direction),
                    })),
                  ]}
                />
              </div>
            </div>
            <Callout icon={Clock} surface="info" size="compact" title="Next scheduled sync">
              {connection?.paused
                ? 'Automatic sync is paused.'
                : connection?.nextSyncAt
                  ? `Next automatic sync ${relativeTime(connection.nextSyncAt).toLowerCase()}.`
                  : connection
                    ? 'No automatic sync is scheduled.'
                    : 'Sync schedule is unavailable.'}{' '}
              {connection?.lastSyncAt
                ? `Last sync completed ${relativeTime(connection.lastSyncAt)}.`
                : 'No completed sync yet.'}
            </Callout>
          </Card>

          <Card
            title="Sync Data"
            data-testid="sync-settings-data"
            className="flex min-w-0 flex-col !p-5 xl:col-span-5"
          >
            <p className="-mt-3 mb-2 text-sm text-muted">
              Select the data you want to sync between systems.
            </p>
            {connection?.provider.entities.length ? (
              <div className="divide-y divide-divider">
                {connection.provider.entities.map((entity) => {
                  const Glyph = entityIcons[entity.key] ?? Database;
                  return (
                    <div
                      key={entity.key}
                      className="grid min-h-11 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-2 py-1"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          label={entity.label}
                          checked={!!value?.entities.includes(entity.key)}
                          disabled={!connection.canManage || busy}
                          onChange={(event) => changeEntity(entity.key, event.target.checked)}
                          className="min-h-8 min-w-0 text-sm font-medium"
                        />
                        <Glyph
                          aria-hidden
                          weight="fill"
                          className="hidden size-4 shrink-0 text-navigation sm:block"
                        />
                      </span>
                      <span className="text-xs text-muted">{entity.description}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted">
                <Database weight="fill" className="size-5" />
                No sync objects are available.
              </div>
            )}
            <Button
              className="mt-4 w-full"
              disabled={!canSave}
              onClick={() => value && save.mutate(value, { onSuccess: () => setDraft(null) })}
            >
              {save.isPending ? 'Saving…' : 'Save Sync Settings'}
            </Button>
            {save.error ? (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errorMessage(save.error, {
                  NOT_SUPPORTED: 'These settings are not supported by this provider.',
                })}
              </p>
            ) : null}
            {save.isSuccess ? (
              <p role="status" className="mt-2 flex items-center gap-2 text-sm text-success">
                <CheckCircle weight="fill" className="size-4" />
                Sync settings saved.
              </p>
            ) : null}
          </Card>
        </div>

        {pause.error ? (
          <Card role="alert" className="text-sm text-danger">
            {errorMessage(pause.error)}
          </Card>
        ) : null}
        {sync.error ? (
          <Card role="alert" className="text-sm text-danger">
            {errorMessage(sync.error, {
              SYNC_IN_PROGRESS: 'A sync is already running. Wait for it to finish.',
            })}
          </Card>
        ) : null}
        {connection && !connection.canManage ? (
          <Card role="status" className="text-sm text-muted">
            You have read-only access to these sync settings.
          </Card>
        ) : null}
      </div>
    );
  }

  return renderFrame(query.isError ? null : (detail ?? null));
}
