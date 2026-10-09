'use client';

import { ESIGN_ERRORS, type SignerState, type SigningClient } from '@firmivra/types';
import { EmptyState } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { AccessCodeStep, ConsentStep, EmailCodeStep } from './gate-steps';
import { CopyStep, SignStep, StatusStep } from './sign-steps';

export interface StepProps {
  signing: SigningClient;
  state: SignerState;
  onState: (state: SignerState) => void;
}

/**
 * The signer's page, opened from the email at /{firm}/sign#t=<token>. The token is traded once for
 * the signer cookie and dropped from the address bar; after that (and after a reload) the API
 * says which step the signer is on: a code, the e-signature consent, then the document.
 */
export function SignerPage() {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const signing = useMemo(() => api.signing(firmSlug), [firmSlug]);
  // One opening per page: the token is single-use in the address bar, and a second effect run
  // (React's dev check) must reuse the first call, not ask for state before the cookie exists.
  const openingRef = useRef<Promise<SignerState> | null>(null);
  const [state, setState] = useState<SignerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!openingRef.current) {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('t');
      // Keep the token out of the history, bookmarks and anything the page later shares.
      if (token) window.history.replaceState(null, '', window.location.pathname);
      openingRef.current = token ? signing.session(token) : signing.state();
    }
    openingRef.current
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e, ESIGN_ERRORS));
      });
    // Another signing link opened in this tab changes only the fragment, which loads nothing:
    // reload so the new link is opened from the start.
    const onHash = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('t')) window.location.reload();
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHash);
    };
  }, [signing]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <EmptyState title="This link can't be opened" description={error} />
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
  const props: StepProps = { signing, state, onState: setState };
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
