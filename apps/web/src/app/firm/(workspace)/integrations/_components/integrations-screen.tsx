'use client';

import {
  IntegrationCategory,
  type IntegrationCard,
  type IntegrationTab,
  type IntegrationEnvironment,
} from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  IconTile,
  Modal,
  SearchField,
  Select,
  Tabs,
} from '@firmivra/ui';
import {
  Heartbeat,
  ArrowsLeftRight,
  ArrowRight,
  CaretRight,
  CheckCircle,
  Clock,
  Database,
  DotsThreeVertical,
  GearSix,
  GridFour,
  Link as LinkIcon,
  Plug,
  Plus,
  PuzzlePiece,
  ShieldCheck,
  WarningCircle,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

const labels = {
  AVAILABLE: 'Available',
  CONNECTED: 'Connected',
  NEEDS_ATTENTION: 'Needs Attention',
  SYNCING: 'Syncing',
  PAUSED: 'Paused',
  DISCONNECTED: 'Disconnected',
} as const;
const tones = {
  AVAILABLE: 'info',
  CONNECTED: 'success',
  NEEDS_ATTENTION: 'danger',
  SYNCING: 'info',
  PAUSED: 'warning',
  DISCONNECTED: 'neutral',
} as const;
const linkClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-action px-3 py-1.5 text-center text-sm font-semibold text-action hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-focus';
const categoryLabel = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' & ');
const dateLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Not checked yet';

/** Unknown catalog logo keys use a neutral tile; provider cards always come from the contract. */
function ProviderLogo({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-info-soft text-2xl font-bold text-action"
    >
      {name.slice(0, 1)}
    </span>
  );
}

function ProviderCard({ item, canManage }: { item: IntegrationCard; canManage: boolean }) {
  const router = useRouter();
  const connection = item.connections[0];
  const [notice, setNotice] = useState('');
  const mutation = useApiMutation(
    async (kind: 'sync' | 'test' | 'resume') => {
      if (!connection) return;
      if (kind === 'sync') {
        await api.integrations.sync(connection.id);
        setNotice('Sync requested.');
      }
      if (kind === 'test') {
        const result = await api.integrations.test(connection.id);
        setNotice(result.summary);
      }
      if (kind === 'resume') {
        await api.integrations.resume(connection.id);
        setNotice('Sync resumed.');
      }
    },
    { invalidate: ['integrations'] },
  );
  const manageHref = `/integrations/${connection?.id ?? item.provider.provider}`;
  const actionHref =
    connection && item.action !== 'RECONNECT'
      ? manageHref
      : `/integrations/${item.provider.provider}/connect`;
  const actionLabel = {
    CONNECT: 'Connect',
    CONFIGURE: 'Configure',
    MANAGE: 'Manage',
    RECONNECT: 'Reconnect',
    RESUME: 'Resume',
  }[item.action];
  return (
    <Card
      data-testid="integration-card"
      className="flex min-w-0 flex-col gap-2 !rounded-lg !bg-subtle !p-3"
    >
      <div className="relative flex items-start gap-3 pr-5">
        <ProviderLogo name={item.provider.name} />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-heading">{item.provider.name}</h2>
          <Badge tone={tones[item.status]} dot>
            {labels[item.status]}
          </Badge>
        </div>
        <ActionMenu
          className="absolute right-0 top-0 [&>button]:min-h-6 [&>button]:border-0 [&>button]:bg-transparent [&>button]:p-0 [&>button>svg:last-child]:hidden"
          label={`Actions for ${item.provider.name}`}
          trigger={<DotsThreeVertical weight="fill" className="size-5" />}
          sections={[
            {
              items: [
                {
                  label: 'View details',
                  onSelect: () => {
                    router.push(actionHref);
                  },
                },
                ...(connection
                  ? [
                      {
                        label: 'Sync history',
                        onSelect: () => {
                          router.push(`${manageHref}/sync-history`);
                        },
                      },
                    ]
                  : []),
              ],
            },
          ]}
        />
      </div>
      <p className="text-xs text-muted">{item.provider.summary}</p>
      {connection ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Clock weight="fill" className="size-4" />
            Last sync: {connection.lastSyncAt ? dateLabel(connection.lastSyncAt) : 'Not synced yet'}
          </p>
          {connection.statusMessage ? (
            <p className="flex items-center gap-1.5 text-xs text-danger">
              <Warning weight="fill" className="size-4" />
              {connection.statusMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1">
              <ArrowsLeftRight weight="fill" className="size-4" />
              {connection.direction === 'TWO_WAY' ? 'Two-way sync' : 'One-way sync'}
            </span>
            <span className="flex items-center gap-1">
              <GearSix weight="fill" className="size-4" />
              {connection.syncMode === 'AUTO' ? 'Auto sync' : 'Manual sync'}
            </span>
          </div>
        </>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {item.action === 'RESUME' ? (
          canManage ? (
            <Button
              className="min-h-9 flex-1 !py-1"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate('resume')}
            >
              Resume
            </Button>
          ) : null
        ) : canManage || connection ? (
          <Link
            className={`${linkClass} flex-1 ${connection ? '!bg-navigation !text-on-action' : ''}`}
            href={actionHref}
          >
            {actionLabel}
          </Link>
        ) : null}
        {canManage && connection && item.status === 'CONNECTED' ? (
          <Button
            variant="outline"
            className="min-h-9 flex-1 !px-2 !py-1"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(connection.syncMode === 'AUTO' ? 'sync' : 'test')}
          >
            {connection.syncMode === 'AUTO' ? 'Sync Now' : 'Test'}
          </Button>
        ) : null}
        {item.status === 'SYNCING' ? (
          <span role="status" className="text-xs text-info">
            Sync in progress
          </span>
        ) : null}
      </div>
      {mutation.isError ? (
        <p role="alert" className="text-xs text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: Icon;
  label: string;
  value: string | number;
  note: string;
  tone: 'green' | 'red' | 'amber';
}) {
  return (
    <Card className="flex items-center gap-3 !rounded-lg !bg-subtle !p-3">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{label}</h2>
        <p className="text-xl font-bold text-heading">{value}</p>
        <p className="text-xs text-muted">{note}</p>
      </div>
    </Card>
  );
}

export function IntegrationsScreen() {
  const [tab, setTab] = useState<IntegrationTab>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [environment, setEnvironment] = useState<IntegrationEnvironment>('LIVE');
  const [panel, setPanel] = useState<'health' | 'mapping' | 'activity' | null>(null);
  const overview = useApiQuery(['integrations', tab, search, category, environment], () =>
    api.integrations.overview({
      tab,
      search,
      environment,
      ...(category ? { category: IntegrationCategory.parse(category) } : {}),
    }),
  );
  const activity = useApiQuery(['integration-activity', panel], async () =>
    panel === 'activity' ? api.integrations.activity() : null,
  );
  // Status panels stay inside the complete frame; a failed request never replaces the page.
  const data = overview.isError || overview.isPending ? undefined : overview.data;
  const summary = data?.summary;
  const mappingConnection = data?.items.flatMap((item) => item.connections)[0];
  const mappingHref = mappingConnection
    ? `/integrations/${mappingConnection.id}/data-mapping`
    : null;
  const healthRows = [
    {
      label: 'All systems operational',
      value: data?.health.operational ?? 0,
      icon: CheckCircle,
      tone: 'text-success',
    },
    {
      label: 'Authorization issues',
      value: data?.health.authorizationIssues ?? 0,
      icon: WarningCircle,
      tone: 'text-warning',
    },
    {
      label: 'Failed syncs',
      value: data?.health.failedSyncs ?? 0,
      icon: Warning,
      tone: 'text-danger',
    },
    {
      label: 'Records pending',
      value: data?.health.recordsPending ?? 0,
      icon: Clock,
      tone: 'text-orange',
    },
  ];
  return (
    <div data-testid="integrations-screen" className="flex min-w-0 flex-col gap-4">
      <header className="-mx-4 -mt-4 flex flex-wrap items-center justify-between gap-4 bg-navigation px-4 py-5 text-on-action md:-ml-6 md:px-6">
        <div>
          <h1 className="text-3xl font-bold">Integrations</h1>
          <p className="mt-1 text-base">Connect and manage the tools that power your business.</p>
        </div>
        <div className="flex max-w-full items-center gap-3 rounded-lg border border-control-border p-3 text-xs">
          <ShieldCheck weight="fill" className="size-8 shrink-0" />
          <div>
            <p>Your connections are encrypted and protected.</p>
            <p className="mt-1 underline">Credentials and API keys are always masked.</p>
          </div>
        </div>
      </header>
      <section
        aria-label="Integration summary"
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryCard
          icon={Plug}
          label="Connected"
          value={summary?.connected ?? 0}
          note="Tools actively syncing"
          tone="green"
        />
        <SummaryCard
          icon={Warning}
          label="Needs Attention"
          value={summary?.needsAttention ?? 0}
          note="Requires your action"
          tone="red"
        />
        <SummaryCard
          icon={GridFour}
          label="Available"
          value={summary?.available ?? 0}
          note="Ready to connect"
          tone="amber"
        />
        <SummaryCard
          icon={Clock}
          label="Last System Check"
          value={dateLabel(summary?.lastCheckAt)}
          note={
            summary
              ? summary.allOperational
                ? 'All systems operational'
                : 'Some connections need attention'
              : 'No system check available'
          }
          tone="amber"
        />
      </section>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Tabs
            variant="segmented"
            label="Integration status"
            value={tab}
            onChange={(id) => setTab(id as IntegrationTab)}
            items={[
              { id: 'all', label: `All Integrations (${summary?.total ?? 0})` },
              { id: 'connected', label: `Connected (${summary?.connected ?? 0})` },
              { id: 'available', label: `Available (${summary?.available ?? 0})` },
              { id: 'attention', label: `Needs Attention (${summary?.needsAttention ?? 0})` },
            ]}
          />
        </div>
        <SearchField
          label="Search integrations"
          placeholder="Search integrations..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          label="Integration category"
          hideLabel
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          options={[
            { value: '', label: 'All Categories' },
            ...IntegrationCategory.options.map((value) => ({ value, label: categoryLabel(value) })),
          ]}
        />
        <Tabs
          label="Integration environment"
          variant="segmented"
          value={environment}
          onChange={(value) => setEnvironment(value as IntegrationEnvironment)}
          items={[
            { id: 'LIVE', label: 'Live Mode' },
            { id: 'TEST', label: 'Test Mode' },
          ]}
        />
      </div>
      {overview.isPending || overview.isError ? (
        <PageState query={overview}>{() => null}</PageState>
      ) : null}
      <section aria-label="Integration providers" className="flex min-w-0 flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data?.items.slice(0, 4).map((item) => (
            <ProviderCard key={item.provider.provider} item={item} canManage={data.canManage} />
          ))}
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data?.items.slice(4).map((item) => (
                <ProviderCard key={item.provider.provider} item={item} canManage={data.canManage} />
              ))}
            </div>
            {!data?.items.length ? (
              <Card
                data-testid="integrations-empty"
                className="flex min-h-48 items-center justify-center text-center text-sm text-muted"
              >
                {overview.isPending
                  ? 'Loading integrations...'
                  : overview.isError
                    ? 'Integrations will appear here when the connection is restored.'
                    : search || category || tab !== 'all'
                      ? 'No integrations match your filters.'
                      : 'No integrations available yet.'}
              </Card>
            ) : null}
          </div>
          <Card
            data-testid="add-integration"
            className="flex flex-col gap-4 !rounded-lg !border-dashed !border-action !bg-subtle !p-4"
          >
            <div className="flex items-center gap-3">
              <PuzzlePiece weight="fill" className="size-10 shrink-0 text-action" />
              <div>
                <h2 className="text-base font-bold text-heading">Add Integration</h2>
                <p className="text-xs text-muted">Connect another tool to your firm</p>
              </div>
            </div>
            <ul className="space-y-3 text-xs text-muted">
              {[
                'Browse available integrations',
                'Request an integration',
                'Custom API or webhook',
              ].map((item) => (
                <li className="flex items-center gap-2" key={item}>
                  <CheckCircle weight="fill" className="size-5 shrink-0 text-gold" />
                  {item}
                </li>
              ))}
            </ul>
            {data?.canManage ? (
              <Link
                className={`${linkClass} !bg-action !text-on-action`}
                href="/integrations/marketplace"
              >
                <Plus weight="fill" />
                Add Integration
              </Link>
            ) : null}
            <Link
              className="text-center text-xs font-semibold text-link underline"
              href="/integrations/marketplace"
            >
              View Integration Marketplace
            </Link>
          </Card>
        </div>
      </section>
      <section aria-label="Integration insights" className="grid gap-3 lg:grid-cols-3">
        <Card
          data-testid="integration-health"
          className="flex flex-col !rounded-lg !bg-subtle !p-3"
        >
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-heading">
            <Heartbeat weight="fill" className="size-6 text-action" />
            Integration Health
          </h2>
          <ul className="mb-3 divide-y divide-divider">
            {healthRows.map((row) => (
              <li key={row.label} className="flex items-center gap-2 py-1.5 text-xs">
                <row.icon weight="fill" className={`size-5 shrink-0 ${row.tone}`} />
                <span className="flex-1">{row.label}</span>
                <span>{row.value}</span>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="mt-auto min-h-9 !py-1"
            onClick={() => setPanel('health')}
          >
            View Health
          </Button>
        </Card>
        <Card
          data-testid="integration-mapping"
          className="flex flex-col !rounded-lg !bg-subtle !p-3"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
            <Database weight="fill" className="size-6 text-action" />
            Data Mapping
          </h2>
          <p className="mb-2 text-xs text-muted">Manage how data flows between systems.</p>
          <ul className="mb-3 divide-y divide-divider">
            {data?.mapping.map((row) => (
              <li key={row.scope} className="flex items-center gap-2 py-2 text-xs">
                <LinkIcon weight="fill" className="size-4" />
                <span className="flex-1">{row.label}</span>
                <span className="text-muted">{row.mappedFields} fields mapped</span>
                <CaretRight />
              </li>
            ))}
          </ul>
          {!data?.mapping.length ? (
            <p className="mb-4 text-xs text-muted">No fields mapped yet.</p>
          ) : null}
          <Button
            variant="outline"
            className="mt-auto min-h-9 !py-1"
            onClick={() => setPanel('mapping')}
          >
            Manage Mapping
          </Button>
        </Card>
        <Card
          data-testid="integration-activity"
          className="flex flex-col !rounded-lg !bg-subtle !p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-heading">
              <Clock weight="fill" className="size-6 text-action" />
              Recent Activity
            </h2>
            <Button
              variant="ghost"
              className="min-h-8 !px-1 !py-0 text-xs"
              onClick={() => setPanel('activity')}
            >
              View All
              <ArrowRight />
            </Button>
          </div>
          <ul className="mb-3 divide-y divide-divider">
            {data?.recent.slice(0, 5).map((event) => (
              <li key={event.id} className="flex items-start gap-2 py-1.5 text-xs">
                {event.ok ? (
                  <CheckCircle weight="fill" className="size-5 shrink-0 text-success" />
                ) : (
                  <WarningCircle weight="fill" className="size-5 shrink-0 text-danger" />
                )}
                <span className="flex-1">{event.message}</span>
                <time className="text-muted" dateTime={event.at}>
                  {dateLabel(event.at)}
                </time>
              </li>
            ))}
          </ul>
          {!data?.recent.length ? (
            <p className="mb-4 text-xs text-muted">No integration activity yet.</p>
          ) : null}
          <Link className={`${linkClass} mt-auto`} href="/audit-log">
            View Audit Log
          </Link>
        </Card>
      </section>
      <Modal
        open={panel !== null}
        title={
          panel === 'health'
            ? 'Integration Health'
            : panel === 'mapping'
              ? 'Data Mapping'
              : 'Integration Activity'
        }
        onClose={() => setPanel(null)}
      >
        {panel === 'health' ? (
          <ul className="space-y-3">
            {healthRows.map((row) => (
              <li key={row.label} className="flex justify-between gap-4 text-sm">
                <span>{row.label}</span>
                <span>{row.value}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {panel === 'mapping' ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Choose a connected integration to configure its field mapping.
            </p>
            {data?.items.flatMap((item) =>
              item.connections.map((connection) => (
                <Link
                  key={connection.id}
                  className={`${linkClass} mr-2`}
                  href={`/integrations/${connection.id}/data-mapping`}
                >
                  {item.provider.name}
                  <CaretRight />
                </Link>
              )),
            )}
            {!mappingHref ? (
              <p className="text-sm text-muted">Connect an integration before mapping fields.</p>
            ) : null}
          </div>
        ) : null}
        {panel === 'activity' ? (
          <PageState
            query={activity}
            empty="No integration activity yet."
            isEmpty={(result) => !result?.items.length}
          >
            {(result) => (
              <ul className="space-y-3">
                {result?.items.map((event) => (
                  <li key={event.id} className="text-sm">
                    <p>{event.message}</p>
                    <time className="text-xs text-muted" dateTime={event.at}>
                      {dateLabel(event.at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </PageState>
        ) : null}
      </Modal>
    </div>
  );
}
