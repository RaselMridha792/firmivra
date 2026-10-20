'use client';

import type { AdvisoryFinancialPage, AdvisoryMeetingRow } from '@firmivra/types';
import { Badge, Callout, Checkbox, Table, type Column } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarDots,
  ChartBar,
  ChartLineUp,
  ClockCounterClockwise,
  FileText,
  Lock,
  MapPin,
  Plus,
  VideoCamera,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { RecommendationsSection } from './action-plans-screen';
import { useAct } from './ba-list-kit';
import {
  BASE,
  BA_KEY,
  SOURCE,
  SectionHead,
  card,
  dayText,
  money,
  outlined,
  primary,
  quiet,
} from './ba-shared';
import { HealthFactors } from './client-overview';
import { ClientShell, useAdvisoryClient } from './client-shell';
import { AddFiguresDialog, BudgetCell } from './financials-screen';

// R1's three client-detail tabs (Rasel, Oct 20): Financials, Recommendations and Meetings, from
// the Advisory developer guide's Frame 3 table (docs/mockups/firm-workspace/business-advisory/
// source). The Financials tab is R0's (commit 2199adde), moved here when the tabs were split.

// ---------- Financials ----------

type Fin = AdvisoryFinancialPage['items'][number];

/** Revenue and expenses by period, oldest first, as bars on one scale. */
function TrendBars({ rows }: { rows: Fin[] }) {
  const current = [...rows].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const max = Math.max(1, ...current.flatMap((r) => [r.revenueCents ?? 0, r.expensesCents ?? 0]));
  const bar = (v: number | null, tone: string, label: string) => (
    <span className="flex items-center gap-2">
      <span
        className="h-3 rounded-pill"
        style={{ width: `${Math.max(1, ((v ?? 0) / max) * 100)}%` }}
      >
        <span className={`block h-full rounded-pill ${tone}`} aria-hidden />
      </span>
      <span className="text-xs whitespace-nowrap text-muted">
        {label} {money(v)}
      </span>
    </span>
  );
  return (
    <ul className="flex flex-col gap-3" data-testid="trend-bars">
      {current.map((r) => (
        <li key={r.id} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm">
          <span className="font-semibold text-heading">{r.periodEnd.slice(0, 4)}</span>
          <span className="flex min-w-0 flex-col gap-1">
            {bar(r.revenueCents, 'bg-chart-blue', 'Revenue')}
            {bar(r.expensesCents, 'bg-chart-yellow', 'Expenses')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** /business-advisory/clients/[clientId]/financials: the trend, every period's figures and the health score. */
export function ClientFinancialsTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const { toast, say } = useAct();
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useApiQuery(
    [...BA_KEY, 'client-financials', advisoryClientId, history, c?.canViewFinancials],
    () =>
      c?.canViewFinancials
        ? api.advisory.financials({
            advisoryClientId,
            pageSize: 50,
            ...(history ? { includeSuperseded: true } : {}),
          })
        : Promise.resolve(null),
  );
  const rows = q.data?.items ?? [];
  const stale = rows.some((r) => r.stale);
  const restricted = c ? !c.canViewFinancials : false;
  const failed = client.isError || q.isError;
  const cols: Column<Fin>[] = [
    {
      id: 'period',
      label: 'Period',
      className: 'whitespace-nowrap',
      cell: (r) => `${dayText(r.periodStart)} – ${dayText(r.periodEnd)}`,
    },
    {
      id: 'rev',
      label: 'Revenue',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.revenueCents),
    },
    {
      id: 'exp',
      label: 'Expenses',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.expensesCents),
    },
    {
      id: 'net',
      label: 'Net Profit',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.netProfitCents),
    },
    {
      id: 'margin',
      label: 'Margin',
      cell: (r) => (r.marginPercent === null ? '—' : `${r.marginPercent}%`),
    },
    {
      id: 'cash',
      label: 'Cash Flow',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.cashFlowCents),
    },
    { id: 'debt', label: 'Debt', className: 'whitespace-nowrap', cell: (r) => money(r.debtCents) },
    {
      id: 'budget',
      label: 'Budget vs Actual',
      className: 'whitespace-nowrap',
      cell: (r) => <BudgetCell r={r} />,
    },
    {
      id: 'source',
      label: 'Source',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone="info">{SOURCE[r.source] ?? r.source}</Badge>
          {r.overridden ? <Badge tone="warning">Overridden</Badge> : null}
        </span>
      ),
    },
    {
      id: 'asof',
      label: 'As of',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          {dayText(r.asOf)}
          {r.stale ? <Badge tone="danger">Stale</Badge> : null}
        </span>
      ),
    },
  ];
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      {restricted ? (
        <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
          Your role does not include &quot;View financial analysis&quot;. The health score below
          still shows its factors.
        </Callout>
      ) : null}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Financial trend" data-testid="tab-trend">
          <SectionHead
            icon={ChartLineUp}
            title="Financial Trend"
            subtitle="Revenue and expenses by period, from the current figures."
          />
          {rows.length && !history ? (
            <TrendBars rows={rows} />
          ) : (
            <p className={quiet}>
              {failed
                ? 'The trend is not available right now.'
                : restricted
                  ? 'Restricted.'
                  : history
                    ? 'Hide corrections to see the trend.'
                    : q.isPending && c
                      ? 'Loading…'
                      : 'No figures yet.'}
            </p>
          )}
        </section>
        <section className={card} aria-label="Business health score" data-testid="tab-health">
          <SectionHead
            icon={ChartBar}
            title="Business Health Score"
            subtitle="Worked out from the firm's formula; its factors and data age."
          />
          {c ? (
            <HealthFactors client={c} />
          ) : (
            <p className={quiet}>{failed ? 'Not available right now.' : 'Loading…'}</p>
          )}
        </section>
      </div>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Financial figures"
        data-testid="tab-figures"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={FileText}
            title="Financial Figures"
            subtitle="Each period with its source and date; a correction keeps the earlier row."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label="Show corrections"
              checked={history}
              disabled={restricted}
              onChange={(e) => setHistory(e.target.checked)}
            />
            <button
              type="button"
              className={primary}
              disabled={restricted || failed}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add Figures
            </button>
          </div>
        </div>
        {stale ? (
          <Callout
            icon={Warning}
            title="Some figures are out of date"
            surface="warning"
            size="compact"
          >
            Review them and add current figures before the plan is finalized.
          </Callout>
        ) : null}
        <Table
          rows={rows}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Financial figures"
          dense
          noun="periods"
          pageSize={50}
          showPagination={false}
          loading={Boolean(c?.canViewFinancials) && q.isPending}
          emptyTitle={
            failed
              ? 'Figures are not available'
              : restricted
                ? 'Figures are restricted'
                : 'No figures yet'
          }
          emptyText={
            failed
              ? 'We could not load them.'
              : restricted
                ? 'Your role cannot view them.'
                : 'Add figures, or connect bookkeeping, payroll or a bank.'
          }
        />
        <Link
          href={`${BASE}/financial-analysis`}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-link hover:underline"
        >
          Compare with other clients in Financial Analysis{' '}
          <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      </section>
      {adding ? (
        <AddFiguresDialog
          advisoryClientId={advisoryClientId}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            say('Figures added.');
          }}
        />
      ) : null}
    </ClientShell>
  );
}

// ---------- Recommendations ----------

/**
 * /business-advisory/clients/[clientId]/recommendations: the module's recommendation list for this
 * client (rationale, potential impact, status Proposed to Declined, client visibility), with Add.
 */
export function ClientRecommendationsTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <RecommendationsSection advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}

// ---------- Meetings ----------

const PAGE = 10;

const monthOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short' });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Where it happens: the virtual link or the place, as the overview's Upcoming Meeting card shows it. */
function Place({ m }: { m: AdvisoryMeetingRow }) {
  return m.joinUrl ? (
    <span className="flex items-center gap-1 text-link">
      <VideoCamera aria-hidden weight="fill" className="size-4" /> Virtual Meeting
    </span>
  ) : (
    <span className="flex items-center gap-1 text-muted">
      <MapPin aria-hidden weight="fill" className="size-4" /> {m.location ?? 'In person'}
    </span>
  );
}

/** One upcoming meeting: the date block, type, day, time, place, advisor, and Join or Open and Reschedule. */
function UpcomingMeeting({ m }: { m: AdvisoryMeetingRow }) {
  const title = m.meetingType ?? 'Advisory meeting';
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-divider p-3 md:flex-row md:items-center">
      <span className="flex w-20 shrink-0 flex-col items-center rounded-lg border border-divider py-2 text-heading">
        <span className="text-xs font-semibold uppercase">{monthOf(m.startsAt)}</span>
        <span className="text-3xl leading-none font-bold">{new Date(m.startsAt).getDate()}</span>
        <span className="text-xs">{new Date(m.startsAt).getFullYear()}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-sm">
        <span className="font-semibold text-heading">{title}</span>
        <span>{longDay(m.startsAt)}</span>
        <span>
          {timeOf(m.startsAt)} – {timeOf(m.endsAt)}
        </span>
        <Place m={m} />
        {m.advisor ? <span className="text-muted">With {m.advisor.name}</span> : null}
      </span>
      <span className="grid shrink-0 grid-cols-2 gap-2">
        {m.joinUrl ? (
          <a
            href={m.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={primary}
            aria-label={`Join the meeting: ${title}`}
          >
            Join Meeting
          </a>
        ) : (
          <Link
            href={`/calendar/${m.appointmentId}`}
            className={primary}
            aria-label={`Open the meeting: ${title}`}
          >
            Open Meeting
          </Link>
        )}
        <Link
          href={`/calendar/${m.appointmentId}/edit`}
          className={outlined}
          aria-label={`Reschedule: ${title}`}
        >
          Reschedule
        </Link>
      </span>
    </li>
  );
}

/**
 * /business-advisory/clients/[clientId]/meetings: the client's upcoming and past advisory meetings.
 * Meetings are appointments tagged Business Advisory (the contract): Schedule Meeting, Open and
 * Reschedule go to Appointments, so this tab only lists them.
 */
export function ClientMeetingsTab({ advisoryClientId }: { advisoryClientId: string }) {
  const [page, setPage] = useState(1);
  const upcoming = useApiQuery([...BA_KEY, 'client-meetings', advisoryClientId, 'upcoming'], () =>
    api.advisory.meetings({ advisoryClientId, when: 'upcoming', pageSize: PAGE }),
  );
  const past = useApiQuery([...BA_KEY, 'client-meetings', advisoryClientId, 'past', page], () =>
    api.advisory.meetings({ advisoryClientId, when: 'past', page, pageSize: PAGE }),
  );
  const next = upcoming.data?.items ?? [];
  const cols: Column<AdvisoryMeetingRow>[] = [
    {
      id: 'date',
      label: 'Date',
      className: 'whitespace-nowrap',
      cell: (m) => dayText(m.startsAt.slice(0, 10)),
    },
    {
      id: 'time',
      label: 'Time',
      className: 'whitespace-nowrap',
      cell: (m) => `${timeOf(m.startsAt)} – ${timeOf(m.endsAt)}`,
    },
    {
      id: 'type',
      label: 'Meeting',
      cell: (m) => (
        <Link href={`/calendar/${m.appointmentId}`} className="text-link hover:underline">
          {m.meetingType ?? 'Advisory meeting'}
        </Link>
      ),
    },
    { id: 'advisor', label: 'Advisor', cell: (m) => m.advisor?.name ?? '—' },
    { id: 'place', label: 'Where', cell: (m) => <Place m={m} /> },
  ];
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Upcoming meetings"
        data-testid="tab-upcoming-meetings"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={CalendarDots}
            title="Upcoming Meetings"
            subtitle="Advisory meetings booked in Appointments."
          />
          <Link href="/calendar/new" className={primary}>
            <Plus aria-hidden weight="bold" className="size-4" /> Schedule Meeting
          </Link>
        </div>
        {next.length ? (
          <ul className="flex flex-col gap-3">
            {next.map((m) => (
              <UpcomingMeeting key={m.appointmentId} m={m} />
            ))}
          </ul>
        ) : (
          <p className={quiet}>
            {upcoming.isError
              ? 'Meetings are not available right now.'
              : upcoming.isPending
                ? 'Loading…'
                : 'No upcoming meetings.'}
          </p>
        )}
      </section>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Past meetings"
        data-testid="tab-past-meetings"
      >
        <SectionHead
          icon={ClockCounterClockwise}
          title="Past Meetings"
          subtitle="Earlier advisory meetings; open one in Appointments for its details."
        />
        <Table
          rows={past.data?.items ?? []}
          columns={cols}
          rowKey={(m) => m.appointmentId}
          caption="Past meetings"
          dense
          noun="meetings"
          pageSize={PAGE}
          showPagination={false}
          loading={past.isPending}
          emptyTitle={past.isError ? 'Meetings are not available' : 'No past meetings'}
          emptyText={
            past.isError ? 'We could not load them.' : 'Meetings appear here after they take place.'
          }
        />
        {past.data && past.data.total > PAGE ? (
          <div className="flex items-center justify-end gap-2 text-sm">
            <button
              type="button"
              className={outlined}
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span className="text-muted">
              Page {page} of {Math.ceil(past.data.total / PAGE)}
            </span>
            <button
              type="button"
              className={outlined}
              disabled={page >= Math.ceil(past.data.total / PAGE)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </ClientShell>
  );
}
