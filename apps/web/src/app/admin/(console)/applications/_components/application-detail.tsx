'use client';

import { Building2, Contact, FileCheck2, FileText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@firmivra/ui';
import type { FirmApplication } from './application-data';
import { Field, formatDate, SectionTitle, StatusPill } from './application-ui';

export function ApplicationDetail({ application: initial }: { application: FirmApplication }) {
  const application = initial;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Link
        href="/applications"
        className="w-fit text-sm font-medium text-brand-700 hover:underline"
      >
        ← Back to Applications
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold text-text">
              {application.businessName}
            </h1>
            <StatusPill status={application.status} />
          </div>
          <p className="mt-2 text-sm text-muted">Submitted {formatDate(application.submittedAt)}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle icon={Building2}>Business Information</SectionTitle>
          <dl className="mt-4 divide-y divide-border">
            <Field label="Business name">{application.businessName}</Field>
            <Field label="DBA">{application.dba}</Field>
            <Field label="Business type">{application.businessType}</Field>
            <Field label="Services offered">{application.services.join(', ')}</Field>
            <Field label="EIN">••••{application.einLast4}</Field>
            <Field label="Website">{application.website}</Field>
            <Field label="Business address">{application.address}</Field>
            <Field label="Agreement accepted">{application.agreementAccepted ? 'Yes' : 'No'}</Field>
            <Field label="Certification accepted">
              {application.certificationAccepted ? 'Yes' : 'No'}
            </Field>
          </dl>
        </Card>

        <Card>
          <SectionTitle icon={Contact}>Primary Administrator</SectionTitle>
          <dl className="mt-4 divide-y divide-border">
            <Field label="Full name">{application.ownerName}</Field>
            <Field label="Email">{application.email}</Field>
            <Field label="Phone">{application.phone}</Field>
            <Field label="Title / role">{application.ownerRole}</Field>
            <Field label="Preferred contact">{application.contactMethod}</Field>
            <Field label="Alternate phone">{application.alternatePhone}</Field>
          </dl>
        </Card>

        <Card>
          <SectionTitle icon={FileText}>Account Details</SectionTitle>
          <dl className="mt-4 divide-y divide-border">
            <Field label="Requested plan">{application.requestedPlan}</Field>
            <Field label="Estimated team size">{application.teamSize}</Field>
            <Field label="Estimated client volume">{application.clientVolume}</Field>
            <Field label="Referral source">{application.referralSource}</Field>
            <Field label="Requested start">{application.requestedStart}</Field>
            <Field label="Additional information">{application.additionalInfo}</Field>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle icon={FileCheck2}>Documents Submitted</SectionTitle>
          {application.documents.length ? (
            <ul className="mt-4 list-inside list-disc text-sm text-text">
              {application.documents.map((document) => (
                <li key={document}>{document}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-control bg-canvas px-4 py-5 text-center text-sm text-muted">
              No documents uploaded.
            </p>
          )}
        </Card>
        <Card>
          <SectionTitle icon={ShieldCheck}>Automated Checks</SectionTitle>
          {application.checks.length ? (
            <ul className="mt-4 list-inside list-disc text-sm text-text">
              {application.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-control bg-canvas px-4 py-5 text-center text-sm text-muted">
              No automated checks returned by mock data.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
