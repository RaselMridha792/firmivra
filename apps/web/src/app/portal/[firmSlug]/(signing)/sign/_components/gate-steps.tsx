'use client';

import { ESIGN_CODE_LENGTH, ESIGN_CODE_MINUTES, ESIGN_ERRORS } from '@firmivra/types';
import { Button, Card, Checkbox, Input } from '@firmivra/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { ConsentText } from '../../../../../../components/esign/consent-text';
import { PageState } from '../../../../../../components/page-state';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import type { StepProps } from './signer-page';

const message = (e: unknown) => (e ? errorMessage(e, ESIGN_ERRORS) : undefined);

/** VERIFY_EMAIL: a 6-digit code to the signer's email proves the link reached the right person. */
export function EmailCodeStep({ signing, state, onState }: StepProps) {
  const send = useApiMutation(() => signing.sendCode());
  const verify = useApiMutation((code: string) => signing.verifyCode({ code }));
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string>();
  // "Send a new code" waits until the API would take it (`resendAfter`), not into a 429.
  const [canResend, setCanResend] = useState(false);
  const resendAfter = send.data?.resendAfter;
  useEffect(() => {
    if (!resendAfter) return;
    const wait = Math.max(0, new Date(resendAfter).getTime() - Date.now());
    const timer = setTimeout(() => setCanResend(true), wait);
    return () => clearTimeout(timer);
  }, [resendAfter]);

  function sendCode() {
    setCanResend(false);
    setCode('');
    setCodeError(undefined);
    send.mutate(undefined);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (code.length !== ESIGN_CODE_LENGTH) {
      setCodeError(`Enter the ${ESIGN_CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setCodeError(undefined);
    verify.mutate(code, { onSuccess: onState });
  }

  const sent = send.data;
  const sendError = message(send.error);
  return (
    <Card title="Confirm it's you">
      {!sent ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text">
            To keep these documents private, we&apos;ll email a {ESIGN_CODE_LENGTH}-digit code to{' '}
            <strong>{state.codeSentTo}</strong>.
          </p>
          {sendError && (
            <p role="alert" className="text-sm text-danger">
              {sendError}
            </p>
          )}
          <div>
            <Button onClick={sendCode} disabled={send.isPending}>
              Email me a code
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <p className="text-sm text-text">
            We sent a code to <strong>{sent.sentTo}</strong>. It works for {ESIGN_CODE_MINUTES}{' '}
            minutes.
          </p>
          <Input
            label="Code from the email"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            // Pasted codes may carry spaces or a dash: keep the digits, then cut to length.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, ESIGN_CODE_LENGTH))}
            error={codeError ?? message(verify.error)}
          />
          {sendError && (
            <p role="alert" className="text-sm text-danger">
              {sendError}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={verify.isPending}>
              Continue
            </Button>
            <Button variant="ghost" onClick={sendCode} disabled={!canResend || send.isPending}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** The access code's shape (letters and digits, 4 to 20), as the API checks it. */
const ACCESS_CODE = /^[A-Za-z0-9]{4,20}$/;

/** VERIFY_ACCESS_CODE: the code the sender gave the signer some other way (phone, in person). */
export function AccessCodeStep({ signing, state, onState }: StepProps) {
  const verify = useApiMutation((code: string) => signing.verifyAccessCode({ code }));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();

  function submit(e: FormEvent) {
    e.preventDefault();
    // Read out over the phone it may gain spaces or dashes; the code itself has neither.
    const clean = code.replace(/[\s-]/g, '');
    if (!ACCESS_CODE.test(clean)) {
      setError('Enter the code exactly as you were given it: 4 to 20 letters and numbers.');
      return;
    }
    setError(undefined);
    verify.mutate(clean, { onSuccess: onState });
  }

  return (
    <Card title="Enter your access code">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <p className="text-sm text-text">
          {state.senderName} gave you an access code for these documents, separately from the email.
        </p>
        <Input
          label="Access code"
          autoComplete="off"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error ?? message(verify.error)}
        />
        <div>
          <Button type="submit" disabled={verify.isPending}>
            Continue
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** CONSENT: the firm's e-signature consent, accepted before the document opens. */
export function ConsentStep({ signing, firmSlug, opening, state, onState }: StepProps) {
  const consent = useApiQuery(['signing', firmSlug, opening, 'consent'], () => signing.consent());
  const accept = useApiMutation((versionId: string) =>
    signing.acceptConsent({ versionId, agree: true }),
  );
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();

  function submit(versionId: string) {
    if (!agreed) {
      setError('Tick the box to agree, or close this page if you do not.');
      return;
    }
    setError(undefined);
    accept.mutate(versionId, {
      onSuccess: onState,
      onError: (err) => {
        // The firm published a newer consent meanwhile: show it and ask again.
        if (errorCode(err) === 'CONSENT_OUTDATED') {
          setAgreed(false);
          void consent.refetch();
        }
      },
    });
  }

  return (
    <Card title="Agree to sign electronically">
      <PageState query={consent} isEmpty={() => false}>
        {(c) => (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit(c.versionId);
            }}
            noValidate
          >
            <div
              data-testid="consent-text"
              className="max-h-96 overflow-y-auto rounded-control border border-border p-4"
              // Scrollable text must be reachable by keyboard.
              tabIndex={0}
              aria-label="Consent text"
            >
              <ConsentText markdown={c.bodyMarkdown} />
            </div>
            <Checkbox
              label={`I agree to sign ${state.firmName}'s documents electronically.`}
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            {(error ?? message(accept.error)) && (
              <p role="alert" className="text-sm text-danger">
                {error ?? message(accept.error)}
              </p>
            )}
            <div>
              <Button type="submit" disabled={accept.isPending || consent.isFetching}>
                Continue
              </Button>
            </div>
          </form>
        )}
      </PageState>
    </Card>
  );
}
