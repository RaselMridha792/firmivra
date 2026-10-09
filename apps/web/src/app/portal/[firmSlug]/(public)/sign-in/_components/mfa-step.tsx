'use client';

import type { MfaSetupResponse } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useState } from 'react';
import { QrCode } from '../../../../../../components/qr-code';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { CodeInput } from '../../_components/code-input';
import { StepHeading } from '../../sign-up/_components/sign-up-frame';

export interface Challenge {
  session: string;
  setup?: MfaSetupResponse;
}

/** The authenticator code after the password, or the first-time authenticator setup. */
export function MfaStep({
  session: firstSession,
  setup,
  onSignedIn,
  onBack,
}: Challenge & { onSignedIn: () => void; onBack: () => void }) {
  const { business } = usePortal();
  const [session, setSession] = useState(firstSession);
  const [code, setCode] = useState('');
  const submit = useApiMutation(() => portalAuth(business.slug).submitMfaCode({ session, code }));
  return (
    <form
      noValidate
      data-testid="mfa-form"
      className="grid gap-4 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate(undefined, {
          onSuccess: (result) => {
            if (result.status === 'SIGNED_IN') onSignedIn();
            else setSession(result.session);
          },
          onError: (error) => {
            setCode('');
            if (errorCode(error) === 'CHALLENGE_EXPIRED') onBack();
          },
        });
      }}
    >
      <StepHeading title={setup ? 'Set Up Your Authenticator' : 'Verify Your Identity'}>
        {setup
          ? 'Scan the code with your authenticator app, or enter the setup key, then enter the 6-digit code it shows.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </StepHeading>
      {setup ? (
        <div className="grid justify-items-center gap-2">
          <QrCode value={setup.otpauthUri} label="Authenticator setup QR code" />
          <p className="font-mono text-sm break-all">{setup.secret}</p>
        </div>
      ) : null}
      <CodeInput
        label="Authenticator code"
        value={code}
        onChange={setCode}
        disabled={submit.isPending}
        invalid={submit.isError}
      />
      {submit.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(submit.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        className="text-lg"
        disabled={submit.isPending || code.replace(/\s/g, '').length < 6}
      >
        Verify Code
      </Button>
      <Button variant="ghost" className="underline" disabled={submit.isPending} onClick={onBack}>
        Back to sign in
      </Button>
    </form>
  );
}
