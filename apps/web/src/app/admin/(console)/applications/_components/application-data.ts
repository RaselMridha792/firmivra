import type { ListFirmApplicationsQuery } from '@firmivra/types';

/** Shared React Query keys; mutations invalidate every applications list, count and detail. */
export const APPLICATIONS_KEY = ['firm-applications'] as const;

export const applicationListKey = (query: ListFirmApplicationsQuery) =>
  [...APPLICATIONS_KEY, 'list', query] as const;

export const applicationCountsKey = [...APPLICATIONS_KEY, 'counts'] as const;

export const applicationDetailKey = (id: string) => [...APPLICATIONS_KEY, 'detail', id] as const;
