'use client';

import {
  ApiRequestError,
  ESIGN_ERRORS,
  type EsignInPersonSession,
  type EsignRecipient,
  type EsignRequestDetail,
} from '@firmivra/types';
import { Button, Card, EmptyState, Input } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { useApiMutation, useApiQuery } from '../../lib/query';
import { PageState } from '../page-state';

const STATE_KEY = ['esign', 'in-person'];
const message = (e: unknown) => (e ? errorMessage(e, ESIGN_ERRORS) : undefined);
const signedOut = (e: unknown) => e instanceof ApiRequestError && e.status === 401;
/** A signer who can sign now: it is their turn and they have not finished. */
const canStart = (x: EsignRecipient) =>
  x.delivery === 'IN_PERSON' && ['SENT', 'DELIVERED', 'VIEWED'].includes(x.status);

/**
 * /firm-sign/in-person: where a locked staff session lands (any firm page answers 403
 * KIOSK_LOCKED). It opens the open session's kiosk, or Firm Sign when there is none.
 */
export function InPersonResume() {
  const router = useRouter();
  const state = useApiQuery(STATE_KEY, () => api.esign.inPerson.state());
  const session = state.data?.session;
  const open = state.isSuccess;
  useEffect(() => {
    if (signedOut(state.error)) router.replace('/sign-in');
    else if (open)
      router.replace(session ? `/firm-sign/in-person/${session.requestId}` : '/firm-sign');
  }, [router, open, session, state.error]);
  if (state.error && !signedOut(state.error)) {
    return <EmptyState title="In-person signing" description={message(state.error) ?? ''} />;
  }
  return (
    <p className="text-sm text-muted" role="status">
      Opening in-person signing…
    </p>
  );
}

/**
 * /firm-sign/in-person/{requestId}: a staff member hands this device to a signer. Before: pick
 * the in-person signer whose turn it is. While open: the signer's link, and the password form
 * that returns to the staff view. Every other firm page stays locked on the server meanwhile.
 */
export function InPersonKiosk({ requestId }: { requestId: string }) {
  const router = useRouter();
  const state = useApiQuery(STATE_KEY, () => api.esign.inPerson.state());
  const session = state.data?.session;
  // A session for another request: that one's kiosk, never two at once.
  const elsewhere = session && session.requestId !== requestId ? session.requestId : null;
  useEffect(() => {
    if (signedOut(state.error)) router.replace('/sign-in');
    else if (elsewhere) router.replace(`/firm-sign/in-person/${elsewhere}`);
  }, [router, elsewhere, state.error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
        In-person signing
      </h1>
      <PageState query={state} isEmpty={() => false}>
        {(s) =>
          s.session?.requestId === requestId ? (
            <Locked session={s.session} />
          ) : s.session ? null : (
            <Start requestId={requestId} />
          )
        }
      </PageState>
    </div>
  );
}

/** Before the kiosk opens: who signs here now, and what locking means. */
function Start({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();
  const request = useApiQuery(['esign', 'requests', requestId], () => api.esign.get(requestId));
  const start = useApiMutation((recipientId: string) =>
    api.esign.inPerson.start(requestId, { recipientId }),
  );
  return (
    <PageState query={request} isEmpty={() => false}>
      {(r: EsignRequestDetail) => {
        const signers = r.recipients.filter((x) => x.delivery === 'IN_PERSON');
        return (
          <Card title={r.title}>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text">
                Hand this device to the signer. Until you type your password again, it shows only
                their signing pages, and the rest of Firmivra stays locked.
              </p>
              {signers.length === 0 ? (
                <p className="text-sm text-muted">No one on this request signs in person.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {signers.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-sm text-text">
                        {x.name}
                        {!canStart(x) && (
                          <span className="text-muted">
                            {' '}
                            ({x.status === 'SIGNED' ? 'signed' : 'not their turn'})
                          </span>
                        )}
                      </span>
                      <Button
                        disabled={!canStart(x) || start.isPending}
                        onClick={() =>
                          start.mutate(x.id, {
                            onSuccess: (session) =>
                              queryClient.setQueryData(STATE_KEY, { session }),
                          })
                        }
                      >
                        Start signing with {x.name}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {start.error && (
                <p role="alert" className="text-sm text-danger">
                  {message(start.error)}
                </p>
              )}
              <div>
                <Link
                  href={`/firm-sign/requests/${requestId}`}
                  className="text-sm text-brand-700 underline"
                >
                  Back to the request
                </Link>
              </div>
            </div>
          </Card>
        );
      }}
    </PageState>
  );
}

/** The kiosk while open: the signer's link, and the staff member's way back. */
function Locked({ session }: { session: EsignInPersonSession }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const exit = useApiMutation((password: string) => api.esign.inPerson.exit({ password }));
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();

  // Left alone, the server ends the session and signs the staff member out: check then.
  useEffect(() => {
    const wait = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: STATE_KEY }),
      wait,
    );
    return () => clearTimeout(timer);
  }, [session.expiresAt, queryClient]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setError('Type your password to return to the staff view.');
      return;
    }
    setError(undefined);
    exit.mutate(password, {
      onSuccess: () => {
        // Everything cached before the lock may be stale or was refused: start clean.
        queryClient.clear();
        router.replace(`/firm-sign/requests/${session.requestId}`);
      },
      onError: (err) => {
        setPassword('');
        if (signedOut(err)) router.replace('/sign-in');
      },
    });
  }

  const until = new Date(session.expiresAt).toLocaleTimeString(undefined, { timeStyle: 'short' });
  return (
    <>
      <Card title={`Hand this device to ${session.signerName}`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            {session.signerName} signs in a new tab. When they are done, close that tab and come
            back here. If nobody returns by {until}, you are signed out.
          </p>
          <div>
            <Button onClick={() => window.open(session.signingUrl, '_blank', 'noopener')}>
              Open the signing pages
            </Button>
          </div>
        </div>
      </Card>
      <Card title="Return to the staff view">
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <p className="text-sm text-text">
            Only the staff member who started this signing can return. After 5 wrong passwords you
            are signed out.
          </p>
          <Input
            label="Your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={error ?? message(exit.error)}
          />
          <div>
            <Button type="submit" variant="secondary" disabled={exit.isPending}>
              Unlock
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
