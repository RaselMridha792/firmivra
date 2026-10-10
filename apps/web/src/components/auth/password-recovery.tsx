'use client';
import { type ReactNode, useEffect, useRef } from 'react';
import { type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordRequest, ResetPasswordRequest } from '@firmivra/types';
import { AuthFrame, Button, Input } from '@firmivra/ui';
import { ArrowLeft, ArrowRight, KeyRound, Mail } from 'lucide-react';
import { adminAuth, staffAuth } from '../../lib/auth';
import { useApiMutation } from '../../lib/query';
import { errorCode, errorMessage } from '../../lib/errors';
import { PasswordFields } from './password-fields';
import { useAuthReady } from './use-auth-ready';

type Site = 'firm' | 'admin';

/** Button's classes with the screen's main-button look (auth-submit), for a link. */
const SUBMIT_LINK =
  'auth-submit inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-on-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Forgot password (email a reset code) and reset password (code and a new password), in the
 * sign-in screen's frame. Neither step ever says whether an account uses the email.
 */
export function PasswordRecovery({ site, reset = false }: { site: Site; reset?: boolean }) {
  return (
    <AuthFrame
      site={site}
      title={reset ? 'Reset Password' : 'Forgot Password?'}
      subtitle={
        reset
          ? 'Enter the code from your email and choose a new password.'
          : "Enter your email and we'll send you a reset code."
      }
    >
      <h1 className="sr-only">{site === 'admin' ? 'Super Admin console' : 'Firm workspace'}</h1>
      {reset ? <ResetPassword site={site} /> : <ForgotPassword site={site} />}
      <a className="mx-auto mt-6 flex w-fit items-center gap-2 text-base text-link" href="/sign-in">
        <ArrowLeft aria-hidden="true" className="size-5" /> Back to sign in
      </a>
    </AuthFrame>
  );
}

function ForgotPassword({ site }: { site: Site }) {
  const ready = useAuthReady();
  const client = site === 'admin' ? adminAuth : staffAuth;
  const form = useForm<ForgotPasswordRequest>({ resolver: zodResolver(ForgotPasswordRequest) });
  const mutation = useApiMutation((body: ForgotPasswordRequest) => client.forgotPassword(body));
  if (mutation.isSuccess)
    return (
      <Done
        id="forgot-sent"
        title="Check your email"
        text="If an account uses this email, we sent it a 6-digit reset code. It can take a few minutes to arrive."
        href="/reset-password"
        action="Enter your reset code"
      />
    );
  return (
    <>
      <ErrorText error={mutation.isError ? mutation.error : undefined} />
      <form
        className="auth-form"
        data-testid="forgot-form"
        noValidate
        onSubmit={form.handleSubmit((body) => mutation.mutate(body))}
      >
        <fieldset className="contents" disabled={!ready || mutation.isPending}>
          <IconField icon={<Mail aria-hidden="true" className={ICON} />}>
            <Input
              label="Email Address"
              type="email"
              autoComplete="username"
              placeholder="Enter your email address"
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />
          </IconField>
          <Button
            type="submit"
            className="auth-submit"
            disabled={!ready || mutation.isPending}
            aria-busy={mutation.isPending}
          >
            Send Reset Code <ArrowRight aria-hidden="true" className="h-7 w-7" />
          </Button>
        </fieldset>
      </form>
    </>
  );
}

type ResetValues = ResetPasswordRequest & { confirm: string };

/** The API's rules for email, code and password, plus the confirmation, which only the screen checks. */
const resetResolver = zodResolver(ResetPasswordRequest);
const resolver: Resolver<ResetValues> = async (values, context, options) => {
  const result = await resetResolver(values, context, options as never);
  const errors: FieldErrors<ResetValues> = { ...(result.errors as FieldErrors<ResetValues>) };
  if (values.confirm !== values.password) {
    errors.confirm = { type: 'validate', message: 'The passwords do not match' };
  }
  return Object.keys(errors).length > 0
    ? { values: {}, errors }
    : {
        values: { ...(result.values as ResetPasswordRequest), confirm: values.confirm },
        errors: {},
      };
};

function ResetPassword({ site }: { site: Site }) {
  const ready = useAuthReady();
  const client = site === 'admin' ? adminAuth : staffAuth;
  const form = useForm<ResetValues>({
    resolver,
    defaultValues: { email: '', code: '', password: '', confirm: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });
  const mutation = useApiMutation(({ confirm: _confirm, ...body }: ResetValues) =>
    client.resetPassword(body),
  );
  // RESET_CODE_INVALID also covers a new password Cognito refuses (a leaked one, say), so the
  // text names both; only that answer clears the code, and a 429 or a network error keeps it.
  if (mutation.isSuccess)
    return (
      <Done
        id="reset-done"
        title="Your password was reset."
        text="You were signed out everywhere. Sign in with your new password."
        href="/sign-in"
        action="Go to sign in"
      />
    );
  return (
    <>
      <ErrorText error={mutation.isError ? mutation.error : undefined} overrides={RESET_ERRORS} />
      <form
        className="auth-form"
        data-testid="reset-form"
        noValidate
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate(values, {
            onSuccess: () => form.reset(),
            onError: (error) => {
              if (errorCode(error) === 'RESET_CODE_INVALID') form.resetField('code');
            },
          }),
        )}
      >
        <fieldset className="contents" disabled={!ready || mutation.isPending}>
          <IconField icon={<Mail aria-hidden="true" className={ICON} />}>
            <Input
              label="Email Address"
              type="email"
              autoComplete="username"
              placeholder="Enter your email address"
              error={form.formState.errors.email?.message}
              {...form.register('email')}
            />
          </IconField>
          <IconField icon={<KeyRound aria-hidden="true" className={ICON} />}>
            <Input
              label="Reset Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              maxLength={12}
              error={form.formState.errors.code?.message}
              {...form.register('code')}
            />
          </IconField>
          <PasswordFields
            password={form.register('password', { deps: 'confirm' })}
            confirm={form.register('confirm')}
            value={password}
            errors={{
              password: form.formState.errors.password?.message,
              confirm: form.formState.errors.confirm?.message,
            }}
          />
          <Button
            type="submit"
            className="auth-submit"
            disabled={!ready || mutation.isPending}
            aria-busy={mutation.isPending}
          >
            Reset Password <ArrowRight aria-hidden="true" className="h-7 w-7" />
          </Button>
          <p className="text-center text-base text-muted">
            No code?{' '}
            <a className="text-link" href="/forgot-password">
              Send a new one
            </a>
          </p>
        </fieldset>
      </form>
    </>
  );
}

const ICON = 'pointer-events-none absolute top-12 left-5 h-6 w-6 text-muted';

/** An input with its icon inside, as on the sign-in screen. */
function IconField({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-field relative">
      {children}
      {icon}
    </div>
  );
}

const RESET_ERRORS = {
  RESET_CODE_INVALID: 'That code is not right or has expired, or choose another password.',
};

function ErrorText({ error, overrides }: { error: unknown; overrides?: Record<string, string> }) {
  return error ? (
    <p role="alert" className="mt-4 text-sm text-danger">
      {errorMessage(error, overrides)}
    </p>
  ) : null;
}

/** The step's result with the one way on, as a link in the screen's main-button look. */
// The form it replaces had focus, so the title takes it and screen readers read the result.
function Done(props: { id: string; title: string; text: string; href: string; action: string }) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  return (
    <div className="mt-6 grid gap-6 text-center">
      <div role="status" data-testid={props.id} className="grid gap-2">
        <p ref={titleRef} tabIndex={-1} className="text-lg font-semibold text-heading outline-none">
          {props.title}
        </p>
        <p className="text-muted">{props.text}</p>
      </div>
      <a href={props.href} className={SUBMIT_LINK}>
        {props.action} <ArrowRight aria-hidden="true" className="h-7 w-7" />
      </a>
    </div>
  );
}
