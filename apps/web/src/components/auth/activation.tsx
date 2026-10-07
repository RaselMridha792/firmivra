'use client';

import { useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@firmivra/ui';
import { StaffAccess } from '../staff-access';

/** The invitation fragment never reaches Next.js, request logs or referrers. */
function tokenReader() {
  let token: string | null = null;
  return {
    read: () => token,
    subscribe: (notify: () => void) => {
      if (token === null) {
        const url = new URL(window.location.href);
        token = new URLSearchParams(url.hash.slice(1)).get('token') ?? '';
        url.hash = '';
        // Old query-token links are rejected and removed rather than forwarded to the API.
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
      }
      notify();
      return () => {};
    },
  };
}
export function Activation() {
  const [reader] = useState(tokenReader);
  const token = useSyncExternalStore(reader.subscribe, reader.read, () => null);
  if (token === null)
    return (
      <main className="mx-auto max-w-auth p-6">
        <Skeleton className="h-48" />
      </main>
    );
  return <StaffAccess site="firm" mode="activate" token={token || undefined} />;
}
