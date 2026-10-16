'use client';

import { ChangeEmailRequest, ChangePhoneRequest, type SignUpState } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Clock3, Mail, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { usePortal } from '../../../layout';
import { ButtonLink } from '../../_components/button-link';
import { CodeInput } from '../../_components/code-input';
import { SIGN_UP_ERRORS } from './shared';
import { StepHeading } from './sign-up-frame';
import { stepPath, useSignUpState } from './use-sign-up-state';

type Channel = 'email' | 'phone';
const STEP: Record<Channel, SignUpState['step']> = { email: 'VERIFY_EMAIL', phone: 'VERIFY_PHONE' };

/** Verify Email or Verify Phone (docs/mockups/client-portal/Verify email .png, Verify phone.png). */
export function VerifyStep({ channel }: { channel: Channel }) {
  const { business } = usePortal();
  const slug = business.slug;
  const { state, action, run } = useSignUpState(slug);
  const [code, setCode] = useState('');
  const [changing, setChanging] = useState(false);
  const client = portalAuth(slug);
  const Icon = channel === 'email' ? Mail : Smartphone;
  const title = channel === 'email' ? 'Verify Your Email Address' : 'Verify Your Phone Number';

  if (errorCode(state.error) === 'SIGN_UP_EXPIRED') return <Expired />;
  return (
    <PageState query={state}>
      {(s) => {
        if (s.step === 'CONTACT_FIRM') return <ContactFirm />;
        if (s.step !== STEP[channel]) return <OtherStep step={s.step} />;
        const to = channel === 'email' ? s.email : s.phoneMasked;
        return (
          <div className="text-center [&_header_p]:text-firm-primary [&_h1]:text-platform-navy">
            <Icon
              aria-hidden
              className="mx-auto size-16 rounded-full bg-folder-surface p-4 text-platform-navy"
            />
            <StepHeading title={title}>
              <span className="block">
                We&apos;ve sent a 6-digit verification code{' '}
                {channel === 'email' ? 'to' : 'by text to'}
              </span>
              <strong data-testid="code-sent-to" className="mt-1 block text-platform-navy">
                {to}
              </strong>
              <span className="mt-3 block">
                Please enter the code below to confirm your{' '}
                {channel === 'email' ? 'email address' : 'phone number'}.
              </span>
            </StepHeading>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                const body = { code };
                run(
                  () => (channel === 'email' ? client.verifyEmail(body) : client.verifyPhone(body)),
                  () => setCode(''),
                );
              }}
              className="grid gap-4 [&_fieldset]:gap-2 [&_fieldset_input]:w-8 [&_fieldset_input]:shadow-sm [&_fieldset_input]:placeholder:font-normal [&_fieldset_input]:placeholder:text-platform-navy [&_fieldset_input]:focus-visible:outline-platform-blue md:[&_fieldset]:gap-3 md:[&_fieldset_input]:size-16"
            >
              <CodeInput
                label="Verification code"
                value={code}
                onChange={setCode}
                disabled={action.isPending}
                invalid={action.isError}
                placeholder="—"
              />
              <Resend
                at={s.resendAvailableAt}
                disabled={action.isPending}
                onResend={() => run(() => client.resendCode({ channel }))}
              />
              {action.isError ? (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(action.error, SIGN_UP_ERRORS)}
                </p>
              ) : null}
              <Button
                type="submit"
                className="min-h-12 text-lg enabled:bg-platform-blue! enabled:hover:bg-platform-blue-hover! focus-visible:outline-platform-blue"
                disabled={action.isPending || code.replace(/\s/g, '').length < 6}
              >
                {channel === 'email' ? 'Verify Email' : 'Verify Phone Number'}
                <ArrowRight aria-hidden className="size-6" />
              </Button>
            </form>
            <div aria-hidden className="mt-4 flex items-center gap-6 px-12 text-sm text-muted">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            {changing ? (
              <ChangeForm
                channel={channel}
                pending={action.isPending}
                onCancel={() => setChanging(false)}
                onSave={(value) =>
                  run(
                    () =>
                      channel === 'email'
                        ? client.changeEmail({ email: value })
                        : client.changePhone({ phone: value }),
                    () => setChanging(false),
                  )
                }
              />
            ) : (
              <Button
                variant="ghost"
                className="mt-4 min-h-0 px-0 py-0 text-platform-blue! underline hover:bg-transparent! focus-visible:outline-platform-blue"
                onClick={() => setChanging(true)}
              >
                {channel === 'email' ? 'Change Email Address' : 'Change Phone Number'}
              </Button>
            )}
          </div>
        );
      }}
    </PageState>
  );
}

/** "Didn't receive the code? Resend Code (0:45)", counting down to `at`. */
function Resend({
  at,
  disabled,
  onResend,
}: {
  at: string | null;
  disabled: boolean;
  onResend: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = at ? Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)) : 0;
  useEffect(() => {
    if (left <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [left]);
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <p className="text-sm text-firm-primary">
      Didn&apos;t receive the code?{' '}
      <Button
        variant="ghost"
        className="min-h-0 px-0 py-0 text-platform-blue! underline hover:bg-transparent! focus-visible:outline-platform-blue"
        disabled={disabled || left > 0}
        onClick={onResend}
      >
        Resend Code{left > 0 ? ` (${clock})` : ''}
      </Button>
    </p>
  );
}

function ChangeForm({
  channel,
  pending,
  onSave,
  onCancel,
}: {
  channel: Channel;
  pending: boolean;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const schema = channel === 'email' ? ChangeEmailRequest : ChangePhoneRequest;
  const field = channel === 'email' ? 'email' : 'phone';
  const form = useForm<{ email?: string; phone?: string }>({
    resolver: zodResolver(schema) as never,
  });
  return (
    <form
      noValidate
      data-testid="change-form"
      onSubmit={form.handleSubmit((values) => onSave(values[field] ?? ''))}
      className="mt-6 grid gap-3 text-left"
    >
      <Input
        label={channel === 'email' ? 'New email address' : 'New US mobile number'}
        type={channel === 'email' ? 'email' : 'tel'}
        error={form.formState.errors[field]?.message}
        {...form.register(field)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Send a new code
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The sign-up is on another step: point there, without moving the person by itself. */
function OtherStep({ step }: { step: SignUpState['step'] }) {
  const { business } = usePortal();
  const path = stepPath(business.slug, step);
  return (
    <div role="status" className="grid gap-4 text-center">
      <StepHeading title="Continue your sign-up">Your sign-up is on another step.</StepHeading>
      {path ? (
        <Link className="text-link underline" href={path}>
          Continue your sign-up
        </Link>
      ) : null}
    </div>
  );
}

/** No sign-up in progress (410 SIGN_UP_EXPIRED): it timed out, or none was started here. */
export function Expired() {
  const { business } = usePortal();
  return (
    <div
      role="status"
      data-testid="sign-up-expired"
      className="grid gap-4 text-center [&_header]:mb-0 [&_header_p]:text-firm-primary [&_h1]:text-platform-navy"
    >
      <Clock3
        aria-hidden
        strokeWidth={3}
        className="mx-auto size-24 rounded-full bg-folder-surface p-6 text-platform-blue"
      />
      <StepHeading title="Your sign-up timed out">Please start your sign-up again.</StepHeading>
      <ButtonLink
        className="bg-platform-blue! hover:bg-platform-blue-hover! focus-visible:outline-platform-blue"
        href={`/${business.slug}/sign-up`}
      >
        Start a new sign-up
      </ButtonLink>
    </div>
  );
}

/** CONTACT_FIRM: this sign-up can't go on online; a new one can. */
export function ContactFirm() {
  const { business } = usePortal();
  return (
    <div role="status" data-testid="contact-firm" className="grid gap-4 text-center">
      <StepHeading title="We couldn't finish your sign-up">
        We couldn&apos;t finish your sign-up online. Please contact {business.name}.
      </StepHeading>
      <Link className="text-link underline" href={`/${business.slug}/sign-up`}>
        Start a new sign-up
      </Link>
    </div>
  );
}
