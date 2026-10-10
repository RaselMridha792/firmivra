'use client';

import { SignInRequest, type SignInResult } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuthReady } from '../../../../../../components/auth/use-auth-ready';
import { AUTH_MODE, DEV_USERS, portalAuth, signIn } from '../../../../../../lib/auth';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { MfaStep, type Challenge } from './mfa-step';

/**
 * Sign in with email and password, then the authenticator code when the client turned MFA on
 * (or its first-time setup). A wrong email and a wrong password get the same answer.
 */
export function SignInForm() {
  const { business } = usePortal();
  const slug = business.slug;
  const client = portalAuth(slug);
  const ready = useAuthReady();
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<Challenge>();
  const form = useForm<SignInRequest>({
    resolver: zodResolver(SignInRequest),
    defaultValues: { email: '', password: '' },
  });
  // The shell sends a client the firm has not approved yet on to /sign-up/done.
  const home = () => router.replace(`/${slug}/home`);
  const mutation = useApiMutation(async (action: () => Promise<SignInResult | void>) => {
    const result = await action();
    form.resetField('password');
    if (!result || result.status === 'SIGNED_IN') return home();
    const setup =
      result.status === 'MFA_SETUP_REQUIRED'
        ? await client.startMfaSetup({ session: result.session })
        : undefined;
    setChallenge({ session: setup?.session ?? result.session, setup });
  });

  if (challenge) {
    return (
      <MfaStep
        {...challenge}
        onSignedIn={home}
        onBack={() => {
          setChallenge(undefined);
          mutation.reset();
        }}
      />
    );
  }
  return (
    <>
      <form
        noValidate
        data-testid="sign-in-form"
        className="grid gap-4"
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate(() => client.signIn(body), {
            onError: () => form.resetField('password'),
          }),
        )}
      >
        <fieldset className="contents" disabled={!ready || mutation.isPending}>
          <Input
            label="Email Address"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <div className="relative">
            <Input
              label="Password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="pr-12"
              error={form.formState.errors.password?.message}
              {...form.register('password')}
            />
            <Button
              variant="ghost"
              className="absolute top-6 right-0"
              aria-label={show ? 'Hide password' : 'Show password'}
              aria-pressed={show}
              onClick={() => setShow(!show)}
            >
              {show ? (
                <EyeOff aria-hidden className="size-5" />
              ) : (
                <Eye aria-hidden className="size-5" />
              )}
            </Button>
          </div>
          <Link
            className="justify-self-end text-sm text-link underline"
            href={`/${slug}/forgot-password`}
          >
            Forgot your password?
          </Link>
          {mutation.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(mutation.error)}
            </p>
          ) : null}
          <Button type="submit" className="text-lg" aria-busy={mutation.isPending}>
            Sign In <ArrowRight aria-hidden className="size-6" />
          </Button>
        </fieldset>
        <p className="text-center text-text">
          New to our client portal?{' '}
          <Link className="text-link underline" href={`/${slug}/sign-up`}>
            Create an account
          </Link>
        </p>
      </form>
      {AUTH_MODE === 'local' ? (
        <details open className="mt-6 text-sm">
          <summary>Local development: quick sign-in</summary>
          <div className="mt-4 grid gap-2">
            {DEV_USERS.CLIENT.map((user) => (
              <Button
                key={user.email}
                variant="secondary"
                disabled={!ready || mutation.isPending}
                onClick={() => mutation.mutate(() => signIn(user.email, 'CLIENT'))}
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
