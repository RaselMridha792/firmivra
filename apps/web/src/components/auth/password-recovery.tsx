'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ForgotPasswordRequest, ResetPasswordRequest } from '@firmivra/types';
import { AuthFrame, Button, Input } from '@firmivra/ui';
import { staffAuth, adminAuth } from '../../lib/auth';
import { useApiMutation } from '../../lib/query';
import { errorMessage } from '../../lib/errors';
import { PasswordFields } from './password-fields';

export function PasswordRecovery({
  site,
  reset = false,
}: {
  site: 'firm' | 'admin';
  reset?: boolean;
}) {
  return (
    <AuthFrame site={site} title={reset ? 'Reset password' : 'Forgot password'}>
      {reset ? <ResetPassword site={site} /> : <ForgotPassword site={site} />}
      <a className="mt-4 block text-center text-link" href="/sign-in">
        Back to sign in
      </a>
    </AuthFrame>
  );
}
function ForgotPassword({ site }: { site: 'firm' | 'admin' }) {
  const client = site === 'admin' ? adminAuth : staffAuth;
  const form = useForm<ForgotPasswordRequest>({ resolver: zodResolver(ForgotPasswordRequest) });
  const mutation = useApiMutation((body: ForgotPasswordRequest) => client.forgotPassword(body));
  return (
    <form
      className="auth-form"
      data-testid="forgot-form"
      onSubmit={form.handleSubmit((body) => mutation.mutate(body))}
    >
      <Input
        label="Email Address"
        type="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status">
          If an account matches this email, we sent a reset code.{' '}
          <a className="text-link" href="/reset-password">
            Enter your reset code
          </a>
        </p>
      ) : null}
      <Button
        type="submit"
        className="auth-submit"
        disabled={mutation.isPending}
        aria-busy={mutation.isPending}
      >
        Send reset code
      </Button>
    </form>
  );
}
function ResetPassword({ site }: { site: 'firm' | 'admin' }) {
  const client = site === 'admin' ? adminAuth : staffAuth;
  const [confirm, setConfirm] = useState('');
  const form = useForm<ResetPasswordRequest>({ resolver: zodResolver(ResetPasswordRequest) });
  const mutation = useApiMutation(async (body: ResetPasswordRequest) => {
    await client.resetPassword(body);
    form.reset();
    setConfirm('');
  });
  return (
    <form
      className="auth-form"
      data-testid="reset-form"
      onSubmit={form.handleSubmit((body) => {
        if (body.password !== confirm) {
          form.setError('password', { message: 'The passwords do not match.' });
          return;
        }
        mutation.mutate(body);
      })}
    >
      <Input
        label="Email Address"
        type="email"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <Input
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={form.formState.errors.code?.message}
        {...form.register('code')}
      />
      <PasswordFields
        field={form.register('password')}
        password={form.watch('password') ?? ''}
        error={form.formState.errors.password?.message}
        confirm={confirm}
        onConfirm={setConfirm}
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p role="status">Your password was reset. Sign in with your new password.</p>
      ) : null}
      <Button
        type="submit"
        className="auth-submit"
        disabled={mutation.isPending}
        aria-busy={mutation.isPending}
      >
        Reset password
      </Button>
    </form>
  );
}
