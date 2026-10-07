import type { QueryClient } from '@tanstack/react-query';

/**
 * The signed-in site's session, set by <SignedIn>: how to refresh it and where to sign in.
 * Public pages have none, so their 401s stay plain errors.
 */
interface Session {
  refresh: () => Promise<unknown>;
  signInPath: string;
}

let session: Session | null = null;
let refreshing: Promise<boolean> | null = null;

export function setSession(value: Session | null): void {
  session = value;
}

/**
 * Refreshes the session once; every 401 that arrives meanwhile waits for the same refresh.
 * <SignedIn> passes its site's refresh before the session is set.
 */
export function refreshSession(refresh = session?.refresh): Promise<boolean> {
  if (!refresh) return Promise.resolve(false);
  refreshing ??= refresh()
    .then(
      () => true,
      () => false,
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * fetch for the API clients (lib/api.ts): on a 401, refresh the session once and send the request
 * again; if it's still 401, the session is over and the browser opens the site's sign-in page.
 */
export const sessionFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401 || !session) return res;
  const signInPath = session.signInPath;
  const again = (await refreshSession()) ? await fetch(input, init) : res;
  if (again.status === 401) window.location.replace(signInPath);
  return again;
};

/** Whose data the cache holds, per slot ('user', 'firm'). */
const owners = new Map<string, string>();

/**
 * Empties the data cache when its owner changes, so the next person on the same tab never sees
 * the previous person's (or firm's) rows. <SignedIn> claims 'user', the firm layout 'firm'.
 */
export function claimCache(client: QueryClient, slot: string, owner: string): void {
  const previous = owners.get(slot);
  if (previous !== undefined && previous !== owner) client.clear();
  owners.set(slot, owner);
}

/** On sign-out: empty the cache and forget its owners. */
export function releaseCache(client: QueryClient): void {
  client.clear();
  owners.clear();
}
