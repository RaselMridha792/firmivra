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
import {
  Building2,
  ClipboardList,
  FileSearch,
  Plus,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
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

/** A card's title with its icon, as on the Super Admin's application page. */
function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xl font-semibold text-brand-900">
      <Icon aria-hidden className="size-6 text-brand-700" />
      {children}
    </h2>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 sm:grid-cols-3 lg:grid-cols-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words text-sm text-text sm:col-span-2 lg:col-span-4">
        {children || 'Not provided'}
      </dd>
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
        className="grid grid-cols-2 gap-3 rounded-xl bg-surface p-4 shadow-md sm:p-5"
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
        <Card variant="elevated">
          <SectionTitle icon={FileSearch}>Review your application</SectionTitle>
          <p className="mt-1 text-sm text-muted">Check these details before submitting.</p>
          <dl className="mt-4 divide-y divide-border">
            <ReviewRow label="Practice Type">
              {PRACTICE_TYPES[values.business.practiceType]}
            </ReviewRow>
            <ReviewRow label="Business Name">{values.business.legalName}</ReviewRow>
            <ReviewRow label="DBA">{values.business.dbaName}</ReviewRow>
            <ReviewRow label="Business Type">{ENTITY_TYPES[values.business.entityType]}</ReviewRow>
            <ReviewRow label="EIN (if applicable)">
              <span data-testid="application-review-ein">{maskedEin}</span>
            </ReviewRow>
            <ReviewRow label="Business Email">{values.business.email}</ReviewRow>
            <ReviewRow label="Business Phone">{values.business.phone}</ReviewRow>
            <ReviewRow label="Website">{values.business.website}</ReviewRow>
            <ReviewRow label="Business Address">
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
            <ReviewRow label="Services Offered">
              {values.business.services.map((service) => FIRM_SERVICES[service]).join(', ')}
            </ReviewRow>
            <ReviewRow label="Primary Administrator">{values.primaryAdmin.fullName}</ReviewRow>
            <ReviewRow label="Administrator Email">{values.primaryAdmin.email}</ReviewRow>
            <ReviewRow label="Administrator Phone">{values.primaryAdmin.phone}</ReviewRow>
            <ReviewRow label="Title / Role">{values.primaryAdmin.title}</ReviewRow>
            <ReviewRow label="Preferred Contact Method">
              {
                contactOptions.find(
                  (option) => option.value === values.primaryAdmin.preferredContact,
                )?.label
              }
            </ReviewRow>
            <ReviewRow label="Alternate Phone">{values.primaryAdmin.alternatePhone}</ReviewRow>
            <ReviewRow label="Requested Plan">{FIRM_PLANS[values.account.requestedPlan]}</ReviewRow>
            <ReviewRow label="Estimated Team Size">{values.account.teamSize}</ReviewRow>
            <ReviewRow label="Estimated Client Volume (per year)">
              {CLIENT_VOLUMES[values.account.clientVolume]}
            </ReviewRow>
            <ReviewRow label="Requested Start Date">
              {values.account.requestedStartDate || 'As soon as possible'}
            </ReviewRow>
            <ReviewRow label="How You Heard About Us">{values.account.heardFrom}</ReviewRow>
            <ReviewRow label="Additional Information">{values.account.additionalInfo}</ReviewRow>
            <ReviewRow label="Professional Credentials">
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
          <Card variant="elevated" className="flex flex-col gap-4">
            <SectionTitle icon={Building2}>Business Information</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Practice Type"
                options={choices(PRACTICE_TYPES)}
                error={issues.business?.practiceType?.message}
                {...form.register('business.practiceType')}
              />
              <Select
                label="Business Type"
                options={choices(ENTITY_TYPES)}
                error={issues.business?.entityType?.message}
                {...form.register('business.entityType')}
              />
              <Input
                label="Legal Business Name"
                required
                data-testid="business-name"
                error={issues.business?.legalName?.message}
                {...form.register('business.legalName')}
              />
              <Input label="DBA (Doing Business As)" {...form.register('business.dbaName')} />
              <Input
                label="EIN (if applicable)"
                // Not a password field: browsers would offer to save it, or fill in a password.
                type="text"
                inputMode="numeric"
                autoComplete="off"
                data-testid="business-ein"
                error={issues.business?.ein?.message}
                {...form.register('business.ein')}
              />
              <Input
                label="Business Email"
                type="email"
                error={issues.business?.email?.message}
                {...form.register('business.email')}
              />
              <Input
                label="Business Phone"
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
            <h3 className="font-semibold text-heading">Business Address</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Street Address"
                required
                error={issues.business?.address?.line1?.message}
                {...form.register('business.address.line1')}
              />
              <Input
                label="Address Line 2"
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
                label="ZIP Code"
                required
                autoComplete="postal-code"
                error={issues.business?.address?.postalCode?.message}
                {...form.register('business.address.postalCode')}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-text">Services Offered</legend>
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

          <Card variant="elevated" className="flex flex-col gap-4">
            <SectionTitle icon={UserRound}>Primary Administrator</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Full Name"
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
                label="Title / Role"
                error={issues.primaryAdmin?.title?.message}
                {...form.register('primaryAdmin.title')}
              />
              <Select
                label="Preferred Contact Method"
                options={contactOptions}
                error={issues.primaryAdmin?.preferredContact?.message}
                {...form.register('primaryAdmin.preferredContact')}
              />
              <Input
                label="Alternate Phone"
                type="tel"
                error={issues.primaryAdmin?.alternatePhone?.message}
                {...form.register('primaryAdmin.alternatePhone')}
              />
            </div>
          </Card>

          <Card variant="elevated" className="flex flex-col gap-4">
            <SectionTitle icon={ClipboardList}>Account Details</SectionTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Requested Plan"
                options={choices(FIRM_PLANS)}
                error={issues.account?.requestedPlan?.message}
                {...form.register('account.requestedPlan')}
              />
              <Input
                label="Estimated Team Size"
                type="number"
                min={1}
                max={10000}
                required
                error={issues.account?.teamSize?.message}
                {...form.register('account.teamSize', { valueAsNumber: true })}
              />
              <Select
                label="Estimated Client Volume (per year)"
                options={choices(CLIENT_VOLUMES)}
                error={issues.account?.clientVolume?.message}
                {...form.register('account.clientVolume')}
              />
              <div className="flex flex-col gap-1">
                <Input
                  id="requested-start-date"
                  label="Requested Start Date"
                  type="date"
                  aria-describedby={
                    issues.account?.requestedStartDate
                      ? 'requested-start-date-error requested-start-date-hint'
                      : 'requested-start-date-hint'
                  }
                  error={issues.account?.requestedStartDate?.message}
                  {...form.register('account.requestedStartDate')}
                />
                <p id="requested-start-date-hint" className="text-xs text-muted">
                  Leave blank for as soon as possible.
                </p>
              </div>
              <Input
                label="How did you hear about Firmivra?"
                error={issues.account?.heardFrom?.message}
                {...form.register('account.heardFrom')}
              />
              <div className="flex flex-col gap-1 sm:col-span-2">
                <label htmlFor="additional-information" className="text-sm font-medium text-text">
                  Additional Information
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
                Professional Credentials (optional)
              </legend>
              {credentials.fields.map((field, index) => (
                <div key={field.id} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="grid flex-1 gap-3 sm:grid-cols-3">
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
                  </div>
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
                className="self-start"
                disabled={credentials.fields.length >= 20}
                onClick={() => credentials.append({ type: 'PTIN', number: '', issuedBy: '' })}
              >
                <Plus aria-hidden className="size-4" />
                Add Credential
              </Button>
              {issues.credentials?.root?.message || issues.credentials?.message ? (
                <p className="text-xs text-danger">
                  {issues.credentials.root?.message ?? issues.credentials.message}
                </p>
              ) : null}
            </fieldset>
          </Card>

          <Card variant="elevated" className="flex flex-col gap-3">
            <SectionTitle icon={ShieldCheck}>Agreements</SectionTitle>
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
