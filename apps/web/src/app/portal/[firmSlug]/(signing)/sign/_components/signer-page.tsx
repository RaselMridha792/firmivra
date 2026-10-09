'use client';

import { ESIGN_ERRORS, type SignerState, type SigningClient } from '@firmivra/types';
import { Button, EmptyState } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { AccessCodeStep, ConsentStep, EmailCodeStep } from './gate-steps';
import { CopyStep, SignStep, StatusStep } from './sign-steps';

export interface StepProps {
  signing: SigningClient;
  firmSlug: string;
  /** Which opening this is: a new link in the same tab must not reuse the last one's data. */
  opening: number;
  state: SignerState;
  onState: (state: SignerState) => void;
  /**
   * Any error from a step: LINK_INVALID closes the page, WRONG_STEP and NOT_YOUR_TURN read the
   * signer's step again. Others stay on the step.
   */
  onLost: (error: unknown) => void;
}

/** Answers that mean the link itself is no good: retrying it can't help. */
const DEAD_LINK = new Set(['LINK_INVALID', 'VALIDATION_FAILED', 'NOT_FOUND']);

const linkToken = () => new URLSearchParams(window.location.hash.slice(1)).get('t');

/** The signer cookie ran out (an hour) or the link changed: the email's link opens it again. */
const closedText = (sender: string | null) =>
  `This page has closed. Open the signing link from your email again.${
    sender ? ` If it still doesn't open, ask ${sender} for a new one.` : ''
  }`;

/**
 * The signer's page, opened from the email at /{firm}/sign#t=<token>. The token is traded once for
 * the signer cookie and then dropped from the address bar; after that (and after a reload) the
 * API says which step the signer is on: a code, the e-signature consent, then the document.
 */
export function SignerPage() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const signing = useMemo(() => api.signing(firmSlug), [firmSlug]);
  // One opening per attempt: a second effect run (React's dev check) reuses the first call
  // instead of asking for state before the cookie exists.
  const openingRef = useRef<Promise<SignerState> | null>(null);
  // The link's token, out of the address bar at once but kept here for Try again.
  const tokenRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SignerState | null>(null);
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    const fresh = linkToken();
    if (fresh) {
      // Out of history and bookmarks at once; Try again uses the kept copy.
      tokenRef.current = fresh;
      window.history.replaceState(null, '', window.location.pathname);
    }
    const token = tokenRef.current;
    openingRef.current ??= token ? signing.session(token) : signing.state();
    openingRef.current
      .then((s) => {
        // An older opening that answers after another link was opened changes nothing.
        if (!active) return;
        tokenRef.current = null;
        setState(s);
      })
      .catch((e: unknown) => {
        if (!active) return;
        const code = errorCode(e);
        const dead = !!code && DEAD_LINK.has(code);
        if (dead) tokenRef.current = null;
        setError({
          // A cut-off link fails the token's own check before it reaches the API.
          text:
            code === 'VALIDATION_FAILED'
              ? 'This link is not complete. Open it again from the email, or ask the sender for a new one.'
              : // Without a token (a reload) the cookie ran out: the email's link opens it again.
                !token && code === 'LINK_INVALID'
                ? closedText(null)
                : errorMessage(e, ESIGN_ERRORS),
          retry: !dead,
        });
      });
    // Another signing link opened in this tab changes only the fragment, which loads nothing:
    // start over with the new link.
    const onHash = () => {
      if (!linkToken()) return;
      openingRef.current = null;
      setState(null);
      setError(null);
      setAttempt((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, [signing, attempt]);

  const sender = state?.senderName ?? null;
  const onLost = useCallback(
    (e: unknown) => {
      const code = errorCode(e);
      if (code === 'LINK_INVALID') {
        setError({ text: closedText(sender), retry: false });
      } else if (code === 'WRONG_STEP' || code === 'NOT_YOUR_TURN') {
        // The request moved on in another tab or for another signer: show where it is now.
        signing
          .state()
          .then(setState, (x: unknown) =>
            setError({ text: errorMessage(x, ESIGN_ERRORS), retry: true }),
          );
      }
    },
    [signing, sender],
  );

  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <EmptyState
          title="This link can't be opened"
          description={error.text}
          action={
            error.retry ? (
              <Button
                variant="secondary"
                onClick={() => {
                  openingRef.current = null;
                  setError(null);
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  if (!state) {
    return (
      <p className="text-sm text-muted" role="status">
        Opening your document…
      </p>
    );
  }
  const props: StepProps = {
    signing,
    firmSlug,
    opening: attempt,
    state,
    onState: setState,
    onLost,
  };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" data-step={state.step}>
      <header className="flex flex-col gap-1">
        <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
          {state.title}
        </h1>
        <p className="text-sm text-muted">
          Sent by {state.senderName} for {state.signerName}
        </p>
      </header>
      {state.step === 'VERIFY_EMAIL' && <EmailCodeStep {...props} />}
      {state.step === 'VERIFY_ACCESS_CODE' && <AccessCodeStep {...props} />}
      {state.step === 'CONSENT' && <ConsentStep {...props} />}
      {state.step === 'SIGN' && <SignStep {...props} />}
      {state.step === 'COPY' && <CopyStep {...props} />}
      {['WAITING', 'DONE', 'DECLINED', 'CLOSED'].includes(state.step) && <StatusStep {...props} />}
    </div>
  );
}
