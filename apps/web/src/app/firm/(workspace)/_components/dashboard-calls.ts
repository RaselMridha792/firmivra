import type { DashboardSummaryQuery } from '@firmivra/types';
import { api } from '../../../../lib/api';
import { startEarly, takeEarly } from '../../../../lib/early';
import { type DashboardPlace, placeFrom } from './dashboard-place';

// Dashboard Review Two V8: the calls the dashboard's widgets wait for. When the dashboard is the
// page opened, the workspace starts them as its code loads, side by side with the user and the
// firm (layout.tsx); the screen then takes them instead of calling again (lib/early.ts).

/** The summary's query for the dashboard's three periods. */
export function summaryQueryOf(place: DashboardPlace): DashboardSummaryQuery {
  const { period, pipeline, revenue } = place;
  return {
    period: period.period,
    from: period.from,
    to: period.to,
    pipelinePeriod: pipeline.period,
    pipelineFrom: pipeline.from,
    pipelineTo: pipeline.to,
    revenuePeriod: revenue.period,
    revenueFrom: revenue.from,
    revenueTo: revenue.to,
  };
}

/** Upcoming Appointments asks for the next 15 days (cut at the firm's midnight once known). */
export function upcomingWindow(at: number): { from: string; to: string } {
  return { from: new Date(at).toISOString(), to: new Date(at + 15 * 86_400_000).toISOString() };
}

const summaryKey = (query: DashboardSummaryQuery) => `dashboard:summary:${JSON.stringify(query)}`;

/** Each widget's call: the one started early when there is one, else a new one. */
export const dashboardCalls = {
  summary: (query: DashboardSummaryQuery) =>
    takeEarly(summaryKey(query), () => api.dashboard.summary(query)),
  availability: () => takeEarly('dashboard:availability', () => api.availability.get()),
  inbox: () => takeEarly('dashboard:messages', () => api.messages.inbox({ limit: 5 })),
  upcoming: (window: { from: string; to: string }) =>
    takeEarly('dashboard:upcoming', () => api.appointments.list(window)),
};

/** The dashboard is the page being opened, at this address's `search`: its calls start now. */
export function startDashboardCalls(search: string): void {
  const params = new URLSearchParams(search);
  const query = summaryQueryOf(placeFrom((key) => params.get(key) ?? undefined));
  startEarly(summaryKey(query), () => api.dashboard.summary(query));
  startEarly('dashboard:availability', () => api.availability.get());
  startEarly('dashboard:messages', () => api.messages.inbox({ limit: 5 }));
  const window = upcomingWindow(Date.now());
  startEarly('dashboard:upcoming', () => api.appointments.list(window));
}
