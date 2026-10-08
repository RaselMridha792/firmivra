'use client';

import type { FirmSettings } from '@firmivra/types';
import { Badge, Checkbox, Input } from '@firmivra/ui';
import { BrandPreview } from './brand-preview';
import { TextArea } from './fields';
import type { StepProps } from './shared';
import { StepFrame, useStepForm } from './step-form';

/** Step 4: what clients see first on the portal, and whether they may sign up themselves. */
export function PortalStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const stepForm = useStepForm(
    'clientPortal',
    {
      portalHeader: firm.portalHeader ?? '',
      welcomeMessage: firm.welcomeMessage ?? '',
      clientSignUpEnabled: firm.clientSignUpEnabled,
    },
    onNext,
  );
  const { form } = stepForm;
  const [header, welcome] = form.watch(['portalHeader', 'welcomeMessage']);

  return (
    <StepFrame title="Client portal" stepForm={stepForm} onBack={onBack}>
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
      />
    </StepFrame>
  );
}
