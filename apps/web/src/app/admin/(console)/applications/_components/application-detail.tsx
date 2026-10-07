'use client';

import { Building2, Contact, FileCheck2, FileText, History, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button, Card } from '@firmivra/ui';
import {
  addApplicationNote,
  decideApplication,
  type ApplicationAction,
  type FirmApplication,
} from './application-data';
import { ApplicationActionDialog } from './application-action-dialog';
import { ApplicationNotes } from './application-notes';
import { Field, formatDate, SectionTitle, StatusPill } from './application-ui';
import { useState } from 'react';

export function ApplicationDetail({ application: initial }: { application: FirmApplication }) {
  const [application, setApplication] = useState(initial);
  const [action, setAction] = useState<ApplicationAction | null>(null);
  const saveNote = async (note: string) =>
    setApplication(await addApplicationNote(application.id, note));
  const runAction = async (detail: string) => {
    if (!action) return;
    setApplication(await decideApplication(application.id, action, detail));
    setAction(null);
  };

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
            <span data-testid="page-title" className="sr-only">
              Firm application
            </span>
            <h1 className="font-serif text-3xl font-semibold text-text">
              {application.businessName}
            </h1>
            <StatusPill status={application.status} />
          </div>
          <p className="mt-2 text-sm text-muted">Submitted {formatDate(application.submittedAt)}</p>
        </div>
        {application.status === 'Pending Review' ||
        application.status === 'Information Requested' ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAction('Approve')}>Approve application</Button>
            <Button variant="secondary" onClick={() => setAction('Request Information')}>
              Request information
            </Button>
            <Button variant="ghost" className="text-danger" onClick={() => setAction('Decline')}>
              Decline application
            </Button>
          </div>
        ) : null}
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

      <Card>
        <SectionTitle icon={History}>Application History</SectionTitle>
        <ol className="mt-5 space-y-5 border-l border-border pl-5">
          {application.history.map((event) => (
            <li key={`${event.at}-${event.title}-${event.detail}`} className="relative">
              <span
                aria-hidden
                className="absolute -left-[1.56rem] top-1 size-3 rounded-full bg-brand-700 ring-4 ring-surface"
              />
              <p className="text-sm font-semibold text-text">{event.title}</p>
              <p className="mt-1 text-sm text-muted">{event.detail}</p>
              <time className="mt-1 block text-xs text-muted" dateTime={event.at}>
                {formatDate(event.at)}
              </time>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <SectionTitle icon={FileText}>Internal Notes</SectionTitle>
        <div className="mt-4">
          <ApplicationNotes notes={application.notes} onSave={saveNote} />
        </div>
      </Card>
      {action ? (
        <ApplicationActionDialog
          action={action}
          onClose={() => setAction(null)}
          onConfirm={runAction}
        />
      ) : null}
    </div>
  );
}
