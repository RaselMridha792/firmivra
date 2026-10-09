'use client';
import { useAuthReady } from './use-auth-ready';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { MfaRequest, type MfaSetupResponse } from '@firmivra/types';
import { AuthFrame, Button, Input } from '@firmivra/ui';
import { adminAuth, staffAuth } from '../../lib/auth';
import { useApiMutation } from '../../lib/query';
import { errorCode, errorMessage } from '../../lib/errors';
import { QrCode } from '../qr-code';

export function Mfa({
  site,
  session,
  setup,
  onBack,
  onSignedIn,
}: {
  site: 'firm' | 'admin';
  session: string;
  setup?: MfaSetupResponse;
  onBack: () => void;
  /** Runs once signed in, in place of opening the workspace. */
  onSignedIn?: () => void;
}) {
  const ready = useAuthReady();
  const router = useRouter();
  const client = site === 'admin' ? adminAuth : staffAuth;
  const form = useForm<MfaRequest>({
    resolver: zodResolver(MfaRequest),
    defaultValues: { session },
  });
  const mutation = useApiMutation(async (body: MfaRequest) => {
    const result = await client.submitMfaCode(body);
    form.resetField('code');
    if (result.status === 'SIGNED_IN') {
      if (onSignedIn) onSignedIn();
      else router.replace('/');
    } else form.setValue('session', result.session);
  });
  return (
    <AuthFrame site={site} title={setup ? 'Set up your authenticator' : 'Verify your identity'}>
      {mutation.isError ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      <form
        data-testid="mfa-form"
        className="auth-form"
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate(body, {
            onError: (error) => {
              form.resetField('code');
              if (errorCode(error) === 'CHALLENGE_EXPIRED') onBack();
            },
          }),
        )}
      >
        <fieldset className="contents" disabled={!ready || mutation.isPending}>
          {setup ? (
            <div className="space-y-4">
              <p>Scan with your authenticator app, or enter the setup key.</p>
              <QrCode value={setup.otpauthUri} label="Authenticator setup QR code" />
              <p className="break-all font-mono text-sm">{setup.secret}</p>
            </div>
          ) : null}
          <Input
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <Button
            type="submit"
            className="auth-submit"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
          >
            Verify code
          </Button>
          <Button variant="ghost" disabled={mutation.isPending} onClick={onBack}>
            Back to sign in
          </Button>
        </fieldset>
      </form>
    </AuthFrame>
  );
}
