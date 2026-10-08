'use client';

import type { FirmSettings } from '@firmivra/types';
import { Badge, Checkbox, Input } from '@firmivra/ui';
import { MonitorSmartphone } from 'lucide-react';
import { BrandPreview } from './brand-preview';
import { TextArea } from './fields';
import type { StepProps } from './shared';
import { type StepForm, StepFrame, useStepForm } from './step-form';

export const portalValues = (firm: FirmSettings) => ({
  portalHeader: firm.portalHeader ?? '',
  welcomeMessage: firm.welcomeMessage ?? '',
  clientSignUpEnabled: firm.clientSignUpEnabled,
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

/** Also Settings > Client portal. */
export function PortalFields({ form, firm }: { form: StepForm; firm: FirmSettings }) {
  const [header, welcome, signUp] = form.watch([
    'portalHeader',
    'welcomeMessage',
    'clientSignUpEnabled',
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
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Turning portal features on and off: <Badge>Soon</Badge>
      </p>
      <BrandPreview
        name={firm.portalName ?? `${firm.name} Client Portal`}
        primary={firm.primaryColor}
        accent={firm.accentColor}
        header={header}
        welcome={welcome}
        signUp={signUp}
      />
    </>
  );
}
