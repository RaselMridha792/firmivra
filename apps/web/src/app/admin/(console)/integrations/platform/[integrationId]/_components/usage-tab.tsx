'use client';

import { Callout, DateRangePicker, Skeleton, type DateRange } from '@firmivra/ui';
import { Warning } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  type UsageDay,
  type UsageReport,
} from '../../../_components/integrations-contract';
import {
  formatCents,
  formatDate,
  formatDuration,
  formatMetric,
  formatNumber,
  formatPercent,
} from '../../../_components/integration-format';
import { loadError, QuietLine, Unavailable } from '../../../_components/integration-states';
import { LinkButton } from '../../../_components/integrations-shell';
import { Panel } from './detail-parts';

/**
 * Usage & Analytics for one integration (docx §5): requests, volume, success and failure rates
 * and latency over a date range, in the provider's own units; "N/A" where the provider reports
 * nothing; the daily requests as bars; and the alert thresholds it crossed.
 */

const DAY_MS = 86_400_000;
const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10);
/** The last 30 whole UTC days, as the API's default. */
function defaultRange(): DateRange {
  const today = Date.now();
  return { from: dayKey(today - 29 * DAY_MS), to: dayKey(today) };
}
/** "Oct 14" for a `YYYY-MM-DD` day (UTC). */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

function UsageStat({
  label,
  value,
  note,
  loading,
  testId,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-subtle p-4"
    >
      <span className="text-sm text-text">{label}</span>
      {loading ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <span className="text-2xl leading-tight font-bold wrap-anywhere text-heading">{value}</span>
      )}
      {note ? <span className="text-xs text-muted">{note}</span> : null}
    </div>
  );
}

/** Daily requests as bars, failures in red at the foot of each bar. */
function DailyBars({ series }: { series: UsageDay[] }) {
  const peak = Math.max(0, ...series.map((day) => day.requests));
  const first = series[0];
  const last = series[series.length - 1];
  if (!peak || !first || !last) return <QuietLine>No requests in this range.</QuietLine>;
  const busiest = series.find((day) => day.requests === peak);
  const width = series.length * 10;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>Peak {formatNumber(peak)} per day</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-chart-blue" />
            Requests
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-chart-red" />
            Failures
          </span>
        </span>
      </figcaption>
      <svg
        role="img"
        aria-label={`Requests per day from ${formatDate(`${first.day}T12:00:00Z`)} to ${formatDate(`${last.day}T12:00:00Z`)}: peak ${formatNumber(peak)}${busiest ? ` on ${dayLabel(busiest.day)}` : ''}.`}
        viewBox={`0 0 ${width} 100`}
        preserveAspectRatio="none"
        className="block h-40 w-full"
      >
        <rect width={width} height="100" className="fill-subtle" />
        {series.map((day, index) => {
          const height = (day.requests / peak) * 96;
          const failed = (day.failures / peak) * 96;
          return (
            <g key={day.day}>
              <rect
                x={index * 10 + 1.5}
                y={100 - height}
                width="7"
                height={height}
                className="fill-chart-blue"
              />
              {failed > 0 ? (
                <rect
                  x={index * 10 + 1.5}
                  y={100 - failed}
                  width="7"
                  height={failed}
                  className="fill-chart-red"
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-xs text-muted">
        <span>{dayLabel(first.day)}</span>
        <span>{dayLabel(last.day)}</span>
      </div>
    </figure>
  );
}

function stats(report: UsageReport | undefined, integrationId: string) {
  const subject = report?.subjects.find((item) => item.key === integrationId);
  const totals = report?.totals;
  return {
    requestLabel: subject?.requestLabel ?? 'Requests',
    volumeLabel: subject?.volumeLabel ?? 'Volume',
    requests: totals ? formatNumber(totals.requests) : null,
    successRate: totals
      ? totals.successRate === null
        ? 'N/A'
        : formatPercent(totals.successRate)
      : null,
    failures: totals ? formatNumber(totals.failures) : null,
    failureRate:
      totals && totals.requests
        ? `${formatPercent((totals.failures / totals.requests) * 100)} of requests`
        : undefined,
    latency: totals ? formatDuration(totals.avgLatencyMs) : null,
    volume: totals
      ? subject?.volumeUnit
        ? formatMetric(totals.volume, subject.volumeUnit)
        : 'N/A'
      : null,
    cost: totals ? (totals.costCents === null ? 'N/A' : formatCents(totals.costCents)) : null,
  };
}

export function UsageTab({ integrationId }: { integrationId: string }) {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const usage = useApiQuery(
    ['admin-integrations', 'platform', integrationId, 'usage', range.from, range.to],
    () =>
      adminIntegrations.platformUsage(integrationId, {
        from: range.from || undefined,
        to: range.to || undefined,
      }),
  );
  const loading = usage.isPending;
  const view = stats(usage.data, integrationId);
  const shown = (value: string | null) => value ?? <Unavailable />;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel
        testId="usage-analytics"
        title="Usage & Analytics"
        subtitle="Requests, volume, success and failure rates and latency, in the provider's own units. N/A where the provider reports none."
        action={
          <LinkButton href={`/integrations/usage?integration=${encodeURIComponent(integrationId)}`}>
            Open Usage & Analytics
          </LinkButton>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="w-full max-w-md">
            <DateRangePicker label="Date range" value={range} onChange={setRange} />
          </div>
          {usage.isError ? <QuietLine>{loadError(usage.error)}</QuietLine> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-6">
            <UsageStat
              testId="usage-requests"
              label={view.requestLabel}
              value={shown(view.requests)}
              loading={loading}
            />
            <UsageStat
              testId="usage-success-rate"
              label="Success Rate"
              value={shown(view.successRate)}
              loading={loading}
            />
            <UsageStat
              testId="usage-failures"
              label="Failures"
              value={shown(view.failures)}
              note={view.failureRate}
              loading={loading}
            />
            <UsageStat
              testId="usage-latency"
              label="Average Latency"
              value={shown(view.latency)}
              loading={loading}
            />
            <UsageStat
              testId="usage-volume"
              label={view.volumeLabel}
              value={shown(view.volume)}
              loading={loading}
            />
            <UsageStat
              testId="usage-cost"
              label="Provider Cost"
              value={shown(view.cost)}
              loading={loading}
            />
          </div>
        </div>
      </Panel>
      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <Panel testId="usage-daily" title="Requests per Day" className="xl:col-span-2">
          {usage.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : usage.isError ? (
            <QuietLine>{loadError(usage.error)}</QuietLine>
          ) : (
            <DailyBars series={usage.data.series} />
          )}
        </Panel>
        <Panel
          testId="usage-alerts"
          title="Alerts"
          subtitle="Thresholds this integration crossed in the range."
        >
          {usage.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : usage.isError ? (
            <QuietLine>{loadError(usage.error)}</QuietLine>
          ) : usage.data.alerts.length ? (
            <ul className="flex flex-col gap-2">
              {usage.data.alerts.map((alert) => (
                <li key={`${alert.subjectKey}-${alert.kind}`}>
                  <Callout size="compact" surface="warning" icon={Warning} tone="amber">
                    {alert.message}
                  </Callout>
                </li>
              ))}
            </ul>
          ) : (
            <QuietLine>No thresholds crossed in this range.</QuietLine>
          )}
        </Panel>
      </div>
    </div>
  );
}
