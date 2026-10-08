'use client';
import { useAuthReady } from './use-auth-ready';
import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActivateRequest,
  type ActivationCheckResponse,
  type MfaSetupResponse,
} from '@firmivra/types';
import { AuthFrame, Button, Input } from '@firmivra/ui';
import { staffAuth } from '../../lib/auth';
import { useApiMutation, useApiQuery } from '../../lib/query';
import { errorMessage } from '../../lib/errors';
import { PageState } from '../page-state';
import { PasswordFields } from './password-fields';
import { Mfa } from './mfa';
import { SignIn } from './sign-in';

// Only the fragment is accepted; remove it before any auth request or navigation.
function tokenReader() {
  let token: string | null = null;
  return {
    read: () => token,
    subscribe: (notify: () => void) => {
      if (token === null) {
        const url = new URL(window.location.href);
        token = new URLSearchParams(url.hash.slice(1)).get('token') ?? '';
        url.hash = '';
        url.searchParams.delete('token');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
      }
      notify();
      return () => {};
    },
  };
}
export function Activation() {
  const [reader] = useState(tokenReader);
  const token = useSyncExternalStore(reader.subscribe, reader.read, () => null);
  return token ? (
    <CheckedActivation token={token} />
  ) : (
    <AuthFrame site="firm" title="Activate your account">
      <p className="mt-6" role="status">
        {token === null
          ? 'Reading invitation…'
          : 'Open the activation link from your invitation email.'}
      </p>
      <a href="/sign-in" className="mt-4 block text-link">
        Back to sign in
      </a>
    </AuthFrame>
  );
}
function CheckedActivation({ token }: { token: string }) {
  const [cacheId] = useState(() => crypto.randomUUID());
  const query = useApiQuery(['activation', cacheId], () => staffAuth.checkActivation({ token }));
  const content = (
    <PageState query={query}>
      {(invite) =>
        invite.hasAccount ? (
          <>
            <p className="p-4 text-center text-heading">
              Sign in to join {invite.business.name}. Use your existing password.
            </p>
            <SignIn
              site="firm"
              email={invite.email}
              onSignedIn={async () => {
                await staffAuth.acceptInvite({ token });
              }}
            />
          </>
        ) : (
          <ActivateForm token={token} invite={invite} />
        )
      }
    </PageState>
  );
  return query.data ? (
    content
  ) : (
    <AuthFrame site="firm" title="Activate your account">
      {content}
    </AuthFrame>
  );
}
function ActivateForm({ token, invite }: { token: string; invite: ActivationCheckResponse }) {
  const ready = useAuthReady();
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [setup, setSetup] = useState<MfaSetupResponse>();
  const [session, setSession] = useState('');
  const form = useForm<ActivateRequest>({
    resolver: zodResolver(ActivateRequest),
    defaultValues: { token, name: invite.name },
  });
  const password = useWatch({ control: form.control, name: 'password' });
  const mutation = useApiMutation(async (body: ActivateRequest) => {
    const result = await staffAuth.activate(body);
    form.reset();
    setConfirm('');
    if (result.status === 'SIGNED_IN') router.replace('/');
    else {
      const data =
        result.status === 'MFA_SETUP_REQUIRED'
          ? await staffAuth.startMfaSetup({ session: result.session })
          : undefined;
      setSetup(data);
      setSession(data?.session ?? result.session);
    }
  });
  if (session)
    return (
      <Mfa site="firm" session={session} setup={setup} onBack={() => router.replace('/sign-in')} />
    );
  return (
    <AuthFrame site="firm" title="Activate your account">
      <p className="mt-4 text-sm text-muted">
        {invite.business.name} · {invite.email}
      </p>
      <form
        className="auth-form"
        data-testid="activate-form"
        onSubmit={form.handleSubmit((body) => {
          if (body.password !== confirm) {
            form.setError('password', { message: 'The passwords do not match.' });
            return;
          }
          mutation.mutate(body);
        })}
      >
        <fieldset className="contents" disabled={!ready || mutation.isPending}>
          <Input
            label="Your name"
            autoComplete="name"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <PasswordFields
            field={form.register('password')}
            password={password ?? ''}
            error={form.formState.errors.password?.message}
            confirm={confirm}
            onConfirm={setConfirm}
          />
          {mutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(mutation.error)}
            </p>
          ) : null}
          <Button
            type="submit"
            className="auth-submit"
            disabled={mutation.isPending}
            aria-busy={mutation.isPending}
          >
            Activate account
          </Button>
          <a href="/sign-in" className="text-center text-link">
            Back to sign in
          </a>
        </fieldset>
      </form>
    </AuthFrame>
  );
}
