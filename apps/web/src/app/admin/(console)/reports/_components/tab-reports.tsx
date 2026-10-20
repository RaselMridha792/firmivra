'use client';

import type { AdminReportKpi } from '@firmivra/types';
import { ADMIN_REPORT_FEATURES, type AdminFeatureUsageQuery } from '@firmivra/types';
import { DonutChart, KpiCard, Select } from '@firmivra/ui';
import {
  ArrowCircleDown,
  ArrowCircleUp,
  ArrowCounterClockwise,
  CalendarCheck,
  ChartLineUp,
  CheckCircle,
  Clock,
  CurrencyDollar,
  Headset,
  HourglassMedium,
  UserPlus,
  UsersThree,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BarList, MonthBars, MonthLine, PeriodSelect } from './charts';
import { Kpi } from './overview';
import {
  COULD_NOT_LOAD,
  count,
  dateTimeText,
  Loaded,
  money,
  moneyWhole,
  NOT_AVAILABLE,
  Panel,
  QuietLine,
  ReportsHeader,
  ReportsTabs,
  RP,
  useRange,
} from './reports-common';

// The Revenue, Users, Feature Usage and Support tabs (docx §7 to §10; the design names the tabs
// only). Every figure is the API's: money from billing records, users from the platform and the
// daily rollup, usage from the rollup (empty until it runs), support from the tickets.

const SUBTITLE =
  'Insights and data to help you monitor growth, performance, and platform activity.';

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReportsHeader title="Reports & Analytics" subtitle={SUBTITLE} />
      <ReportsTabs />
      {children}
    </div>
  );
}

/** A plain figure card (a count with no earlier figure to compare with). */
function Figure({
  label,
  value,
  icon,
  tone = 'blue',
  note,
  loading,
}: {
  label: string;
  value: string | undefined;
  icon: typeof ChartLineUp;
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'purple';
  note?: string;
  loading: boolean;
}) {
  return (
    <KpiCard
      icon={icon}
      tone={tone}
      label={label}
      value={value ?? '—'}
      note={value === undefined && !loading ? COULD_NOT_LOAD : note}
      loading={loading}
    />
  );
}

/** A small table: the header row and one row per item, or the quiet empty line. */
function Rows<T>({
  rows,
  columns,
  empty,
  rowKey,
}: {
  rows: T[];
  columns: { label: string; cell: (r: T) => ReactNode; align?: 'right' }[];
  empty: string;
  rowKey: (r: T, i: number) => string;
}) {
  if (!rows.length) return <QuietLine>{empty}</QuietLine>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-table-head text-text">
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={`px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={`px-3 py-2.5 text-text ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const kpiOf = (value: number | undefined): AdminReportKpi | undefined =>
  value === undefined ? undefined : { value, previous: null };

// ---------- Revenue (docx §7) ----------

export function RevenueReport() {
  const { range, keep } = useRange();
  const q = useApiQuery([...RP, 'revenue', range], () => api.adminReports.revenue(range ?? {}));
  const [months, setMonths] = useState<3 | 6>(6);
  const d = q.data;
  const loading = q.isPending;
  return (
    <Page>
      <section aria-label="Revenue summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          kpi={d?.mrrCents}
          label="Monthly Recurring Revenue"
          icon={CurrencyDollar}
          tone="green"
          show={moneyWhole}
          loading={loading}
        />
        <Kpi
          kpi={d?.arrCents}
          label="Annual Recurring Revenue"
          icon={ChartLineUp}
          tone="green"
          show={moneyWhole}
          loading={loading}
        />
        <Kpi
          kpi={d?.collectedCents}
          label="Payments Received"
          icon={CheckCircle}
          tone="blue"
          show={moneyWhole}
          loading={loading}
        />
        <Kpi
          kpi={d?.refundedCents}
          label="Refunds"
          icon={ArrowCounterClockwise}
          tone="amber"
          show={moneyWhole}
          upIsGood={false}
          loading={loading}
        />
        <Kpi
          kpi={d?.failedPayments}
          label="Failed Payments"
          icon={WarningCircle}
          tone="red"
          show={count}
          upIsGood={false}
          loading={loading}
        />
        <Figure
          label="Overdue Balances"
          value={d ? money(d.overdueCents) : undefined}
          icon={HourglassMedium}
          tone="red"
          note="At the end of the period"
          loading={loading}
        />
        <Figure
          label="Upgrades"
          value={d ? count(d.upgrades) : undefined}
          icon={ArrowCircleUp}
          tone="green"
          note="In the period"
          loading={loading}
        />
        <Figure
          label="Downgrades & Cancellations"
          value={d ? `${count(d.downgrades)} · ${count(d.cancellations)}` : undefined}
          icon={ArrowCircleDown}
          tone="amber"
          note="Downgrades · cancellations in the period"
          loading={loading}
        />
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel
          title="Revenue Trend"
          testId="revenue-trend"
          action={<PeriodSelect label="Revenue Trend period" value={months} onChange={setMonths} />}
        >
          <Loaded query={q}>
            {(r) => (
              <MonthLine
                data={r.trend.slice(-months)}
                label="Payments received by month"
                format={moneyWhole}
                minTop={1_000_000}
                emptyText="No payments received in these months."
              />
            )}
          </Loaded>
        </Panel>
        <Panel title="Revenue by Plan" testId="revenue-by-plan">
          <Loaded query={q}>
            {(r) => (
              <Rows
                rows={r.byPlan}
                rowKey={(p) => p.planName}
                empty="No payments received in this period."
                columns={[
                  { label: 'Plan', cell: (p) => p.planName },
                  { label: 'Firms', cell: (p) => count(p.firms), align: 'right' },
                  { label: 'Revenue', cell: (p) => moneyWhole(p.revenueCents), align: 'right' },
                ]}
              />
            )}
          </Loaded>
        </Panel>
      </div>
      <Panel title="Revenue by Firm" testId="revenue-by-firm">
        <Loaded query={q}>
          {(r) => (
            <Rows
              rows={r.byFirm}
              rowKey={(f) => f.id}
              empty="No payments received in this period."
              columns={[
                { label: '#', cell: (f) => r.byFirm.indexOf(f) + 1 },
                {
                  label: 'Firm',
                  cell: (f) => (
                    <Link href={keep(`/reports/firms/${f.id}`)} className="hover:text-action">
                      {f.name}
                    </Link>
                  ),
                },
                { label: 'Revenue', cell: (f) => moneyWhole(f.revenueCents), align: 'right' },
              ]}
            />
          )}
        </Loaded>
      </Panel>
    </Page>
  );
}

// ---------- Users (docx §8) ----------

export function UsersReport() {
  const { range, keep } = useRange();
  const q = useApiQuery([...RP, 'users', range], () => api.adminReports.users(range ?? {}));
  const [months, setMonths] = useState<3 | 6>(6);
  const d = q.data;
  const loading = q.isPending;
  const inactive =
    d && d.totalUsers.value !== null && d.activeUsers.value !== null
      ? d.totalUsers.value - d.activeUsers.value
      : null;
  return (
    <Page>
      <section aria-label="Users summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          kpi={d?.totalUsers}
          label="Total Users"
          icon={UsersThree}
          tone="blue"
          show={count}
          loading={loading}
        />
        <Kpi
          kpi={d?.activeUsers}
          label="Active Users"
          icon={CheckCircle}
          tone="green"
          show={count}
          loading={loading}
        />
        <Kpi
          kpi={d ? { value: inactive, previous: null } : undefined}
          label="Inactive Users"
          icon={XCircle}
          tone="grey"
          show={count}
          loading={loading}
        />
        <Kpi
          kpi={d?.newUsers}
          label="New Users"
          icon={UserPlus}
          tone="purple"
          show={count}
          loading={loading}
        />
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel
          title="User Growth"
          testId="user-growth"
          action={<PeriodSelect label="User Growth period" value={months} onChange={setMonths} />}
        >
          <Loaded query={q}>
            {(r) => (
              <MonthBars
                data={r.signups.slice(-months)}
                label="New users by month"
                emptyText="No new users in these months."
              />
            )}
          </Loaded>
        </Panel>
        <Panel title="Users by Role" testId="users-by-role">
          <Loaded query={q}>
            {(r) => (
              <DonutChart
                size="lg"
                legend
                showPercent
                label="Users by role"
                centerLabel="Users"
                emptyText="No users yet."
                segments={r.byPool.map((p) => ({
                  label: p.pool === 'STAFF' ? 'Firm staff' : 'Client logins',
                  value: p.users,
                  tone: p.pool === 'STAFF' ? 'blue' : 'green',
                }))}
              />
            )}
          </Loaded>
        </Panel>
      </div>
      <Panel title="Users by Firm" testId="users-by-firm">
        <Loaded query={q}>
          {(r) => (
            <Rows
              rows={r.byFirm}
              rowKey={(f) => f.id}
              empty="Users by firm, active users and last logins appear once the daily usage rollup has run."
              columns={[
                {
                  label: 'Firm',
                  cell: (f) => (
                    <Link href={keep(`/reports/firms/${f.id}/users`)} className="hover:text-action">
                      {f.name}
                    </Link>
                  ),
                },
                { label: 'Total Users', cell: (f) => count(f.totalUsers), align: 'right' },
                { label: 'Active Users', cell: (f) => count(f.activeUsers), align: 'right' },
                {
                  label: 'Last Login',
                  cell: (f) => (f.lastLoginAt ? dateTimeText(f.lastLoginAt) : '—'),
                },
              ]}
            />
          )}
        </Loaded>
      </Panel>
    </Page>
  );
}

// ---------- Feature Usage (docx §9) ----------

export function FeatureUsageReport() {
  const { range } = useRange();
  const [feature, setFeature] = useState('');
  const [plan, setPlan] = useState('');
  const query: AdminFeatureUsageQuery = {
    ...range,
    ...(feature ? { feature } : {}),
    ...(plan ? { planCode: plan } : {}),
  };
  const q = useApiQuery([...RP, 'feature-usage', query], () =>
    api.adminReports.featureUsage(query),
  );
  const catalog = useApiQuery([...RP, 'fields', 'FIRMS'], () => api.adminReports.fields('FIRMS'));
  const plans = catalog.data?.filters.find((f) => f.key === 'plan')?.options ?? [];
  return (
    <Page>
      <div className="grid gap-3 sm:grid-cols-2 lg:w-2/3">
        <Select
          label="Feature"
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          options={[
            { value: '', label: 'All Features' },
            ...Object.entries(ADMIN_REPORT_FEATURES).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          label="Plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          options={[{ value: '', label: 'All Plans' }, ...plans]}
        />
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel title="Usage Percentage" testId="usage-percent">
          <Loaded query={q}>
            {(r) => (
              <BarList
                label="Share of active firms using each feature"
                emptyText="Usage appears once the daily usage rollup has run."
                rows={r.rows.map((f) => ({
                  key: f.feature,
                  label: f.label,
                  percent: r.hasData ? f.percent : null,
                }))}
              />
            )}
          </Loaded>
        </Panel>
        <Panel title="Usage Volume" testId="usage-volume">
          <Loaded query={q}>
            {(r) =>
              r.hasData ? (
                <Rows
                  rows={[...r.rows].sort((a, b) => b.events - a.events)}
                  rowKey={(f) => f.feature}
                  empty="No usage in this period."
                  columns={[
                    { label: 'Feature', cell: (f) => f.label },
                    { label: 'Uses', cell: (f) => count(f.events), align: 'right' },
                    { label: 'Firms', cell: (f) => count(f.firms), align: 'right' },
                    {
                      label: 'Share of Firms',
                      cell: (f) => (f.percent === null ? '—' : `${Math.round(f.percent)}%`),
                      align: 'right',
                    },
                  ]}
                />
              ) : (
                <QuietLine>Usage appears once the daily usage rollup has run.</QuietLine>
              )
            }
          </Loaded>
        </Panel>
      </div>
    </Page>
  );
}

// ---------- Support (docx §10) ----------

const PRIORITY_TONES = ['red', 'yellow', 'blue', 'grey', 'purple'] as const;

export function SupportReport() {
  const { range, keep } = useRange();
  const q = useApiQuery([...RP, 'support', range], () => api.adminReports.support(range ?? {}));
  const [months, setMonths] = useState<3 | 6>(6);
  const d = q.data;
  const loading = q.isPending;
  return (
    <Page>
      <section aria-label="Support summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          kpi={d?.total}
          label="Total Tickets"
          icon={Headset}
          tone="blue"
          show={count}
          upIsGood={false}
          loading={loading}
        />
        <Kpi
          kpi={kpiOf(d?.open)}
          label="Open Tickets"
          icon={WarningCircle}
          tone="red"
          show={count}
          loading={loading}
        />
        <Kpi
          kpi={kpiOf(d?.inProgress)}
          label="In Progress"
          icon={HourglassMedium}
          tone="amber"
          show={count}
          loading={loading}
        />
        <Kpi
          kpi={d?.closed}
          label="Closed Tickets"
          icon={CheckCircle}
          tone="green"
          show={count}
          loading={loading}
        />
        <Figure
          label="Average First Response"
          value={
            d
              ? d.avgFirstResponseMinutes === null
                ? NOT_AVAILABLE
                : `${Math.round(d.avgFirstResponseMinutes)} min`
              : undefined
          }
          icon={Clock}
          note="Tickets answered in the period"
          loading={loading}
        />
        <Figure
          label="Average Resolution"
          value={
            d
              ? d.avgResolutionHours === null
                ? NOT_AVAILABLE
                : `${Math.round(d.avgResolutionHours * 10) / 10} h`
              : undefined
          }
          icon={CalendarCheck}
          note="Tickets resolved in the period"
          loading={loading}
        />
      </section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <Panel
          title="Ticket Volume"
          testId="ticket-volume"
          action={<PeriodSelect label="Ticket Volume period" value={months} onChange={setMonths} />}
        >
          <Loaded query={q}>
            {(r) => (
              <MonthBars
                data={r.volume.slice(-months)}
                label="Tickets opened by month"
                emptyText="No tickets in these months."
              />
            )}
          </Loaded>
        </Panel>
        <Panel title="Tickets by Priority" testId="tickets-by-priority">
          <Loaded query={q}>
            {(r) => (
              <DonutChart
                size="lg"
                legend
                showPercent
                label="Tickets by priority"
                centerLabel="Tickets"
                emptyText="No tickets in this period."
                segments={r.byPriority.map((p, i) => ({
                  label: p.priority,
                  value: p.tickets,
                  tone: PRIORITY_TONES[i % PRIORITY_TONES.length]!,
                }))}
              />
            )}
          </Loaded>
        </Panel>
      </div>
      <Panel
        title="Tickets by Firm"
        testId="tickets-by-firm"
        action={
          <Link href="/support" className="text-sm font-medium text-action">
            Open Support
          </Link>
        }
      >
        <Loaded query={q}>
          {(r) => (
            <Rows
              rows={r.byFirm}
              rowKey={(f) => f.id}
              empty="No tickets in this period."
              columns={[
                {
                  label: 'Firm',
                  cell: (f) => (
                    <Link
                      href={keep(`/reports/firms/${f.id}/support`)}
                      className="hover:text-action"
                    >
                      {f.name}
                    </Link>
                  ),
                },
                { label: 'Tickets', cell: (f) => count(f.tickets), align: 'right' },
              ]}
            />
          )}
        </Loaded>
      </Panel>
    </Page>
  );
}
