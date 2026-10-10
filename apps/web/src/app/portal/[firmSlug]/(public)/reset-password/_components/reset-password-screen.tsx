'use client';

import { ResetPasswordRequest } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { type FieldErrors, type Resolver, useForm } from 'react-hook-form';
import { useAuthReady } from '../../../../../../components/auth/use-auth-ready';
import { portalAuth } from '../../../../../../lib/auth';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { ButtonLink } from '../../_components/button-link';
import { SignUpFrame, StepHeading } from '../../sign-up/_components/sign-up-frame';
import {
  PASSWORD_BENEFITS,
  resetEmailKey,
} from '../../forgot-password/_components/forgot-password-screen';

type Values = ResetPasswordRequest & { confirm: string };
const fieldsResolver = zodResolver(ResetPasswordRequest);
const resolver: Resolver<Values> = async (values, context, options) => {
  const result = await fieldsResolver(values, context, options as never);
  const errors: FieldErrors<Values> = { ...(result.errors as FieldErrors<Values>) };
  if (values.confirm !== values.password) {
    errors.confirm = { type: 'validate', message: 'The passwords do not match' };
  }
  return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
};

/**
 * /{firm}/reset-password (N03): the emailed code and a new password. Opened from its URL it asks
 * for the email too; it never moves on by itself, and a wrong email gets the same answer as a
 * wrong code.
 */
export function ResetPasswordScreen() {
  const { business } = usePortal();
  const slug = business.slug;
  const ready = useAuthReady();
  const queryClient = useQueryClient();
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      email: queryClient.getQueryData<string>(resetEmailKey(slug)) ?? '',
      code: '',
      password: '',
      confirm: '',
    },
  });
  const reset = useApiMutation(({ confirm: _confirm, ...body }: Values) =>
    portalAuth(slug).resetPassword(body),
  );
  const errors = form.formState.errors;
  return (
    <SignUpFrame
      heading="Choose a New"
      highlight="Password"
      intro="Enter the 6-digit code from your email and choose a new password for your client portal."
      benefits={PASSWORD_BENEFITS}
    >
      {reset.isSuccess ? (
        <div role="status" data-testid="password-changed" className="grid gap-4 text-center">
          <Check
            aria-hidden
            className="mx-auto size-20 rounded-full bg-folder-surface p-4 text-firm-primary"
          />
          <StepHeading title="Password Changed">
            You can now sign in with your new password.
          </StepHeading>
          <ButtonLink href={`/${slug}/sign-in`}>Sign In</ButtonLink>
        </div>
      ) : (
        <>
          <StepHeading title="Reset Your Password">
            If an account uses that email, we sent it a 6-digit code.
          </StepHeading>
          <form
            noValidate
            data-testid="reset-password-form"
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) =>
              reset.mutate(values, { onError: () => form.resetField('code') }),
            )}
          >
            <fieldset className="contents" disabled={!ready || reset.isPending}>
              <Input
                label="Email Address"
                type="email"
                autoComplete="username"
                error={errors.email?.message}
                {...form.register('email')}
              />
              <Input
                label="Reset code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                error={errors.code?.message}
                {...form.register('code')}
              />
              <Input
                label="New Password"
                type="password"
                autoComplete="new-password"
                error={errors.password?.message}
                {...form.register('password')}
              />
              <Input
                label="Confirm New Password"
                type="password"
                autoComplete="new-password"
                error={errors.confirm?.message}
                {...form.register('confirm')}
              />
              {reset.isError ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(reset.error)}
                </p>
              ) : null}
              <Button type="submit" className="text-lg" aria-busy={reset.isPending}>
                Change Password <ArrowRight aria-hidden className="size-6" />
              </Button>
            </fieldset>
            <p className="text-center text-text">
              No code?{' '}
              <Link className="text-link underline" href={`/${slug}/forgot-password`}>
                Send a new one
              </Link>
            </p>
          </form>
        </>
      )}
    </SignUpFrame>
  );
}
