'use client';

import {
  ApiRequestError,
  ESIGN_ERRORS,
  ESIGN_KIOSK_IDLE_MINUTES,
  ESIGN_KIOSK_PASSWORD_TRIES,
  type EsignInPersonSession,
  type EsignRecipient,
  type EsignRequestDetail,
} from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/errors';
import { useApiMutation, useApiQuery } from '../../lib/query';
import { PageState } from '../page-state';

const STATE_KEY = ['esign', 'in-person'];
/** How often an open kiosk asks whether it is still open (the server ends a kiosk left alone). */
const CHECK_MS = 60_000;
const message = (e: unknown) => (e ? errorMessage(e, ESIGN_ERRORS) : undefined);
/** Start errors in staff words: ESIGN_ERRORS speaks to the signer. */
const STAFF_START_ERRORS = {
  ...ESIGN_ERRORS,
  NOT_YOUR_TURN: "It isn't this signer's turn yet.",
};

/**
 * The signing link from the start answer, by request. Only that answer carries the one-time token
 * (`GET /esign/in-person` doesn't), so it is kept here, in memory only: a reload loses it.
 */
const startLinks = new Map<string, string>();
const hasToken = (url: string) => new URL(url).hash.includes('t=');

/** The caller's open in-person session. Answers while the staff session is locked. */
const useInPersonState = () => useApiQuery(STATE_KEY, () => api.esign.inPerson.state());

/** Why an in-person signer can't start now, or null when they can. */
function blocked(x: EsignRecipient): string | null {
  if (['SENT', 'DELIVERED', 'VIEWED'].includes(x.status)) return null;
  if (x.status === 'SIGNED') return 'signed';
  if (x.status === 'DECLINED') return 'declined';
  return 'not their turn';
}

/**
 * /firm-sign/in-person: where a locked staff session lands (firm pages answer 403
 * KIOSK_LOCKED). It opens the open session's kiosk, or Firm Sign when there is none.
 */
export function InPersonResume() {
  const router = useRouter();
  const state = useInPersonState();
  const requestId = state.data?.session?.requestId;
  const loaded = state.isSuccess;
  useEffect(() => {
    if (loaded) router.replace(requestId ? `/firm-sign/in-person/${requestId}` : '/firm-sign');
  }, [router, loaded, requestId]);
  return (
    <PageState query={state} isEmpty={() => false}>
      {() => (
        <p className="text-sm text-muted" role="status">
          Opening in-person signing…
        </p>
      )}
    </PageState>
  );
}

/**
 * /firm-sign/in-person/{requestId}: a staff member hands this device to a signer. Before: pick
 * the in-person signer whose turn it is. While open: the signer's link, and the password form
 * that returns to the staff view. Every other firm page stays locked on the server meanwhile.
 */
export function InPersonKiosk({ requestId }: { requestId: string }) {
  const router = useRouter();
  const state = useInPersonState();
  const session = state.data?.session;
  // A session for another request: that one's kiosk, never two at once.
  const elsewhere = session && session.requestId !== requestId ? session.requestId : null;
  useEffect(() => {
    if (elsewhere) router.replace(`/firm-sign/in-person/${elsewhere}`);
  }, [router, elsewhere]);

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

  function startWith(recipientId: string) {
    start.mutate(recipientId, {
      onSuccess: (session) => {
        // Nothing this tab read before the lock stays in memory while the device is handed over.
        // The kiosk's own state stays: the page watches it, and removing it would send the tab
        // through a 403 KIOSK_LOCKED before the lock screen shows.
        queryClient.removeQueries({
          predicate: (q) => q.queryKey[0] !== STATE_KEY[0] || q.queryKey[1] !== STATE_KEY[1],
        });
        startLinks.set(session.requestId, session.signingUrl);
        queryClient.setQueryData(STATE_KEY, { session });
      },
      onError: (err) => {
        // Another tab opened a kiosk meanwhile: show that one (its unlock form) instead.
        if (errorCode(err) === 'KIOSK_LOCKED') {
          void queryClient.invalidateQueries({ queryKey: STATE_KEY });
        }
        // The request moved on (a signer signed, it was voided): show its statuses now.
        if (err instanceof ApiRequestError && err.status === 409) {
          void queryClient.invalidateQueries({ queryKey: ['esign', 'requests', requestId] });
        }
      },
    });
  }

  return (
    <PageState query={request} isEmpty={() => false}>
      {(r: EsignRequestDetail) => {
        const signers = r.recipients.filter((x) => x.delivery === 'IN_PERSON');
        const allowed = r.allowedActions.includes('START_IN_PERSON');
        return (
          <Card title={r.title}>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-text">
                Hand this device to the signer. Until you type your password again, it shows only
                their signing pages, and the rest of Firmivra stays locked.
              </p>
              {signers.length === 0 ? (
                <p className="text-sm text-muted">No one on this request signs in person.</p>
              ) : !allowed ? (
                <p className="text-sm text-muted">
                  This request can&apos;t be signed in person now.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {signers.map((x) => {
                    const why = blocked(x);
                    return (
                      <li key={x.id} className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm text-text">
                          {x.name}
                          {why && <span className="text-muted"> ({why})</span>}
                        </span>
                        <Button disabled={!!why || start.isPending} onClick={() => startWith(x.id)}>
                          Start signing with {x.name}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {start.error && (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(start.error, STAFF_START_ERRORS)}
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

  // A kiosk left alone (ESIGN_KIOSK_IDLE_MINUTES) is ended on the server, which signs the staff
  // member out: the next check then answers 401 and the session layer opens the sign-in page.
  useEffect(() => {
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: STATE_KEY }),
      CHECK_MS,
    );
    return () => clearInterval(timer);
  }, [queryClient]);

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
        startLinks.delete(session.requestId);
        router.replace(`/firm-sign/requests/${session.requestId}`);
      },
      // A wrong password is typed again from scratch. (After ESIGN_KIOSK_PASSWORD_TRIES the API signs the staff member
      // out; the session layer opens the sign-in page on that 401.)
      onError: () => setPassword(''),
    });
  }

  const link =
    startLinks.get(session.requestId) ?? (hasToken(session.signingUrl) ? session.signingUrl : null);
  return (
    <>
      <Card title={`Hand this device to ${session.signerName}`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            {session.signerName} signs in a new tab. When they are done, they close that tab and
            hand the device back. If the signing pages sit unused for {ESIGN_KIOSK_IDLE_MINUTES}{' '}
            minutes, you are signed out.
          </p>
          {link ? (
            <div>
              <Button onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}>
                Open the signing pages
              </Button>
            </div>
          ) : (
            // The one-time link was in this page's memory only (lost on a reload).
            <p className="text-sm text-muted">
              The signing pages can&apos;t be opened again from here. If the signer&apos;s tab was
              closed, return to the staff view and start the in-person signing again.
            </p>
          )}
        </div>
      </Card>
      <Card title="Return to the staff view">
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <p className="text-sm text-text">
            Only the staff member who started this signing can return. After{' '}
            {ESIGN_KIOSK_PASSWORD_TRIES} wrong passwords you are signed out.
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
