'use client';

import type { Address, ClientRecord, ContactMethod } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { dateText, formatPhone } from '../../_components/client-parts';
import { useClientRecord } from './use-client-record';

const CONTACT: Record<ContactMethod, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone call',
  TEXT: 'Text message',
};
const ROLES = { PRIMARY: 'Primary', SPOUSE: 'Spouse', AUTHORIZED: 'Authorized' } as const;
const STATUS = {
  ACTIVE: ['Active', 'success'],
  INVITED: ['Invited', 'info'],
  PENDING_APPROVAL: ['Awaiting approval', 'warning'],
  DECLINED: ['Declined', 'danger'],
  DISABLED: ['Off', 'neutral'],
} as const;

/** A date of birth as written, without a time-zone shift (it is a calendar date). */
const birthDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm wrap-anywhere text-text sm:col-span-2">
        {children ?? <span className="text-muted">Not on file</span>}
      </dd>
    </div>
  );
}

function addressLines(address: Address) {
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const lines = [address.line1, address.line2, cityLine].filter(Boolean);
  if (!lines.length) return null;
  if (address.country !== 'US') lines.push(address.country);
  return lines.map((line) => (
    <span key={line} className="block">
      {line}
    </span>
  ));
}

/** Only the last 4 digits ever reach the browser; the rest is shown as dots. */
const masked = (last4: string | null, pattern: string) => (last4 ? `${pattern}${last4}` : null);

function Profile({ client }: { client: ClientRecord }) {
  const { profile } = client;
  const legalName = [profile.firstName, profile.middleName, profile.lastName]
    .filter(Boolean)
    .join(' ');
  const business = client.accountType === 'BUSINESS';
  return (
    <Card title="Profile">
      <dl className="divide-y divide-border">
        {business ? (
          <>
            <Field label="Business name">{profile.businessName}</Field>
            <Field label="Entity type">{profile.entityType}</Field>
            <Field label="EIN">{masked(profile.einLast4, '••-•••')}</Field>
            <Field label="Contact person">{legalName || null}</Field>
          </>
        ) : (
          <>
            <Field label="Legal name">{legalName || null}</Field>
            <Field label="Preferred name">{profile.preferredName}</Field>
            <Field label="Date of birth">
              {profile.dateOfBirthUnavailable ? (
                <span className="text-warning">Can&apos;t be shown right now. Enter it again.</span>
              ) : profile.dateOfBirth ? (
                birthDate(profile.dateOfBirth)
              ) : null}
            </Field>
            <Field label="SSN">{masked(profile.ssnLast4, '•••-••-')}</Field>
          </>
        )}
      </dl>
    </Card>
  );
}

function Contact({ client }: { client: ClientRecord }) {
  const method = client.profile.preferredContactMethod;
  return (
    <Card title="Contact">
      <dl className="divide-y divide-border">
        <Field label="Email">{client.email}</Field>
        <Field label="Phone">{formatPhone(client.phone)}</Field>
        <Field label="Preferred contact">{method ? CONTACT[method] : null}</Field>
        <Field label="Address">{addressLines(client.profile.address)}</Field>
      </dl>
    </Card>
  );
}

function Portal({ client }: { client: ClientRecord }) {
  return (
    <Card title="Portal access">
      {client.portalLogins.length ? (
        <ul className="divide-y divide-border">
          {client.portalLogins.map((login) => {
            const [label, tone] = STATUS[login.status];
            return (
              <li
                key={login.clientAccountId}
                className="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-sm wrap-anywhere text-text">{login.email}</span>
                  <span className="block text-xs text-muted">{ROLES[login.portalRole]} login</span>
                </span>
                <Badge tone={tone}>{label}</Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No portal login yet. The client can sign up on your portal, and you approve it under
          Sign-ups.
        </p>
      )}
    </Card>
  );
}

function FirmDetails({ client }: { client: ClientRecord }) {
  return (
    <Card title="Firm details">
      <dl className="divide-y divide-border">
        <Field label="Assigned to">{client.assignedTo?.name ?? 'Unassigned'}</Field>
        <Field label="Client since">{dateText(client.createdAt)}</Field>
        <Field label="Referral source">{client.profile.referralSource}</Field>
        <Field label="Notes">
          {client.profile.additionalInfo ? (
            <span className="whitespace-pre-line">{client.profile.additionalInfo}</span>
          ) : null}
        </Field>
        {client.archivedAt ? <Field label="Archived">{dateText(client.archivedAt)}</Field> : null}
      </dl>
    </Card>
  );
}

/** Overview: profile (SSN and EIN as the last 4 only), contact, portal logins and firm details. */
export function ClientOverview() {
  const { id } = useParams<{ id: string }>();
  const record = useClientRecord(id);
  return (
    <PageState query={record}>
      {(client) => (
        <div data-testid="client-overview" className="grid gap-5 lg:grid-cols-2">
          <Profile client={client} />
          <Contact client={client} />
          <Portal client={client} />
          <FirmDetails client={client} />
        </div>
      )}
    </PageState>
  );
}
