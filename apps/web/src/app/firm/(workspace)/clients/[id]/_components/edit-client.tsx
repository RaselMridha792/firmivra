'use client';

import {
  type ClientRecord,
  clientFormIssues,
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
/** E5: a Business's responsible party, sent as one (all three). */
const PARTY_FIELDS = ['rpName', 'rpEmail', 'rpPhone'] as const;
type Values = Record<
  | (typeof CONTACT_FIELDS)[number]
  | (typeof NAME_FIELDS)[number]
  | (typeof BUSINESS_FIELDS)[number]
  | (typeof OTHER_FIELDS)[number]
  | (typeof ADDRESS_FIELDS)[number]
  | (typeof PARTY_FIELDS)[number]
  | 'ssn'
  | 'ein',
  string
>;

/** The form field an issue's path names (a responsible party's own fields are rp*). */
function fieldOf(path: readonly PropertyKey[]): FieldPath<Values> {
  const last = String(path.at(-1) ?? 'displayName');
  if (path.includes('responsibleParty')) {
    return `rp${last.charAt(0).toUpperCase()}${last.slice(1)}` as FieldPath<Values>;
  }
  return last as FieldPath<Values>;
}

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
    rpName: profile.responsibleParty?.name ?? '',
    rpEmail: profile.responsibleParty?.email ?? '',
    rpPhone: formatPhone(profile.responsibleParty?.phone ?? null) ?? '',
  };
}

/** Only the fields that changed; SSN and EIN only when a new number is typed. */
function bodies(client: ClientRecord, values: Values) {
  const was = initial(client);
  const changed = <K extends keyof Values>(keys: readonly K[]) =>
    Object.fromEntries(keys.filter((k) => values[k] !== was[k]).map((k) => [k, values[k]]));
  const address = changed(ADDRESS_FIELDS);
  // Sent once all three are typed; until then the required check names what is missing.
  const party =
    client.accountType === 'BUSINESS' &&
    Object.keys(changed(PARTY_FIELDS)).length &&
    PARTY_FIELDS.every((k) => values[k].trim())
      ? { responsibleParty: { name: values.rpName, email: values.rpEmail, phone: values.rpPhone } }
      : {};
  const profile = {
    ...changed([...NAME_FIELDS, ...BUSINESS_FIELDS, ...OTHER_FIELDS]),
    ...(values.ssn ? { ssn: values.ssn } : {}),
    ...(values.ein ? { ein: values.ein } : {}),
    ...(Object.keys(address).length ? { address } : {}),
    ...party,
  };
  return { contact: changed(CONTACT_FIELDS), profile };
}

/**
 * Edit the client's contact details and profile. Checked with the contract's schemas before
 * anything is sent, and (Octavia's E5) with the same required fields as Add New Client: email,
 * phone and address, and for a Business its name and responsible party. SSN and EIN can be
 * replaced but never read back (only the last 4 show).
 */
export function EditClient({
  client,
  initiallyOpen = false,
}: {
  client: ClientRecord;
  /** `?edit=1` (TX-F07): opened from another module's Edit Client Details. */
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  /** Closing after an edit asks first (Octavia's E6): Save Changes, Discard Changes, Keep Editing. */
  const [leaving, setLeaving] = useState(false);
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
    // E5: what the record must hold once saved, whatever this edit changes.
    const required = clientFormIssues({
      accountType: client.accountType,
      email: values.email,
      phone: values.phone,
      profile: {
        businessName: values.businessName,
        address: {
          line1: values.line1,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
          country: client.profile.address.country,
        },
        responsibleParty: { name: values.rpName, email: values.rpEmail, phone: values.rpPhone },
      },
    });
    const checks = [
      Object.keys(contact).length ? UpdateClientRequest.safeParse(contact) : null,
      Object.keys(profile).length ? UpdateClientProfileRequest.safeParse(profile) : null,
    ];
    let valid = required.length === 0;
    for (const issue of required) form.setError(fieldOf(issue.path), { message: issue.message });
    for (const check of checks) {
      if (!check || check.success) continue;
      valid = false;
      for (const issue of check.error.issues) {
        form.setError(fieldOf(issue.path), { message: issue.message });
      }
    }
    if (!valid) return;
    if (!checks.some(Boolean)) return setOpen(false);
    save.mutate({ contact, profile }, { onSuccess: () => setOpen(false) });
  });
  const dirty = form.formState.isDirty;
  const close = () => (dirty ? setLeaving(true) : setOpen(false));
  const discard = () => {
    form.reset(initial(client));
    setLeaving(false);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          save.reset();
          form.reset(initial(client));
          setLeaving(false);
          setOpen(true);
        }}
      >
        Edit details
      </Button>
      <Modal open={open} title={`Edit ${client.displayName}`} onClose={close}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-text">Contact</legend>
            <div className="sm:col-span-2">
              <Input label="Name shown in lists" {...field('displayName')} />
            </div>
            <Input
              label={business ? 'Business email *' : 'Email *'}
              type="email"
              {...field('email')}
            />
            <Input
              label={business ? 'Business phone *' : 'Phone *'}
              type="tel"
              {...field('phone')}
            />
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
                <Input label="Business name *" {...field('businessName')} />
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
            <legend className="mb-2 text-sm font-semibold text-text">
              {business ? 'Business address' : 'Home address'}
            </legend>
            <Input label="Street address *" {...field('line1')} />
            <Input label="Apt, suite (optional)" {...field('line2')} />
            <Input label="City *" {...field('city')} />
            <Input label="State *" placeholder="GA" {...field('state')} />
            <Input label="ZIP code *" inputMode="numeric" {...field('postalCode')} />
          </fieldset>
          {business ? (
            <fieldset className="grid gap-4 sm:grid-cols-2" data-testid="responsible-party-fields">
              <legend className="mb-2 text-sm font-semibold text-text">Responsible party</legend>
              <div className="sm:col-span-2">
                <Input label="Full name *" autoComplete="off" {...field('rpName')} />
              </div>
              <Input label="Their email *" type="email" autoComplete="off" {...field('rpEmail')} />
              <Input label="Their phone *" type="tel" autoComplete="off" {...field('rpPhone')} />
            </fieldset>
          ) : null}
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
          {leaving ? (
            <div
              role="alertdialog"
              aria-labelledby="edit-client-leaving"
              data-testid="unsaved-changes"
              className="flex flex-col gap-3 rounded-control border border-warning bg-warning-soft p-4"
            >
              <p id="edit-client-leaving" className="text-sm font-semibold text-heading">
                You have unsaved changes. Save them before you close?
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  autoFocus
                  onClick={() => setLeaving(false)}
                >
                  Keep Editing
                </Button>
                <Button type="button" variant="secondary" onClick={discard}>
                  Discard Changes
                </Button>
                <Button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => {
                    setLeaving(false);
                    void submit();
                  }}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Save changes
              </Button>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
