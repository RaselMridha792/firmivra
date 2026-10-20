import type {
  IntegrationConnectionDetail,
  IntegrationSyncDirection,
  UpdateIntegrationSettingsRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Select, Toggle } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  ArrowsHorizontal,
  CheckCircle,
  Database,
  Gear,
  Info,
  LinkSimple,
  Pause,
  ShieldCheck,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CardTitle,
  ConnectionBadge,
  EmptyLine,
  HealthIcon,
  entityIcons,
  formatDate,
  formatDirection,
  formatFrequency,
  inSentence,
  relativeTime,
  shortTime,
} from './manage-integration-shared';

/**
 * The Overview cards of Manage Integration (manage-integration-u2013-quickbooks-online.jpg):
 * Connection Details, Sync Controls, Sync Data, Recent Sync Activity, Data Mapping and Connection
 * Health. Every value comes from the connection; a card keeps its frame when there is none.
 */

export function ConnectionDetails({
  detail,
  onDisconnect,
}: {
  detail: IntegrationConnectionDetail | null;
  onDisconnect: () => void;
}) {
  const rows: [string, ReactNode][] = [
    ['Status', detail ? <ConnectionBadge key="status" status={detail.status} /> : 'Unavailable'],
    ['Connected Since', detail ? formatDate(detail.connectedAt) : 'Not available'],
    ['Company', detail?.accountLabel ?? 'Not provided'],
    ['Provider Account ID', detail?.accountIdMasked ?? 'Not provided'],
    ['Environment', detail?.environment === 'TEST' ? 'Test / Sandbox' : 'Live (Production)'],
    ['Connection Type', detail?.connectionType ?? 'Not provided'],
  ];
  return (
    <Card data-testid="connection-details" className="flex h-full flex-col p-5!">
      <CardTitle>Connection Details</CardTitle>
      <dl className="divide-y divide-divider border-y border-divider text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-3 py-2">
            <dt className="text-heading">{label}</dt>
            <dd className="text-heading">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto grid gap-3 pt-5 sm:grid-cols-2">
        <Link
          href={detail ? `/integrations/${detail.id}/sync-settings` : '#'}
          aria-disabled={!detail}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-action px-3 py-2 text-sm font-medium whitespace-nowrap text-action hover:bg-accent-soft"
        >
          <Gear aria-hidden weight="fill" className="size-5" /> Update Connection
        </Link>
        <Button
          variant="secondary"
          className="min-h-10! border-danger/50! bg-danger-soft! px-3! py-2! whitespace-nowrap text-danger!"
          disabled={!detail?.canManage}
          onClick={onDisconnect}
        >
          <LinkSimple aria-hidden weight="bold" className="size-5" /> Disconnect
        </Button>
      </div>
    </Card>
  );
}

const minutes = (value: number) => ({ value: String(value), label: formatFrequency(value) });

export function SyncControls({
  detail,
  busy,
  onSync,
  onPause,
  onSettings,
}: {
  detail: IntegrationConnectionDetail | null;
  busy: boolean;
  onSync: () => void;
  onPause: () => void;
  /** Frequency and direction save at once (PATCH .../settings). */
  onSettings: (body: UpdateIntegrationSettingsRequest) => void;
}) {
  const provider = detail?.provider;
  const enabled = provider?.entities.filter((e) => detail?.entities.includes(e.key)) ?? [];
  /** A direction the provider and every enabled object support. */
  const supported = (direction: IntegrationSyncDirection) =>
    !!provider?.directions.includes(direction) &&
    enabled.every((e) => e.directions.includes(direction));
  const canEdit = !!detail?.canManage && !busy;
  const auto = !!detail && detail.syncMode === 'AUTO';
  const lastOk = detail?.recentRuns[0]?.status === 'SUCCEEDED';
  return (
    <Card data-testid="sync-controls" className="h-full p-5!">
      <CardTitle>Sync Controls</CardTitle>
      <p className="-mt-2 mb-3 text-sm text-text">
        Automatically keep your data in sync between {provider?.name ?? 'the provider'} and LVP Pro.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Button
          className="min-h-10! py-2! whitespace-nowrap"
          disabled={!detail?.canManage || detail.syncing || busy}
          onClick={onSync}
        >
          <ArrowsClockwise aria-hidden weight="bold" className="size-5" />
          {detail?.syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
        <Button
          variant="secondary"
          className="min-h-10! border-action! px-3! py-2! whitespace-nowrap text-heading! disabled:opacity-50"
          disabled={!detail?.canManage || !auto || busy}
          onClick={onPause}
        >
          {detail?.paused ? (
            <ArrowsClockwise aria-hidden weight="bold" className="size-5" />
          ) : (
            <Pause aria-hidden weight="fill" className="size-5" />
          )}
          {detail?.paused ? 'Resume Auto Sync' : 'Pause Auto Sync'}
        </Button>
      </div>
      <div className="mt-3 flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium whitespace-nowrap text-heading">Auto Sync</span>
          <span className="flex items-center gap-3">
            <span className="text-right text-xs leading-tight text-muted">
              Automatically sync data on a set schedule.
            </span>
            <Toggle
              checked={auto && !detail.paused}
              disabled={!canEdit || !auto}
              label="Auto sync"
              onChange={onPause}
            />
          </span>
        </div>
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-heading">Sync Frequency</span>
          <Select
            label="Sync frequency"
            hideLabel
            value={auto ? String(detail.syncEveryMinutes ?? '') : ''}
            disabled={!canEdit || !provider?.frequencies.length}
            onChange={(event) =>
              onSettings(
                event.target.value
                  ? { syncMode: 'AUTO', syncEveryMinutes: Number(event.target.value) }
                  : { syncMode: 'MANUAL', syncEveryMinutes: null },
              )
            }
            options={[
              { value: '', label: 'Manual' },
              ...(provider?.frequencies ?? []).map(minutes),
            ]}
          />
        </div>
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
          <span className="text-heading">Sync Direction</span>
          <Select
            label="Sync direction"
            hideLabel
            value={detail?.direction ?? ''}
            disabled={!canEdit}
            onChange={(event) => {
              const direction = provider?.directions.find((d) => d === event.target.value);
              if (direction && supported(direction)) onSettings({ direction });
            }}
            options={
              provider
                ? provider.directions.map((direction) => ({
                    value: direction,
                    label: supported(direction)
                      ? formatDirection(direction)
                      : `${formatDirection(direction)} (not for every object)`,
                  }))
                : [{ value: '', label: 'Not available' }]
            }
          />
        </div>
      </div>
      <div className="mt-4 flex gap-3 rounded-control bg-info-soft p-3 text-sm">
        <Info aria-hidden weight="fill" className="mt-0.5 size-6 shrink-0 text-action" />
        <p>
          <span className="block font-semibold text-heading">
            {detail?.paused
              ? 'Automatic sync is paused.'
              : detail?.nextSyncAt
                ? `Next automatic sync ${inSentence(relativeTime(detail.nextSyncAt))}.`
                : 'No automatic sync scheduled.'}
          </span>
          <span className="text-text">
            {detail?.lastSyncAt
              ? `Last sync completed${lastOk ? ' successfully' : ''} – ${inSentence(relativeTime(detail.lastSyncAt))}.`
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
    <Card data-testid="sync-data" className="flex h-full flex-col p-5!">
      <CardTitle>Sync Data</CardTitle>
      <p className="-mt-2 mb-2 text-sm text-text">
        Select the data you want to sync between systems.
      </p>
      {detail?.provider.entities.length ? (
        <div className="divide-y divide-divider border-y border-divider">
          {detail.provider.entities.map((entity) => {
            const Glyph = entityIcons[entity.key] ?? Database;
            return (
              <div
                key={entity.key}
                className="grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-2 py-1.5"
              >
                <Checkbox
                  label={entity.label}
                  checked={selected.includes(entity.key)}
                  disabled={!detail.canManage || busy}
                  onChange={(event) => onToggle(entity.key, event.target.checked)}
                  className="min-h-0! [&>span]:sr-only"
                />
                <Glyph aria-hidden weight="fill" className="size-5 text-heading" />
                <span aria-hidden className="text-sm leading-tight text-heading">
                  {entity.label}
                </span>
                <span className="text-xs leading-tight text-text">{entity.description}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyLine>No sync objects are available.</EmptyLine>
      )}
      <Button
        className="mt-auto min-h-10! w-full pt-2"
        disabled={!detail?.canManage || busy}
        onClick={onSave}
      >
        Save Sync Settings
      </Button>
    </Card>
  );
}

export function RecentActivity({ detail }: { detail: IntegrationConnectionDetail | null }) {
  return (
    <Card data-testid="recent-sync-activity" className="h-full p-5!">
      <CardTitle
        action={
          <Link
            href={detail ? `/integrations/${detail.id}/sync-history` : '#'}
            className="inline-flex items-center gap-1 font-medium text-link"
          >
            View All <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Link>
        }
      >
        Recent Sync Activity
      </CardTitle>
      {detail?.recentRuns.length ? (
        <ul className="divide-y divide-divider overflow-hidden rounded-control border border-divider">
          {detail.recentRuns.slice(0, 5).map((run) => {
            const failed = run.status === 'FAILED' || run.failedCount > 0;
            return (
              <li
                key={run.id}
                className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-2.5 text-sm ${failed ? 'bg-danger-soft text-danger' : 'text-heading'}`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  {failed ? (
                    <WarningCircle aria-hidden weight="fill" className="size-6 shrink-0" />
                  ) : (
                    <CheckCircle
                      aria-hidden
                      weight="fill"
                      className="size-6 shrink-0 text-success"
                    />
                  )}
                  <span className="leading-tight">
                    {run.entityLabel} {failed ? 'sync failed' : 'synced'}
                  </span>
                </span>
                <time dateTime={run.finishedAt ?? run.createdAt} className="whitespace-nowrap">
                  {shortTime(run.finishedAt ?? run.createdAt)}
                </time>
                <span className="whitespace-nowrap">{run.recordCount} records</span>
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
  const name = detail?.provider.name;
  return (
    <Card data-testid="data-mapping-preview" className="h-full p-5!">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action">
            <Database aria-hidden weight="fill" className="size-7" />
          </span>
          <div>
            <h2 className="text-xl font-bold text-heading">Data Mapping</h2>
            <p className="text-xs text-action">
              Map fields between {name ?? 'the provider'} and LVP Pro.
            </p>
          </div>
        </div>
        <Link
          href={detail ? `/integrations/${detail.id}/data-mapping` : '#'}
          className="shrink-0 rounded-control border border-action px-3 py-2 text-sm font-medium whitespace-nowrap text-action hover:bg-accent-soft"
        >
          Configure Mapping
        </Link>
      </div>
      {detail?.mappingPreview.length ? (
        <div className="overflow-hidden overflow-x-auto rounded-control border border-divider">
          <table className="w-full text-left text-sm">
            <thead className="bg-table-head text-xs font-semibold text-heading">
              <tr>
                <th className="px-3 py-2">LVP Pro Field</th>
                <th className="w-12 px-3 py-2">
                  <span className="sr-only">Direction</span>
                </th>
                <th className="px-3 py-2">{name} Field</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider text-heading">
              {detail.mappingPreview.slice(0, 7).map((pair) => (
                <tr key={`${pair.scope}-${pair.localField}`}>
                  <td className="px-3 py-1.5">{pair.localLabel}</td>
                  <td className="px-3 py-1.5" title={formatDirection(pair.direction)}>
                    <ArrowsHorizontal
                      aria-hidden
                      weight="bold"
                      className="mx-auto size-5 text-action"
                    />
                    <span className="sr-only">{formatDirection(pair.direction)}</span>
                  </td>
                  <td className="px-3 py-1.5">{pair.externalLabel}</td>
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
  const ok = detail?.health.ok ?? false;
  return (
    <Card data-testid="connection-health" className="flex h-full flex-col p-5!">
      <CardTitle>Connection Health</CardTitle>
      <div
        className={`flex items-center gap-3 rounded-control p-3 text-sm text-heading ${ok ? 'bg-success-soft' : 'bg-warning-soft'}`}
      >
        {ok ? (
          <CheckCircle aria-hidden weight="fill" className="size-8 shrink-0 text-success" />
        ) : (
          <WarningCircle aria-hidden weight="fill" className="size-8 shrink-0 text-warning" />
        )}
        <span>{detail?.health.summary ?? 'Connection health is unavailable.'}</span>
      </div>
      {detail?.health.checks.length ? (
        <ul className="mt-3 space-y-2 text-sm text-heading">
          {detail.health.checks.map((check) => (
            <li key={check.key} className="flex items-center gap-2.5">
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
        className="mt-auto min-h-10! w-full border-action! text-action!"
        disabled={!detail?.canManage || busy}
        onClick={onTest}
      >
        <ShieldCheck aria-hidden weight="fill" className="size-5" /> Run Connection Test
      </Button>
    </Card>
  );
}
