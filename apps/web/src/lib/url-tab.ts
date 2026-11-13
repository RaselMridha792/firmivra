'use client';

import { useState } from 'react';

// A service workspace's selected tab lives in its address (`?tab=`), so a refresh keeps it and a
// link out of it (SH1's origin) comes Back to the same tab. Octavia's Review 2: Payroll UX01
// (Reports after refresh), F05 (Back from Messages to Communications) and Bookkeeping N08 (Back
// from Terms to Reconciliation).

/** `href` with `tab` set to `tab`, keeping its other parameters and hash. */
export function withTab(href: string, tab: string): string {
  const url = new URL(href, 'http://x');
  url.searchParams.set('tab', tab);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The workspace's tab, starting from `initial` (read from `?tab=` by the caller). Choosing another
 * replaces the address's `tab` in place: no new history entry, and Next's router stays in step.
 */
export function useUrlTab<T extends string>(initial: T, inUrl: (tab: T) => string = (t) => t) {
  const [tab, setTab] = useState<T>(initial);
  const select = (next: T) => {
    setTab(next);
    const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', withTab(here, inUrl(next)));
  };
  return [tab, select] as const;
}
