'use client';

import { Card, IconTile, Skeleton, type KpiTone } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  ShieldWarning,
  User,
  UsersThree,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AuditMetric, AuditSummary } from '../../../../../mocks/admin-audit-security';

interface Metric {
  key: keyof AuditSummary;
  label: string;
  icon: Icon;
  tone: KpiTone;
  /** Whether a rise is good news (green) or bad news (red). */
  upIsGood: boolean;
  /** The design shows the alert change as a count and the others as a percentage. */
  change: 'count' | 'percent';
}

const METRICS: Metric[] = [
  {
    key: 'securityAlerts',
    label: 'Security Alerts',
    icon: ShieldWarning,
    tone: 'red',
    upIsGood: false,
    change: 'count',
  },
  {
    key: 'failedLogins',
    label: 'Failed Logins',
    icon: User,
    tone: 'blue',
    upIsGood: false,
    change: 'percent',
  },
  {
    key: 'activeSessions',
    label: 'Active Sessions',
    icon: UsersThree,
    tone: 'green',
    upIsGood: true,
    change: 'percent',
  },
  {
    key: 'highRiskEvents',
    label: 'High-Risk Events',
    icon: Warning,
    tone: 'amber',
    upIsGood: false,
    change: 'percent',
  },
];

/** "↑ 2 from last 7 days": the range's last 7 days against the 7 days before. */
function Trend({ metric, spec }: { metric: AuditMetric; spec: Metric }) {
  const change = metric.current - metric.previous;
  if (!change) return <span className="text-sm text-muted">No change from last 7 days</span>;
  const up = change > 0;
  const amount =
    spec.change === 'percent' && metric.previous
      ? `${Math.round((Math.abs(change) / metric.previous) * 100)}%`
      : String(Math.abs(change));
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm ${up === spec.upIsGood ? 'text-success' : 'text-danger'}`}
    >
      <Arrow aria-hidden weight="bold" className="size-3.5" />
      <span className="sr-only">{up ? 'Up' : 'Down'} </span>
      {amount} from last 7 days
    </span>
  );
}

/** The four cards over the event list; they count the selected date range (docx §2). */
export function AuditKpis({ query }: { query: UseQueryResult<AuditSummary> }) {
  return (
    <section aria-label="Security summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {METRICS.map((spec) => {
        const metric = query.data?.[spec.key];
        return (
          <Card
            key={spec.key}
            data-testid={`kpi-${spec.key}`}
            className="flex items-center gap-5 p-5!"
          >
            <IconTile icon={spec.icon} tone={spec.tone} />
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className="text-sm font-semibold text-heading">{spec.label}</h2>
              {query.isPending ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p
                  data-testid={`kpi-${spec.key}-value`}
                  className="text-2xl leading-none font-bold text-heading"
                >
                  {metric ? (
                    metric.value
                  ) : (
                    <>
                      <span aria-hidden>—</span>
                      <span className="sr-only">Not available right now</span>
                    </>
                  )}
                </p>
              )}
              {metric ? <Trend metric={metric} spec={spec} /> : null}
            </div>
          </Card>
        );
      })}
    </section>
  );
}
