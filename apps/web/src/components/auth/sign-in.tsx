'use client';
import { useAuthReady } from './use-auth-ready';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInRequest, type SignInResult, type MfaSetupResponse } from '@firmivra/types';
import { AuthFrame, Button, Input, Checkbox } from '@firmivra/ui';
import { Eye, Mail, Lock, ArrowRight } from 'lucide-react';
import { AUTH_MODE, DEV_USERS, adminAuth, staffAuth, signIn } from '../../lib/auth';
import { useApiMutation } from '../../lib/query';
import { errorMessage } from '../../lib/errors';
import { Mfa } from './mfa';

export function SignIn({
  site,
  email,
  onSignedIn,
}: {
  site: 'firm' | 'admin';
  email?: string;
  onSignedIn?: () => Promise<void>;
}) {
  const client = site === 'admin' ? adminAuth : staffAuth;
  const ready = useAuthReady();
  const router = useRouter();
  const [challenge, setChallenge] = useState<{ session: string; setup?: MfaSetupResponse }>();
  const [show, setShow] = useState(false);
  const form = useForm<SignInRequest>({
    resolver: zodResolver(SignInRequest),
    defaultValues: { email },
  });
  const mutation = useApiMutation(async (action: () => Promise<SignInResult | void>) => {
    const result = await action();
    form.resetField('password');
    if (!result || result.status === 'SIGNED_IN') {
      if (onSignedIn) await onSignedIn();
      router.replace('/');
    } else {
      const setup =
        result.status === 'MFA_SETUP_REQUIRED'
          ? await client.startMfaSetup({ session: result.session })
          : undefined;
      setChallenge({ session: setup?.session ?? result.session, setup });
    }
  });
  if (challenge)
    return (
      <Mfa
        site={site}
        {...challenge}
        onSignedIn={onSignedIn}
        onBack={() => {
          setChallenge(undefined);
          mutation.reset();
          form.reset();
        }}
      />
    );
  return (
    <>
      <AuthFrame site={site} title="Welcome Back">
        <h1 className="sr-only">{site === 'admin' ? 'Super Admin console' : 'Firm workspace'}</h1>
        {mutation.isError ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
        <form
          data-testid="sign-in-form"
          className="auth-form"
          onSubmit={form.handleSubmit((body) =>
            mutation.mutate(() => client.signIn(body), {
              onError: () => form.resetField('password'),
            }),
          )}
        >
          <fieldset className="contents" disabled={!ready || mutation.isPending}>
            <div className="auth-field relative">
              <Input
                label="Email Address"
                type="email"
                autoComplete="username"
                placeholder="Enter your email address"
                error={form.formState.errors.email?.message}
                {...form.register('email')}
              />
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute top-12 left-5 h-6 w-6 text-muted"
              />
            </div>
            <div className="auth-field relative">
              <Input
                label="Password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                error={form.formState.errors.password?.message}
                {...form.register('password')}
              />
              <Lock
                aria-hidden="true"
                className="pointer-events-none absolute top-12 left-5 h-6 w-6 text-muted"
              />
              <Button
                className="absolute top-10 right-2"
                variant="ghost"
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                onClick={() => setShow(!show)}
              >
                <Eye aria-hidden="true" className="h-6 w-6 text-muted" />
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 text-base">
              <Checkbox label="Remember me" />
              <a className="text-link" href="/forgot-password">
                Forgot password?
              </a>
            </div>
            <Button
              type="submit"
              className="auth-submit"
              disabled={!ready || mutation.isPending}
              aria-busy={mutation.isPending}
            >
              Sign In <ArrowRight aria-hidden="true" className="h-7 w-7" />
            </Button>
          </fieldset>
        </form>
      </AuthFrame>
      {AUTH_MODE === 'local' ? (
        <details open className="mx-auto max-w-auth p-6">
          <summary>Local development: quick sign-in</summary>
          <div className="mt-4 grid gap-2">
            {DEV_USERS[site === 'admin' ? 'ADMIN' : 'STAFF'].map((user) => (
              <Button
                key={user.email}
                variant="secondary"
                disabled={!ready || mutation.isPending}
                onClick={() =>
                  mutation.mutate(() => signIn(user.email, site === 'admin' ? 'ADMIN' : 'STAFF'))
                }
              >
                Quick sign-in: {user.email}
              </Button>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
