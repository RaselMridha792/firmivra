'use client';

import type { AgendaItem } from '@firmivra/types';
import { Toast } from '@firmivra/ui';
import { useCallback, useState, type ReactNode } from 'react';
import type { Notify } from './ap-actions';
import { useOptions } from './ap-data';
import {
  type AppointmentsView,
  KpiRow,
  type KpiFilter,
  OverviewHeader,
  ViewSwitch,
} from './ap-frame';
import { MiniMonth, QuickActions, TodaysAppointments } from './ap-rail';
import { todayIn } from './time';

/** Which of the page's appointments a KPI card keeps. */
export function applyKpiFilter(items: AgendaItem[], filter: KpiFilter): AgendaItem[] {
  const now = Date.now();
  switch (filter) {
    case 'upcoming':
      return items.filter(
        (i) =>
          i.status !== 'CANCELED' &&
          Date.parse(i.startsAt) > now &&
          Date.parse(i.startsAt) < now + 7 * 86_400_000,
      );
    case 'completed':
      return items.filter((i) => i.status === 'COMPLETED');
    case 'no_show':
      return items.filter((i) => i.status === 'NO_SHOW');
    case 'canceled':
      return items.filter((i) => i.status === 'CANCELED');
    default:
      return items;
  }
}

export interface OverviewState {
  timeZone: string;
  today: string;
  day: string;
  setDay: (date: string) => void;
  filter: KpiFilter;
  setFilter: (filter: KpiFilter) => void;
  notify: Notify;
}

/**
 * The Appointments overview every route shares: title, five cards, the Calendar / List / Today
 * switch, the page's own toolbar and list on the left, and the mini calendar, the day's schedule
 * and Quick Actions on the right. Every widget keeps its frame when its data is missing.
 */
export function Overview({
  view,
  toolbar,
  children,
}: {
  view: AppointmentsView;
  /** The row beside the view switch: search, filters, the date picker. */
  toolbar: (state: OverviewState) => ReactNode;
  children: (state: OverviewState) => ReactNode;
}) {
  const { timeZone } = useOptions();
  const [picked, setPicked] = useState<string>();
  const [filter, setFilter] = useState<KpiFilter>('all');
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notify = useCallback<Notify>((text, tone = 'success') => setMessage({ text, tone }), []);
  const today = todayIn(timeZone);
  const state: OverviewState = {
    timeZone,
    today,
    day: picked ?? today,
    setDay: setPicked,
    filter,
    setFilter,
    notify,
  };
  return (
    <div className="flex flex-col gap-5" data-testid={`appointments-${view}`}>
      <OverviewHeader />
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <KpiRow filter={filter} onFilter={setFilter} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitch active={view} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          {toolbar(state)}
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-5">{children(state)}</div>
        <aside aria-label="Calendar and shortcuts" className="flex flex-col gap-5">
          <MiniMonth day={state.day} today={state.today} onDay={setPicked} />
          <TodaysAppointments
            day={state.day}
            today={state.today}
            timeZone={timeZone}
            notify={notify}
          />
          <QuickActions notify={notify} />
        </aside>
      </div>
    </div>
  );
}
