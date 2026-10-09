'use client';

import {
  CLIENT_VOLUMES,
  CREDENTIAL_TYPES,
  ENTITY_TYPES,
  FIRM_PLANS,
  FIRM_SERVICES,
  PRACTICE_TYPES,
  SubmitFirmApplicationRequest,
  type SubmitFirmApplicationRequest as ApplicationBody,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useForm, type DefaultValues } from 'react-hook-form';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';

const choices = <T extends Record<string, string>>(items: T) =>
  Object.entries(items).map(([value, label]) => ({ value, label }));

const defaults: DefaultValues<ApplicationBody> = {
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: '',
    dbaName: '',
    entityType: 'LLC',
    ein: '',
    email: '',
    phone: '',
    website: '',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '' },
    services: [],
  },
  primaryAdmin: {
    fullName: '',
    email: '',
    phone: '',
    title: '',
    preferredContact: 'EMAIL',
    alternatePhone: '',
  },
  account: {
    requestedPlan: 'STARTER',
    teamSize: 1,
    clientVolume: 'UNDER_100',
    heardFrom: '',
    requestedStartDate: '',
    additionalInfo: '',
  },
  credentials: [],
  honeypot: '',
};

const contactOptions = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone call' },
  { value: 'TEXT', label: 'Text message' },
];

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words text-sm text-text">{children || 'Not provided'}</dd>
    </div>
  );
}

export function ApplicationForm() {
  const router = useRouter();
  const [review, setReview] = useState(false);
  const form = useForm<ApplicationBody>({
    resolver: zodResolver(SubmitFirmApplicationRequest),
    defaultValues: defaults,
  });
  const credentials = useFieldArray({ control: form.control, name: 'credentials' });
  const submit = useApiMutation((body: ApplicationBody) => api.firmApplications.submit(body));

  async function send(body: ApplicationBody) {
    try {
      const result = await submit.mutateAsync(body);
      if (result.received) router.replace('/apply/done');
    } catch {
      return;
    }
  }

  const onSubmit = (body: ApplicationBody) => (review ? send(body) : setReview(true));
  const values = form.getValues();
  const ein = (values.business.ein ?? '').replace(/\D/g, '');
  const maskedEin = ein
    ? `${'•'.repeat(Math.max(0, ein.length - 4))}${ein.slice(-4)}`
    : 'Not provided';
  const issues = form.formState.errors;

  return (
    <form
      data-testid="application-form"
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
      noValidate
    >
      <div
        aria-label="Application progress"
        className="grid grid-cols-2 gap-3 rounded-card border border-border bg-surface p-4 shadow-sm sm:p-5"
      >
        <div
          className={`flex items-center gap-3 rounded-control px-3 py-2 ${review ? 'text-success' : 'bg-info-soft text-action'}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold">
            1
          </span>
          <span>
            <span className="block text-xs text-muted">Step 1</span>
            <span className="block text-sm font-semibold">Application details</span>
          </span>
        </div>
        <div
          className={`flex items-center gap-3 rounded-control px-3 py-2 ${review ? 'bg-info-soft text-action' : 'text-muted'}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-sm font-bold">
            2
          </span>
          <span>
            <span className="block text-xs text-muted">Step 2</span>
            <span className="block text-sm font-semibold">Review and submit</span>
          </span>
        </div>
      </div>
      {review ? (
        <Card className="border-t-4 border-t-action shadow-sm">
          <h2 className="font-serif text-2xl font-bold text-heading">Review your application</h2>
          <p className="mt-1 text-sm text-muted">Check these details before submitting.</p>
          <dl className="mt-4 divide-y divide-border">
            <ReviewRow label="Practice">{PRACTICE_TYPES[values.business.practiceType]}</ReviewRow>
            <ReviewRow label="Legal business name">{values.business.legalName}</ReviewRow>
            <ReviewRow label="Doing business as">{values.business.dbaName}</ReviewRow>
            <ReviewRow label="Entity type">{ENTITY_TYPES[values.business.entityType]}</ReviewRow>
            <ReviewRow label="EIN">
              <span data-testid="application-review-ein">{maskedEin}</span>
            </ReviewRow>
            <ReviewRow label="Business email">{values.business.email}</ReviewRow>
            <ReviewRow label="Business phone">{values.business.phone}</ReviewRow>
            <ReviewRow label="Website">{values.business.website}</ReviewRow>
            <ReviewRow label="Business address">
              {[
                values.business.address.line1,
                values.business.address.line2,
                values.business.address.city,
                values.business.address.state,
                values.business.address.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            </ReviewRow>
            <ReviewRow label="Services">
              {values.business.services.map((service) => FIRM_SERVICES[service]).join(', ')}
            </ReviewRow>
            <ReviewRow label="Primary administrator">{values.primaryAdmin.fullName}</ReviewRow>
            <ReviewRow label="Administrator email">{values.primaryAdmin.email}</ReviewRow>
            <ReviewRow label="Administrator phone">{values.primaryAdmin.phone}</ReviewRow>
            <ReviewRow label="Title">{values.primaryAdmin.title}</ReviewRow>
            <ReviewRow label="Preferred contact">
              {
                contactOptions.find(
                  (option) => option.value === values.primaryAdmin.preferredContact,
                )?.label
              }
            </ReviewRow>
            <ReviewRow label="Alternate phone">{values.primaryAdmin.alternatePhone}</ReviewRow>
            <ReviewRow label="Requested plan">{FIRM_PLANS[values.account.requestedPlan]}</ReviewRow>
            <ReviewRow label="Team size">{values.account.teamSize}</ReviewRow>
            <ReviewRow label="Estimated clients per year">
              {CLIENT_VOLUMES[values.account.clientVolume]}
            </ReviewRow>
            <ReviewRow label="Requested start date">
              {values.account.requestedStartDate || 'As soon as possible'}
            </ReviewRow>
            <ReviewRow label="How you heard about us">{values.account.heardFrom}</ReviewRow>
            <ReviewRow label="Additional information">{values.account.additionalInfo}</ReviewRow>
            <ReviewRow label="Credentials">
              {values.credentials
                ?.map(
                  (item) =>
                    `${CREDENTIAL_TYPES[item.type]}: ${item.number}${item.issuedBy ? ` (${item.issuedBy})` : ''}`,
                )
                .join('; ')}
            </ReviewRow>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setReview(false)}>
              Edit application
            </Button>
            <Button type="submit" disabled={submit.isPending || form.formState.isSubmitting}>
              {submit.isPending ? 'Sending…' : 'Submit application'}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-4 border-t-4 border-t-action shadow-sm">
            <h2 className="font-serif text-2xl font-bold text-heading">Business details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Practice type"
                options={choices(PRACTICE_TYPES)}
                error={issues.business?.practiceType?.message}
                {...form.register('business.practiceType')}
              />
              <Select
                label="Entity type"
                options={choices(ENTITY_TYPES)}
                error={issues.business?.entityType?.message}
                {...form.register('business.entityType')}
              />
              <Input
                label="Legal business name"
                required
                data-testid="business-name"
                error={issues.business?.legalName?.message}
                {...form.register('business.legalName')}
              />
              <Input label="Doing business as" {...form.register('business.dbaName')} />
              <Input
                label="EIN"
                // Not a password field: browsers would offer to save it, or fill in a password.
                type="text"
                inputMode="numeric"
                autoComplete="off"
                data-testid="business-ein"
                error={issues.business?.ein?.message}
                {...form.register('business.ein')}
              />
              <Input
                label="Business email"
                type="email"
                error={issues.business?.email?.message}
                {...form.register('business.email')}
              />
              <Input
                label="Business phone"
                type="tel"
                error={issues.business?.phone?.message}
                {...form.register('business.phone')}
              />
              <Input
                label="Website"
                placeholder="example.com"
                error={issues.business?.website?.message}
                {...form.register('business.website')}
              />
            </div>
            <h3 className="font-medium text-text">Business address</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Street address"
                required
                error={issues.business?.address?.line1?.message}
                {...form.register('business.address.line1')}
              />
              <Input
                label="Address line 2"
                error={issues.business?.address?.line2?.message}
                {...form.register('business.address.line2')}
              />
              <Input
                label="City"
                required
                error={issues.business?.address?.city?.message}
                {...form.register('business.address.city')}
              />
              <Input
                label="State (2-letter code)"
                required
                maxLength={2}
                error={issues.business?.address?.state?.message}
                {...form.register('business.address.state')}
              />
              <Input
                label="ZIP code"
                required
                autoComplete="postal-code"
                error={issues.business?.address?.postalCode?.message}
                {...form.register('business.address.postalCode')}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">Services offered</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(FIRM_SERVICES).map(([value, label]) => (
                  <Checkbox
                    key={value}
                    label={label}
                    value={value}
                    {...form.register('business.services')}
                  />
                ))}
              </div>
              {issues.business?.services?.message ? (
                <p role="alert" className="text-sm text-danger">
                  {issues.business.services.message}
                </p>
              ) : null}
            </fieldset>
          </Card>

          <Card className="flex flex-col gap-4 border-t-4 border-t-action shadow-sm">
            <h2 className="font-serif text-2xl font-bold text-heading">Primary administrator</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full name"
                required
                error={issues.primaryAdmin?.fullName?.message}
                {...form.register('primaryAdmin.fullName')}
              />
              <Input
                label="Email"
                type="email"
                required
                error={issues.primaryAdmin?.email?.message}
                {...form.register('primaryAdmin.email')}
              />
              <Input
                label="Phone"
                type="tel"
                required
                error={issues.primaryAdmin?.phone?.message}
                {...form.register('primaryAdmin.phone')}
              />
              <Input
                label="Title"
                error={issues.primaryAdmin?.title?.message}
                {...form.register('primaryAdmin.title')}
              />
              <Select
                label="Preferred contact method"
                options={contactOptions}
                error={issues.primaryAdmin?.preferredContact?.message}
                {...form.register('primaryAdmin.preferredContact')}
              />
              <Input
                label="Alternate phone"
                type="tel"
                error={issues.primaryAdmin?.alternatePhone?.message}
                {...form.register('primaryAdmin.alternatePhone')}
              />
            </div>
          </Card>

          <Card className="flex flex-col gap-4 border-t-4 border-t-action shadow-sm">
            <h2 className="font-serif text-2xl font-bold text-heading">Plan and team</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Requested plan"
                options={choices(FIRM_PLANS)}
                error={issues.account?.requestedPlan?.message}
                {...form.register('account.requestedPlan')}
              />
              <Input
                label="Team size"
                type="number"
                min={1}
                max={10000}
                required
                error={issues.account?.teamSize?.message}
                {...form.register('account.teamSize', { valueAsNumber: true })}
              />
              <Select
                label="Estimated clients per year"
                options={choices(CLIENT_VOLUMES)}
                error={issues.account?.clientVolume?.message}
                {...form.register('account.clientVolume')}
              />
              <Input
                label="Requested start date"
                type="date"
                error={issues.account?.requestedStartDate?.message}
                {...form.register('account.requestedStartDate')}
              />
              <Input
                label="How did you hear about Firmivra?"
                error={issues.account?.heardFrom?.message}
                {...form.register('account.heardFrom')}
              />
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="additional-information" className="text-sm font-medium text-text">
                  Additional information
                </label>
                <textarea
                  id="additional-information"
                  rows={4}
                  maxLength={2000}
                  aria-invalid={issues.account?.additionalInfo ? true : undefined}
                  className="w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-focus"
                  {...form.register('account.additionalInfo')}
                />
                {issues.account?.additionalInfo?.message ? (
                  <p className="text-xs text-danger">{issues.account.additionalInfo.message}</p>
                ) : null}
              </div>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-text">
                Professional credentials (optional)
              </legend>
              {credentials.fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <Select
                    label="Credential"
                    options={choices(CREDENTIAL_TYPES)}
                    error={issues.credentials?.[index]?.type?.message}
                    {...form.register(`credentials.${index}.type`)}
                  />
                  <Input
                    label="Number"
                    error={issues.credentials?.[index]?.number?.message}
                    {...form.register(`credentials.${index}.number`)}
                  />
                  <Input
                    label="Issued by"
                    error={issues.credentials?.[index]?.issuedBy?.message}
                    {...form.register(`credentials.${index}.issuedBy`)}
                  />
                  <Button
                    variant="secondary"
                    aria-label="Remove credential"
                    onClick={() => credentials.remove(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                disabled={credentials.fields.length >= 20}
                onClick={() => credentials.append({ type: 'PTIN', number: '', issuedBy: '' })}
              >
                Add credential
              </Button>
              {issues.credentials?.root?.message || issues.credentials?.message ? (
                <p className="text-xs text-danger">
                  {issues.credentials.root?.message ?? issues.credentials.message}
                </p>
              ) : null}
            </fieldset>
          </Card>

          <Card className="flex flex-col gap-3 border-t-4 border-t-action shadow-sm">
            <h2 className="font-serif text-xl font-bold text-heading">Agreements</h2>
            <Checkbox
              label="I accept Firmivra’s terms and privacy notice."
              {...form.register('agreement.acceptedTerms')}
            />
            <Checkbox
              label="I certify that the information above is accurate."
              {...form.register('agreement.certifiedAccurate')}
            />
            {issues.agreement?.acceptedTerms?.message ||
            issues.agreement?.certifiedAccurate?.message ? (
              <p role="alert" className="text-sm text-danger">
                {issues.agreement?.acceptedTerms?.message ??
                  issues.agreement?.certifiedAccurate?.message}
              </p>
            ) : null}
            <Button type="submit" className="self-start">
              Review application
            </Button>
          </Card>
        </>
      )}
      {submit.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(submit.error)}
        </p>
      ) : null}
      <div className="absolute h-0 w-0 overflow-hidden opacity-0" aria-hidden="true">
        <label>
          Fax
          <input tabIndex={-1} autoComplete="off" {...form.register('honeypot')} />
        </label>
      </div>
    </form>
  );
}
