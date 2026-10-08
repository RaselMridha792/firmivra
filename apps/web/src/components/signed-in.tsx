'use client';

import { ApiRequestError, type MeResponse } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, use, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { adminAuth, AUTH_MODE, portalAuth, signOut as devSignOut, staffAuth } from '../lib/auth';
import { claimCache, refreshSession, releaseCache, setSession } from '../lib/session';

export type Site = 'admin' | 'firm' | 'portal';

interface SignedInValue {
  me: MeResponse;
  /** Signs out on the API (from the browser), then opens the site's sign-in page. */
  signOut: () => Promise<void>;
}

const MeContext = createContext<SignedInValue | null>(null);

/** The signed-in user, for any page or component inside a signed-in layout. */
export function useMe(): SignedInValue {
  const value = use(MeContext);
  if (!value) throw new Error('useMe() works only inside <SignedIn> (a signed-in layout)');
  return value;
}

type State =
  { status: 'loading' } | { status: 'ready'; me: MeResponse } | { status: 'error'; code: string };

/** Renews this site's session (POST .../auth/refresh): the API sets fresh cookies. */
function refreshFor(site: Site, firmSlug: string | undefined): () => Promise<unknown> {
  if (site === 'admin') return () => adminAuth.refresh();
  if (site === 'portal' && firmSlug) return () => portalAuth(firmSlug).refresh();
  return () => staffAuth.refresh();
}

/**
 * The sign-in check of every signed-in layout. Reads the user once in the browser
 * (GET /admin/me on the Super Admin site, GET /portal/{slug}/me on a firm's portal, GET /me on the
 * firm site), shows a loading state, and gives the
 * pages the user through useMe(). On a 401 it refreshes the session once, then sends the visitor
 * to the site's sign-in page. A different person than last time on this tab starts with an empty
 * data cache, and sign-out empties it (lib/session.ts).
 */
export function SignedIn({
  site,
  signInPath,
  firmSlug,
  children,
}: {
  site: Site;
  signInPath: string;
  /** The portal's firm (portal only): its sign-out ends that firm's session. */
  firmSlug?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = refreshFor(site, firmSlug);
    // Each site's own route: the portal's cookies reach only /api/v1/portal/{slug}/.
    const loadMe = () =>
      site === 'admin'
        ? adminAuth.me()
        : site === 'portal' && firmSlug
          ? portalAuth(firmSlug).me()
          : api.me();
    const is401 = (e: unknown) => e instanceof ApiRequestError && e.status === 401;
    // One refresh on a 401, then one more try; a second 401 means the session is over.
    loadMe()
      .catch(async (e: unknown) => {
        if (!is401(e) || !(await refreshSession(refresh))) throw e;
        return loadMe();
      })
      .then(
        (me) => {
          if (!active) return;
          claimCache(queryClient, 'user', me.user.id);
          setSession({ refresh, signInPath });
          setState({ status: 'ready', me });
        },
        (e: unknown) => {
          if (!active) return;
          if (is401(e)) router.replace(signInPath);
          else setState({ status: 'error', code: e instanceof ApiRequestError ? e.code : 'ERROR' });
        },
      );
    return () => {
      active = false;
    };
  }, [site, signInPath, firmSlug, router, queryClient, attempt]);

  const signOut = useCallback(async () => {
    // A portal session is that firm's own, locally too (its cookies reach only its routes).
    if (site === 'portal' && firmSlug) await portalAuth(firmSlug).signOut();
    else if (AUTH_MODE === 'local') await devSignOut();
    else if (site === 'admin') await adminAuth.signOut();
    else await staffAuth.signOut();
    // Nothing of this person's stays in memory for whoever uses the tab next.
    setSession(null);
    releaseCache(queryClient);
    router.replace(signInPath);
  }, [site, signInPath, firmSlug, router, queryClient]);

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3">
        <p className="text-danger">We couldn&apos;t load your account ({state.code}).</p>
        <Button
          variant="secondary"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  return <MeContext value={{ me: state.me, signOut }}>{children}</MeContext>;
}
