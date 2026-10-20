import type {
  IntegrationConnectionDetail,
  UpdateIntegrationSettingsRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Select, Toggle } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  Database,
  Gear,
  LinkSimple,
  Pause,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import {
  DirectionIcon,
  EmptyLine,
  HealthIcon,
  entityIcons,
  formatDate,
  formatDirection,
  formatFrequency,
  relativeTime,
} from './manage-integration-shared';

export function ConnectionDetails({
  detail,
  onDisconnect,
}: {
  detail: IntegrationConnectionDetail | null;
  onDisconnect: () => void;
}) {
  const rows = [
    [
      'Status',
      detail?.status
        ? detail.status.charAt(0) + detail.status.slice(1).toLowerCase()
        : 'Unavailable',
    ],
    ['Connected Since', detail ? formatDate(detail.connectedAt) : 'Not available'],
    ['Company', detail?.accountLabel ?? 'Not provided'],
    ['Provider Account ID', detail?.accountIdMasked ?? 'Not provided'],
    [
      'Environment',
      detail
        ? detail.environment === 'TEST'
          ? 'Test / Sandbox'
          : 'Live (Production)'
        : 'Not available',
    ],
    ['Connection Type', detail?.connectionType ?? 'Not provided'],
  ];
  return (
    <Card
      title="Connection Details"
      data-testid="connection-details"
      className="flex h-full flex-col !p-5"
    >
      <dl className="divide-y divide-divider text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-2 gap-3 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto grid gap-3 pt-6 sm:grid-cols-2">
        <Link
          href={detail ? `/integrations/${detail.id}/sync-settings` : '#'}
          aria-disabled={!detail}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action px-4 py-2 text-sm font-medium text-action"
        >
          <Gear weight="fill" className="size-5" /> Update Connection
        </Link>
        <Button
          variant="secondary"
          className="border-danger text-danger"
          disabled={!detail?.canManage}
          onClick={onDisconnect}
        >
          <LinkSimple weight="fill" className="size-5" /> Disconnect
        </Button>
      </div>
    </Card>
  );
}

export function SyncControls({
  detail,
  busy,
  onSync,
  onPause,
}: {
  detail: IntegrationConnectionDetail | null;
  busy: boolean;
  onSync: () => void;
  onPause: () => void;
}) {
  const settings = useApiMutation(
    async (changes: UpdateIntegrationSettingsRequest) => {
      if (!detail) throw new Error('Connection details are unavailable.');
      const updated = await api.integrations.updateSettings(detail.id, changes);
      if (changes.syncMode === 'AUTO' && detail.paused) await api.integrations.resume(detail.id);
      return updated;
    },
    { invalidate: ['integrations', 'connection', detail?.id] },
  );
  const disabled = !detail?.canManage || busy || settings.isPending;
  return (
    <Card title="Sync Controls" data-testid="sync-controls" className="h-full !p-5">
      <p className="-mt-3 mb-3 text-sm text-muted">
        Automatically keep your data in sync between systems.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button disabled={!detail?.canManage || detail.syncing || busy} onClick={onSync}>
          <ArrowsClockwise weight="fill" className="size-5" />{' '}
          {detail?.syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
        <Button variant="secondary" disabled={!detail?.canManage || busy} onClick={onPause}>
          {detail?.paused ? (
            <ArrowsClockwise weight="fill" className="size-5" />
          ) : (
            <Pause weight="fill" className="size-5" />
          )}
          {detail?.paused ? 'Resume Auto Sync' : 'Pause Auto Sync'}
        </Button>
      </div>
      <div className="mt-4 divide-y divide-divider text-sm">
        <div className="flex min-h-12 items-center justify-between gap-4">
          <span className="font-medium text-text">Auto Sync</span>
          <Toggle
            checked={!!detail && !detail.paused && detail.syncMode === 'AUTO'}
            disabled={disabled || !detail?.provider.frequencies.length}
            label="Auto sync status"
            onChange={(enabled) => {
              settings.mutate({
                syncMode: enabled ? 'AUTO' : 'MANUAL',
                syncEveryMinutes: enabled
                  ? (detail?.syncEveryMinutes ?? detail?.provider.frequencies[0] ?? null)
                  : null,
              });
            }}
          />
        </div>
        <div className="flex min-h-12 items-center justify-between gap-4">
          <span className="text-muted">Sync Frequency</span>
          <Select
            label="Sync Frequency"
            hideLabel
            value={detail?.syncEveryMinutes?.toString() ?? ''}
            disabled={disabled || detail?.syncMode !== 'AUTO'}
            options={[
              { value: '', label: detail ? 'Manual sync' : 'Not available' },
              ...(detail?.provider.frequencies.map((minutes) => ({
                value: String(minutes),
                label: formatFrequency(minutes),
              })) ?? []),
            ]}
            onChange={(event) =>
              settings.mutate(
                event.target.value
                  ? { syncMode: 'AUTO', syncEveryMinutes: Number(event.target.value) }
                  : { syncMode: 'MANUAL', syncEveryMinutes: null },
              )
            }
          />
        </div>
        <div className="flex min-h-12 items-center justify-between gap-4">
          <span className="text-muted">Sync Direction</span>
          <Select
            label="Sync Direction"
            hideLabel
            value={detail?.direction ?? ''}
            disabled={disabled}
            options={
              detail?.provider.directions.map((value) => ({
                value,
                label: formatDirection(value),
              })) ?? [{ value: '', label: 'Not available' }]
            }
            onChange={(event) => {
              const direction = detail?.provider.directions.find(
                (value) => value === event.target.value,
              );
              if (direction) settings.mutate({ direction });
            }}
          />
        </div>
      </div>
      {settings.isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {errorMessage(settings.error, {
            NOT_SUPPORTED: 'These sync settings are not supported by this provider.',
          })}
        </p>
      ) : null}
      <div className="mt-4 flex gap-3 rounded-control bg-info-soft p-3 text-sm text-info">
        <WarningCircle weight="fill" className="mt-0.5 size-5 shrink-0" />
        <p>
          <span className="block font-semibold">
            {detail?.nextSyncAt
              ? `Next automatic sync ${relativeTime(detail.nextSyncAt)}.`
              : 'No automatic sync scheduled.'}
          </span>
          <span>
            {detail?.lastSyncAt
              ? `Last sync completed ${relativeTime(detail.lastSyncAt)}.`
              : 'No completed sync yet.'}
          </span>
        </p>
      </div>
    </Card>
  );
}

export function SyncData({
  detail,
  selected,
  busy,
  onToggle,
  onSave,
}: {
  detail: IntegrationConnectionDetail | null;
  selected: string[];
  busy: boolean;
  onToggle: (key: string, checked: boolean) => void;
  onSave: () => void;
}) {
  return (
    <Card title="Sync Data" data-testid="sync-data" className="h-full !p-5">
      <p className="-mt-3 mb-2 text-sm text-muted">
        Select the data you want to sync between systems.
      </p>
      {detail?.provider.entities.length ? (
        <div className="divide-y divide-divider">
          {detail.provider.entities.map((entity) => {
            const Glyph = entityIcons[entity.key] ?? Database;
            return (
              <div
                key={entity.key}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    label={entity.label}
                    checked={selected.includes(entity.key)}
                    disabled={!detail.canManage || busy}
                    onChange={(event) => onToggle(entity.key, event.target.checked)}
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
        <EmptyLine>No sync objects are available.</EmptyLine>
      )}
      <Button className="mt-3 w-full" disabled={!detail?.canManage || busy} onClick={onSave}>
        Save Sync Settings
      </Button>
    </Card>
  );
}

export function RecentActivity({ detail }: { detail: IntegrationConnectionDetail | null }) {
  return (
    <Card data-testid="recent-sync-activity" className="h-full !p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Recent Sync Activity</h2>
        <Link
          href={detail ? `/integrations/${detail.id}/sync-history` : '#'}
          className="inline-flex items-center gap-1 text-sm font-medium text-link"
        >
          View All <ArrowRight weight="fill" className="size-4" />
        </Link>
      </div>
      {detail?.recentRuns.length ? (
        <ul className="divide-y divide-divider">
          {detail.recentRuns.slice(0, 5).map((run) => {
            const failed = run.status === 'FAILED' || run.failedCount > 0;
            return (
              <li
                key={run.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 text-sm ${failed ? 'text-danger' : 'text-text'}`}
              >
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  {failed ? (
                    <WarningCircle weight="fill" className="size-5 shrink-0" />
                  ) : (
                    <CheckCircle weight="fill" className="size-5 shrink-0 text-success" />
                  )}
                  <span className="truncate">
                    {run.entityLabel} {failed ? 'sync failed' : 'synced'}
                  </span>
                </span>
                <span className="text-muted">{relativeTime(run.finishedAt ?? run.createdAt)}</span>
                <span>{run.recordCount} records</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyLine>No sync activity yet.</EmptyLine>
      )}
    </Card>
  );
}

export function MappingPreview({ detail }: { detail: IntegrationConnectionDetail | null }) {
  return (
    <Card data-testid="data-mapping-preview" className="h-full !p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-info-soft text-info">
            <Database weight="fill" className="size-6" />
          </span>
          <div>
            <h2 className="font-semibold text-text">Data Mapping</h2>
            <p className="text-xs text-muted">Map fields between systems.</p>
          </div>
        </div>
        <Link
          href={detail ? `/integrations/${detail.id}/data-mapping` : '#'}
          className="rounded-control border border-action px-3 py-2 text-sm font-medium text-action"
        >
          Configure Mapping
        </Link>
      </div>
      {detail?.mappingPreview.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-table-head text-xs text-muted">
              <tr>
                <th className="px-3 py-2">LVP Pro Field</th>
                <th className="px-3 py-2 text-center">Direction</th>
                <th className="px-3 py-2">{detail.provider.name} Field</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {detail.mappingPreview.slice(0, 7).map((pair) => (
                <tr key={`${pair.scope}-${pair.localField}`}>
                  <td className="px-3 py-2">{pair.localLabel}</td>
                  <td className="px-3 py-2">
                    <span className="flex justify-center">
                      <DirectionIcon />
                    </span>
                  </td>
                  <td className="px-3 py-2">{pair.externalLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyLine>No fields have been mapped.</EmptyLine>
      )}
    </Card>
  );
}

export function ConnectionHealth({
  detail,
  busy,
  onTest,
}: {
  detail: IntegrationConnectionDetail | null;
  busy: boolean;
  onTest: () => void;
}) {
  return (
    <Card
      title="Connection Health"
      data-testid="connection-health"
      className="flex h-full flex-col !p-5"
    >
      <div
        className={`flex gap-3 rounded-control p-3 text-sm ${detail?.health.ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
      >
        <HealthIcon ok={detail?.health.ok ?? false} />
        <span className="font-medium">
          {detail?.health.summary ?? 'Connection health is unavailable.'}
        </span>
      </div>
      {detail?.health.checks.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {detail.health.checks.map((check) => (
            <li key={check.key} className="flex items-center gap-2">
              <HealthIcon ok={check.ok} />
              <span>{check.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyLine>No health checks are available.</EmptyLine>
      )}
      <Button
        variant="secondary"
        className="mt-auto w-full border-action text-action"
        disabled={!detail?.canManage || busy}
        onClick={onTest}
      >
        <ShieldCheck weight="fill" className="size-5" /> Run Connection Test
      </Button>
    </Card>
  );
}
