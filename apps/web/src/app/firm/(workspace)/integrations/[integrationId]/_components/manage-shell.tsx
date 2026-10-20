'use client';

import {
  ApiRequestError,
  type ConnectIntegrationResult,
  type IntegrationConnectionDetail,
} from '@firmivra/types';
import { ActionMenu, Badge, Button, Card } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  DotsThreeVertical,
  FirstAid,
  Gear,
  Plugs,
  TreeStructure,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  ConnectionBadge,
  manageTabs,
  providerDisc,
  relativeTime,
} from './manage-integration-shared';

/**
 * The frame every Manage Integration tab shares (the spec's Frame 2: header with the provider,
 * status, last and next sync and Sync Now, then the six tabs). The Overview draws its own panels
 * under the same header; the other tabs render inside `ManageShell`, which loads the connection
 * once and keeps the header and tabs in place when it cannot (a failed load never replaces the
 * page).
 */

export type ManageTab = (typeof manageTabs)[number]['suffix'];

/** The integration codes of the contract, in plain words (`IntegrationErrorCode`). */
export const INTEGRATION_ERROR_TEXTS: Record<string, string> = {
  ALREADY_CONNECTED: 'This provider is already connected.',
  NOT_SUPPORTED: 'The provider does not support that setting.',
  NOT_CONNECTED: 'Reconnect or resume the integration first.',
  SYNC_IN_PROGRESS: 'A sync is running. Wait for it to finish.',
  ALREADY_PAUSED: 'The integration is already in that state.',
  CREDENTIALS_REJECTED: 'The provider refused the credentials. Nothing was saved.',
  AUTHORIZATION_FAILED: 'The authorization could not be completed. Try again.',
  INVALID_CONFIGURATION: 'A field is not offered by the provider, or two settings conflict.',
  PROVIDER_UNAVAILABLE: 'The provider cannot be reached right now. Try again later.',
  COMING_SOON: 'This provider is not available yet.',
};
export const integrationError = (error: unknown) => errorMessage(error, INTEGRATION_ERROR_TEXTS);

/**
 * Follows a connect or reconnect answer: the provider's authorization page (https only, or this
 * site), or nothing to do when the connection is saved at once. Returns an error text or null.
 */
export function followConnect(result: ConnectIntegrationResult): string | null {
  if (result.mode !== 'REDIRECT') return null;
  const target = new URL(result.url, window.location.origin);
  const local = target.origin === window.location.origin;
  if (target.protocol !== 'https:' && !(local && target.protocol === 'http:'))
    return 'The authorization address is unavailable. Please try again.';
  window.location.assign(target.href);
  return null;
}

const missing = (error: unknown) =>
  error instanceof ApiRequestError && ['FORBIDDEN', 'NOT_FOUND'].includes(error.code);

/** A green check beside a sync time that exists; a grey clock while there is none. */
function SyncMark({ done }: { done: boolean }) {
  return done ? (
    <CheckCircle aria-hidden weight="fill" className="size-6 text-success" />
  ) : (
    <Clock aria-hidden weight="fill" className="size-6 text-muted" />
  );
}

/** The provider header: mark, name, status, purpose, last and next sync, Sync Now and the menu. */
export function ManageHeader({
  integrationId,
  detail,
  busy,
  onSync,
}: {
  integrationId: string;
  detail: IntegrationConnectionDetail | null;
  busy: boolean;
  onSync: () => void;
}) {
  const router = useRouter();
  const go = (suffix: ManageTab) => () => router.push(`/integrations/${integrationId}${suffix}`);
  return (
    <Card className="p-5!" data-testid="integration-header">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-start gap-5">
          <span
            className={`flex size-20 shrink-0 items-center justify-center rounded-full text-4xl font-bold ${detail ? providerDisc(detail.provider.category) : 'bg-disabled text-muted'}`}
          >
            {detail?.provider.name.charAt(0) ?? <Plugs aria-hidden weight="fill" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-heading">
                {detail?.provider.name ?? 'Integration unavailable'}
              </h1>
              {detail ? (
                <ConnectionBadge status={detail.status} large />
              ) : (
                <Badge tone="neutral">Unavailable</Badge>
              )}
              {detail?.environment === 'TEST' ? <Badge tone="warning">Test mode</Badge> : null}
            </div>
            <p className="mt-1 text-lg text-heading">
              {detail?.provider.summary ?? 'Connection details could not be loaded.'}
            </p>
            <p className="mt-2 max-w-3xl text-sm text-text">
              {detail?.statusMessage ??
                detail?.provider.description ??
                'Retry when the integration service is available.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3 xl:justify-end">
          <div className="grid min-w-56 grid-cols-1 divide-y divide-divider rounded-control border border-border px-4 text-sm">
            <div className="flex items-center gap-3 py-2.5">
              <SyncMark done={!!detail?.lastSyncAt} />
              <span>
                <strong className="block font-semibold text-heading">Last Sync</strong>
                <span className="text-base text-action">
                  {relativeTime(detail?.lastSyncAt ?? null)}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3 py-2.5">
              <SyncMark done={!!detail?.nextSyncAt && !detail.paused} />
              <span>
                <strong className="block font-semibold text-heading">Next Sync</strong>
                <span className="text-base text-action">
                  {detail?.paused ? 'Paused' : relativeTime(detail?.nextSyncAt ?? null)}
                  {detail?.syncMode === 'AUTO' && !detail.paused ? ' (Auto)' : ''}
                </span>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {/* The design's Sync Now and menu share one framed box. */}
            <div className="flex items-stretch rounded-control border border-border">
              <div className="p-2">
                <Button
                  className="min-w-44"
                  disabled={!detail?.canManage || detail.syncing || busy}
                  onClick={onSync}
                >
                  <ArrowsClockwise aria-hidden weight="bold" className="size-5" />
                  {detail?.syncing ? 'Syncing…' : 'Sync Now'}
                </Button>
              </div>
              <div className="flex items-center border-l border-divider px-1">
                <ActionMenu
                  label="More integration actions"
                  className="[&>button]:border-0 [&>button]:bg-transparent [&>button]:px-2 [&>button>svg:last-child]:hidden"
                  trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-6" />}
                  sections={[
                    {
                      items: [
                        { label: 'Sync Settings', icon: Gear, onSelect: go('/sync-settings') },
                        {
                          label: 'Data Mapping',
                          icon: TreeStructure,
                          onSelect: go('/data-mapping'),
                        },
                        {
                          label: 'Sync History',
                          icon: ClockCounterClockwise,
                          onSelect: go('/sync-history'),
                        },
                        {
                          label: 'Run Connection Test',
                          icon: FirstAid,
                          onSelect: go('/troubleshooting'),
                        },
                      ],
                    },
                  ]}
                />
              </div>
            </div>
            <Link
              href={`/integrations/${integrationId}/sync-history`}
              className="inline-flex items-center gap-2 font-semibold text-link underline underline-offset-2"
            >
              View Sync History <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** The six tabs, with the design's thin dividers; the current one is highlighted. */
export function ManageTabsNav({
  integrationId,
  current,
}: {
  integrationId: string;
  current: ManageTab;
}) {
  return (
    <nav
      aria-label="Integration management"
      className="flex overflow-x-auto border-b border-divider"
    >
      {manageTabs.map((tab, index) => {
        const on = tab.suffix === current;
        const before = manageTabs[index - 1]?.suffix === current;
        return (
          <Link
            key={tab.label}
            href={`/integrations/${integrationId}${tab.suffix}`}
            aria-current={on ? 'page' : undefined}
            className={`relative shrink-0 border-b-2 px-6 py-3 text-base ${index > 0 && !on && !before ? 'before:absolute before:top-1/2 before:left-0 before:h-6 before:-translate-y-1/2 before:border-l before:border-divider' : ''} ${on ? 'rounded-t-control border-action bg-accent-soft font-semibold text-action' : 'border-transparent text-heading hover:text-action'}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Breadcrumb({ name }: { name: string | undefined }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      <Link href="/integrations" className="text-link">
        Integrations
      </Link>
      <ArrowRight aria-hidden className="size-4 text-muted" />
      <span className="text-text">{name ?? 'Integration'}</span>
    </nav>
  );
}

/** A quiet notice line inside the frame: an error with Try again, or a success. */
export function Notice({
  tone,
  children,
  onRetry,
}: {
  tone: 'error' | 'success';
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <Card
      role={tone === 'error' ? 'alert' : 'status'}
      className="flex flex-wrap items-center justify-between gap-4 !p-4"
    >
      <p className={`text-sm ${tone === 'error' ? 'text-danger' : 'text-success'}`}>{children}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * Loads the connection and draws the header and tabs around a tab's content. `children` gets the
 * connection, or null while it loads or when it cannot be read (each tab then shows its frames
 * with a quiet line).
 */
export function ManageShell({
  integrationId,
  current,
  testId,
  children,
}: {
  integrationId: string;
  current: ManageTab;
  testId: string;
  children: (detail: IntegrationConnectionDetail | null) => ReactNode;
}) {
  const query = useApiQuery(['integrations', 'connection', integrationId], () =>
    api.integrations.connection(integrationId),
  );
  const sync = useApiMutation(() => api.integrations.sync(integrationId), {
    invalidate: ['integrations'],
  });
  const detail = query.data ?? null;
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-4">
      <Breadcrumb name={detail?.provider.name} />
      {query.isError ? (
        <Notice
          tone="error"
          onRetry={missing(query.error) ? undefined : () => void query.refetch()}
        >
          {missing(query.error)
            ? 'This integration was not found, or you do not have access to it.'
            : integrationError(query.error)}
        </Notice>
      ) : sync.isError ? (
        <Notice tone="error">{integrationError(sync.error)}</Notice>
      ) : sync.isSuccess ? (
        <Notice tone="success">
          Sync started for {sync.data.entityLabel}. Progress shows in Sync History.
        </Notice>
      ) : null}
      <ManageHeader
        integrationId={integrationId}
        detail={detail}
        busy={sync.isPending}
        onSync={() => sync.mutate(undefined)}
      />
      <ManageTabsNav integrationId={integrationId} current={current} />
      {children(detail)}
    </div>
  );
}
