'use client';

import { ActionMenu, Button, Select, Table, Toast, type Column } from '@firmivra/ui';
import {
  ArrowsClockwise,
  ChartBar,
  DotsThreeVertical,
  FileText,
  Key,
  PencilSimple,
  Plus,
  Power,
  Prohibit,
  Pulse,
  Warning,
  WebhooksLogo,
  type Icon,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  SYSTEM_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_DIRECTIONS,
  type ApiKey,
  type ApiKeyStatus,
  type IntegrationEnvironment,
  type IssuedApiKey,
  type WebhookDirection,
  type WebhookEndpoint,
  type WebhookStatus,
  type WebhookWithSecret,
} from '../../_components/integrations-contract';
import { DashboardPanel, MiniStat } from '../../_components/dashboard-parts';
import { DeliveryStatusBadge, EnvironmentBadge } from '../../_components/integration-badges';
import { formatDate, formatDateTime, formatNumber } from '../../_components/integration-format';
import {
  loadError,
  QuietLine,
  SkeletonLines,
  Unavailable,
} from '../../_components/integration-states';
import {
  IntegrationsHeader,
  IntegrationsNav,
  LinkButton,
} from '../../_components/integrations-shell';
import type { Notice } from '../../_components/platform-actions';
import {
  CreateKeyDialog,
  IssuedKeyDialog,
  RevokeKeyDialog,
  RotateKeyDialog,
} from './api-key-dialogs';
import {
  ApiKeyStatusBadge,
  CodePills,
  DIRECTION_LABELS,
  DirectionText,
  keyText,
  Meter,
  RowButton,
  ScopePills,
  WebhookStatusBadge,
} from './api-webhooks-parts';
import { DeliveriesDrawer } from './deliveries-drawer';
import {
  RotateSecretDialog,
  SigningSecretDialog,
  WebhookFormDialog,
  WebhookStatusDialog,
} from './webhook-dialogs';

/**
 * API & Webhooks (docx §8; no design frame, built in the dashboard's look): Firmivra-issued API
 * keys (prefix and last four only; Create and Rotate show the full key once; Revoke with a
 * reason), each live key's rate limit against its peak use, and the webhook endpoints with their
 * events, signing secret (shown once), retry policy and a delivery history with Redeliver.
 */

const DAY_MS = 86_400_000;
const KEY_STATUSES: readonly ApiKeyStatus[] = ['ACTIVE', 'EXPIRED', 'REVOKED'];
const KEY_STATUS_LABELS: Record<ApiKeyStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};
const oneOf = <T extends string>(list: readonly T[], value: string): T | undefined =>
  list.find((item) => item === value);

type KeyDialog =
  | { kind: 'create' }
  | { kind: 'rotate' | 'revoke'; key: ApiKey }
  | { kind: 'issued'; issued: IssuedApiKey; rotated?: ApiKey };
type HookDialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'rotate' | 'status' | 'deliveries'; hook: WebhookEndpoint }
  | { kind: 'secret'; result: WebhookWithSecret & { signingSecret: string }; rotated: boolean };

/** What a key's status line says: when it expires, expired, or was revoked. */
/** The sum of the counts B8 keeps; unknown when the keys have none yet. */
function known(values: readonly (number | null)[] | undefined): number | undefined {
  if (!values) return undefined;
  const numbers = values.filter((value): value is number => value !== null);
  if (values.length && !numbers.length) return undefined;
  return numbers.reduce((total, value) => total + value, 0);
}

function keyNote(key: ApiKey, now: number): { text: string; warn: boolean } {
  if (key.status === 'REVOKED' && key.revokedAt)
    return { text: `Revoked ${formatDate(key.revokedAt)}`, warn: false };
  if (!key.expiresAt) return { text: 'Never expires', warn: false };
  if (key.status === 'EXPIRED')
    return { text: `Expired ${formatDate(key.expiresAt)}`, warn: false };
  const days = Math.ceil((Date.parse(key.expiresAt) - now) / DAY_MS);
  return days <= 30
    ? { text: `Expires in ${days} ${days === 1 ? 'day' : 'days'}`, warn: true }
    : { text: `Expires ${formatDate(key.expiresAt)}`, warn: false };
}

/** A small filter select in a panel's toolbar. */
function ToolbarSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="w-full sm:w-44">
      <Select
        label={label}
        hideLabel
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={options}
      />
    </div>
  );
}

/** A panel body for "nothing here" (truly empty, or no match for the filters). */
function EmptyBlock({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
      <p className="font-semibold text-heading">{title}</p>
      {text ? <p className="max-w-xl text-sm text-muted">{text}</p> : null}
      {action}
    </div>
  );
}

export function ApiWebhooksPage() {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | ''>('');
  const [keyEnvironment, setKeyEnvironment] = useState<IntegrationEnvironment | ''>('');
  const [hookDirection, setHookDirection] = useState<WebhookDirection | ''>('');
  const [hookStatus, setHookStatus] = useState<WebhookStatus | ''>('');
  const [keyDialog, setKeyDialog] = useState<KeyDialog | null>(null);
  const [hookDialog, setHookDialog] = useState<HookDialog | null>(null);

  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const allKeys = useApiQuery(['admin-integrations', 'api-keys', 'all'], () =>
    adminIntegrations.listApiKeys(),
  );
  const keyQuery = { status: keyStatus || undefined, environment: keyEnvironment || undefined };
  const keys = useApiQuery(['admin-integrations', 'api-keys', 'list', keyQuery], () =>
    adminIntegrations.listApiKeys(keyQuery),
  );
  const allHooks = useApiQuery(['admin-integrations', 'webhooks', 'all'], () =>
    adminIntegrations.listWebhooks(),
  );
  const hookQuery = { direction: hookDirection || undefined, status: hookStatus || undefined };
  const hooks = useApiQuery(['admin-integrations', 'webhooks', 'list', hookQuery], () =>
    adminIntegrations.listWebhooks(hookQuery),
  );

  const canSecrets = access.data?.canManageSecrets ?? false;
  const canConfigure = access.data?.canManageConfiguration ?? false;
  const keysFiltered = !!(keyStatus || keyEnvironment);
  const hooksFiltered = !!(hookDirection || hookStatus);

  // The cards, from the unfiltered lists.
  const liveKeys = allKeys.data?.filter((key) => key.status === 'ACTIVE');
  const count = (value: number | undefined) =>
    value === undefined ? <Unavailable /> : formatNumber(value);
  const requests24h = known(liveKeys?.map((key) => key.usage24h.requests));
  const limited24h = known(liveKeys?.map((key) => key.usage24h.rateLimited));
  const sent7d = allHooks.data?.reduce((total, hook) => total + hook.stats.deliveries7d, 0);
  const failed7d = allHooks.data?.reduce((total, hook) => total + hook.stats.failures7d, 0);

  function issued(result: IssuedApiKey, rotated?: ApiKey) {
    setKeyDialog({ kind: 'issued', issued: result, rotated });
    setNotice({
      tone: 'success',
      text: rotated
        ? `${rotated.name} was rotated. The old key ${keyText(rotated)} is revoked.`
        : `${result.key.name} was created. Copy the key now: it is shown only once.`,
    });
  }
  function hookSaved(result: WebhookWithSecret, rotated: boolean) {
    const { signingSecret } = result;
    if (signingSecret)
      setHookDialog({ kind: 'secret', result: { ...result, signingSecret }, rotated });
    else setHookDialog(null);
    setNotice({
      tone: 'success',
      text: rotated
        ? `The signing secret for ${result.endpoint.url} was rotated.`
        : signingSecret
          ? `The webhook to ${result.endpoint.url} was added. Copy its signing secret now.`
          : `The webhook to ${result.endpoint.url} was updated.`,
    });
  }

  const keyColumns: Column<ApiKey>[] = [
    {
      id: 'name',
      label: 'Name',
      className: 'min-w-52',
      cell: (key) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-heading">{key.name}</span>
          <code className="font-mono text-xs text-muted">{keyText(key)}</code>
          {key.rotatedFromId ? <span className="text-xs text-muted">Rotated key</span> : null}
        </span>
      ),
    },
    {
      id: 'environment',
      label: 'Environment',
      cell: (key) => <EnvironmentBadge environment={key.environment} />,
    },
    {
      id: 'scopes',
      label: 'Scopes',
      className: 'min-w-48',
      cell: (key) => <ScopePills scopes={key.scopes} />,
    },
    {
      id: 'created',
      label: 'Created',
      className: 'whitespace-nowrap',
      cell: (key) => (
        <span className="flex flex-col">
          <time dateTime={key.createdAt} className="text-heading">
            {formatDate(key.createdAt)}
          </time>
          <span className="text-xs text-muted">by {key.createdBy}</span>
        </span>
      ),
    },
    {
      id: 'lastUsed',
      label: 'Last Used',
      className: 'whitespace-nowrap',
      cell: (key) =>
        key.lastUsedAt ? (
          <time dateTime={key.lastUsedAt} className="text-heading">
            {formatDateTime(key.lastUsedAt)}
          </time>
        ) : (
          <span className="text-muted">Never used</span>
        ),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (key) => {
        const note = keyNote(key, now);
        return (
          <span className="flex flex-col items-start gap-1">
            <ApiKeyStatusBadge status={key.status} />
            <span className={`text-xs ${note.warn ? 'font-semibold text-warning' : 'text-muted'}`}>
              {note.text}
            </span>
          </span>
        );
      },
    },
  ];

  const hookColumns: Column<WebhookEndpoint>[] = [
    {
      id: 'endpoint',
      label: 'Endpoint',
      className: 'min-w-64',
      cell: (hook) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold wrap-anywhere text-heading">{hook.url}</span>
          {hook.description ? <span className="text-xs text-muted">{hook.description}</span> : null}
          <span className="text-xs text-muted">
            Signing secret <code className="font-mono">{hook.signingSecretHint ?? 'not set'}</code>
          </span>
        </span>
      ),
    },
    {
      id: 'direction',
      label: 'Direction',
      cell: (hook) => (
        <span className="flex flex-col gap-0.5">
          <DirectionText direction={hook.direction} />
          {hook.integration ? (
            <span className="text-xs text-muted">From {hook.integration.name}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'events',
      label: 'Events',
      className: 'min-w-48',
      cell: (hook) => <CodePills items={hook.events} label="Events" />,
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (hook) => (
        <span className="flex flex-col items-start gap-1">
          <WebhookStatusBadge status={hook.status} />
          <span className="text-xs text-muted">
            {hook.maxRetries ? `Up to ${hook.maxRetries} retries` : 'No retries'}
          </span>
        </span>
      ),
    },
    {
      id: 'lastDelivery',
      label: 'Last Delivery',
      className: 'whitespace-nowrap',
      cell: (hook) =>
        hook.stats.lastDeliveryAt ? (
          <span className="flex flex-col items-start gap-1">
            <time dateTime={hook.stats.lastDeliveryAt} className="text-heading">
              {formatDateTime(hook.stats.lastDeliveryAt)}
            </time>
            {hook.stats.lastStatus ? <DeliveryStatusBadge status={hook.stats.lastStatus} /> : null}
            <span className="text-xs text-muted">
              7 days: {formatNumber(hook.stats.deliveries7d)} sent
              {hook.stats.failures7d ? `, ${formatNumber(hook.stats.failures7d)} failed` : ''}
            </span>
          </span>
        ) : (
          <span className="text-muted">No deliveries yet</span>
        ),
    },
  ];

  const keyRows = keys.data ?? [];
  const hookRows = hooks.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="API & Webhooks"
        subtitle="Manage Firmivra-issued API keys, their rate limits, and the webhook endpoints that send and receive integration events."
        crumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'API & Webhooks' }]}
        actions={
          <LinkButton href="/integrations/logs?source=WEBHOOK">
            <FileText aria-hidden weight="fill" className="size-5" />
            View Webhook Logs
          </LinkButton>
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <section
        aria-label="API and webhook summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MiniStat
          testId="kpi-active-keys"
          tone="blue"
          icon={Key}
          value={count(liveKeys?.length)}
          label="Active API Keys"
          note={
            liveKeys
              ? `${liveKeys.filter((key) => key.environment === 'LIVE').length} live · ${liveKeys.filter((key) => key.environment === 'TEST').length} test`
              : undefined
          }
          loading={allKeys.isPending}
        />
        <MiniStat
          testId="kpi-requests"
          tone="green"
          icon={Pulse}
          value={count(requests24h)}
          label="API Requests (24 hours)"
          note={limited24h === undefined ? undefined : `${formatNumber(limited24h)} rate-limited`}
          loading={allKeys.isPending}
        />
        <MiniStat
          testId="kpi-webhooks"
          tone="purple"
          icon={WebhooksLogo}
          value={count(allHooks.data?.length)}
          label="Webhook Endpoints"
          note={
            allHooks.data
              ? `${allHooks.data.filter((hook) => hook.status === 'ACTIVE').length} active`
              : undefined
          }
          loading={allHooks.isPending}
        />
        <MiniStat
          testId="kpi-failed-deliveries"
          tone="amber"
          icon={Warning}
          value={count(failed7d)}
          label="Failed Deliveries (7 days)"
          note={sent7d === undefined ? undefined : `of ${formatNumber(sent7d)} deliveries`}
          loading={allHooks.isPending}
        />
      </section>

      <IntegrationsNav current="api-webhooks" />

      <DashboardPanel
        testId="api-keys"
        band="blue"
        title="API Keys"
        subtitle="Keys Firmivra issues for integration access. Only the prefix and last four characters are kept."
        action={
          <Button disabled={!canSecrets} onClick={() => setKeyDialog({ kind: 'create' })}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Create API Key
          </Button>
        }
      >
        <div className="flex flex-wrap gap-3 px-5 pt-4">
          <ToolbarSelect
            label="Key status"
            value={keyStatus}
            onChange={(value) => setKeyStatus(oneOf(KEY_STATUSES, value) ?? '')}
            options={[
              { value: '', label: 'All statuses' },
              ...KEY_STATUSES.map((value) => ({ value, label: KEY_STATUS_LABELS[value] })),
            ]}
          />
          <ToolbarSelect
            label="Key environment"
            value={keyEnvironment}
            onChange={(value) => setKeyEnvironment(oneOf(ENVIRONMENTS, value) ?? '')}
            options={[
              { value: '', label: 'All environments' },
              ...ENVIRONMENTS.map((value) => ({ value, label: ENVIRONMENT_LABELS[value] })),
            ]}
          />
        </div>
        {keys.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(keys.error)}</QuietLine>
          </div>
        ) : keys.data && !keyRows.length ? (
          keysFiltered ? (
            <EmptyBlock
              title="No API keys match these filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setKeyStatus('');
                    setKeyEnvironment('');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              title="No API keys yet."
              text="API keys let partner systems call Firmivra's integration API. Each key has its own scopes, environment and rate limit, and the full key is shown only once."
              action={
                <Button disabled={!canSecrets} onClick={() => setKeyDialog({ kind: 'create' })}>
                  <Plus aria-hidden weight="bold" className="size-5" />
                  Create API Key
                </Button>
              }
            />
          )
        ) : (
          <div className="px-2 pt-2">
            <Table
              caption="API keys"
              rows={keyRows}
              loading={keys.isPending}
              columns={keyColumns}
              rowKey={(key) => key.id}
              showPagination={false}
              rowActions={(key) => {
                const items: {
                  label: string;
                  icon: Icon;
                  onSelect: () => void;
                  danger?: boolean;
                }[] = [];
                if (canSecrets && key.status === 'ACTIVE')
                  items.push(
                    {
                      label: 'Rotate Key',
                      icon: ArrowsClockwise,
                      onSelect: () => setKeyDialog({ kind: 'rotate', key }),
                    },
                    {
                      label: 'Revoke Key',
                      icon: Prohibit,
                      danger: true,
                      onSelect: () => setKeyDialog({ kind: 'revoke', key }),
                    },
                  );
                items.push({
                  label: 'View Usage',
                  icon: ChartBar,
                  onSelect: () =>
                    router.push(
                      `/integrations/usage?scope=API&subject=${encodeURIComponent(key.id)}`,
                    ),
                });
                return (
                  <ActionMenu
                    label={`More actions for ${key.name} (${keyText(key)})`}
                    trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                    sections={[{ items }]}
                  />
                );
              }}
            />
          </div>
        )}
      </DashboardPanel>

      <DashboardPanel
        testId="rate-limits"
        band="green"
        title="Rate Limits & Usage"
        subtitle="Each active key's limit against its peak use in the last 24 hours."
        action={<LinkButton href="/integrations/usage?scope=API">View API Usage</LinkButton>}
      >
        <div className="px-5 py-2">
          {allKeys.isPending ? (
            <SkeletonLines rows={4} label="Loading rate limits" />
          ) : allKeys.isError ? (
            <QuietLine>{loadError(allKeys.error)}</QuietLine>
          ) : !liveKeys?.length ? (
            <QuietLine>No active API keys, so nothing counts against a rate limit.</QuietLine>
          ) : (
            <ul className="grid gap-x-8 lg:grid-cols-2">
              {liveKeys.map((key) => {
                const limit = key.rateLimitPerMinute ?? SYSTEM_RATE_LIMIT_PER_MINUTE;
                const peak = key.usage24h.peakPerMinute;
                const used = peak !== null && limit ? Math.round((peak / limit) * 100) : null;
                return (
                  <li key={key.id} className="flex flex-col gap-2 border-b border-divider py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 font-semibold text-heading">
                        {key.name}{' '}
                        <code className="font-mono text-xs font-normal text-muted">
                          {keyText(key)}
                        </code>
                      </span>
                      <span className="text-sm text-text">
                        {peak === null
                          ? `Limit ${formatNumber(limit)} per minute · peak not tracked yet`
                          : `Peak ${formatNumber(peak)} of ${formatNumber(limit)} per minute (${used ?? 0}%)`}
                      </span>
                    </div>
                    <Meter value={peak ?? 0} max={limit} warn={false} />
                    <p className="flex flex-wrap gap-x-4 text-xs text-muted">
                      <span>
                        {key.usage24h.requests === null
                          ? 'No usage recorded yet'
                          : `${formatNumber(key.usage24h.requests)} requests in 24 hours`}
                      </span>
                      {key.usage24h.rateLimited === null ? null : (
                        <span>{formatNumber(key.usage24h.rateLimited)} rate-limited</span>
                      )}
                      <span>
                        {key.rateLimitPerMinute === null ? 'System limit' : 'Own limit'} ·{' '}
                        {ENVIRONMENT_LABELS[key.environment]}
                      </span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="py-3 text-xs text-muted">
            Keys without a limit of their own share the system limit of{' '}
            {formatNumber(SYSTEM_RATE_LIMIT_PER_MINUTE)} requests per minute.
          </p>
        </div>
      </DashboardPanel>

      <DashboardPanel
        testId="webhooks"
        band="purple"
        title="Webhooks"
        subtitle="Endpoints Firmivra sends events to, and the provider endpoints it receives events on."
        action={
          <Button disabled={!canSecrets} onClick={() => setHookDialog({ kind: 'add' })}>
            <Plus aria-hidden weight="bold" className="size-5" />
            Add Webhook
          </Button>
        }
      >
        <div className="flex flex-wrap gap-3 px-5 pt-4">
          <ToolbarSelect
            label="Webhook direction"
            value={hookDirection}
            onChange={(value) => setHookDirection(oneOf(WEBHOOK_DIRECTIONS, value) ?? '')}
            options={[
              { value: '', label: 'Both directions' },
              ...WEBHOOK_DIRECTIONS.map((value) => ({ value, label: DIRECTION_LABELS[value] })),
            ]}
          />
          <ToolbarSelect
            label="Webhook status"
            value={hookStatus}
            onChange={(value) => setHookStatus(oneOf(['ACTIVE', 'DISABLED'] as const, value) ?? '')}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DISABLED', label: 'Disabled' },
            ]}
          />
        </div>
        {hooks.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(hooks.error)}</QuietLine>
          </div>
        ) : hooks.data && !hookRows.length ? (
          hooksFiltered ? (
            <EmptyBlock
              title="No webhooks match these filters."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setHookDirection('');
                    setHookStatus('');
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              title="No webhook endpoints yet."
              text="Add an outbound endpoint to send integration events to another system, or an inbound one for a provider to call Firmivra. Each gets its own signing secret."
              action={
                <Button disabled={!canSecrets} onClick={() => setHookDialog({ kind: 'add' })}>
                  <Plus aria-hidden weight="bold" className="size-5" />
                  Add Webhook
                </Button>
              }
            />
          )
        ) : (
          <div className="px-2 pt-2">
            <Table
              caption="Webhook endpoints"
              rows={hookRows}
              loading={hooks.isPending}
              columns={hookColumns}
              rowKey={(hook) => hook.id}
              showPagination={false}
              rowActions={(hook) => {
                const items: {
                  label: string;
                  icon: Icon;
                  onSelect: () => void;
                  danger?: boolean;
                }[] = [];
                if (canConfigure)
                  items.push({
                    label: 'Edit Webhook',
                    icon: PencilSimple,
                    onSelect: () => setHookDialog({ kind: 'edit', hook }),
                  });
                if (canSecrets)
                  items.push({
                    label: 'Rotate Signing Secret',
                    icon: Key,
                    onSelect: () => setHookDialog({ kind: 'rotate', hook }),
                  });
                if (canConfigure)
                  items.push(
                    hook.status === 'ACTIVE'
                      ? {
                          label: 'Disable',
                          icon: Prohibit,
                          danger: true,
                          onSelect: () => setHookDialog({ kind: 'status', hook }),
                        }
                      : {
                          label: 'Enable',
                          icon: Power,
                          onSelect: () => setHookDialog({ kind: 'status', hook }),
                        },
                  );
                items.push({
                  label: 'View Logs',
                  icon: FileText,
                  onSelect: () =>
                    router.push(
                      hook.integration
                        ? `/integrations/logs?source=WEBHOOK&integration=${encodeURIComponent(hook.integration.id)}`
                        : '/integrations/logs?source=WEBHOOK',
                    ),
                });
                return (
                  <>
                    <RowButton onClick={() => setHookDialog({ kind: 'deliveries', hook })}>
                      Deliveries<span className="sr-only"> for {hook.url}</span>
                    </RowButton>
                    <ActionMenu
                      label={`More actions for ${hook.url}`}
                      trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
                      sections={[{ items }]}
                    />
                  </>
                );
              }}
            />
          </div>
        )}
      </DashboardPanel>

      {keyDialog?.kind === 'create' ? (
        <CreateKeyDialog onClose={() => setKeyDialog(null)} onIssued={(result) => issued(result)} />
      ) : null}
      {keyDialog?.kind === 'rotate' ? (
        <RotateKeyDialog
          apiKey={keyDialog.key}
          onClose={() => setKeyDialog(null)}
          onIssued={(result) => issued(result, keyDialog.key)}
        />
      ) : null}
      {keyDialog?.kind === 'revoke' ? (
        <RevokeKeyDialog
          apiKey={keyDialog.key}
          onClose={() => setKeyDialog(null)}
          onDone={(text) => {
            setKeyDialog(null);
            setNotice({ tone: 'success', text });
          }}
        />
      ) : null}
      {keyDialog?.kind === 'issued' ? (
        <IssuedKeyDialog
          issued={keyDialog.issued}
          rotated={keyDialog.rotated}
          onClose={() => setKeyDialog(null)}
        />
      ) : null}

      {hookDialog?.kind === 'add' || hookDialog?.kind === 'edit' ? (
        <WebhookFormDialog
          endpoint={hookDialog.kind === 'edit' ? hookDialog.hook : undefined}
          onClose={() => setHookDialog(null)}
          onSaved={(result) => hookSaved(result, false)}
        />
      ) : null}
      {hookDialog?.kind === 'rotate' ? (
        <RotateSecretDialog
          endpoint={hookDialog.hook}
          onClose={() => setHookDialog(null)}
          onRotated={(result) => hookSaved(result, true)}
        />
      ) : null}
      {hookDialog?.kind === 'status' ? (
        <WebhookStatusDialog
          endpoint={hookDialog.hook}
          onClose={() => setHookDialog(null)}
          onDone={(text) => {
            setHookDialog(null);
            setNotice({ tone: 'success', text });
          }}
        />
      ) : null}
      {hookDialog?.kind === 'secret' ? (
        <SigningSecretDialog
          result={hookDialog.result}
          rotated={hookDialog.rotated}
          onClose={() => setHookDialog(null)}
        />
      ) : null}
      {hookDialog?.kind === 'deliveries' ? (
        <DeliveriesDrawer
          endpoint={hookDialog.hook}
          onClose={() => setHookDialog(null)}
          onNotice={setNotice}
        />
      ) : null}
    </div>
  );
}
