'use client';

import type { FirmSettings } from '@firmivra/types';
import { Checkbox, Input } from '@firmivra/ui';
import { MonitorSmartphone } from 'lucide-react';
import { BrandPreview } from './brand-preview';
import { TextArea } from './fields';
import type { StepProps } from './shared';
import { type StepForm, StepFrame, useStepForm } from './step-form';
import Link from 'next/link';

export const portalValues = (firm: FirmSettings) => ({
  portalHeader: firm.portalHeader ?? '',
  welcomeMessage: firm.welcomeMessage ?? '',
  clientSignUpEnabled: firm.clientSignUpEnabled,
});

/** Settings > Client portal also sets the landing page's button text (CP-1g). */
export const portalSettingsValues = (firm: FirmSettings) => ({
  ...portalValues(firm),
  portalSignInLabel: firm.portalSignInLabel ?? '',
  portalSignUpLabel: firm.portalSignUpLabel ?? '',
});

/** Step 4: what clients see first on the portal, and whether they may sign up themselves. */
export function PortalStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const stepForm = useStepForm('clientPortal', portalValues(firm), onNext);
  return (
    <StepFrame title="Client portal" icon={MonitorSmartphone} stepForm={stepForm} onBack={onBack}>
      <PortalFields form={stepForm.form} firm={firm} />
    </StepFrame>
  );
}

/**
 * Also Settings > Client portal, where `buttons` adds the landing page's button text, the Portal
 * Appearance link and the device sizes of the Live Preview (CP-1g).
 */
export function PortalFields({
  form,
  firm,
  buttons = false,
}: {
  form: StepForm;
  firm: FirmSettings;
  buttons?: boolean;
}) {
  const [header, welcome, signUp, signInLabel, signUpLabel] = form.watch([
    'portalHeader',
    'welcomeMessage',
    'clientSignUpEnabled',
    'portalSignInLabel',
    'portalSignUpLabel',
  ]);
  return (
    <>
      <Input
        label="Portal heading"
        placeholder={`Welcome to ${firm.portalName ?? `${firm.name} Client Portal`}`}
        error={form.formState.errors.portalHeader?.message}
        {...form.register('portalHeader')}
      />
      <TextArea
        label="Welcome message"
        error={form.formState.errors.welcomeMessage?.message}
        {...form.register('welcomeMessage')}
      />
      <Checkbox
        label="Clients may create their own portal account (you approve each one)"
        {...form.register('clientSignUpEnabled')}
      />
      {buttons ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Sign in button text"
              placeholder="Sign In"
              maxLength={30}
              error={form.formState.errors.portalSignInLabel?.message}
              {...form.register('portalSignInLabel')}
            />
            <Input
              label="Create account button text"
              placeholder="Create an Account"
              maxLength={30}
              error={form.formState.errors.portalSignUpLabel?.message}
              {...form.register('portalSignUpLabel')}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-info-soft p-3 text-sm text-text">
            <span>Logo, colors and theme are managed in Branding settings.</span>
            <Link href="/settings/branding" className="font-semibold text-link">
              Go to Branding
            </Link>
          </div>
        </>
      ) : null}
      <BrandPreview
        name={firm.portalName ?? `${firm.name} Client Portal`}
        primary={firm.primaryColor}
        accent={firm.accentColor}
        header={header}
        welcome={welcome}
        signUp={signUp}
        signInLabel={buttons ? signInLabel || null : null}
        signUpLabel={buttons ? signUpLabel || null : null}
        devices={buttons}
      />
    </>
  );
}
