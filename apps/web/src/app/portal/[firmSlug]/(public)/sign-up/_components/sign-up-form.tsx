'use client';

import { type AccountType, type LegalKind, PASSWORD_RULES, SignUpRequest } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, EyeOff, Circle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { useAuthReady } from '../../../../../../components/auth/use-auth-ready';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { LegalDialog } from '../../_components/legal-dialog';
import { SIGN_UP_ERRORS } from './shared';

/** The API's fields (the versions come from the firm's info), plus the two the screen checks. */
const Fields = SignUpRequest.omit({ accepted: true });
type Values = Omit<SignUpRequest, 'accepted'> & { confirm: string; agree: boolean };

const fieldsResolver = zodResolver(Fields);
const resolver: Resolver<Values> = async (values, context, options) => {
  const result = await fieldsResolver(values, context, options as never);
  const errors: FieldErrors<Values> = { ...(result.errors as FieldErrors<Values>) };
  if (values.confirm !== values.password) {
    errors.confirm = { type: 'validate', message: 'The passwords do not match' };
  }
  if (!values.agree) {
    errors.agree = { type: 'validate', message: 'Agree to the Terms and Privacy Policy' };
  }
  return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
};

const ACCOUNT_TYPES: { value: AccountType; label: string; description: string }[] = [
  { value: 'INDIVIDUAL', label: 'Individual', description: 'For personal tax services' },
  {
    value: 'BUSINESS',
    label: 'Business',
    description: 'For business tax, bookkeeping and formation services',
  },
];

/**
 * Step 1, "Create Your Account". The answer is the same whether or not the email already has
 * an account at this firm (the API emails that person instead of sending a code), so the screen
 * always moves on to Verify Email.
 */
export function SignUpForm() {
  const { business, legal, signUpOpen } = usePortal();
  const slug = business.slug;
  const router = useRouter();
  const ready = useAuthReady();
  const queryClient = useQueryClient();
  const [show, setShow] = useState(false);
  const [reading, setReading] = useState<LegalKind | null>(null);
  const form = useForm<Values>({
    resolver,
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      confirm: '',
      accountType: 'INDIVIDUAL',
      agree: false,
    },
  });
  const create = useApiMutation((body: SignUpRequest) => portalAuth(slug).signUp(body));
  const password = useWatch({ control: form.control, name: 'password' });
  const errors = form.formState.errors;

  if (!signUpOpen || !legal.terms || !legal.privacy) {
    return (
      <p role="status" data-testid="sign-up-closed" className="text-lg text-text">
        {business.name} is not taking new sign-ups online right now. Please contact the firm.
      </p>
    );
  }
  const accepted = { termsVersion: legal.terms.version, privacyVersion: legal.privacy.version };

  return (
    <form
      noValidate
      data-testid="sign-up-form"
      onSubmit={form.handleSubmit(({ confirm: _confirm, agree: _agree, ...fields }) =>
        create.mutate(
          { ...fields, accepted },
          {
            onSuccess: (state) => {
              queryClient.setQueryData(['sign-up-state', slug], state);
              router.push(`/${slug}/sign-up/verify-email`);
            },
            onError: (error) => {
              if (errorCode(error) === 'TERMS_OUTDATED') {
                form.setValue('agree', false);
                void queryClient.invalidateQueries({ queryKey: ['portal-info', slug] });
              }
            },
          },
        ),
      )}
    >
      <fieldset className="grid gap-4 md:grid-cols-2" disabled={!ready || create.isPending}>
        <Input
          label="Full Name *"
          autoComplete="name"
          placeholder="Enter your full name"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <Input
          label="Email Address *"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <div className="md:col-span-2">
          <Input
            label="Phone Number *"
            type="tel"
            autoComplete="tel-national"
            placeholder="(770) 123-4567"
            error={errors.phone?.message}
            {...form.register('phone')}
          />
          <p className="mt-1 text-xs text-muted">A US mobile number: we text it a code.</p>
        </div>
        {(['password', 'confirm'] as const).map((name) => (
          <div key={name} className="relative md:col-span-2">
            <Input
              label={name === 'password' ? 'Create a Password *' : 'Confirm Password *'}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={name === 'password' ? 'Create a password' : 'Confirm your password'}
              className="pr-12"
              error={errors[name]?.message}
              {...form.register(name)}
            />
            <Button
              variant="ghost"
              className="absolute top-6 right-0"
              aria-label={show ? 'Hide passwords' : 'Show passwords'}
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
        ))}
        <ul aria-label="Password rules" className="grid gap-1 text-sm md:col-span-2 md:grid-cols-2">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(password);
            const Icon = met ? Check : Circle;
            return (
              <li
                key={rule.id}
                className={`flex items-center gap-2 ${met ? 'text-success' : 'text-muted'}`}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {rule.label}
                <span className="sr-only">{met ? ', done' : ', not yet'}</span>
              </li>
            );
          })}
        </ul>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-lg font-bold text-heading">Account Type *</legend>
          <div className="grid gap-4 md:grid-cols-2">
            {ACCOUNT_TYPES.map((type) => (
              <label
                key={type.value}
                className="flex cursor-pointer gap-3 rounded-card border border-border p-4 has-checked:border-action has-checked:bg-folder-surface"
              >
                <input
                  type="radio"
                  value={type.value}
                  className="mt-1 size-5 shrink-0 accent-action"
                  {...form.register('accountType')}
                />
                <span>
                  <span className="block font-bold text-heading">{type.label}</span>
                  <span className="text-sm text-text">{type.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <div className="flex flex-wrap items-center gap-x-1 text-base text-text">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-action"
                aria-invalid={errors.agree ? true : undefined}
                {...form.register('agree')}
              />
              I agree to the
            </label>
            <LegalLink onClick={() => setReading('terms')}>Terms of Service</LegalLink>
            and
            <span>
              <LegalLink onClick={() => setReading('privacy')}>Privacy Policy</LegalLink>.
            </span>
          </div>
          {errors.agree ? <p className="text-xs text-danger">{errors.agree.message}</p> : null}
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            {errorMessage(create.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <Button type="submit" className="text-lg md:col-span-2" aria-busy={create.isPending}>
          {create.isPending ? 'Creating your account…' : 'Create Account'}
          <ArrowRight aria-hidden className="size-6" />
        </Button>
      </fieldset>
      <LegalDialog slug={slug} kind={reading} onClose={() => setReading(null)} />
    </form>
  );
}

function LegalLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" className="text-link underline" onClick={onClick}>
      {children}
    </button>
  );
}
