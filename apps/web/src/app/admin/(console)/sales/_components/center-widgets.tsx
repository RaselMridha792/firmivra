'use client';

import { Badge, DonutChart, type ChartTone } from '@firmivra/ui';
import {
  CalendarDots,
  CaretRight,
  ChartBar,
  ChartLineUp,
  DownloadSimple,
  FileText,
  Lightning,
  Play,
  Target,
  TrendUp,
  UserPlus,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ComponentProps } from 'react';
import {
  adminSales,
  appointmentTypeLabel,
  PERIOD_LABELS,
  type ActivityKind,
  type LeadSource,
  type RevenueSlice,
  type SalesActivity,
  type SalesPeriod,
} from '../../../../../mocks/admin-sales';
import { useApiQuery } from '../../../../../lib/query';
import {
  Bar,
  BarRow,
  CompactSelect,
  dateText,
  FrameState,
  money,
  moneyExact,
  Panel,
  SALES_KEY,
  STAGE_STYLE,
  timeText,
  ViewAll,
} from './sales-ui';

/* Sales Pipeline (the stage bars) ------------------------------------------------------------- */

export function CenterPipelineCard({ period }: { period: SalesPeriod }) {
  const counts = useApiQuery([...SALES_KEY, 'stage-counts', period, 'default'], () =>
    adminSales.stageCounts(period),
  );
  return (
    <Panel
      icon={TrendUp}
      title="Sales Pipeline"
      testId="center-pipeline"
      action={<ViewAll href="/sales/pipeline" label="pipeline" />}
    >
      <FrameState query={counts} empty="No stages yet." lines={7}>
        {(stages) => {
          const max = Math.max(0, ...stages.map((stage) => stage.count));
          return (
            <ul aria-label="Records per stage" className="flex flex-col gap-1.5">
              {stages.map((stage) => (
                <li key={stage.stageId}>
                  <BarRow
                    label={stage.name}
                    value={stage.count}
                    max={max}
                    fillClass={STAGE_STYLE[stage.tone].bar}
                    labelClass="w-36"
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </FrameState>
    </Panel>
  );
}

/* Revenue by Plan ----------------------------------------------------------------------------- */

const SLICE_TONES: Record<RevenueSlice['id'], { chart: ChartTone; dot: string }> = {
  SOLO: { chart: 'blue', dot: 'bg-chart-blue' },
  TEAM_PRO: { chart: 'navy', dot: 'bg-heading' },
  BUSINESS: { chart: 'purple', dot: 'bg-purple' },
  ENTERPRISE: { chart: 'yellow', dot: 'bg-chart-yellow' },
  ADD_ONS: { chart: 'green', dot: 'bg-chart-green' },
};
const REVENUE_PERIODS: SalesPeriod[] = ['THIS_MONTH', 'LAST_30_DAYS', 'THIS_QUARTER', 'THIS_YEAR'];

export function RevenueByPlanCard() {
  const [period, setPeriod] = useState<SalesPeriod>('THIS_MONTH');
  const revenue = useApiQuery([...SALES_KEY, 'revenue', period], () =>
    adminSales.revenueByPlan(period),
  );
  return (
    <Panel
      icon={ChartBar}
      title="Revenue by Plan"
      testId="revenue-by-plan"
      action={
        <CompactSelect
          label="Revenue period"
          value={period}
          options={REVENUE_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
          onChange={setPeriod}
          className="w-36"
        />
      }
    >
      <FrameState query={revenue} empty="No sales in this period." isEmpty={() => false} lines={5}>
        {(data) => (
          <div className="flex flex-wrap items-center gap-5">
            <DonutChart
              size="lg"
              legend={false}
              segments={data.slices.map((slice) => ({
                label: slice.label,
                value: slice.cents,
                tone: SLICE_TONES[slice.id].chart,
              }))}
              centerValue={
                <span className="text-xl leading-tight tabular-nums">{money(data.totalCents)}</span>
              }
              centerLabel="Total Sales"
              label={`Monthly revenue of clients won, ${PERIOD_LABELS[period].toLowerCase()}: ${money(data.totalCents)}`}
              emptyText="No sales in this period."
            />
            <ul aria-label="Revenue by plan" className="flex min-w-48 flex-1 flex-col gap-3">
              {data.slices.map((slice) => (
                <li key={slice.id} className="flex items-center gap-3 text-sm text-text">
                  <span
                    aria-hidden
                    className={`size-3 shrink-0 rounded-sm ${SLICE_TONES[slice.id].dot}`}
                  />
                  <span className="min-w-0 flex-1">{slice.label}</span>
                  <span className="w-10 text-right tabular-nums">
                    {data.totalCents ? Math.round((slice.cents / data.totalCents) * 100) : 0}%
                  </span>
                  <span className="w-16 text-right font-medium text-heading tabular-nums">
                    {money(slice.cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </FrameState>
    </Panel>
  );
}

/* Quick Actions ------------------------------------------------------------------------------- */

export type QuickAction = 'ADD' | 'TRIAL' | 'ASSIGN' | 'DEMO' | 'PROPOSAL' | 'EXPORT';

const QUICK: { id: QuickAction | 'PIPELINE'; label: string; icon: Icon; tone: string }[] = [
  { id: 'ADD', label: 'Add New Lead', icon: UserPlus, tone: 'bg-info-soft text-action' },
  { id: 'TRIAL', label: 'Start 14-Day Trial', icon: Play, tone: 'bg-success-soft text-success' },
  { id: 'ASSIGN', label: 'Assign Sales Rep', icon: Users, tone: 'bg-success-soft text-success' },
  { id: 'DEMO', label: 'Schedule a Demo', icon: CalendarDots, tone: 'bg-purple-soft text-purple' },
  {
    id: 'PROPOSAL',
    label: 'Create Offer / Proposal',
    icon: FileText,
    tone: 'bg-danger-soft text-danger',
  },
  {
    id: 'PIPELINE',
    label: 'View Full Pipeline',
    icon: ChartLineUp,
    tone: 'bg-info-soft text-action',
  },
  {
    id: 'EXPORT',
    label: 'Export Sales Report',
    icon: DownloadSimple,
    tone: 'bg-success-soft text-success',
  },
];

export function QuickActionsCard({ onAction }: { onAction: (action: QuickAction) => void }) {
  const row =
    'flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';
  return (
    <Panel icon={Lightning} iconClassName="text-gold" title="Quick Actions" testId="quick-actions">
      <ul className="flex flex-col gap-2">
        {QUICK.map(({ id, label, icon: Glyph, tone }) => {
          const content = (
            <>
              <Glyph aria-hidden weight="fill" className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">{label}</span>
              <CaretRight aria-hidden weight="bold" className="size-3.5 shrink-0" />
            </>
          );
          return (
            <li key={id}>
              {id === 'PIPELINE' ? (
                <Link href="/sales/pipeline" className={`${row} ${tone}`}>
                  {content}
                </Link>
              ) : (
                <button type="button" onClick={() => onAction(id)} className={`${row} ${tone}`}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* Recent Sales Activity ----------------------------------------------------------------------- */

type BadgeTone = NonNullable<ComponentProps<typeof Badge>['tone']>;
const SALES_STATUS: Partial<Record<ActivityKind, { label: string; tone: BadgeTone }>> = {
  CREATED: { label: 'New Lead', tone: 'info' },
  APPOINTMENT_SCHEDULED: { label: 'Scheduled', tone: 'info' },
  TRIAL_STARTED: { label: 'Trial', tone: 'warning' },
  PROPOSAL_SENT: { label: 'Proposal', tone: 'purple' },
  WON: { label: 'Won', tone: 'success' },
  LOST: { label: 'Lost', tone: 'danger' },
};
function activityLabel(entry: SalesActivity) {
  switch (entry.kind) {
    case 'CREATED':
      return 'New Lead';
    case 'APPOINTMENT_SCHEDULED':
      return `${entry.detail ?? 'Meeting'} Scheduled`;
    case 'TRIAL_STARTED':
      return '14-Day Trial';
    case 'PROPOSAL_SENT':
      return 'Proposal Sent';
    case 'WON':
      return 'Won Deal';
    case 'LOST':
      return 'Lost Deal';
    default:
      return entry.text;
  }
}

const th = 'px-2 py-2 text-left font-medium whitespace-nowrap first:rounded-l-md last:rounded-r-md';
const td = 'px-2 py-2 align-top';

export function RecentSalesActivityCard({ onViewAll }: { onViewAll: () => void }) {
  const feed = useApiQuery([...SALES_KEY, 'activity', 'sales', 'all', 'recent'], () =>
    adminSales.activity({ kinds: 'sales', limit: 5 }),
  );
  return (
    <Panel
      icon={FileText}
      title="Recent Sales Activity"
      testId="recent-sales-activity"
      action={<ViewAll onClick={onViewAll} label="sales activity" />}
    >
      <FrameState query={feed} empty="No sales activity yet." lines={5}>
        {(entries) => (
          <div className="overflow-x-auto">
            <table className="w-full min-w-sm text-xs text-text 2xl:text-sm">
              <caption className="sr-only">The latest sales activity</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th scope="col" className={th}>
                    Date
                  </th>
                  <th scope="col" className={th}>
                    Firm Name
                  </th>
                  <th scope="col" className={th}>
                    Activity
                  </th>
                  <th scope="col" className={th}>
                    Value
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const status = SALES_STATUS[entry.kind];
                  return (
                    <tr key={entry.id} className="border-b border-divider last:border-0">
                      <td className={`${td} whitespace-nowrap`}>
                        <time dateTime={entry.at}>{dateText(entry.at)}</time>
                      </td>
                      <td className={td}>
                        <Link
                          href={`/sales/opportunities/${entry.opportunityId}`}
                          className="hover:text-action hover:underline"
                        >
                          {entry.firmName}
                        </Link>
                      </td>
                      <td className={td}>{activityLabel(entry)}</td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>
                        {entry.valueCents === null ? '–' : moneyExact(entry.valueCents)}
                      </td>
                      <td className={td}>
                        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </FrameState>
    </Panel>
  );
}

/* Upcoming Follow-ups ------------------------------------------------------------------------- */

export function UpcomingFollowUpsCard({ onViewAll }: { onViewAll: () => void }) {
  const list = useApiQuery([...SALES_KEY, 'appointments', 'all', 'upcoming'], () =>
    adminSales.appointments({ limit: 5 }),
  );
  return (
    <Panel
      icon={CalendarDots}
      title="Upcoming Follow-ups"
      testId="upcoming-follow-ups"
      action={<ViewAll onClick={onViewAll} label="follow-ups" />}
    >
      <FrameState query={list} empty="Nothing is booked yet." lines={5}>
        {(items) => (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-text 2xl:text-sm">
              <caption className="sr-only">The next appointments and follow-ups</caption>
              <thead className="bg-table-head text-heading">
                <tr>
                  <th scope="col" className={th}>
                    Date &amp; Time
                  </th>
                  <th scope="col" className={th}>
                    Firm / Contact
                  </th>
                  <th scope="col" className={th}>
                    Type
                  </th>
                  <th scope="col" className={th}>
                    Assigned To
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-divider last:border-0">
                    <td className={td}>
                      {/* The time sits under the date, so the four columns fit the card. */}
                      <time dateTime={item.startsAt} className="flex flex-col">
                        <span className="whitespace-nowrap">{dateText(item.startsAt)}</span>{' '}
                        <span className="whitespace-nowrap">{timeText(item.startsAt)}</span>
                      </time>
                    </td>
                    <td className={td}>
                      <Link
                        href={`/sales/opportunities/${item.opportunityId}`}
                        className="hover:text-action hover:underline"
                      >
                        {item.firmName}
                      </Link>
                    </td>
                    <td className={td}>{appointmentTypeLabel(item.type)}</td>
                    <td className={td}>{item.assignedName ?? 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FrameState>
    </Panel>
  );
}

/* Lead Sources -------------------------------------------------------------------------------- */

const SOURCE_COLOURS: Record<LeadSource, { dot: string; fill: string }> = {
  WEBSITE: { dot: 'bg-action', fill: 'fill-action' },
  REFERRAL: { dot: 'bg-chart-green', fill: 'fill-chart-green' },
  SOCIAL_MEDIA: { dot: 'bg-purple', fill: 'fill-purple' },
  PAID_ADVERTISING: { dot: 'bg-orange', fill: 'fill-orange' },
  ORGANIC_SEARCH: { dot: 'bg-sky', fill: 'fill-sky' },
  EVENT: { dot: 'bg-chart-red', fill: 'fill-chart-red' },
  PARTNER: { dot: 'bg-accent', fill: 'fill-accent' },
  MANUAL_ENTRY: { dot: 'bg-gold', fill: 'fill-gold' },
  OTHER: { dot: 'bg-chart-grey', fill: 'fill-chart-grey' },
};

export function LeadSourcesCard({ period }: { period: SalesPeriod }) {
  const sources = useApiQuery([...SALES_KEY, 'lead-sources', period], () =>
    adminSales.leadSources(period),
  );
  return (
    <Panel icon={Target} title="Lead Sources" testId="lead-sources">
      <FrameState query={sources} empty="No new leads in this period." lines={6}>
        {(shares) => (
          <ul aria-label="New leads by source" className="flex flex-col gap-2.5">
            {shares.map((share) => (
              <li key={share.source} className="flex items-center gap-3 text-sm text-text">
                <span
                  aria-hidden
                  className={`size-3 shrink-0 rounded-full ${SOURCE_COLOURS[share.source].dot}`}
                />
                <span className="w-28 shrink-0 truncate">{share.label}</span>
                <span className="min-w-0 flex-1">
                  <Bar
                    value={share.percent}
                    max={100}
                    fillClass={SOURCE_COLOURS[share.source].fill}
                    className="h-2.5"
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums">
                  {share.percent}%<span className="sr-only"> ({share.count} leads)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </FrameState>
    </Panel>
  );
}
