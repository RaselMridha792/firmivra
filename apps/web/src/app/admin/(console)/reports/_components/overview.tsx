'use client';

import type { AdminReportActivity, AdminReportKpi, AdminReportsOverview } from '@firmivra/types';
import { DonutChart, type ChartTone } from '@firmivra/ui';
import {
  ArrowCircleUp,
  Buildings,
  ChartLineUp,
  CreditCard,
  CurrencyDollar,
  FileText,
  Headset,
  type Icon,
  UserPlus,
  Users,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BarList, MonthBars, MonthLine, PeriodSelect } from './charts';
import {
  count,
  dateTimeText,
  kpiNote,
  Loaded,
  moneyWhole,
  COULD_NOT_LOAD,
  NOT_AVAILABLE,
  Panel,
  QuietLine,
  ReportKpiCard,
  type ReportTone,
  ReportsHeader,
  ReportsTabs,
  RP,
  trendOf,
  useRange,
} from './reports-common';

type Kpis = AdminReportsOverview['kpis'];
const KPIS: {
  key: keyof Kpis;
  label: string;
  icon: Icon;
  tone: ReportTone;
  show: (v: number) => string;
  upIsGood?: boolean;
}[] = [
  { key: 'totalFirms', label: 'Total Firms', icon: Buildings, tone: 'blue', show: count },
  { key: 'activeFirms', label: 'Active Firms', icon: UsersThree, tone: 'blue', show: count },
  {
    key: 'pendingApplications',
    label: 'Pending Applications',
    icon: FileText,
    tone: 'blue',
    show: count,
    upIsGood: false,
  },
  { key: 'totalUsers', label: 'Total Users', icon: UsersThree, tone: 'blue', show: count },
  {
    key: 'mrrCents',
    label: 'Monthly Recurring Revenue',
    icon: CurrencyDollar,
    tone: 'green',
    show: moneyWhole,
  },
  {
    key: 'overduePayments',
    label: 'Overdue Payments',
    icon: CreditCard,
    tone: 'blue',
    show: count,
    upIsGood: false,
  },
  {
    key: 'openSupportIssues',
    label: 'Open Support Issues',
    icon: Headset,
    tone: 'blue',
    show: count,
    upIsGood: false,
  },
  {
    key: 'uptimePercent',
    label: 'Platform Uptime',
    icon: ChartLineUp,
    tone: 'blue',
    show: (v) => `${v}%`,
  },
];

/** A KPI card for a figure that may have no source (null: "Not available", never zero). */
export function Kpi({
  kpi,
  label,
  icon,
  tone,
  show,
  upIsGood = true,
  loading,
}: {
  kpi: AdminReportKpi | undefined;
  label: string;
  icon: Icon;
  tone: ReportTone;
  show: (v: number) => string;
  upIsGood?: boolean;
  loading: boolean;
}) {
  return (
    <ReportKpiCard
      icon={icon}
      tone={tone}
      label={label}
      loading={loading}
      value={kpi && kpi.value !== null ? show(kpi.value) : '—'}
      trend={kpi ? trendOf(kpi, upIsGood) : undefined}
      // No figure once loading is over means the call failed: say so, not "not available".
      note={
        kpi
          ? kpi.value === null
            ? NOT_AVAILABLE
            : kpiNote(kpi)
          : loading
            ? undefined
            : COULD_NOT_LOAD
      }
    />
  );
}

const PLAN_TONES: ChartTone[] = ['blue', 'green', 'yellow', 'purple', 'navy', 'grey', 'red'];

/** The icon of an activity row by its kind (contract: AdminReportActivity.kind). */
export const ACTIVITY_ICONS: Record<string, { icon: Icon; className: string }> = {
  firm_registered: { icon: UserPlus, className: 'text-success' },
  subscription_changed: { icon: ArrowCircleUp, className: 'text-success' },
  payment_failed: { icon: WarningCircle, className: 'text-danger' },
  user_added: { icon: Users, className: 'text-action' },
  ticket_opened: { icon: Headset, className: 'text-action' },
};
export function ActivityIcon({ kind }: { kind: string }) {
  const { icon: I, className } = ACTIVITY_ICONS[kind] ?? {
    icon: FileText,
    className: 'text-action',
  };
  return <I aria-hidden weight="fill" className={`size-5 ${className}`} />;
}

export function ActivityTable({
  rows,
  third,
}: {
  rows: AdminReportActivity[];
  third: { label: string; value: (a: AdminReportActivity) => string };
}) {
  if (!rows.length) return <QuietLine>No activity in this period.</QuietLine>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-table-head text-text">
          <tr>
            <th scope="col" className="w-8 px-2 py-2">
              <span className="sr-only">Kind</span>
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Date &amp; Time
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Activity
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {third.label}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((a, i) => (
            <tr key={`${a.at}-${i}`}>
              <td className="px-2 py-2.5">
                <ActivityIcon kind={a.kind} />
              </td>
              <td className="px-2 py-2.5 whitespace-nowrap text-text">{dateTimeText(a.at)}</td>
              <td className="px-2 py-2.5 text-text">{a.title}</td>
              <td className="px-2 py-2.5 text-text">{third.value(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsOverview() {
  const { range, keep } = useRange();
  const q = useApiQuery([...RP, 'overview', range], () => api.adminReports.overview(range ?? {}));
  const [growthMonths, setGrowthMonths] = useState<3 | 6>(6);
  const [revenueMonths, setRevenueMonths] = useState<3 | 6>(6);
  const loading = q.isPending;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader
        title="Reports & Analytics"
        subtitle="Insights and data to help you monitor growth, performance, and platform activity."
      />
      <ReportsTabs />

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map(({ key, ...k }) => (
          <Kpi key={key} kpi={q.data?.kpis[key]} {...k} loading={loading} />
        ))}
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel
          title="Firm Growth"
          testId="firm-growth"
          action={
            <PeriodSelect
              label="Firm Growth period"
              value={growthMonths}
              onChange={setGrowthMonths}
            />
          }
        >
          <Loaded query={q}>
            {(d) => (
              <MonthBars
                data={d.firmGrowth.slice(-growthMonths)}
                label="New firms by month"
                emptyText="No new firms in these months."
              />
            )}
          </Loaded>
        </Panel>
        <Panel
          title="Revenue Trend"
          testId="revenue-trend"
          action={
            <PeriodSelect
              label="Revenue Trend period"
              value={revenueMonths}
              onChange={setRevenueMonths}
            />
          }
        >
          <Loaded query={q}>
            {(d) => (
              <MonthLine
                data={d.revenueTrend.slice(-revenueMonths)}
                label="Payments received by month"
                format={moneyWhole}
                minTop={1_000_000}
                emptyText="No payments received in these months."
              />
            )}
          </Loaded>
        </Panel>

        <Panel title="Plan Distribution" testId="plan-distribution">
          <Loaded query={q}>
            {(d) => {
              const total = d.planDistribution.reduce((a, p) => a + p.firms, 0);
              return (
                <DonutChart
                  size="lg"
                  legend
                  showPercent
                  centerValue={count(total)}
                  centerLabel="Firms"
                  label="Active firms by plan"
                  emptyText="No active firms yet."
                  segments={d.planDistribution.map((p, i) => ({
                    label: p.planName,
                    value: p.firms,
                    tone: PLAN_TONES[i % PLAN_TONES.length]!,
                  }))}
                />
              );
            }}
          </Loaded>
        </Panel>
        <Panel title="Feature Usage" testId="feature-usage">
          <Loaded query={q}>
            {(d) => (
              <BarList
                label="Share of active firms using each feature"
                emptyText="Usage appears once the daily usage rollup has run."
                rows={d.featureUsage.map((f) => ({
                  key: f.feature,
                  label: f.label,
                  percent: f.percent,
                }))}
              />
            )}
          </Loaded>
        </Panel>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[3fr_2fr]">
        <Panel
          title="Recent Activity"
          testId="recent-activity"
          action={
            <Link
              href={keep('/reports/builder?type=ACTIVITY_LOG')}
              className="text-sm font-medium text-action"
            >
              View All
            </Link>
          }
        >
          <Loaded query={q}>
            {(d) => (
              <ActivityTable
                rows={d.recentActivity.slice(0, 5)}
                third={{ label: 'Details', value: (a) => a.detail ?? a.firm?.name ?? '—' }}
              />
            )}
          </Loaded>
        </Panel>
        <Panel
          title="Top Firms by Revenue"
          testId="top-firms"
          action={
            <Link
              href={keep('/reports/firms?sort=revenue&descending=true')}
              className="text-sm font-medium text-action"
            >
              View All
            </Link>
          }
        >
          <Loaded query={q}>
            {(d) =>
              d.topFirms.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-table-head text-text">
                      <tr>
                        <th scope="col" className="w-10 px-3 py-2 font-medium">
                          #
                        </th>
                        <th scope="col" className="px-3 py-2 font-medium">
                          Firm
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                          Revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {d.topFirms.map((f, i) => (
                        <tr key={f.id}>
                          <td className="px-3 py-2.5 text-text">{i + 1}</td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={keep(`/reports/firms/${f.id}`)}
                              className="text-text hover:text-action"
                            >
                              {f.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5 text-right text-text">
                            {moneyWhole(f.revenueCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <QuietLine>No payments received in this period.</QuietLine>
              )
            }
          </Loaded>
        </Panel>
      </div>
    </div>
  );
}
