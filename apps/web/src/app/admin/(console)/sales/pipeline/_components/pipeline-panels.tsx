'use client';

import type { DateRange } from '@firmivra/ui';
import { CalendarDots, ChartBar, Clock } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useApiQuery } from '../../../../../../lib/query';
import { ActivityLine } from '../../_components/feed-drawers';
import {
  adminSales,
  appointmentTypeLabel,
  PERIOD_LABELS,
  type PeriodInput,
  type SalesPeriod,
} from '../../_components/sales-api';
import {
  BarRow,
  CompactSelect,
  dateText,
  FrameState,
  Panel,
  SALES_KEY,
  STAGE_STYLE,
  timeText,
  ViewAll,
} from '../../_components/sales-ui';

/** Recent Activity (docx §19): who did what, newest first; each line opens its record. */
export function RecentActivityPanel({
  pipelineId,
  onViewAll,
}: {
  pipelineId?: string;
  onViewAll: () => void;
}) {
  const feed = useApiQuery(
    [...SALES_KEY, 'activity', 'all', pipelineId ?? 'default', 'recent'],
    () => adminSales.activity({ kinds: 'all', pipelineId, limit: 5 }),
  );
  return (
    <Panel
      icon={Clock}
      title="Recent Activity"
      testId="recent-activity"
      action={<ViewAll onClick={onViewAll} label="activity" />}
    >
      <FrameState query={feed} empty="No activity yet." lines={5}>
        {(entries) => (
          <ul aria-label="Recent activity">
            {entries.map((entry) => (
              <ActivityLine key={entry.id} entry={entry} compact />
            ))}
          </ul>
        )}
      </FrameState>
    </Panel>
  );
}

/** Upcoming Appointments (docx §20): date, time, firm and type; each row opens the record. */
export function UpcomingAppointmentsPanel({
  pipelineId,
  onViewAll,
}: {
  pipelineId?: string;
  onViewAll: () => void;
}) {
  const list = useApiQuery(
    [...SALES_KEY, 'appointments', pipelineId ?? 'default', 'upcoming'],
    () => adminSales.appointments({ pipelineId, limit: 5 }),
  );
  return (
    <Panel
      icon={CalendarDots}
      title="Upcoming Appointments"
      testId="upcoming-appointments"
      action={<ViewAll onClick={onViewAll} label="appointments" />}
    >
      <FrameState query={list} empty="Nothing is booked yet." lines={5}>
        {(items) => (
          <ul aria-label="Upcoming appointments">
            {items.map((item) => (
              <li key={item.id} className="border-b border-divider last:border-0">
                {/* Date, time, firm and type on one line, as in the design. */}
                <Link
                  href={`/sales/opportunities/${item.opportunityId}`}
                  className="grid grid-cols-[auto_auto_minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-x-3 py-2.5 text-xs text-text hover:text-action"
                >
                  <time dateTime={item.startsAt} className="contents">
                    <span className="whitespace-nowrap">{dateText(item.startsAt)}</span>
                    <span className="whitespace-nowrap">{timeText(item.startsAt)}</span>
                  </time>
                  <span title={item.firmName} className="min-w-0 truncate">
                    {item.firmName}
                  </span>
                  <span
                    title={appointmentTypeLabel(item.type)}
                    className="min-w-0 truncate text-muted"
                  >
                    {appointmentTypeLabel(item.type)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </FrameState>
    </Panel>
  );
}

type AnalyticsPeriod = SalesPeriod | 'CUSTOM';
const ANALYTICS_PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'THIS_MONTH', label: PERIOD_LABELS.THIS_MONTH },
  { value: 'LAST_30_DAYS', label: PERIOD_LABELS.LAST_30_DAYS },
  { value: 'THIS_QUARTER', label: PERIOD_LABELS.THIS_QUARTER },
  { value: 'THIS_YEAR', label: PERIOD_LABELS.THIS_YEAR },
  { value: 'CUSTOM', label: 'Custom (filter dates)' },
];

/**
 * Pipeline Analytics (docx §21): the same stages as the board, Unqualified / Lost included,
 * counted with the board's date rule. A stage row filters the board to that stage.
 */
export function PipelineAnalyticsPanel({
  pipelineId,
  range,
  onStage,
}: {
  pipelineId?: string;
  /** The filter bar's dates, used by Custom. */
  range: DateRange;
  onStage: (stageId: string) => void;
}) {
  const [period, setPeriod] = useState<AnalyticsPeriod>('THIS_MONTH');
  const input: PeriodInput =
    period === 'CUSTOM'
      ? { from: range.from || '1970-01-01', to: range.to || '2999-12-31' }
      : period;
  const counts = useApiQuery([...SALES_KEY, 'stage-counts', input, pipelineId ?? 'default'], () =>
    adminSales.stageCounts(input, pipelineId),
  );
  return (
    <Panel
      icon={ChartBar}
      title="Pipeline Analytics"
      testId="pipeline-analytics"
      action={
        <CompactSelect
          label="Analytics period"
          value={period}
          options={ANALYTICS_PERIODS}
          onChange={setPeriod}
          className="w-32"
        />
      }
    >
      <FrameState query={counts} empty="No stages yet." lines={8}>
        {(stages) => {
          const max = Math.max(0, ...stages.map((stage) => stage.count));
          return (
            <ul aria-label="Records per stage" className="flex flex-col gap-0.5">
              {stages.map((stage) => (
                <li key={stage.stageId}>
                  <BarRow
                    label={stage.name}
                    value={stage.count}
                    max={max}
                    fillClass={STAGE_STYLE[stage.tone].bar}
                    onClick={() => onStage(stage.stageId)}
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
