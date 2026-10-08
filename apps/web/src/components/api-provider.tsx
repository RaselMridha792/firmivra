'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { shouldRetry } from '../lib/query';

/**
 * The data cache for useApiQuery and useApiMutation. One per page load, in the root layout:
 * each site is its own host, so admin, firm and portal never share a cache. Nothing is
 * stored in localStorage or cookies.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
