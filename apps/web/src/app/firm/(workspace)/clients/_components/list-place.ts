'use client';

import { useEffect, useRef } from 'react';
import {
  type ClientsPlace,
  clientsPlaceQuery,
  LAST_CLIENTS_LIST,
} from '../../../../../lib/clients-place';
import { FROM_DASHBOARD } from '../../../../../lib/from-dashboard';

const SCROLL = 'firmivra:clients:scroll';
/** Set by Return to Clients just before it opens the list, so the list scrolls back too. */
export const RETURNING = 'firmivra:clients:returning';

/** Session storage can be missing or refuse (private windows): the list then simply starts fresh. */
export const session = {
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

/**
 * Octavia's E7: keeps the list's place in its address (replaceState, so no reload and no extra
 * history entry), remembers that address for Return to Clients, and keeps the scroll position.
 * Back restores the list from the address (the browser and Next keep its scroll); Return to
 * Clients opens the remembered address and scrolls back once the list has loaded. A plain visit to
 * /clients, or Reset, starts fresh.
 */
export function useListPlace(place: ClientsPlace, fromDashboard: boolean, loaded: boolean) {
  const query = [clientsPlaceQuery(place), fromDashboard ? FROM_DASHBOARD : '']
    .filter(Boolean)
    .join('&');
  const url = `/clients${query ? `?${query}` : ''}`;
  useEffect(() => {
    // Next's own history state is kept, so Back and Forward still work.
    window.history.replaceState(window.history.state, '', url);
    session.set(LAST_CLIENTS_LIST, url);
  }, [url]);
  useEffect(() => {
    // Kept when a link is followed (a client's page, a row action), before the page changes and
    // the next page's scroll resets it.
    const save = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest('a[href]')) {
        session.set(SCROLL, String(Math.round(window.scrollY)));
      }
    };
    document.addEventListener('click', save, true);
    return () => document.removeEventListener('click', save, true);
  }, []);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!loaded || restoredRef.current) return;
    restoredRef.current = true;
    if (session.get(RETURNING) !== '1') return;
    session.set(RETURNING, null);
    const y = Number(session.get(SCROLL));
    if (y > 0) window.scrollTo(0, y);
  }, [loaded]);
}
