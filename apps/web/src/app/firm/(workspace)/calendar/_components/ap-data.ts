'use client';

import type { AgendaEntry, AgendaItem, AgendaQuery } from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AP_AGENDA, AP_OPTIONS, AP_SUMMARY, FALLBACK_ZONE, isFull } from './ap-shared';

/** The form's dropdowns and the firm's zone; undefined while loading or when the API is unreachable. */
export function useOptions() {
  const query = useApiQuery(AP_OPTIONS, () => api.scheduling.options());
  return { query, options: query.data, timeZone: query.data?.timezone ?? FALLBACK_ZONE };
}

/** The five KPI numbers for a month (YYYY-MM; this month when left out). */
export function useSummary(month?: string) {
  return useApiQuery([...AP_SUMMARY, month ?? 'now'], () =>
    api.scheduling.summary(month ? { month } : {}),
  );
}

/** One source for Calendar, List, Today and Upcoming: the agenda between two instants. */
export function useAgenda(query: AgendaQuery) {
  const result = useApiQuery([...AP_AGENDA, query], () => api.scheduling.agenda(query));
  const entries: AgendaEntry[] = result.data?.items ?? [];
  return { query: result, entries, items: entries.filter(isFull) as AgendaItem[] };
}
