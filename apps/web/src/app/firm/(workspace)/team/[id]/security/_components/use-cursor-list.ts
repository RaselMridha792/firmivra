'use client';

import type { QueryKey } from '@tanstack/react-query';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * A list read page by page (Login History, Activity & Audit): the first page as a query, then
 * Load more appends the next page from its cursor.
 */
export function useCursorList<T>(key: QueryKey, fetchPage: (cursor?: string) => Promise<Page<T>>) {
  const first = useApiQuery(key, () => fetchPage());
  const [more, setMore] = useState<{ items: T[]; next: string | null } | null>(null);
  const load = useApiMutation((cursor: string) => fetchPage(cursor));
  const next = more ? more.next : (first.data?.nextCursor ?? null);
  return {
    items: [...(first.data?.items ?? []), ...(more?.items ?? [])],
    pending: first.isPending,
    failed: first.isError,
    hasMore: next !== null,
    loadingMore: load.isPending,
    moreError: load.error,
    loadMore: () => {
      if (!next) return;
      load.mutate(next, {
        onSuccess: (page) =>
          setMore((m) => ({ items: [...(m?.items ?? []), ...page.items], next: page.nextCursor })),
      });
    },
  };
}
