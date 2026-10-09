'use client';

import {
  ESIGN_CODE_LENGTH,
  ESIGN_CODE_MINUTES,
  ESIGN_ERRORS,
  type SignerCodeSent,
  type SignerConsent,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input } from '@firmivra/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { ConsentText } from '../../../../../../components/esign/consent-text';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import type { StepProps } from './signer-page';

const message = (e: unknown) => errorMessage(e, ESIGN_ERRORS);

/** VERIFY_EMAIL: a 6-digit code to the signer's email proves the link reached the right person. */
export function EmailCodeStep({ signing, state, onState }: StepProps) {
  const [sent, setSent] = useState<SignerCodeSent | null>(null);
  const [code, setCode] = useState('');
  const [sendError, setSendError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setSendError(undefined);
    try {
      setSent(await signing.sendCode());
      setCode('');
      setCodeError(undefined);
    } catch (e) {
      setSendError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!new RegExp(`^\\d{${ESIGN_CODE_LENGTH}}$`).test(code)) {
      setCodeError(`Enter the ${ESIGN_CODE_LENGTH}-digit code from the email.`);
      return;
    }
    setBusy(true);
    setCodeError(undefined);
    try {
      onState(await signing.verifyCode({ code }));
    } catch (err) {
      setCodeError(message(err));
    } finally {
      setBusy(false);
    }
  }

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
            <Button onClick={() => void send()} disabled={busy}>
              Email me a code
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void verify(e)} noValidate>
          <p className="text-sm text-text">
            We sent a code to <strong>{sent.sentTo}</strong>. It works for {ESIGN_CODE_MINUTES}{' '}
            minutes.
          </p>
          <Input
            label="Code from the email"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={ESIGN_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            error={codeError}
          />
          {sendError && (
            <p role="alert" className="text-sm text-danger">
              {sendError}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy}>
              Continue
            </Button>
            <Button variant="ghost" onClick={() => void send()} disabled={busy}>
              Send a new code
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** VERIFY_ACCESS_CODE: the code the sender gave the signer some other way (phone, in person). */
export function AccessCodeStep({ signing, state, onState }: StepProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      setError('Enter the access code.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onState(await signing.verifyAccessCode({ code: code.trim() }));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Enter your access code">
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-sm text-text">
          {state.senderName} gave you an access code for these documents, separately from the email.
        </p>
        <Input
          label="Access code"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={20}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={error}
        />
        <div>
          <Button type="submit" disabled={busy}>
            Continue
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** CONSENT: the firm's e-signature consent, accepted before the document opens. */
export function ConsentStep({ signing, state, onState }: StepProps) {
  const [consent, setConsent] = useState<SignerConsent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Bumped to read the consent again when the firm published a newer one meanwhile.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    signing
      .consent()
      .then((c) => {
        if (active) setConsent(c);
      })
      .catch((e: unknown) => {
        if (active) setLoadError(message(e));
      });
    return () => {
      active = false;
    };
  }, [signing, reload]);

  async function accept(e: FormEvent) {
    e.preventDefault();
    if (!consent) return;
    if (!agreed) {
      setError('Tick the box to agree, or close this page if you do not.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onState(await signing.acceptConsent({ versionId: consent.versionId, agree: true }));
    } catch (err) {
      setError(message(err));
      if (errorCode(err) === 'CONSENT_OUTDATED') {
        setAgreed(false);
        setReload((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Agree to sign electronically">
      {loadError ? (
        <p role="alert" className="text-sm text-danger">
          {loadError}
        </p>
      ) : !consent ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => void accept(e)} noValidate>
          <div
            data-testid="consent-text"
            className="max-h-96 overflow-y-auto rounded-control border border-border p-4"
            tabIndex={0}
            aria-label="Consent text"
          >
            <ConsentText markdown={consent.bodyMarkdown} />
          </div>
          <Checkbox
            label={`I agree to sign ${state.firmName}'s documents electronically.`}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" disabled={busy}>
              Continue
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
