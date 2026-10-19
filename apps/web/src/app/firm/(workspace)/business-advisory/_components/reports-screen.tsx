'use client';

import type { AdvisoryReports } from '@firmivra/types';
import { Callout, DonutChart, Table, type Column, type DonutSegment } from '@firmivra/ui';
import {
  ArrowRight,
  Briefcase,
  CalendarDots,
  ChartLineUp,
  FileText,
  ListChecks,
  Lock,
  Target,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useMembers } from './ba-dialogs';
import { FilterSelect } from './ba-list-kit';
import { BaShell, Disclaimer } from './ba-shell';
import {
  BA_KEY,
  CLIENT_STATUS,
  GOAL_STATUS,
  PLAN_STATUS,
  REC_STATUS,
  SectionHead,
  card,
  money,
  quiet,
} from './ba-shared';

/** The ring colour of each status, matching its badge. */
const TONE: Record<string, DonutSegment['tone']> = {
  IN_PROGRESS: 'green',
  SCHEDULED: 'blue',
  NEEDS_REVIEW: 'yellow',
  ON_HOLD: 'grey',
  COMPLETED: 'purple',
  ARCHIVED: 'grey',
  DRAFT: 'grey',
  IN_REVIEW: 'yellow',
  FINALIZED: 'blue',
  SENT: 'purple',
  NOT_STARTED: 'grey',
  PLANNING: 'blue',
  ON_TRACK: 'green',
  AT_RISK: 'yellow',
  OVERDUE: 'red',
  CANCELLED: 'grey',
  PROPOSED: 'blue',
  ACCEPTED: 'purple',
  IMPLEMENTED: 'green',
  NOT_APPLICABLE: 'grey',
  DECLINED: 'red',
};

function StatusRing({
  icon,
  title,
  rows,
  labels,
  total,
  note,
  testId,
}: {
  icon: Icon;
  title: string;
  rows: { status: string; count: number }[] | undefined;
  labels: Record<string, string>;
  total: number | undefined;
  note?: string | undefined;
  testId: string;
}) {
  return (
    <section className={card} aria-label={title} data-testid={testId}>
      <SectionHead icon={icon} title={title} />
      <DonutChart
        segments={(rows ?? []).map((r) => ({
          label: labels[r.status] ?? r.status,
          value: r.count,
          tone: TONE[r.status] ?? 'grey',
        }))}
        centerValue={total ?? '—'}
        centerLabel="Total"
        legend
        size="sm"
        emptyText="Nothing to count yet"
      />
      {note ? <p className="mt-2 text-sm text-muted">{note}</p> : null}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-canvas px-4 py-3">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      <span className={`text-xl font-bold ${tone === 'bad' ? 'text-danger' : 'text-heading'}`}>
        {value}
      </span>
    </div>
  );
}

/** /business-advisory/reports: live counts across the program, by status, service and advisor. */
export function AdvisoryReportsView() {
  const members = useMembers();
  const [advisor, setAdvisor] = useState('');
  const q = useApiQuery([...BA_KEY, 'reports', advisor], () =>
    api.advisory.reports(advisor ? { advisorUserId: advisor } : {}),
  );
  const r = q.data;
  const n = (v: number | undefined) => (v === undefined ? '—' : String(v));

  const serviceCols: Column<AdvisoryReports['services'][number]>[] = [
    {
      id: 'name',
      label: 'Service',
      cell: (s) => <span className="font-semibold text-heading">{s.name}</span>,
    },
    { id: 'primary', label: 'Primary Focus', cell: (s) => s.primary },
    { id: 'additional', label: 'Additional', cell: (s) => s.additional },
    { id: 'progress', label: 'In Progress', cell: (s) => s.inProgress },
    { id: 'completed', label: 'Completed', cell: (s) => s.completed },
  ];
  const workloadCols: Column<AdvisoryReports['advisorWorkload'][number]>[] = [
    {
      id: 'advisor',
      label: 'Advisor',
      cell: (w) => (
        <span className="font-semibold text-heading">{w.advisor?.name ?? 'No advisor'}</span>
      ),
    },
    { id: 'clients', label: 'Clients', cell: (w) => w.clients },
    { id: 'plans', label: 'Active Plans', cell: (w) => w.activePlans },
    { id: 'goals', label: 'Open Goals', cell: (w) => w.openGoals },
    { id: 'tasks', label: 'Open Tasks', cell: (w) => w.openActionItems },
    { id: 'meetings', label: 'Meetings (30 days)', cell: (w) => w.upcomingMeetings },
  ];
  const trendCols: Column<NonNullable<AdvisoryReports['financialTrend']>[number]>[] = [
    {
      id: 'year',
      label: 'Year',
      cell: (y) => <span className="font-semibold text-heading">{y.year}</span>,
    },
    { id: 'clients', label: 'Clients with Figures', cell: (y) => y.clients },
    { id: 'revenue', label: 'Revenue', cell: (y) => money(y.revenueCents) },
    { id: 'expenses', label: 'Expenses', cell: (y) => money(y.expensesCents) },
    {
      id: 'profit',
      label: 'Net Profit',
      cell: (y) => (
        <span className={y.netProfitCents !== null && y.netProfitCents < 0 ? 'text-danger' : ''}>
          {money(y.netProfitCents)}
        </span>
      ),
    },
  ];

  return (
    <BaShell>
      <div className="flex flex-wrap items-center gap-3" data-testid="ba-reports">
        {members.length ? (
          <FilterSelect
            label="Advisor"
            all="All Advisors"
            value={advisor}
            onChange={setAdvisor}
            options={members}
            width="w-56"
          />
        ) : null}
        <span className="text-sm text-muted">
          {r
            ? `Live counts as of ${new Date(r.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
            : null}
        </span>
        <Link
          href="/reports"
          className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
        >
          Save and schedule reports in Reports{' '}
          <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      </div>
      {q.isError ? (
        <p role="alert" className={quiet} data-testid="ba-error">
          Advisory reports are not available right now. We could not load them. Try again in a
          moment.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StatusRing
          icon={UsersThree}
          title="Advisory Clients"
          rows={r?.clients.byStatus}
          labels={CLIENT_STATUS}
          total={r?.clients.total}
          testId="report-clients"
        />
        <StatusRing
          icon={FileText}
          title="Business Plans"
          rows={r?.plans.byStatus}
          labels={PLAN_STATUS}
          total={r?.plans.total}
          note={r ? `${r.plans.sentThisYear} sent to clients this year` : undefined}
          testId="report-plans"
        />
        <StatusRing
          icon={Target}
          title="Goals"
          rows={r?.goals.byStatus}
          labels={GOAL_STATUS}
          total={r?.goals.total}
          note={
            r?.goals.averageProgress != null
              ? `Open goals average ${r.goals.averageProgress}% progress`
              : undefined
          }
          testId="report-goals"
        />
        <StatusRing
          icon={Briefcase}
          title="Recommendations"
          rows={r?.recommendations.byStatus}
          labels={REC_STATUS}
          total={r?.recommendations.total}
          note={
            r?.recommendations.implementedImpactCents != null
              ? `Implemented: ${money(r.recommendations.implementedImpactCents)} estimated impact`
              : undefined
          }
          testId="report-recommendations"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Action items" data-testid="report-tasks">
          <SectionHead icon={ListChecks} title="Action Items & Tasks" />
          <div className="grid grid-cols-3 gap-3">
            <Figure label="Open" value={n(r?.actionItems.open)} />
            <Figure
              label="Overdue"
              value={n(r?.actionItems.overdue)}
              {...(r?.actionItems.overdue ? { tone: 'bad' as const } : {})}
            />
            <Figure label="Done (30 days)" value={n(r?.actionItems.doneLast30Days)} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-4 text-sm text-muted">
            {(r?.actionItems.byAssignee ?? []).map((a) => (
              <li key={a.kind}>
                Open for{' '}
                {a.kind === 'STAFF' ? 'staff' : a.kind === 'CLIENT' ? 'clients' : 'the team'}:{' '}
                <span className="font-semibold text-heading">{a.open}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Meetings" data-testid="report-meetings">
          <SectionHead icon={CalendarDots} title="Advisory Meetings" />
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Next 30 days" value={n(r?.meetings.upcoming30Days)} />
            <Figure label="Last 90 days" value={n(r?.meetings.past90Days)} />
          </div>
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section className={card} aria-label="Services" data-testid="report-services">
          <SectionHead
            icon={Briefcase}
            title="Services in Use"
            subtitle="From Services & Pricing, across advisory clients."
          />
          <Table
            rows={r?.services ?? []}
            columns={serviceCols}
            rowKey={(s) => s.serviceId}
            caption="Services in use"
            dense
            showPagination={false}
            noun="services"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Services are not available' : 'No services in use'}
            emptyText={
              q.isError ? 'We could not load them.' : 'Add an advisory client with a service.'
            }
          />
        </section>
        <section className={card} aria-label="Advisor workload" data-testid="report-workload">
          <SectionHead
            icon={UsersThree}
            title="Advisor Workload"
            subtitle="Clients, plans, goals, tasks and meetings per advisor."
          />
          <Table
            rows={r?.advisorWorkload ?? []}
            columns={workloadCols}
            rowKey={(w) => w.advisor?.userId ?? 'none'}
            caption="Advisor workload"
            dense
            showPagination={false}
            noun="advisors"
            pageSize={10}
            loading={q.isPending}
            emptyTitle={q.isError ? 'Workload is not available' : 'No advisory clients yet'}
            emptyText={
              q.isError ? 'We could not load it.' : 'Workload shows once clients have advisors.'
            }
          />
        </section>
      </div>

      <section className={card} aria-label="Financial trend" data-testid="report-trend">
        <SectionHead
          icon={ChartLineUp}
          title="Financial Trend"
          subtitle="The current figures of the last three full years, by period end."
        />
        {r && !r.canViewFinancials ? (
          <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
            Your role does not include &quot;View financial analysis&quot;.
          </Callout>
        ) : (
          <Table
            rows={r?.financialTrend ?? []}
            columns={trendCols}
            rowKey={(y) => String(y.year)}
            caption="Financial trend"
            dense
            showPagination={false}
            noun="years"
            pageSize={3}
            loading={q.isPending}
            emptyTitle={q.isError ? 'The trend is not available' : 'No figures yet'}
            emptyText={
              q.isError ? 'We could not load it.' : 'Add financial figures for advisory clients.'
            }
          />
        )}
      </section>
      {r ? <Disclaimer text={r.disclaimer} /> : null}
    </BaShell>
  );
}
