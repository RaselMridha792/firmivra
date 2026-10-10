'use client';

import {
  type ClientRecord,
  ContactMethod,
  UpdateClientProfileRequest,
  UpdateClientRequest,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { type FieldPath, useForm } from 'react-hook-form';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';
import { CLIENT_ERRORS, CLIENTS, formatPhone } from '../../_components/client-parts';

const CONTACT_FIELDS = ['displayName', 'email', 'phone'] as const;
const NAME_FIELDS = ['firstName', 'middleName', 'lastName', 'preferredName'] as const;
const BUSINESS_FIELDS = ['businessName', 'entityType'] as const;
const OTHER_FIELDS = [
  'dateOfBirth',
  'preferredContactMethod',
  'referralSource',
  'additionalInfo',
] as const;
const ADDRESS_FIELDS = ['line1', 'line2', 'city', 'state', 'postalCode'] as const;
type Values = Record<
  | (typeof CONTACT_FIELDS)[number]
  | (typeof NAME_FIELDS)[number]
  | (typeof BUSINESS_FIELDS)[number]
  | (typeof OTHER_FIELDS)[number]
  | (typeof ADDRESS_FIELDS)[number]
  | 'ssn'
  | 'ein',
  string
>;

function initial(client: ClientRecord): Values {
  const { profile } = client;
  return {
    displayName: client.displayName,
    email: client.email ?? '',
    phone: formatPhone(client.phone) ?? '',
    firstName: profile.firstName ?? '',
    middleName: profile.middleName ?? '',
    lastName: profile.lastName ?? '',
    preferredName: profile.preferredName ?? '',
    businessName: profile.businessName ?? '',
    entityType: profile.entityType ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    preferredContactMethod: profile.preferredContactMethod ?? '',
    referralSource: profile.referralSource ?? '',
    additionalInfo: profile.additionalInfo ?? '',
    line1: profile.address.line1 ?? '',
    line2: profile.address.line2 ?? '',
    city: profile.address.city ?? '',
    state: profile.address.state ?? '',
    postalCode: profile.address.postalCode ?? '',
    ssn: '',
    ein: '',
  };
}

/** Only the fields that changed; SSN and EIN only when a new number is typed. */
function bodies(client: ClientRecord, values: Values) {
  const was = initial(client);
  const changed = <K extends keyof Values>(keys: readonly K[]) =>
    Object.fromEntries(keys.filter((k) => values[k] !== was[k]).map((k) => [k, values[k]]));
  const address = changed(ADDRESS_FIELDS);
  const profile = {
    ...changed([...NAME_FIELDS, ...BUSINESS_FIELDS, ...OTHER_FIELDS]),
    ...(values.ssn ? { ssn: values.ssn } : {}),
    ...(values.ein ? { ein: values.ein } : {}),
    ...(Object.keys(address).length ? { address } : {}),
  };
  return { contact: changed(CONTACT_FIELDS), profile };
}

/**
 * Edit the client's contact details and profile. Checked with the contract's schemas before
 * anything is sent; SSN and EIN can be replaced but never read back (only the last 4 show).
 */
export function EditClient({ client }: { client: ClientRecord }) {
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({ defaultValues: initial(client) });
  const save = useApiMutation(
    async ({ contact, profile }: ReturnType<typeof bodies>) => {
      if (Object.keys(contact).length) await api.clients.update(client.id, contact);
      if (Object.keys(profile).length) await api.clients.updateProfile(client.id, profile);
    },
    { invalidate: CLIENTS },
  );
  const business = client.accountType === 'BUSINESS';
  const field = (name: keyof Values) => ({
    error: form.formState.errors[name]?.message,
    ...form.register(name),
  });

  const submit = form.handleSubmit((values) => {
    const { contact, profile } = bodies(client, values);
    const checks = [
      Object.keys(contact).length ? UpdateClientRequest.safeParse(contact) : null,
      Object.keys(profile).length ? UpdateClientProfileRequest.safeParse(profile) : null,
    ];
    let valid = true;
    for (const check of checks) {
      if (!check || check.success) continue;
      valid = false;
      for (const issue of check.error.issues) {
        const name = String(issue.path.at(-1) ?? 'displayName') as FieldPath<Values>;
        form.setError(name, { message: issue.message });
      }
    }
    if (!valid) return;
    if (!checks.some(Boolean)) return setOpen(false);
    save.mutate({ contact, profile }, { onSuccess: () => setOpen(false) });
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          save.reset();
          form.reset(initial(client));
          setOpen(true);
        }}
      >
        Edit details
      </Button>
      <Modal open={open} title={`Edit ${client.displayName}`} onClose={() => setOpen(false)}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text">Contact</legend>
            <div className="sm:col-span-2">
              <Input label="Name shown in lists" {...field('displayName')} />
            </div>
            <Input label="Email" type="email" {...field('email')} />
            <Input label="Phone" type="tel" {...field('phone')} />
            <Select
              label="Preferred contact"
              {...field('preferredContactMethod')}
              options={[
                { value: '', label: 'Not set' },
                ...ContactMethod.options.map((value) => ({
                  value,
                  label: { EMAIL: 'Email', PHONE: 'Phone call', TEXT: 'Text message' }[value],
                })),
              ]}
            />
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text">Profile</legend>
            {business ? (
              <>
                <Input label="Business name" {...field('businessName')} />
                <Input label="Entity type" placeholder="LLC, S corp..." {...field('entityType')} />
                <Input
                  label={`New EIN${client.profile.einLast4 ? ` (now ends ${client.profile.einLast4})` : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  {...field('ein')}
                />
              </>
            ) : null}
            <Input label="First name" {...field('firstName')} />
            <Input label="Middle name" {...field('middleName')} />
            <Input label="Last name" {...field('lastName')} />
            <Input label="Preferred name" {...field('preferredName')} />
            {business ? null : (
              <>
                <Input label="Date of birth" type="date" {...field('dateOfBirth')} />
                <Input
                  label={`New SSN${client.profile.ssnLast4 ? ` (now ends ${client.profile.ssnLast4})` : ''}`}
                  inputMode="numeric"
                  autoComplete="off"
                  {...field('ssn')}
                />
              </>
            )}
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text">Address</legend>
            <Input label="Street address" {...field('line1')} />
            <Input label="Apt, suite (optional)" {...field('line2')} />
            <Input label="City" {...field('city')} />
            <Input label="State" placeholder="GA" {...field('state')} />
            <Input label="ZIP code" inputMode="numeric" {...field('postalCode')} />
          </fieldset>
          <fieldset className="grid gap-4">
            <legend className="mb-2 text-sm font-semibold text-text">Firm details</legend>
            <Input label="Referral source" {...field('referralSource')} />
            <TextArea label="Notes" rows={3} {...field('additionalInfo')} />
          </fieldset>
          {save.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error, CLIENT_ERRORS)}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Save changes
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
