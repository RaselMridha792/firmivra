'use client';

import type { Address, ClientRecord, ContactMethod } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { PortalAccessCard } from '../../../business-advisory/_components/portal-invitation';
import { clientKey, dateText, formatPhone } from '../../_components/client-parts';
import { RecentActivityCard } from '../activity/_components/client-activity-screen';
import { BillingCard } from './client-billing';
import { LinkedProfilesCard } from './client-links';
import { LocalOfficeCard } from './client-office';
import { ActiveServicesCard } from './client-services';
import { ClientTagsCard } from './client-tags';
import { useClientRecord } from './use-client-record';

const CONTACT: Record<ContactMethod, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone call',
  TEXT: 'Text message',
};

/** A date of birth as written, without a time-zone shift (it is a calendar date). */
const birthDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { dateStyle: 'long' });

function Field({
  label,
  empty = 'Not on file',
  children,
}: {
  label: string;
  /** What an empty value reads as. */
  empty?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm wrap-anywhere text-text sm:col-span-2">
        {children === null || children === undefined || children === '' ? (
          <span className="text-muted">{empty}</span>
        ) : (
          children
        )}
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
            {/* E5: the person linked to the business, not replacing it. */}
            <Field label="Responsible party">
              {profile.responsibleParty ? (
                <span data-testid="responsible-party">
                  <span className="block">{profile.responsibleParty.name}</span>
                  <span className="block">{profile.responsibleParty.email}</span>
                  <span className="block">{formatPhone(profile.responsibleParty.phone)}</span>
                </span>
              ) : null}
            </Field>
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

/**
 * Octavia's E10: Portal Access with Send Invitation (Business Advisory B3's card, the canonical
 * Client Portal identity): who can sign in, the last invitation and its state, Send with the
 * recipient confirmed, and Resend and Revoke where the API allows. The record's portal badge
 * follows.
 */
function PortalAccess({ client }: { client: ClientRecord }) {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string>();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <PortalAccessCard
        firmClientId={client.id}
        failed={false}
        onDone={(text) => {
          setNotice(text);
          void qc.invalidateQueries({ queryKey: clientKey(client.id) });
        }}
      />
      {notice ? (
        <p role="status" className="text-sm text-success" data-testid="portal-notice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function FirmDetails({ client }: { client: ClientRecord }) {
  return (
    <Card title="Firm details">
      <dl className="divide-y divide-border">
        <Field label="Assigned to">{client.assignedTo?.name ?? 'Unassigned'}</Field>
        <Field label="Client since">{dateText(client.createdAt)}</Field>
        <Field label="Referral source">{client.profile.referralSource}</Field>
        {/* The profile's own text, not the firm's notes (Octavia read "Notes: Not on file" as no
            notes, BK N04): its name says so, and the internal notes are one click away. */}
        <Field label="Additional Information" empty="None added">
          {client.profile.additionalInfo ? (
            <span className="whitespace-pre-line">{client.profile.additionalInfo}</span>
          ) : null}
        </Field>
        <Field label="Internal notes">
          <Link
            href={`/clients/${client.id}/notes`}
            data-testid="open-client-notes"
            className="font-medium text-link hover:underline"
          >
            Open Notes
          </Link>
        </Field>
        {client.archivedAt ? <Field label="Archived">{dateText(client.archivedAt)}</Field> : null}
      </dl>
    </Card>
  );
}

/**
 * Overview: profile (SSN and EIN as the last 4 only), contact, portal logins, firm details, the
 * client's tags, and (Octavia's E4) the services the client is enrolled in, separate from tags,
 * with Recent Activity at the bottom.
 */
export function ClientOverview() {
  const { id } = useParams<{ id: string }>();
  const record = useClientRecord(id);
  return (
    <PageState query={record}>
      {(client) => (
        <div data-testid="client-overview" className="grid gap-5 lg:grid-cols-2">
          <Profile client={client} />
          <Contact client={client} />
          <ActiveServicesCard clientId={client.id} />
          <PortalAccess client={client} />
          <LocalOfficeCard clientId={client.id} />
          <FirmDetails client={client} />
          <ClientTagsCard client={client} />
          <BillingCard clientId={client.id} />
          <LinkedProfilesCard client={client} />
          <div className="lg:col-span-2">
            <RecentActivityCard clientId={client.id} />
          </div>
        </div>
      )}
    </PageState>
  );
}
