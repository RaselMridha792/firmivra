'use client';

import type { PlanningClientRow, TopOpportunityRow } from '@firmivra/types';
import { Avatar, KpiCard, Table, type Column } from '@firmivra/ui';
import {
  ArrowRight,
  BookOpen,
  CalendarBlank,
  Calculator,
  CurrencyDollar,
  FileText,
  Lightbulb,
  PaperPlaneTilt,
  UsersThree,
  Target,
  ChartBar,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer, TpShell } from './tp-shell';
import {
  CATEGORY_LABEL,
  PlanPill,
  TP_KEY,
  card,
  dateTimeText,
  dayText,
  linkBtn,
  money,
  outlined,
  primary,
  quiet,
} from './tp-shared';
import type { KpiTrend } from '@firmivra/ui';

const trend = (k: {
  deltaPercent: number | null;
  comparedTo: string | null;
}): { trend?: KpiTrend; note?: string } =>
  k.deltaPercent === null
    ? {}
    : {
        trend: {
          text: `${Math.abs(k.deltaPercent)}%`,
          direction: k.deltaPercent === 0 ? 'flat' : k.deltaPercent > 0 ? 'up' : 'down',
          good: k.deltaPercent >= 0,
        },
        ...(k.comparedTo ? { note: k.comparedTo } : {}),
      };

/** /tax-planning: the overview: KPIs, quick actions, recent planning clients, top opportunities, deadlines and resources. */
export function PlanningOverview() {
  const q = useApiQuery([...TP_KEY, 'overview'], () => api.taxPlanning.overview());
  const o = q.data;

  const clientCols: Column<PlanningClientRow>[] = [
    {
      id: 'name',
      label: 'Client Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Avatar name={r.client.name} size="md" />
          <Link
            href={
              r.planId
                ? `/tax-planning/plans/${r.planId}/edit`
                : `/tax-planning/plans/new?clientId=${r.client.id}`
            }
            data-testid="client-link"
            className="font-semibold text-link hover:underline"
          >
            {r.client.name}
          </Link>
        </span>
      ),
    },
    { id: 'type', label: 'Client Type', cell: (r) => r.entityLabel ?? '—' },
    {
      id: 'next',
      label: 'Next Appointment',
      cell: (r) => (r.nextAppointmentAt ? dateTimeText(r.nextAppointmentAt) : '—'),
    },
    { id: 'status', label: 'Status', cell: (r) => <PlanPill status={r.status} /> },
    {
      id: 'savings',
      label: 'Potential Savings',
      cell: (r) =>
        r.potentialSavingsCents === null ? '—' : `${money(r.potentialSavingsCents)} (est.)`,
    },
  ];
  const topCols: Column<TopOpportunityRow>[] = [
    {
      id: 'name',
      label: 'Opportunity',
      cell: (r) => <span className="font-medium text-heading">{r.name}</span>,
    },
    { id: 'clients', label: 'Clients', cell: (r) => r.clientCount },
    {
      id: 'sav',
      label: 'Est. Tax Savings',
      cell: (r) => (r.estimatedSavingsCents === null ? 'N/A' : money(r.estimatedSavingsCents)),
    },
    {
      id: 'act',
      label: 'Action',
      cell: (r) => (
        <Link
          href={`/tax-planning/opportunities/${r.firstOpportunityId}`}
          className="inline-flex min-h-9 items-center rounded-control border border-action px-3 text-sm font-medium text-action hover:bg-accent-soft"
        >
          Review
        </Link>
      ),
    },
  ];
  const kpis = o
    ? [
        {
          icon: UsersThree,
          tone: 'blue' as const,
          label: 'Active Planning Clients',
          k: o.activePlanningClients,
          text: String(o.activePlanningClients.value),
        },
        {
          icon: CalendarBlank,
          tone: 'amber' as const,
          label: 'Upcoming Planning Appointments',
          k: o.upcomingAppointments,
          text: String(o.upcomingAppointments.value),
        },
        {
          icon: FileText,
          tone: 'purple' as const,
          label: 'Strategies In Progress',
          k: o.strategiesInProgress,
          text: String(o.strategiesInProgress.value),
        },
        {
          icon: CurrencyDollar,
          tone: 'green' as const,
          label: 'Projected Tax Savings',
          k: o.projectedSavings,
          text: money(o.projectedSavings.value),
        },
      ]
    : [];

  return (
    <TpShell>
      {q.isError ? (
        <p role="alert" className={quiet} data-testid="tp-error">
          Tax planning is not available right now. We could not load it. Try again in a moment.
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="tp-kpis">
        {(kpis.length
          ? kpis
          : [0, 1, 2, 3].map((i) => ({
              icon: ChartBar,
              tone: 'blue' as const,
              label: 'Loading',
              k: null,
              text: '—',
              i,
            }))
        ).map((x, i) => (
          <li key={x.label + i}>
            <KpiCard
              icon={x.icon}
              tone={x.tone}
              value={x.text}
              label={x.label}
              loading={q.isPending}
              {...(x.k ? trend(x.k) : {})}
            />
          </li>
        ))}
      </ul>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section
          className={`${card} flex flex-wrap items-center gap-4`}
          aria-label="Plan today for tomorrow"
          data-testid="hero"
        >
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info"
          >
            <Lightbulb weight="fill" className="size-8" />
          </span>
          <div className="min-w-48 flex-1">
            <h2 className="font-display text-xl font-bold text-heading">
              Turn Today&apos;s Decisions Into Tomorrow&apos;s Opportunities
            </h2>
            <p className="text-sm text-muted">
              Help your clients minimize taxes, build wealth, and achieve their personal and
              business goals with proactive tax planning.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-56">
            <Link
              href="/tax-planning/plans/new"
              aria-disabled={o ? !o.canCreatePlan : false}
              className={`${primary} ${o && !o.canCreatePlan ? 'pointer-events-none opacity-50' : ''}`}
            >
              <FileText aria-hidden weight="fill" className="size-4" /> Create Planning Plan
            </Link>
            <Link href="/calendar" className={outlined}>
              <CalendarBlank aria-hidden weight="fill" className="size-4" /> Schedule a Planning
              Consultation
            </Link>
          </div>
        </section>
        <section className={card} aria-label="Quick actions" data-testid="quick-actions">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Create Planning Plan', icon: FileText, href: '/tax-planning/plans/new' },
              { label: 'Schedule Appointment', icon: CalendarBlank, href: '/calendar' },
              {
                label: 'Tax Savings Calculator',
                icon: Calculator,
                href: '/tax-planning/calculator',
              },
              {
                label: 'Send Client Resource',
                icon: PaperPlaneTilt,
                href: '/tax-planning/resources',
              },
            ].map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className="flex min-h-11 items-center gap-2 rounded-control border border-action px-3 text-sm font-medium text-heading hover:bg-accent-soft"
              >
                <a.icon aria-hidden weight="fill" className="size-5 shrink-0 text-action" />{' '}
                {a.label}
              </Link>
            ))}
          </div>
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className={card} aria-label="Recent planning clients" data-testid="recent-clients">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-heading">
                Recent Planning Clients
              </h2>
              <p className="text-xs text-muted">
                Clients currently in tax planning or with upcoming planning needs.
              </p>
            </div>
            <Link href="/tax-planning/clients" className={linkBtn}>
              View All <ArrowRight aria-hidden weight="bold" className="size-3" />
            </Link>
          </div>
          <div className="relative">
            <Table
              rows={o?.recentClients ?? []}
              columns={clientCols}
              rowKey={(r) => r.client.id}
              caption="Recent planning clients"
              dense
              noun="clients"
              pageSize={5}
              showPagination={false}
              loading={q.isPending}
              emptyTitle="No planning clients yet"
              emptyText="Create a planning plan to start."
            />
          </div>
        </section>
        <section
          className={card}
          aria-label="Top planning opportunities"
          data-testid="top-opportunities"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-heading">
                Top Planning Opportunities
              </h2>
              <p className="text-xs text-muted">
                Found by screening your clients&apos; data. Review each before you recommend it.
              </p>
            </div>
            <Link href="/tax-planning/opportunities" className={linkBtn}>
              View All <ArrowRight aria-hidden weight="bold" className="size-3" />
            </Link>
          </div>
          <div className="relative">
            <Table
              rows={o?.topOpportunities ?? []}
              columns={topCols}
              rowKey={(r) => r.firstOpportunityId}
              caption="Top planning opportunities"
              dense
              noun="opportunities"
              pageSize={5}
              showPagination={false}
              loading={q.isPending}
              emptyTitle="No opportunities yet"
              emptyText="Screening finds them when your clients have data."
            />
          </div>
        </section>
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Upcoming tax deadlines" data-testid="deadlines">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-heading">
                Upcoming Tax Deadlines
              </h2>
              <p className="text-xs text-muted">Key dates for tax planning and strategy.</p>
            </div>
            <Link href="/tax-planning/calendar" className={linkBtn}>
              View All <ArrowRight aria-hidden weight="bold" className="size-3" />
            </Link>
          </div>
          {o && o.deadlines.length === 0 ? (
            <p className={quiet}>No deadlines in the next months.</p>
          ) : null}
          <ul>
            {(o?.deadlines ?? []).map((d) => (
              <li
                key={d.id}
                className="grid grid-cols-[6.5rem_1fr] gap-3 border-t border-divider py-2 text-sm first:border-t-0 sm:grid-cols-[6.5rem_1fr_1fr]"
              >
                <span className="text-muted">{dayText(d.date)}</span>
                <span className="font-medium text-heading">{d.title}</span>
                <span className="col-span-2 text-xs text-muted sm:col-span-1 sm:text-sm">
                  {d.description ?? d.scope}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className={card} aria-label="Planning resources" data-testid="resources">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-heading">
                <BookOpen aria-hidden weight="fill" className="size-5 text-action" /> Planning
                Resources
              </h2>
              <p className="text-xs text-muted">Tools and resources for you and your clients.</p>
            </div>
            <Link href="/tax-planning/resources" className={linkBtn}>
              View All <ArrowRight aria-hidden weight="bold" className="size-3" />
            </Link>
          </div>
          {o && o.resources.length === 0 ? <p className={quiet}>No resources yet.</p> : null}
          <ul>
            {(o?.resources ?? []).map((r) => (
              <li key={r.key}>
                <Link
                  href="/tax-planning/resources"
                  className="flex items-center gap-3 border-t border-divider py-2 text-sm font-medium text-heading first:border-t-0 hover:text-action"
                >
                  <Target aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
                  {r.title}{' '}
                  <span className="text-xs font-normal text-muted">
                    ({CATEGORY_LABEL[r.category.toUpperCase()] ?? r.category})
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {o ? <Disclaimer text={o.disclaimer} /> : null}
    </TpShell>
  );
}
