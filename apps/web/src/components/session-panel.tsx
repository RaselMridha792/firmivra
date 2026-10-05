'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiRequestError, type BusinessSummary, type MeResponse } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { api } from '../lib/api';
import { adminAuth, signOut } from '../lib/auth';

interface Props {
  title: string;
  /** Sign-in page as the browser sees it. */
  signInPath: string;
  /** Which firm to show: staff use their current firm, clients the portal's firm. */
  firm: { kind: 'staff' } | { kind: 'portal'; slug: string } | { kind: 'none' };
  /** The Super Admin site reads /admin/me: firm routes never accept its cookie. */
  site?: 'firm' | 'admin';
}

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'ready'; me: MeResponse; business?: BusinessSummary; firmError?: string }
  | { status: 'error'; message: string };

/** Calls GET /api/v1/me (and the firm) with the session cookie: proves local sign-in end to end. */
export function SessionPanel({ title, signInPath, firm, site = 'firm' }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const me = site === 'admin' ? await adminAuth.me() : await api.me();
        let business: BusinessSummary | undefined;
        let firmError: string | undefined;
        try {
          if (firm.kind === 'staff') business = await api.currentBusiness();
          if (firm.kind === 'portal') business = await api.portalBusiness(firm.slug);
        } catch (e) {
          firmError = e instanceof ApiRequestError ? e.code : 'ERROR';
        }
        if (active) setState({ status: 'ready', me, business, firmError });
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiRequestError && e.status === 401) setState({ status: 'signed-out' });
        else setState({ status: 'error', message: e instanceof Error ? e.message : 'Error' });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [firm, site]);

  async function onSignOut() {
    await signOut();
    router.push(signInPath);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-brand-900">{title}</h1>
        {state.status === 'ready' ? (
          <Button variant="secondary" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        ) : null}
      </header>

      {state.status === 'loading' ? <p className="text-muted">Loading…</p> : null}
      {state.status === 'error' ? <p className="text-danger">{state.message}</p> : null}
      {state.status === 'signed-out' ? (
        <Card title="You are signed out">
          <Link className="font-medium text-brand-700 underline" href={signInPath}>
            Sign in
          </Link>
        </Card>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <Card title="Signed in as">
            <p data-testid="me-email" className="font-medium">
              {state.me.user.email}
            </p>
            <p className="text-sm text-muted">
              {state.me.user.name} · {state.me.user.pool}
              {state.me.platformAdmin ? ' · Super Admin' : ''}
            </p>
          </Card>
          {firm.kind !== 'none' ? (
            <Card title="Firm">
              {state.business ? (
                <p data-testid="firm-name" className="font-medium">
                  {state.business.name} ({state.business.slug})
                </p>
              ) : (
                <p data-testid="firm-error" className="text-danger">
                  No access to this firm ({state.firmError})
                </p>
              )}
            </Card>
          ) : null}
          <Card title="Your firms">
            <ul className="flex flex-col gap-1 text-sm">
              {state.me.memberships.map((m) => (
                <li key={m.business.id}>
                  {m.business.name}: {m.role}
                </li>
              ))}
              {state.me.clientAccounts.map((c) => (
                <li key={c.business.id}>
                  {c.business.name}: client ({c.status})
                </li>
              ))}
              {state.me.memberships.length + state.me.clientAccounts.length === 0 ? (
                <li className="text-muted">None</li>
              ) : null}
            </ul>
          </Card>
        </>
      ) : null}
    </main>
  );
}
