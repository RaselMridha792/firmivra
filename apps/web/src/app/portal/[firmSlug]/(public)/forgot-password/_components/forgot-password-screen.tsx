'use client';

import { ForgotPasswordRequest } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useAuthReady } from '../../../../../../components/auth/use-auth-ready';
import { portalAuth } from '../../../../../../lib/auth';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { type Benefit, SignUpFrame, StepHeading } from '../../sign-up/_components/sign-up-frame';

export const PASSWORD_BENEFITS: Benefit[] = [
  [MailCheck, 'Check your email', 'We send a 6-digit code to the email on your account.'],
  [
    KeyRound,
    'Choose a new password',
    'At least 12 characters, with upper and lower case and a number.',
  ],
  [ShieldCheck, 'Your information is safe', 'We never ask for your password by phone or email.'],
];

/** Where the reset page finds the email typed here, so it never goes in the URL. */
export const resetEmailKey = (slug: string) => ['portal-reset-email', slug];

/**
 * /{firm}/forgot-password (N03, sign-up style). The answer is the same whether or not the email
 * has an account, so the screen always moves on to the reset page.
 */
export function ForgotPasswordScreen() {
  const { business } = usePortal();
  const slug = business.slug;
  const ready = useAuthReady();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(ForgotPasswordRequest),
    defaultValues: { email: '' },
  });
  const send = useApiMutation((body: ForgotPasswordRequest) =>
    portalAuth(slug).forgotPassword(body),
  );
  return (
    <SignUpFrame
      heading="Reset Your"
      highlight="Password"
      intro="Enter the email address you use for the client portal and we'll send you a code to choose a new password."
      benefits={PASSWORD_BENEFITS}
    >
      <StepHeading title="Forgot Your Password?">
        Enter your email address to get a reset code.
      </StepHeading>
      <form
        noValidate
        data-testid="forgot-password-form"
        className="grid gap-4"
        onSubmit={form.handleSubmit((body) =>
          send.mutate(body, {
            onSuccess: () => {
              queryClient.setQueryData(resetEmailKey(slug), body.email);
              router.push(`/${slug}/reset-password`);
            },
          }),
        )}
      >
        <fieldset className="contents" disabled={!ready || send.isPending}>
          <Input
            label="Email Address"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          {send.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(send.error)}
            </p>
          ) : null}
          <Button type="submit" className="text-lg" aria-busy={send.isPending}>
            Send Reset Code <ArrowRight aria-hidden className="size-6" />
          </Button>
        </fieldset>
        <p className="text-center text-text">
          Remembered it?{' '}
          <Link className="text-link underline" href={`/${slug}/sign-in`}>
            Back to sign in
          </Link>
        </p>
      </form>
    </SignUpFrame>
  );
}
