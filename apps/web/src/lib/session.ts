import type { QueryClient } from '@tanstack/react-query';

/**
 * The signed-in site's session, set by <SignedIn>: how to refresh it and where to sign in.
 * Public pages have none, so their 401s stay plain errors.
 */
interface Session {
  refresh: () => Promise<unknown>;
  /** Ends this site's session on the API (its cookies are cleared), without any screen. */
  end: () => Promise<unknown>;
  signInPath: string;
}

let session: Session | null = null;
let refreshing: Promise<boolean> | null = null;
let ending: Promise<void> | null = null;

export function setSession(value: Session | null): void {
  session = value;
  // A new sign-in on this page starts with no sign-out under way.
  if (value) ending = null;
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

/** The codes of a session that is over: a refresh would not bring it back. */
const ENDED = new Set(['SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_IDLE']);

/**
 * SM4: the firm signed this session out (Active Sessions); SEC-4: it reached its 8 hours, or 15
 * minutes passed without activity. A refresh would not bring it back.
 */
export async function isSessionRevoked(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' && ENDED.has(body.error.code);
  } catch {
    return false;
  }
}

/**
 * The session was signed out from Active Sessions: end it on the API too (cookies cleared), forget
 * it here, and open the site's sign-in page. Every 401 that arrives meanwhile waits for the same.
 */
function endRevoked(current: Session): Promise<void> {
  session = null;
  ending ??= current
    .end()
    .catch(() => undefined)
    .then(() => window.location.replace(current.signInPath));
  return ending;
}

/**
 * fetch for the API clients (lib/api.ts): on a 401, refresh the session once and send the request
 * again; if it's still 401, the session is over and the browser opens the site's sign-in page.
 * A 401 SESSION_REVOKED (SM4) is not refreshed: the browser signs out at once.
 */
export const sessionFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status !== 401 || !session) return res;
  const current = session;
  if (await isSessionRevoked(res)) {
    await endRevoked(current);
    return res;
  }
  const again = (await refreshSession()) ? await fetch(input, init) : res;
  if (await isSessionRevoked(again)) await endRevoked(current);
  else if (again.status === 401) window.location.replace(current.signInPath);
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
