'use client';

import { ENTITY_TYPES, FIRM_SERVICES, type FirmSettings } from '@firmivra/types';
import { Checkbox, Input, Select } from '@firmivra/ui';
import { Building2 } from 'lucide-react';
import { TextArea } from './fields';
import type { StepProps } from './shared';
import { LockedName, type StepForm, StepFrame, useStepForm } from './step-form';

const TEXT_FIELDS = [
  ['name', 'Display name (DBA)'],
  ['contactEmail', 'Business email'],
  ['contactPhone', 'Phone'],
  ['website', 'Website'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postalCode', 'ZIP code'],
] as const;

/** A blank select or number is left out, so Save draft works before it is filled in. */
const blankAsMissing = (value: string) => (value === '' ? undefined : value);

export const businessValues = (firm: FirmSettings) => ({
  ...Object.fromEntries(TEXT_FIELDS.map(([field]) => [field, firm[field] ?? ''])),
  entityType: firm.entityType ?? undefined,
  teamSize: firm.teamSize ?? undefined,
  services: firm.services,
  description: firm.description ?? '',
});

/** Step 2: the details from the application. The EIN is write-only: only its last 4 come back. */
export function BusinessStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const stepForm = useStepForm('businessDetails', businessValues(firm), onNext);
  return (
    <StepFrame title="Business details" icon={Building2} stepForm={stepForm} onBack={onBack}>
      <BusinessFields form={stepForm.form} firm={firm} />
    </StepFrame>
  );
}

/** Also Settings > Profile. */
export function BusinessFields({ form, firm }: { form: StepForm; firm: FirmSettings }) {
  const errors = form.formState.errors;
  return (
    <>
      <LockedName firm={firm} />
      <div className="grid gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map(([field, label]) => (
          <Input
            key={field}
            label={label}
            error={errors[field]?.message}
            {...form.register(field)}
          />
        ))}
        <Select
          label="Entity type"
          options={[
            ...(firm.entityType ? [] : [{ value: '', label: 'Choose…' }]),
            ...Object.entries(ENTITY_TYPES).map(([value, label]) => ({ value, label })),
          ]}
          error={errors.entityType?.message}
          {...form.register('entityType', { setValueAs: blankAsMissing })}
        />
        <Input
          label={firm.einLast4 ? `EIN (saved, ends in ${firm.einLast4})` : 'EIN'}
          placeholder={firm.einLast4 ? 'Leave blank to keep it' : '9 digits'}
          inputMode="numeric"
          autoComplete="off"
          error={errors.ein?.message}
          {...form.register('ein', { setValueAs: blankAsMissing })}
        />
        <Input
          label="Team size"
          type="number"
          min={1}
          error={errors.teamSize?.message}
          {...form.register('teamSize', {
            // Cleared (or not a number): null, so the schema says "Enter the team size".
            setValueAs: (value: string) => (value === '' ? null : Number(value)),
          })}
        />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-text">Services</legend>
        <div className="grid sm:grid-cols-2">
          {Object.entries(FIRM_SERVICES).map(([code, label]) => (
            <Checkbox key={code} label={label} value={code} {...form.register('services')} />
          ))}
        </div>
        {errors.services ? <p className="text-xs text-danger">{errors.services.message}</p> : null}
      </fieldset>
      <TextArea
        label="Description"
        error={errors.description?.message}
        {...form.register('description')}
      />
    </>
  );
}
