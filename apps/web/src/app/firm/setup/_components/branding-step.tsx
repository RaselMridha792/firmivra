'use client';

import type { FirmSettings } from '@firmivra/types';
import { Badge, Input } from '@firmivra/ui';
import { BrandPreview } from './brand-preview';
import { ColorField } from './fields';
import type { StepProps } from './shared';
import { LockedName, StepFrame, useStepForm } from './step-form';

/** Step 1: portal name and colours, with a live preview. Every firm starts with Firmivra's. */
export function BrandingStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const stepForm = useStepForm(
    'branding',
    {
      portalName: firm.portalName ?? '',
      primaryColor: firm.primaryColor ?? '',
      accentColor: firm.accentColor ?? '',
    },
    onNext,
  );
  const { form } = stepForm;
  const [portalName, primary, accent] = form.watch(['portalName', 'primaryColor', 'accentColor']);
  const defaultName = `${firm.name} Client Portal`;

  return (
    <StepFrame title="Branding" stepForm={stepForm} onBack={onBack}>
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
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        Logo: the Firmivra logo until you upload yours. <Badge>Upload soon</Badge>
      </p>
      <BrandPreview name={portalName || defaultName} primary={primary} accent={accent} />
    </StepFrame>
  );
}
