'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import type { IdentityPool } from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { AUTH_MODE, DEV_USERS, signIn } from '../lib/auth';

interface Props {
  title: string;
  pool: IdentityPool;
  /** Where to go after signing in, as the browser sees it (for example "/" or "/lvp"). */
  homePath: string;
}

/** Placeholder sign-in screen. Real screens follow the mockups (Fahad and Nahid, Sprint 1 and 2). */
export function SignInPanel({ title, pool, homePath }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function go(address: string) {
    setBusy(true);
    setError(undefined);
    try {
      await signIn(address, pool);
      router.push(homePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void go(email);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-brand-900">{title}</h1>
      <Card title="Sign in">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            required
          />
          <Button type="submit" disabled={busy}>
            Sign in
          </Button>
        </form>
      </Card>
      {AUTH_MODE === 'local' ? (
        <Card title="Local development: seeded users">
          <div className="flex flex-col gap-2">
            {DEV_USERS[pool].map((u) => (
              <Button
                key={u.email}
                variant="secondary"
                disabled={busy}
                onClick={() => void go(u.email)}
              >
                {u.label} ({u.email})
              </Button>
            ))}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
