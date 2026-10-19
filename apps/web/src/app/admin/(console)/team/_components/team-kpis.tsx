'use client';

import { ArrowUp, CheckCircle, User, Users, UsersThree, type Icon } from '@phosphor-icons/react';
import { Card, Skeleton } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TeamSummary } from '../../../../../mocks/admin-team';
import { percent } from './team-parts';

/** The design's KPI card: a soft square tile, the number, its label and a line under it. */
function Kpi({
  icon: Glyph,
  tone,
  value,
  label,
  detail,
  testId,
}: {
  icon: Icon;
  tone: 'blue' | 'green';
  value: ReactNode;
  label: string;
  detail: ReactNode;
  testId: string;
}) {
  return (
    <Card variant="elevated" data-testid={testId} className="flex min-w-0 items-center gap-4 !p-4">
      <span
        className={`flex size-16 shrink-0 items-center justify-center rounded-xl ${tone === 'green' ? 'bg-success-soft text-success' : 'bg-info-soft text-action'}`}
      >
        <Glyph aria-hidden weight="fill" className="size-8" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span
          data-testid={`${testId}-value`}
          className="text-2xl leading-tight font-bold text-heading"
        >
          {value}
        </span>
        <span className="text-base text-heading">{label}</span>
        <span className="text-sm text-muted">{detail}</span>
      </div>
    </Card>
  );
}

/** Team Members, Admin Users, Standard Users and Active Users, from the members themselves. */
export function TeamKpis({ summary }: { summary: UseQueryResult<TeamSummary> }) {
  const data = summary.data;
  const failed = summary.isError && !data;
  const value = (show: (data: TeamSummary) => ReactNode) =>
    data ? show(data) : failed ? '—' : <Skeleton className="my-1 h-6 w-12" />;
  const detail = (show: (data: TeamSummary) => ReactNode) =>
    data ? show(data) : failed ? 'Not available' : <Skeleton className="mt-1 h-3 w-20" />;
  const share = (count: number, total: number) => (
    <span className="flex flex-col">
      <span className="text-lg leading-tight font-bold text-heading">{percent(count, total)}</span>
      <span className="text-xs">of team</span>
    </span>
  );
  return (
    <section aria-label="Team totals" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        testId="kpi-members"
        icon={UsersThree}
        tone="blue"
        value={value((d) => d.total)}
        label="Team Members"
        detail={detail((d) => (
          <span className="flex flex-col">
            {d.addedLastMonth > 0 ? (
              <span className="flex items-center gap-1 text-base font-bold text-success">
                <ArrowUp aria-hidden weight="bold" className="size-4" />
                {d.addedLastMonth}
                <span className="sr-only"> added</span>
              </span>
            ) : (
              <span className="text-base font-bold text-muted">No change</span>
            )}
            <span className="text-xs">vs. last month</span>
          </span>
        ))}
      />
      <Kpi
        testId="kpi-admins"
        icon={User}
        tone="blue"
        value={value((d) => d.admins)}
        label="Admin Users"
        detail={detail((d) => share(d.admins, d.total))}
      />
      <Kpi
        testId="kpi-standard"
        icon={Users}
        tone="blue"
        value={value((d) => d.standard)}
        label="Standard Users"
        detail={detail((d) => share(d.standard, d.total))}
      />
      <Kpi
        testId="kpi-active"
        icon={CheckCircle}
        tone="green"
        value={value((d) => percent(d.active, d.total))}
        label="Active Users"
        detail={detail((d) => `${d.inactive} inactive`)}
      />
    </section>
  );
}
