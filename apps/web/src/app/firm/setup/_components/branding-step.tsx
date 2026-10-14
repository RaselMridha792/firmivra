'use client';

import type { FirmSettings } from '@firmivra/types';
import { Input } from '@firmivra/ui';
import { Palette } from 'lucide-react';
import { BrandPreview } from './brand-preview';
import { ColorField } from './fields';
import { LogoField } from './logo-field';
import type { StepProps } from './shared';
import { LockedName, type StepForm, StepFrame, useStepForm } from './step-form';

export const brandingValues = (firm: FirmSettings) => ({
  portalName: firm.portalName ?? '',
  primaryColor: firm.primaryColor ?? '',
  accentColor: firm.accentColor ?? '',
});

/** Step 1: portal name, logo and colours, with a live preview. Every firm starts with Firmivra's. */
export function BrandingStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const stepForm = useStepForm('branding', brandingValues(firm), onNext);
  return (
    <StepFrame title="Branding" icon={Palette} stepForm={stepForm} onBack={onBack}>
      <BrandingFields form={stepForm.form} firm={firm} />
    </StepFrame>
  );
}

/** Also Settings > Branding. */
export function BrandingFields({ form, firm }: { form: StepForm; firm: FirmSettings }) {
  const [portalName, primary, accent] = form.watch(['portalName', 'primaryColor', 'accentColor']);
  const defaultName = `${firm.name} Client Portal`;

  return (
    <>
      <LockedName firm={firm} />
      <Input
        label="Portal name"
        placeholder={defaultName}
        error={form.formState.errors.portalName?.message}
        {...form.register('portalName')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ColorField form={form} name="primaryColor" label="Primary colour" />
        <ColorField form={form} name="accentColor" label="Accent colour" />
      </div>
      <LogoField firm={firm} />
      <BrandPreview
        name={portalName || defaultName}
        logoUrl={firm.logoUrl}
        primary={primary}
        accent={accent}
        header={firm.portalHeader}
        welcome={firm.welcomeMessage}
        signUp={firm.clientSignUpEnabled}
      />
    </>
  );
}
