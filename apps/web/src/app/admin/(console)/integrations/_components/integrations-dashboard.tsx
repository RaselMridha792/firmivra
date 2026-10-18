'use client';

import { Button, Table, Toast, type Column } from '@firmivra/ui';
import {
  ArrowRight,
  Check,
  DotsThree,
  EyeSlash,
  FileText,
  Plus,
  SquaresFour,
  Stack,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useApiQuery } from '../../../../../lib/query';
import {
  adminIntegrations,
  STATUS_LABELS,
  type IntegrationStatus,
  type PlatformIntegration,
} from '../../../../../mocks/admin-integrations';
import { DashboardPanel, MiniStat, SummaryCard } from './dashboard-parts';
import {
  ActivityDot,
  CategoryPill,
  EnvironmentBadge,
  IntegrationStatusBadge,
  ServiceLogo,
} from './integration-badges';
import { formatDateTime, formatNumber, formatPercent, uptimeText } from './integration-format';
import { loadError, QuietLine, SkeletonLines, Unavailable } from './integration-states';
import {
  IntegrationsHeader,
  IntegrationsNav,
  LinkButton,
  platformHref,
} from './integrations-shell';
import { PlatformActions, type Notice } from './platform-actions';

/**
 * The Integrations dashboard (firmivra-integrations-admin-dashboard.jpg; docx §2 and §13): the
 * summary cards (they filter the platform list), the section navigation, Firmivra's platform
 * integrations, the customer catalog's counts and the latest integration activity. Every frame
 * keeps its place when its data is empty or could not load.
 */

/** The cards' filters: Needs Attention covers Error too (both require action). */
type CardFilter = 'ALL' | 'ACTIVE' | 'ATTENTION' | 'DISABLED';
const FILTER_STATUSES: Record<CardFilter, IntegrationStatus[] | undefined> = {
  ALL: undefined,
  ACTIVE: ['ACTIVE'],
  ATTENTION: ['NEEDS_ATTENTION', 'ERROR'],
  DISABLED: ['DISABLED'],
};
const FILTER_NAMES: Record<CardFilter, string> = {
  ALL: 'All',
  ACTIVE: STATUS_LABELS.ACTIVE,
  ATTENTION: `${STATUS_LABELS.NEEDS_ATTENTION} or ${STATUS_LABELS.ERROR}`,
  DISABLED: STATUS_LABELS.DISABLED,
};
/** The dashboard shows the first rows; the full list is /integrations/platform. */
const ROWS = 8;

/** "Oct 14, 2026 10:24 AM" over "99.98% uptime", or the latest error in red (docx §3). */
function LastSync({ integration }: { integration: PlatformIntegration }) {
  const failed = integration.status === 'ERROR' && integration.latestError;
  return (
    <span className="flex flex-col">
      {integration.lastSyncAt ? (
        <time dateTime={integration.lastSyncAt} className="whitespace-nowrap text-heading">
          {formatDateTime(integration.lastSyncAt)}
        </time>
      ) : (
        <span className="text-muted">
          {integration.status === 'DRAFT' ? 'Not connected yet' : 'Never synced'}
        </span>
      )}
      <span className={`text-xs ${failed ? 'text-danger' : 'text-muted'}`}>
        {failed ? integration.latestError?.title : uptimeText(integration.uptime30d)}
      </span>
    </span>
  );
}

export function IntegrationsDashboard() {
  const [filter, setFilter] = useState<CardFilter>('ALL');
  const [notice, setNotice] = useState<Notice | null>(null);
  const statuses = FILTER_STATUSES[filter];

  const summary = useApiQuery(['admin-integrations', 'summary'], () => adminIntegrations.summary());
  const platform = useApiQuery(['admin-integrations', 'platform', 'list', filter], () =>
    adminIntegrations.listPlatform({ status: statuses, sort: 'order', pageSize: ROWS }),
  );
  const activity = useApiQuery(['admin-integrations', 'logs', 'dashboard'], () =>
    adminIntegrations.listLogs({ platformOnly: true, pageSize: 5 }),
  );
  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());

  const counts = summary.data;
  const kpiLoading = summary.isPending;
  const kpiValue = (value: number | undefined) =>
    value === undefined ? <Unavailable /> : formatNumber(value);
  const pick = (next: CardFilter) => setFilter((current) => (current === next ? 'ALL' : next));

  const columns: Column<PlatformIntegration>[] = [
    {
      id: 'service',
      label: 'Service',
      className: 'min-w-60',
      cell: (item) => (
        <span className="flex items-center gap-3">
          <ServiceLogo category={item.category} size="sm" />
          <span className="min-w-0">
            <Link
              href={platformHref(item.id)}
              className="block font-semibold text-heading hover:text-action hover:underline"
            >
              {item.name}
            </Link>
            <span className="block text-xs text-muted">{item.description}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      cell: (item) => <CategoryPill category={item.category} />,
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (item) => <IntegrationStatusBadge status={item.status} />,
    },
    {
      id: 'lastSync',
      label: 'Last Sync / Uptime',
      cell: (item) => <LastSync integration={item} />,
    },
    {
      id: 'environment',
      label: 'Environment',
      cell: (item) => <EnvironmentBadge environment={item.environment} variant="text" />,
    },
  ];

  const page = platform.data;
  const more = page && page.total > page.items.length ? page.total : 0;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Integrations"
        subtitle="Manage Firmivra's platform integrations and control the integrations available to customer firms."
        actions={
          <LinkButton href="/integrations/logs">
            <FileText aria-hidden weight="fill" className="size-5" />
            View Integration Logs
          </LinkButton>
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <section
        aria-label="Integration summary"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <SummaryCard
          testId="kpi-total"
          tone="blue"
          icon={Stack}
          value={kpiValue(counts?.total)}
          label="Total Integrations"
          note="Platform + Customer"
          loading={kpiLoading}
          pressed={filter === 'ALL'}
          disabled={!counts}
          onClick={() => setFilter('ALL')}
        />
        <SummaryCard
          testId="kpi-active"
          tone="green"
          icon={Check}
          value={kpiValue(counts?.active)}
          label="Active"
          note={
            counts && counts.uptime30d !== null
              ? `${formatPercent(counts.uptime30d)} uptime (30 days)`
              : 'Uptime (30 days): N/A'
          }
          loading={kpiLoading}
          pressed={filter === 'ACTIVE'}
          disabled={!counts}
          onClick={() => pick('ACTIVE')}
        />
        <SummaryCard
          testId="kpi-attention"
          tone="amber"
          icon={Warning}
          value={kpiValue(counts ? counts.needsAttention + counts.errors : undefined)}
          label="Needs Attention"
          note={
            counts?.errors
              ? `Requires action · ${counts.errors} with ${counts.errors === 1 ? 'an error' : 'errors'}`
              : 'Requires action'
          }
          loading={kpiLoading}
          pressed={filter === 'ATTENTION'}
          disabled={!counts}
          onClick={() => pick('ATTENTION')}
        />
        <SummaryCard
          testId="kpi-disabled"
          tone="grey"
          icon={DotsThree}
          value={kpiValue(counts?.disabled)}
          label="Disabled"
          note="Not in use"
          loading={kpiLoading}
          pressed={filter === 'DISABLED'}
          disabled={!counts}
          onClick={() => pick('DISABLED')}
        />
      </section>

      <IntegrationsNav current="dashboard" />

      <DashboardPanel
        testId="platform-integrations"
        band="blue"
        title="Platform Integrations"
        subtitle="Manage the third-party services that power the Firmivra platform."
        action={
          <LinkButton href="/integrations/platform/new" variant="primary">
            <Plus aria-hidden weight="bold" className="size-5" />
            Add Platform Integration
          </LinkButton>
        }
      >
        {filter !== 'ALL' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-5 py-2 text-sm">
            <span aria-live="polite" className="text-text">
              Showing: <span className="font-semibold text-heading">{FILTER_NAMES[filter]}</span>
            </span>
            <Button variant="ghost" onClick={() => setFilter('ALL')}>
              Clear filter
            </Button>
          </div>
        ) : null}
        {platform.isError ? (
          <div className="px-5 py-2">
            <QuietLine>{loadError(platform.error)}</QuietLine>
          </div>
        ) : page && !page.items.length ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
            {filter === 'ALL' ? (
              <>
                <p className="font-semibold text-heading">No platform integrations yet.</p>
                <p className="max-w-xl text-sm text-muted">
                  Platform integrations are the services Firmivra itself runs on, such as payments,
                  SMS, email and storage. Add the first one to start.
                </p>
                <LinkButton href="/integrations/platform/new" variant="primary">
                  <Plus aria-hidden weight="bold" className="size-5" />
                  Add Platform Integration
                </LinkButton>
              </>
            ) : (
              <>
                <p className="font-semibold text-heading">
                  No integrations match “{FILTER_NAMES[filter]}”.
                </p>
                <Button variant="secondary" onClick={() => setFilter('ALL')}>
                  Clear filter
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="px-2 pt-2">
            <Table
              caption="Platform integrations"
              rows={page?.items ?? []}
              loading={platform.isPending}
              columns={columns}
              rowKey={(item) => item.id}
              showPagination={false}
              rowActions={(item) => (
                <PlatformActions
                  integration={item}
                  canLifecycle={access.data?.canLifecycle ?? false}
                  onNotice={setNotice}
                />
              )}
            />
          </div>
        )}
        {more ? (
          <div className="border-t border-divider px-5 py-3">
            <Link
              href="/integrations/platform"
              className="inline-flex items-center gap-2 text-sm font-semibold text-link hover:underline"
            >
              View all {more} platform integrations
              <ArrowRight aria-hidden weight="bold" className="size-4" />
            </Link>
          </div>
        ) : null}
      </DashboardPanel>

      <div className="grid gap-5 xl:grid-cols-9">
        <DashboardPanel
          testId="catalog-summary"
          className="xl:col-span-5"
          band="purple"
          title="Customer Integration Catalog"
          subtitle="Control which integrations are available for customer firms and manage default settings."
          action={<LinkButton href="/integrations/catalog">Manage Catalog</LinkButton>}
        >
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            <MiniStat
              testId="catalog-total"
              tone="blue"
              icon={SquaresFour}
              value={kpiValue(counts?.catalog.total)}
              label="Total Integrations"
              loading={kpiLoading}
            />
            <MiniStat
              testId="catalog-enabled"
              tone="green"
              icon={Check}
              value={kpiValue(counts?.catalog.enabled)}
              label="Enabled"
              note="Available to firms"
              loading={kpiLoading}
            />
            <MiniStat
              testId="catalog-disabled"
              tone="grey"
              icon={EyeSlash}
              value={kpiValue(counts?.catalog.disabled)}
              label="Disabled"
              note="Not available"
              loading={kpiLoading}
            />
            <MiniStat
              testId="catalog-coming-soon"
              tone="purple"
              icon={UsersThree}
              value={kpiValue(counts?.catalog.comingSoon)}
              label="Coming Soon"
              loading={kpiLoading}
            />
          </div>
          {summary.isError ? (
            <div className="px-5 pb-2">
              <QuietLine>{loadError(summary.error)}</QuietLine>
            </div>
          ) : null}
        </DashboardPanel>

        <DashboardPanel
          testId="integration-activity"
          className="xl:col-span-4"
          band="green"
          title="Integration Activity"
          subtitle="Recent activity across all platform integrations."
          action={<LinkButton href="/integrations/logs">View All Activity</LinkButton>}
        >
          <div className="px-5 py-2">
            {activity.isPending ? (
              <SkeletonLines rows={5} label="Loading activity" />
            ) : activity.isError ? (
              <QuietLine>{loadError(activity.error)}</QuietLine>
            ) : !activity.data.items.length ? (
              <QuietLine>No integration activity yet.</QuietLine>
            ) : (
              <ul className="divide-y divide-divider">
                {activity.data.items.map((log) => (
                  <li
                    key={log.id}
                    className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <ActivityDot severity={log.severity} succeeded={log.succeeded} />
                      <span className="min-w-0 text-heading">{log.message}</span>
                    </span>
                    <time
                      dateTime={log.at}
                      className="shrink-0 pl-7 whitespace-nowrap text-text sm:pl-0"
                    >
                      {formatDateTime(log.at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
