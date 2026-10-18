'use client';

import {
  Button,
  Card,
  DateRangePicker,
  DonutChart,
  Select,
  Skeleton,
  Table,
  Toast,
  type ChartTone,
  type Column,
  type DateRange,
} from '@firmivra/ui';
import {
  ArrowsClockwise,
  Buildings,
  ChartBar,
  CheckCircle,
  CurrencyDollar,
  Database,
  FileText,
  Gauge,
  Plugs,
  PlugsConnected,
  Pulse,
  Timer,
  Warning,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  USAGE_SCOPES,
  type UsageAlert,
  type UsageReport,
  type UsageScope,
  type UsageSubject,
} from '../../../../../../mocks/admin-integrations';
import { DashboardPanel, MiniStat, type DashboardTone } from '../../_components/dashboard-parts';
import { ServiceLogo } from '../../_components/integration-badges';
import {
  formatCents,
  formatDuration,
  formatMetric,
  formatNumber,
  formatPercent,
} from '../../_components/integration-format';
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
  logsHref,
} from '../../_components/integrations-shell';
import type { Notice } from '../../_components/platform-actions';
import { UsageChart } from './usage-chart';
import { UsageThresholdsForm } from './usage-thresholds';
import {
  addressOf,
  daysIn,
  PRESET_LABELS,
  PRESETS,
  presetRange,
  rangeProblem,
  readView,
  utcToday,
  type AddressQuery,
  type Preset,
  type UsageView,
} from './usage-view';

/**
 * Usage & Analytics (docx §10; no design frame, built in the dashboard's look): Firmivra-side
 * usage of each platform integration (requests, success and failure, latency, volume in the
 * provider's own unit, provider cost where reported), the customer catalog's adoption (connected
 * and active firms, connects and disconnects, plan distribution), and API key traffic, over a
 * preset or custom range of UTC days (30 by default). Alerts list what crossed a threshold; the
 * thresholds are edited below. Cross-firm numbers are aggregates only (docx §10).
 */

const SCOPE_LABELS: Record<UsageScope, string> = {
  PLATFORM_INTEGRATION: 'Platform integrations',
  CATALOG: 'Customer catalog adoption',
  API: 'Firmivra API keys',
};
const ALL_LABELS: Record<UsageScope, string> = {
  PLATFORM_INTEGRATION: 'All platform integrations',
  CATALOG: 'All catalog integrations',
  API: 'All API keys',
};
const PLAN_TONES: readonly ChartTone[] = [
  'blue',
  'green',
  'yellow',
  'purple',
  'navy',
  'grey',
  'red',
];
const ALERT_LOOK: Record<UsageAlert['kind'], { icon: Icon; label: string }> = {
  ERROR_RATE: { icon: WarningCircle, label: 'Error rate' },
  LATENCY: { icon: Timer, label: 'Latency' },
  COST: { icon: CurrencyDollar, label: 'Cost' },
  SYNC_FAILURES: { icon: ArrowsClockwise, label: 'Sync failures' },
  QUOTA: { icon: Gauge, label: 'Rate limit' },
};

const rate = (value: number | null) => (value === null ? 'N/A' : formatPercent(value));
const cents = (value: number | null) => (value === null ? 'N/A' : formatCents(value));
const count = (value: number | null) => formatNumber(value ?? 0);

interface Stat {
  id: string;
  label: string;
  icon: Icon;
  tone: DashboardTone;
  value: (report: UsageReport) => string;
  note?: (report: UsageReport) => string | undefined;
}

/** The totals cards of a scope; `selected` is the chosen subject's row (its units and labels). */
function statsFor(scope: UsageScope, selected: UsageSubject | undefined, chosen: boolean): Stat[] {
  const successRate: Stat = {
    id: 'success-rate',
    label: 'Success Rate',
    icon: CheckCircle,
    tone: 'green',
    value: (r) => rate(r.totals.successRate),
    note: (r) => `${formatNumber(r.totals.successes)} succeeded`,
  };
  const failures: Stat = {
    id: 'failures',
    label: 'Failures',
    icon: Warning,
    tone: 'amber',
    value: (r) => formatNumber(r.totals.failures),
  };
  const latency: Stat = {
    id: 'latency',
    label: 'Avg Latency',
    icon: Timer,
    tone: 'purple',
    value: (r) => formatDuration(r.totals.avgLatencyMs),
  };
  const days = (r: UsageReport) => `${daysIn(r.from, r.to)} days`;
  if (scope === 'CATALOG')
    return [
      {
        id: 'connected',
        label: 'Connected Firms',
        icon: Buildings,
        tone: 'blue',
        value: (r) => count(r.totals.connectedFirms),
        note: () => 'On the last day',
      },
      {
        id: 'active',
        label: 'Active Firms',
        icon: Pulse,
        tone: 'green',
        value: (r) => count(r.totals.activeFirms),
        note: () => 'On the last day',
      },
      {
        id: 'connects',
        label: 'Connects',
        icon: PlugsConnected,
        tone: 'purple',
        value: (r) => count(r.totals.connects),
        note: days,
      },
      {
        id: 'disconnects',
        label: 'Disconnects',
        icon: Plugs,
        tone: 'amber',
        value: (r) => count(r.totals.disconnects),
        note: days,
      },
      {
        id: 'requests',
        label: 'Firm Requests',
        icon: ChartBar,
        tone: 'blue',
        value: (r) => formatNumber(r.totals.requests),
        note: days,
      },
      successRate,
    ];
  if (scope === 'API')
    return [
      {
        id: 'requests',
        label: 'API Calls',
        icon: Pulse,
        tone: 'blue',
        value: (r) => formatNumber(r.totals.requests),
        note: days,
      },
      successRate,
      failures,
      latency,
    ];
  const unit = selected?.volumeUnit ?? null;
  return [
    {
      id: 'requests',
      label: selected?.requestLabel ?? 'Requests',
      icon: Pulse,
      tone: 'blue',
      value: (r) => formatNumber(r.totals.requests),
      note: days,
    },
    successRate,
    failures,
    latency,
    {
      id: 'volume',
      label: selected?.volumeLabel ?? 'Volume',
      icon: Database,
      tone: 'blue',
      value: (r) => (unit === null ? 'N/A' : formatMetric(r.totals.volume, unit)),
      note: () =>
        chosen
          ? unit === null
            ? 'Not reported for this range'
            : 'In the provider’s unit'
          : 'Choose one integration: units differ',
    },
    {
      id: 'cost',
      label: 'Provider Cost',
      icon: CurrencyDollar,
      tone: 'grey',
      value: (r) => cents(r.totals.costCents),
      note: () => 'Where the provider reports it',
    },
  ];
}

/** The subjects of a scope for the picker: integration ids, catalog provider keys, API key ids. */
async function subjectOptions(scope: UsageScope): Promise<{ value: string; label: string }[]> {
  if (scope === 'PLATFORM_INTEGRATION') {
    const page = await adminIntegrations.listPlatform({ sort: 'name', pageSize: 100 });
    return page.items.map((item) => ({ value: item.id, label: item.name }));
  }
  if (scope === 'CATALOG') {
    const page = await adminIntegrations.listCatalog({ sort: 'name', pageSize: 100 });
    return page.items.map((item) => ({ value: item.provider, label: item.name }));
  }
  const keys = await adminIntegrations.listApiKeys();
  return keys.map((key) => ({
    value: key.id,
    label: `${key.name} (${key.prefix}…${key.lastFour})`,
  }));
}

/** A frame's body: skeleton, the quiet error line, or the content. */
function Frame({
  pending,
  error,
  rows = 4,
  children,
}: {
  pending: boolean;
  error: unknown;
  rows?: number;
  children: () => ReactNode;
}) {
  if (pending) return <SkeletonLines rows={rows} />;
  if (error) return <QuietLine>{loadError(error)}</QuietLine>;
  return <>{children()}</>;
}

export function UsageAnalytics({ address }: { address: AddressQuery }) {
  const [today] = useState(utcToday);
  const [view, setView] = useState<UsageView>(() => readView(address, today));
  const [draft, setDraft] = useState<DateRange>(() => ({ from: view.from, to: view.to }));
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const next = addressOf(view);
    if (next !== `${window.location.pathname}${window.location.search}`)
      window.history.replaceState(null, '', next);
  }, [view]);

  const access = useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
  const subjects = useApiQuery(['admin-integrations', 'usage', 'subjects', view.scope], () =>
    subjectOptions(view.scope),
  );
  const report = useApiQuery(
    ['admin-integrations', 'usage', 'report', view.scope, view.subject, view.from, view.to],
    () =>
      adminIntegrations.usage({
        scope: view.scope,
        subject: view.subject || undefined,
        from: view.from,
        to: view.to,
      }),
  );
  const thresholds = useApiQuery(['admin-integrations', 'thresholds'], () =>
    adminIntegrations.thresholds(),
  );

  const pick = (subject: string) => setView((current) => ({ ...current, subject }));
  function chooseScope(value: string) {
    const scope = USAGE_SCOPES.find((item) => item === value) ?? 'PLATFORM_INTEGRATION';
    setView((current) => ({ ...current, scope, subject: '' }));
  }
  function choosePreset(value: string) {
    const preset = PRESETS.find((item) => item === value);
    if (!preset) {
      setView((current) => ({ ...current, preset: 'custom' }));
      return;
    }
    const range = presetRange(preset, today);
    setDraft(range);
    setRangeError(null);
    setView((current) => ({ ...current, preset, ...range }));
  }
  function changeRange(next: DateRange) {
    setDraft(next);
    const problem = rangeProblem(next.from, next.to);
    setRangeError(problem);
    if (!problem) setView((current) => ({ ...current, preset: 'custom', ...next }));
  }

  const data = report.data;
  const selected = view.subject
    ? data?.subjects.find((item) => item.key === view.subject)
    : undefined;
  const stats = statsFor(view.scope, selected, !!view.subject);
  const noun =
    view.scope === 'CATALOG'
      ? 'firm requests'
      : view.scope === 'API'
        ? 'API calls'
        : (selected?.requestLabel?.toLowerCase() ?? 'requests');
  const options = subjects.data ?? [];
  const subjectOptionsShown = [
    { value: '', label: ALL_LABELS[view.scope] },
    ...options,
    ...(view.subject && !options.some((item) => item.value === view.subject)
      ? [{ value: view.subject, label: subjects.data ? 'Selected subject' : 'Loading…' }]
      : []),
  ];
  const subjectName =
    options.find((item) => item.value === view.subject)?.label ?? selected?.name ?? 'This subject';

  const subjectColumns: Column<UsageSubject>[] = [
    {
      id: 'name',
      label: view.scope === 'API' ? 'API Key' : 'Integration',
      className: 'min-w-52',
      cell: (item) => (
        <span className="flex items-center gap-3">
          {item.category ? <ServiceLogo category={item.category} size="sm" /> : null}
          <button
            type="button"
            onClick={() => pick(item.key)}
            className="relative rounded-sm text-left font-semibold text-heading hover:text-action hover:underline"
          >
            {item.name}
            <span className="sr-only"> (show its usage)</span>
          </button>
        </span>
      ),
    },
    ...(view.scope === 'CATALOG'
      ? ([
          {
            id: 'connected',
            label: 'Connected Firms',
            cell: (item) => count(item.connectedFirms),
          },
          { id: 'active', label: 'Active Firms', cell: (item) => count(item.activeFirms) },
          {
            id: 'moves',
            label: 'Connects / Disconnects',
            className: 'whitespace-nowrap',
            cell: (item) => `${count(item.connects)} / ${count(item.disconnects)}`,
          },
        ] satisfies Column<UsageSubject>[])
      : []),
    {
      id: 'requests',
      label:
        view.scope === 'CATALOG'
          ? 'Firm Requests'
          : view.scope === 'API'
            ? 'API Calls'
            : 'Requests',
      className: 'whitespace-nowrap',
      cell: (item) => (
        <span className="flex flex-col">
          <span className="text-heading">{formatNumber(item.requests)}</span>
          {view.scope === 'PLATFORM_INTEGRATION' && item.requestLabel ? (
            <span className="text-xs text-muted">{item.requestLabel}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'successRate',
      label: 'Success Rate',
      cell: (item) => rate(item.successRate),
    },
    ...(view.scope === 'CATALOG'
      ? []
      : ([
          { id: 'failures', label: 'Failures', cell: (item) => formatNumber(item.failures) },
          {
            id: 'latency',
            label: 'Avg Latency',
            className: 'whitespace-nowrap',
            cell: (item) => formatDuration(item.avgLatencyMs),
          },
        ] satisfies Column<UsageSubject>[])),
    ...(view.scope === 'PLATFORM_INTEGRATION'
      ? ([
          {
            id: 'volume',
            label: 'Volume',
            className: 'whitespace-nowrap',
            cell: (item) => (
              <span className="flex flex-col">
                <span className="text-heading">
                  {item.volumeUnit ? formatMetric(item.volume, item.volumeUnit) : 'N/A'}
                </span>
                {item.volumeLabel ? (
                  <span className="text-xs text-muted">{item.volumeLabel}</span>
                ) : null}
              </span>
            ),
          },
          {
            id: 'cost',
            label: 'Provider Cost',
            className: 'whitespace-nowrap',
            cell: (item) => cents(item.costCents),
          },
        ] satisfies Column<UsageSubject>[])
      : []),
  ];

  const plans = data?.planDistribution ?? [];
  const planFirms = plans.reduce((total, plan) => total + plan.firms, 0);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Usage & Analytics"
        subtitle="Monitor reliability, adoption, volume and cost across Firmivra's integrations."
        crumbs={[{ label: 'Integrations', href: '/integrations' }, { label: 'Usage & Analytics' }]}
        actions={
          <LinkButton
            href={
              view.scope === 'PLATFORM_INTEGRATION' && view.subject
                ? logsHref(view.subject)
                : '/integrations/logs'
            }
          >
            <FileText aria-hidden weight="fill" className="size-5" />
            View Integration Logs
          </LinkButton>
        }
      />

      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <IntegrationsNav current="usage" />

      <Card data-testid="usage-controls" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-60">
            <Select
              label="Scope"
              value={view.scope}
              onChange={(event) => chooseScope(event.target.value)}
              options={USAGE_SCOPES.map((value) => ({ value, label: SCOPE_LABELS[value] }))}
            />
          </div>
          <div className="w-full sm:w-72">
            <Select
              label="Subject"
              value={view.subject}
              disabled={subjects.isError}
              onChange={(event) => pick(event.target.value)}
              options={subjectOptionsShown}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              label="Time range"
              value={view.preset}
              onChange={(event) => choosePreset(event.target.value)}
              options={([...PRESETS, 'custom'] as const).map((value: Preset) => ({
                value,
                label: PRESET_LABELS[value],
              }))}
            />
          </div>
          <DateRangePicker label="Dates (UTC)" value={draft} onChange={changeRange} />
        </div>
        {rangeError ? (
          <p role="alert" className="text-sm text-danger">
            {rangeError} The page still shows {view.from} to {view.to}.
          </p>
        ) : null}
      </Card>

      <section
        aria-label="Usage totals"
        data-testid="usage-totals"
        className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${stats.length === 6 ? 'min-[1440px]:grid-cols-6' : 'xl:grid-cols-4'}`}
      >
        {stats.map((stat) => (
          <MiniStat
            key={stat.id}
            testId={`usage-${stat.id}`}
            tone={stat.tone}
            icon={stat.icon}
            label={stat.label}
            loading={report.isPending}
            value={data ? stat.value(data) : <Unavailable />}
            note={data ? stat.note?.(data) : undefined}
          />
        ))}
      </section>

      <DashboardPanel
        testId="usage-chart"
        band="blue"
        title="Usage Over Time"
        subtitle={`${noun[0]?.toUpperCase() ?? ''}${noun.slice(1)} per day (UTC), split into succeeded and failed.`}
      >
        <div className="px-5 py-4">
          {report.isPending ? (
            <div role="status" aria-label="Loading the usage chart">
              <Skeleton className="h-56" />
            </div>
          ) : (
            <>
              <UsageChart series={data?.series ?? []} noun={noun} />
              {report.isError ? (
                <QuietLine>{loadError(report.error)}</QuietLine>
              ) : data && !data.totals.requests ? (
                <QuietLine>No {noun} in this range.</QuietLine>
              ) : null}
            </>
          )}
        </div>
      </DashboardPanel>

      <div className="grid gap-5 xl:grid-cols-3">
        <DashboardPanel
          testId="usage-subjects"
          className="xl:col-span-2"
          band="purple"
          title={view.scope === 'API' ? 'Top API Keys' : 'Top Integrations'}
          subtitle={
            view.subject
              ? `${subjectName} only. Show all to compare.`
              : 'The busiest subjects in the range. Choose one to see its own usage.'
          }
          action={
            view.subject ? (
              <Button variant="secondary" onClick={() => pick('')}>
                Show All
              </Button>
            ) : undefined
          }
        >
          <div className="px-2 py-2">
            {report.isError ? (
              <div className="px-3">
                <QuietLine>{loadError(report.error)}</QuietLine>
              </div>
            ) : data && !data.subjects.length ? (
              <div className="px-3">
                <QuietLine>No usage was recorded in this range.</QuietLine>
              </div>
            ) : (
              <Table
                caption="Usage by subject"
                rows={data?.subjects ?? []}
                loading={report.isPending}
                columns={subjectColumns}
                rowKey={(item) => item.key}
                noun="subjects"
                rowActions={
                  view.scope === 'PLATFORM_INTEGRATION'
                    ? (item) => (
                        <LinkButton href={logsHref(item.key)} size="sm">
                          Logs<span className="sr-only"> for {item.name}</span>
                        </LinkButton>
                      )
                    : undefined
                }
              />
            )}
          </div>
        </DashboardPanel>

        <DashboardPanel
          testId="plan-distribution"
          band="green"
          title="Plan Distribution"
          subtitle="Connected firms by subscription plan, on the last day."
        >
          <div className="px-5 py-4">
            {view.scope !== 'CATALOG' ? (
              <div className="flex flex-col items-start gap-3">
                <QuietLine>
                  Plan distribution counts the firms connected through the customer catalog.
                </QuietLine>
                <Button variant="secondary" onClick={() => chooseScope('CATALOG')}>
                  Show Catalog Adoption
                </Button>
              </div>
            ) : (
              <Frame pending={report.isPending} error={report.error}>
                {() => (
                  <DonutChart
                    segments={plans.map((plan, index) => ({
                      label: plan.planName,
                      value: plan.firms,
                      tone: PLAN_TONES[index % PLAN_TONES.length] ?? 'grey',
                    }))}
                    centerValue={formatNumber(planFirms)}
                    centerLabel="Firms"
                    emptyText="No firms are connected in this range."
                  />
                )}
              </Frame>
            )}
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardPanel
          testId="usage-alerts"
          band="purple"
          title="Alerts"
          subtitle="Subjects that crossed a threshold in the range, once per condition."
        >
          <div className="px-5 py-2">
            <Frame pending={report.isPending} error={report.error} rows={3}>
              {() =>
                data?.alerts.length ? (
                  <ul className="divide-y divide-divider">
                    {data.alerts.map((alert) => {
                      const look = ALERT_LOOK[alert.kind];
                      return (
                        <li
                          key={`${alert.subjectKey}-${alert.kind}`}
                          className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="flex min-w-0 items-start gap-3">
                            <look.icon
                              aria-hidden
                              weight="fill"
                              className="mt-0.5 size-5 shrink-0 text-gold"
                            />
                            <span className="min-w-0">
                              <span className="block font-semibold text-heading">{look.label}</span>
                              <span className="block text-text">{alert.message}</span>
                            </span>
                          </span>
                          {view.scope === 'PLATFORM_INTEGRATION' ? (
                            <Link
                              href={logsHref(alert.subjectKey)}
                              className="shrink-0 pl-8 font-semibold text-link hover:underline sm:pl-0"
                            >
                              View Logs<span className="sr-only"> for {alert.subjectName}</span>
                            </Link>
                          ) : (
                            <Button variant="ghost" onClick={() => pick(alert.subjectKey)}>
                              Show Usage<span className="sr-only"> of {alert.subjectName}</span>
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <QuietLine>No thresholds were crossed in this range.</QuietLine>
                )
              }
            </Frame>
          </div>
        </DashboardPanel>

        <DashboardPanel
          testId="usage-thresholds"
          band="blue"
          title="Alert Thresholds"
          subtitle="Optional limits for error rate, latency, rate-limit use, cost and failed syncs."
        >
          <div className="px-5 py-4">
            <UsageThresholdsForm
              query={thresholds}
              canEdit={access.data?.canManageConfiguration ?? false}
              onNotice={setNotice}
            />
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
