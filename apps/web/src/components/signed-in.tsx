'use client';

import { ApiRequestError, type MeResponse } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { createContext, type ReactNode, use, useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { adminAuth, AUTH_MODE, signOut as devSignOut, staffAuth } from '../lib/auth';

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

/**
 * The sign-in check of every signed-in layout. Reads the user once in the browser
 * (GET /admin/me on the Super Admin site, GET /me elsewhere), shows a loading state, sends
 * signed-out visitors to the site's sign-in page, and gives the pages the user through useMe().
 */
export function SignedIn({
  site,
  signInPath,
  children,
}: {
  site: Site;
  signInPath: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    (site === 'admin' ? adminAuth.me() : api.me()).then(
      (me) => active && setState({ status: 'ready', me }),
      (e: unknown) => {
        if (!active) return;
        if (e instanceof ApiRequestError && e.status === 401) router.replace(signInPath);
        else setState({ status: 'error', code: e instanceof ApiRequestError ? e.code : 'ERROR' });
      },
    );
    return () => {
      active = false;
    };
  }, [site, signInPath, router, attempt]);

  const signOut = useCallback(async () => {
    if (AUTH_MODE === 'local') await devSignOut();
    else if (site === 'admin') await adminAuth.signOut();
    else await staffAuth.signOut();
    router.replace(signInPath);
  }, [site, signInPath, router]);

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
