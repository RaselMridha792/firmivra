'use client';

import { useEffect, useRef } from 'react';

/** Session storage can be missing or refuse (private windows): the list then simply starts fresh. */
const session = {
  get: (key: string) => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string | null) => {
    try {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      // Nothing to keep then.
    }
  },
};

/** When the browser last went Back or Forward (the list restores its scroll after it loads). */
let poppedAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    poppedAt = Date.now();
  });
}

/**
 * A list that keeps its place (Leads R2 1, as Clients' E7): its filters, page and size live in its
 * address (replaceState, so no reload and no extra history entry); that address is remembered
 * under `key` for the record page's Back link; and the scroll position comes back once the list
 * has loaded, after Back in the browser or the page's own Back link.
 */
export function useListReturn(key: string, url: string, loaded: boolean) {
  useEffect(() => {
    // A null state lets Next keep its router in step with the address.
    window.history.replaceState(null, '', url);
    session.set(key, url);
  }, [key, url]);
  useEffect(() => {
    // Kept when a link is followed (a record, a row action), before the next page resets it.
    const save = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a[href]')) {
        session.set(`${key}:scroll`, String(Math.round(window.scrollY)));
      }
    };
    document.addEventListener('click', save, true);
    return () => document.removeEventListener('click', save, true);
  }, [key]);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!loaded || restoredRef.current) return;
    restoredRef.current = true;
    const returning = session.get(`${key}:returning`) === '1' || Date.now() - poppedAt < 5_000;
    session.set(`${key}:returning`, null);
    if (!returning) return;
    const y = Number(session.get(`${key}:scroll`));
    if (y > 0) window.scrollTo(0, y);
  }, [key, loaded]);
}

/**
 * The record page's Back: the list as it was left (its remembered address), scrolling back once
 * it loads. Falls back to `home` when there is none.
 */
export function listReturnHref(key: string, home: string): string {
  const last = typeof window === 'undefined' ? null : session.get(key);
  return last && last.startsWith(home) ? last : home;
}
export function markReturning(key: string) {
  session.set(`${key}:returning`, '1');
}
