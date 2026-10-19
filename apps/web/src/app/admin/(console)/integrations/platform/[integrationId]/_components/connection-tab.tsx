'use client';

import { ApiRequestError } from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Select, Table, type Column } from '@firmivra/ui';
import { LockKey } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  AUTH_TYPE_LABELS,
  BACKOFFS,
  DATA_ACCESS,
  DATA_ACCESS_LABELS,
  FIRM_EXPOSURE_LABELS,
  FIRM_EXPOSURES,
  SYNC_SCHEDULE_LABELS,
  SYNC_SCHEDULES,
  type Backoff,
  type ConnectionValue,
  type DataAccess,
  type FirmExposure,
  type PlatformIntegrationDetail,
  type ProviderTemplate,
  type SyncSchedule,
} from '../../../../../../../mocks/admin-integrations';
import { EnvironmentBadge } from '../../../_components/integration-badges';
import { formatDateTime } from '../../../_components/integration-format';
import {
  integrationErrorMessage,
  Loaded,
  loadError,
  QuietLine,
  SkeletonLines,
} from '../../../_components/integration-states';
import { CopyButton, DetailRows, OutlineButton, Panel } from './detail-parts';

/**
 * Connection Settings (docx §5): the connection's fields with secrets masked (never the full
 * value), Update Credentials for a Super Admin only, the non-secret endpoints, OAuth reconnect,
 * the environment switch, and the service settings (scopes, schedule, features, data access,
 * retries, exposure) saved with the version read.
 */

type Detail = UseQueryResult<PlatformIntegrationDetail>;

export interface ConnectionActions {
  canConfigure: boolean;
  canSecrets: boolean;
  /** False until the rights are known (or they could not load). */
  accessKnown: boolean;
  onCredentials: () => void;
  onConnectionFields: () => void;
  onEnvironment: () => void;
  onReconnect: () => void;
  onReload: () => void;
  onSaved: (text: string) => void;
}

const BACKOFF_LABELS: Record<Backoff, string> = {
  EXPONENTIAL: 'Exponential',
  FIXED: 'Fixed interval',
};

const fieldColumns: Column<ConnectionValue>[] = [
  {
    id: 'field',
    label: 'Field',
    cell: (field) => (
      <span className="flex flex-col">
        <span className="font-medium text-heading">{field.label}</span>
        {field.required ? <span className="text-xs text-muted">Required</span> : null}
      </span>
    ),
  },
  {
    id: 'value',
    label: 'Value',
    className: 'min-w-40',
    cell: (field) =>
      field.display ? (
        <span className="flex items-center gap-2">
          {field.secret ? (
            <LockKey aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
          ) : null}
          <code className="wrap-anywhere text-heading">{field.display}</code>
        </span>
      ) : (
        <span className="text-muted">Not set</span>
      ),
  },
  {
    id: 'kind',
    label: 'Type',
    className: 'whitespace-nowrap',
    cell: (field) =>
      field.secret ? <Badge tone="purple">Secret · write-only</Badge> : <Badge>Setting</Badge>,
  },
  {
    id: 'updated',
    label: 'Last Updated',
    className: 'whitespace-nowrap',
    cell: (field) =>
      field.updatedAt ? (
        <time dateTime={field.updatedAt}>{formatDateTime(field.updatedAt)}</time>
      ) : (
        <span className="text-muted">Never</span>
      ),
  },
];

function ConnectionDetails({ detail, actions }: { detail: Detail; actions: ConnectionActions }) {
  const integration = detail.data;
  const gone = !integration || integration.status === 'REMOVED';
  const plainFields = integration?.connection.fields.filter((field) => !field.secret) ?? [];
  return (
    <Panel
      testId="connection-details"
      title="Connection Details"
      subtitle="Credentials are write-only: only a masked hint is shown after saving."
      action={
        <div className="flex flex-wrap gap-2">
          <OutlineButton
            onClick={actions.onConnectionFields}
            disabled={gone || !actions.canConfigure || !plainFields.length}
          >
            Edit Connection Settings
          </OutlineButton>
          <Button onClick={actions.onCredentials} disabled={gone || !actions.canSecrets}>
            <LockKey aria-hidden weight="fill" className="size-5" />
            Update Credentials
          </Button>
        </div>
      }
    >
      {actions.accessKnown && !actions.canSecrets ? (
        <p className="pb-2 text-sm text-muted">Only a Super Admin can change credentials.</p>
      ) : null}
      <Loaded query={detail} rows={5}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <DetailRows
              rows={[
                { label: 'Authentication', value: AUTH_TYPE_LABELS[data.connection.authType] },
                {
                  label: 'Environment',
                  value: (
                    <span className="flex flex-wrap items-center gap-3">
                      <EnvironmentBadge environment={data.environment} />
                      <button
                        type="button"
                        onClick={actions.onEnvironment}
                        disabled={gone || !actions.canConfigure}
                        className="text-sm font-semibold text-link hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
                      >
                        Switch to {data.environment === 'LIVE' ? 'Test' : 'Live'}
                      </button>
                    </span>
                  ),
                },
                {
                  label: 'Credentials Rotated',
                  value: data.connection.secretRotatedAt ? (
                    <time dateTime={data.connection.secretRotatedAt}>
                      {formatDateTime(data.connection.secretRotatedAt)}
                    </time>
                  ) : (
                    <span className="text-muted">Never</span>
                  ),
                },
                {
                  label: 'Configuration',
                  value: data.connection.complete ? (
                    <Badge tone="success" dot>
                      Every required field is set
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot>
                      Required fields are missing
                    </Badge>
                  ),
                },
                ...(data.connection.oauth
                  ? [
                      {
                        label: 'OAuth Connection',
                        value: (
                          <span className="flex flex-wrap items-center gap-3">
                            <span>
                              {data.connection.oauth.connected
                                ? `Connected as ${data.connection.oauth.account ?? 'the platform account'}${data.connection.oauth.connectedAt ? ` since ${formatDateTime(data.connection.oauth.connectedAt)}` : ''}`
                                : 'Not connected'}
                            </span>
                            <OutlineButton
                              onClick={actions.onReconnect}
                              disabled={gone || !actions.canSecrets}
                            >
                              Reconnect
                            </OutlineButton>
                          </span>
                        ),
                      },
                    ]
                  : []),
                {
                  label: 'Webhook URL',
                  value: data.connection.webhookUrl ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 wrap-anywhere">{data.connection.webhookUrl}</span>
                      <CopyButton value={data.connection.webhookUrl} label="Copy webhook URL" />
                    </span>
                  ) : (
                    <span className="text-muted">This provider sends no webhooks</span>
                  ),
                },
              ]}
            />
            {data.connection.fields.length ? (
              <Table
                caption="Connection fields"
                rows={data.connection.fields}
                columns={fieldColumns}
                rowKey={(field) => field.key}
                showPagination={false}
              />
            ) : (
              <QuietLine>This provider has no connection fields.</QuietLine>
            )}
          </div>
        )}
      </Loaded>
    </Panel>
  );
}

interface SettingsDraft {
  scopes: string[];
  syncSchedule: SyncSchedule;
  features: string[];
  dataAccess: DataAccess;
  maxRetries: string;
  backoff: Backoff;
  firmExposure: FirmExposure;
}
const draftOf = (integration: PlatformIntegrationDetail): SettingsDraft => ({
  scopes: integration.settings.scopes,
  syncSchedule: integration.settings.syncSchedule,
  features: integration.settings.features,
  dataAccess: integration.settings.dataAccess,
  maxRetries: String(integration.settings.retry.maxRetries),
  backoff: integration.settings.retry.backoff,
  firmExposure: integration.settings.firmExposure,
});
const toggled = (list: string[], value: string, on: boolean) =>
  on ? [...new Set([...list, value])] : list.filter((item) => item !== value);

/** The service settings form; keyed by the version, so a save elsewhere starts it fresh. */
function SettingsForm({
  integration,
  template,
  actions,
}: {
  integration: PlatformIntegrationDetail;
  template: ProviderTemplate;
  actions: ConnectionActions;
}) {
  const [draft, setDraft] = useState(() => draftOf(integration));
  const [retryError, setRetryError] = useState<string | undefined>();
  const save = useApiMutation(
    (body: SettingsDraft) =>
      adminIntegrations.updatePlatform(integration.id, {
        version: integration.version,
        settings: {
          scopes: body.scopes,
          syncSchedule: body.syncSchedule,
          features: body.features,
          dataAccess: body.dataAccess,
          retry: { maxRetries: Number(body.maxRetries), backoff: body.backoff },
          firmExposure: body.firmExposure,
        },
      }),
    { invalidate: ['admin-integrations'] },
  );
  const locked = !actions.canConfigure || integration.status === 'REMOVED';
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(integration));
  const set = (patch: Partial<SettingsDraft>) => setDraft((current) => ({ ...current, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const retries = Number(draft.maxRetries);
    if (!/^\d+$/.test(draft.maxRetries.trim()) || retries > 10) {
      setRetryError('Choose from 0 to 10 retries.');
      requestAnimationFrame(() => document.getElementById('settings-retries')?.focus());
      return;
    }
    setRetryError(undefined);
    save.mutate(draft, { onSuccess: () => actions.onSaved('Service settings saved.') });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Sync Schedule"
          value={draft.syncSchedule}
          disabled={locked}
          options={SYNC_SCHEDULES.map((value) => ({ value, label: SYNC_SCHEDULE_LABELS[value] }))}
          onChange={(event) =>
            set({
              syncSchedule:
                SYNC_SCHEDULES.find((value) => value === event.target.value) ?? draft.syncSchedule,
            })
          }
        />
        <Select
          label="Data Access"
          value={draft.dataAccess}
          disabled={locked}
          options={DATA_ACCESS.map((value) => ({ value, label: DATA_ACCESS_LABELS[value] }))}
          onChange={(event) =>
            set({
              dataAccess:
                DATA_ACCESS.find((value) => value === event.target.value) ?? draft.dataAccess,
            })
          }
        />
        <Input
          id="settings-retries"
          label="Retries After a Failure"
          type="number"
          inputMode="numeric"
          min={0}
          max={10}
          disabled={locked}
          value={draft.maxRetries}
          error={retryError}
          onChange={(event) => set({ maxRetries: event.target.value })}
        />
        <Select
          label="Retry Backoff"
          value={draft.backoff}
          disabled={locked}
          options={BACKOFFS.map((value) => ({ value, label: BACKOFF_LABELS[value] }))}
          onChange={(event) =>
            set({
              backoff: BACKOFFS.find((value) => value === event.target.value) ?? draft.backoff,
            })
          }
        />
        <div className="sm:col-span-2">
          <Select
            label="Firm Exposure"
            value={draft.firmExposure}
            disabled={locked}
            options={FIRM_EXPOSURES.map((value) => ({
              value,
              label: FIRM_EXPOSURE_LABELS[value],
            }))}
            onChange={(event) =>
              set({
                firmExposure:
                  FIRM_EXPOSURES.find((value) => value === event.target.value) ??
                  draft.firmExposure,
              })
            }
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold text-heading">Permissions and Scopes</legend>
        <p className="text-xs text-muted">Least privilege: choose only what Firmivra needs.</p>
        {template.scopes.length ? (
          <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
            {template.scopes.map((scope) => (
              <Checkbox
                key={scope}
                label={scope}
                disabled={locked}
                checked={draft.scopes.includes(scope)}
                onChange={(event) =>
                  set({ scopes: toggled(draft.scopes, scope, event.target.checked) })
                }
              />
            ))}
          </div>
        ) : (
          <QuietLine>This provider has no scopes to choose.</QuietLine>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-semibold text-heading">Enabled Features</legend>
        {template.features.length ? (
          <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
            {template.features.map((feature) => (
              <div key={feature.key} className="flex flex-col pb-2">
                <Checkbox
                  label={feature.label}
                  disabled={locked}
                  checked={draft.features.includes(feature.key)}
                  onChange={(event) =>
                    set({ features: toggled(draft.features, feature.key, event.target.checked) })
                  }
                />
                <span className="pl-8 text-xs text-muted">{feature.description}</span>
              </div>
            ))}
          </div>
        ) : (
          <QuietLine>This provider has no optional features.</QuietLine>
        )}
      </fieldset>
      {save.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          <span>{integrationErrorMessage(save.error)}</span>
          {save.error instanceof ApiRequestError && save.error.code === 'CONFLICT' ? (
            <Button variant="secondary" onClick={actions.onReload}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={locked || !dirty || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </form>
  );
}

export function ConnectionTab({
  detail,
  providers,
  actions,
}: {
  detail: Detail;
  providers: UseQueryResult<ProviderTemplate[]>;
  actions: ConnectionActions;
}) {
  const integration = detail.data;
  const template = integration
    ? (providers.data?.find((item) => item.key === integration.provider) ??
      providers.data?.find((item) => item.key === 'custom'))
    : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ConnectionDetails detail={detail} actions={actions} />
      <Panel
        testId="service-settings"
        title="Service Settings"
        subtitle="Scopes, schedule, enabled features, data access, retries and whether firms may use it."
      >
        {detail.isPending || (integration && providers.isPending) ? (
          <SkeletonLines rows={4} />
        ) : detail.isError ? (
          <QuietLine>{loadError(detail.error)}</QuietLine>
        ) : providers.isError ? (
          <QuietLine>{loadError(providers.error)}</QuietLine>
        ) : integration && template ? (
          <SettingsForm
            key={integration.version}
            integration={integration}
            template={template}
            actions={actions}
          />
        ) : (
          <QuietLine>This provider has no settings to change.</QuietLine>
        )}
      </Panel>
    </div>
  );
}
