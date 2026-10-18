'use client';

import { Button, Card, Radio, Skeleton } from '@firmivra/ui';
import {
  CalendarBlank,
  CheckCircle,
  CircleNotch,
  Plug,
  TrendUp,
  UsersThree,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATALOG_STATUS_HINTS,
  CATALOG_STATUS_LABELS,
  CATALOG_STATUSES,
  type CatalogItem,
  type CatalogStatus,
  type ConnectionTestResult,
} from '../../../../../../../mocks/admin-integrations';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from '../../../_components/integration-format';
import {
  integrationErrorMessage,
  loadError,
  QuietLine,
  SkeletonLines,
  Unavailable,
} from '../../../_components/integration-states';
import { platformHref } from '../../../_components/integrations-shell';

/**
 * The catalog edit page's right column (stripe-integration-admin-dashboard-1.jpg): Status
 * (Enabled, Disabled, Coming Soon; it saves with the form), Quick Stats from the adoption rollup
 * (never a firm's own connection) and Test Connection for the platform integration it relies on.
 */

function RailCard({
  title,
  subtitle,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card data-testid={testId} className="flex min-w-0 flex-col gap-4 p-6!">
      <div>
        <h2 className="text-xl font-bold text-heading">{title}</h2>
        {subtitle ? <p className="text-sm text-text">{subtitle}</p> : null}
      </div>
      {children}
    </Card>
  );
}

export function StatusCard({
  status,
  saved,
  firmsUsing,
  disabled,
  onChange,
}: {
  /** The status on the form (null while loading). */
  status: CatalogStatus | null;
  saved: CatalogStatus | null;
  firmsUsing: number | null;
  disabled: boolean;
  onChange: (status: CatalogStatus) => void;
}) {
  return (
    <RailCard
      testId="catalog-status"
      title="Status"
      subtitle="Control the availability of this integration in the catalog."
    >
      {status === null ? (
        <SkeletonLines rows={3} label="Loading status" />
      ) : (
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Catalog status</legend>
          {CATALOG_STATUSES.map((value) => (
            <div key={value} className="flex flex-col">
              <Radio
                name="catalog-status"
                label={CATALOG_STATUS_LABELS[value]}
                value={value}
                checked={status === value}
                disabled={disabled}
                aria-describedby={`catalog-status-${value}`}
                className={`font-semibold ${status === value ? 'text-action' : 'text-heading'}`}
                onChange={() => onChange(value)}
              />
              <p id={`catalog-status-${value}`} className="-mt-2 pb-1 pl-7 text-sm text-text">
                {CATALOG_STATUS_HINTS[value]}
              </p>
            </div>
          ))}
          {status === 'DISABLED' && saved !== 'DISABLED' && firmsUsing ? (
            <p role="status" className="mt-2 rounded-lg bg-warning-soft p-3 text-sm text-text">
              {formatNumber(firmsUsing)} connected {firmsUsing === 1 ? 'firm loses' : 'firms lose'}{' '}
              access when you save. You confirm it first.
            </p>
          ) : null}
        </fieldset>
      )}
    </RailCard>
  );
}

const STAT_TONES = {
  green: 'bg-success-soft',
  blue: 'bg-info-soft',
  purple: 'bg-purple-soft',
} as const;
const ICON_TONES = { green: 'text-success', blue: 'text-info', purple: 'text-purple' } as const;

function Stat({
  icon: Glyph,
  tone,
  value,
  label,
  loading,
  testId,
}: {
  icon: Icon;
  tone: keyof typeof STAT_TONES;
  value: ReactNode;
  label: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex min-w-0 items-center gap-3 rounded-lg p-4 ${STAT_TONES[tone]}`}
    >
      <Glyph aria-hidden weight="fill" className={`size-7 shrink-0 ${ICON_TONES[tone]}`} />
      <span className="flex min-w-0 flex-col">
        {loading ? (
          <Skeleton className="h-6 w-14" />
        ) : (
          <span className="text-xl leading-tight font-bold wrap-anywhere text-heading">
            {value}
          </span>
        )}
        <span className="text-sm text-text">{label}</span>
      </span>
    </div>
  );
}

export function QuickStats({ query }: { query: UseQueryResult<CatalogItem> }) {
  const stats = query.data?.stats;
  const loading = query.isPending;
  const value = (shown: string | undefined) => shown ?? <Unavailable />;
  return (
    <RailCard testId="quick-stats" title="Quick Stats">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          testId="stat-firms-using"
          icon={UsersThree}
          tone="green"
          value={value(stats ? formatNumber(stats.firmsUsing) : undefined)}
          label="Firms Using"
          loading={loading}
        />
        <Stat
          testId="stat-connections"
          icon={TrendUp}
          tone="blue"
          value={value(stats ? formatNumber(stats.totalConnections) : undefined)}
          label="Total Connections"
          loading={loading}
        />
        <Stat
          testId="stat-last-activity"
          icon={CalendarBlank}
          tone="purple"
          value={value(
            stats
              ? stats.lastActivityAt
                ? formatDate(stats.lastActivityAt)
                : 'None yet'
              : undefined,
          )}
          label="Last Activity"
          loading={loading}
        />
        <Stat
          testId="stat-uptime"
          icon={CheckCircle}
          tone="green"
          value={value(
            stats
              ? stats.uptime30d === null
                ? 'N/A'
                : formatPercent(stats.uptime30d, 1)
              : undefined,
          )}
          label="Uptime (30 days)"
          loading={loading}
        />
      </div>
      {query.isError ? <QuietLine>{loadError(query.error)}</QuietLine> : null}
    </RailCard>
  );
}

export function TestConnectionCard({ query }: { query: UseQueryResult<CatalogItem> }) {
  const linked = query.data?.platformIntegration ?? null;
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const test = useApiMutation((id: string) => adminIntegrations.testPlatform(id), {
    invalidate: ['admin-integrations'],
  });
  const ok = result ? result.ok : linked?.lastCheckOk;
  const at = result ? result.at : linked?.lastCheckAt;
  const canTest = !!linked && linked.status !== 'DRAFT' && linked.status !== 'REMOVED';
  return (
    <RailCard
      testId="test-connection"
      title="Test Connection"
      subtitle="Verify the platform connection is working properly."
    >
      {query.isPending ? (
        <SkeletonLines rows={2} label="Loading the platform connection" />
      ) : query.isError ? (
        <QuietLine>{loadError(query.error)}</QuietLine>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          onClick={() =>
            linked &&
            test.mutate(linked.id, {
              onSuccess: setResult,
            })
          }
          disabled={!canTest || test.isPending}
          aria-busy={test.isPending}
        >
          {test.isPending ? (
            <CircleNotch
              aria-hidden
              weight="bold"
              className="size-5 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Plug aria-hidden weight="fill" className="size-5" />
          )}
          {test.isPending ? 'Testing…' : 'Test Connection'}
        </Button>
        {linked && at ? (
          <div data-testid="test-result" aria-live="polite" className="flex items-center gap-2">
            {ok === false ? (
              <XCircle aria-hidden weight="fill" className="size-7 shrink-0 text-danger" />
            ) : (
              <CheckCircle aria-hidden weight="fill" className="size-7 shrink-0 text-success" />
            )}
            <span className="flex flex-col">
              <span
                className={`text-sm font-semibold ${ok === false ? 'text-danger' : 'text-success'}`}
              >
                {ok === false
                  ? 'Connection Failed'
                  : ok
                    ? 'Connection Successful'
                    : 'Not checked since the credentials changed'}
              </span>
              <span className="text-xs text-text">
                Last tested: <time dateTime={at}>{formatDateTime(at)}</time>
              </span>
            </span>
          </div>
        ) : null}
      </div>
      {result && !result.ok ? <p className="text-sm text-text">{result.message}</p> : null}
      {test.isError ? (
        <p role="alert" className="text-sm text-danger">
          {integrationErrorMessage(test.error)}
        </p>
      ) : null}
      {query.data ? (
        linked ? (
          <p className="text-sm text-text">
            Relies on{' '}
            <Link
              href={platformHref(linked.id)}
              className="font-semibold text-link hover:underline"
            >
              {linked.name}
            </Link>
            .{linked.lastCheckAt ? '' : ' It has not been tested yet.'}
          </p>
        ) : (
          <QuietLine>
            No Firmivra platform integration backs this entry: firms connect their own accounts.
          </QuietLine>
        )
      ) : null}
    </RailCard>
  );
}
