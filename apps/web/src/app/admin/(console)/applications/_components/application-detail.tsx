'use client';

import {
  CLIENT_VOLUMES,
  CREDENTIAL_TYPES,
  ENTITY_TYPES,
  FIRM_PLANS,
  FIRM_SERVICES,
  PRACTICE_TYPES,
  FirmApplicationId,
  type FirmApplicationRecord,
} from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { APPLICATIONS_KEY, applicationDetailKey } from './application-data';
import {
  ApplicationPageState,
  dateText,
  NoApplicationPermission,
  StatusPill,
} from './application-ui';

type Action = 'approve' | 'request-info' | 'decline';
type Field = readonly [label: string, value: string | null | undefined];

function display(value: string | null | undefined) {
  return value?.trim() || '—';
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function FieldCard({ title, fields }: { title: string; fields: readonly Field[] }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold">{title}</h2>
      <dl className="mt-4 divide-y divide-border">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(7rem,.8fr)_minmax(0,1.2fr)] gap-3 py-2 text-sm"
          >
            <dt className="text-muted">{label}</dt>
            <dd className="break-words">{display(value)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ApplicationRecord({ application }: { application: FirmApplicationRecord }) {
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [notes, setNotes] = useState(application.internalNotes ?? '');
  const approve = useApiMutation((id: string) => api.firmApplications.approve(id), {
    invalidate: APPLICATIONS_KEY,
  });
  const requestInfo = useApiMutation(
    ({ id, message }: { id: string; message: string }) =>
      api.firmApplications.requestInfo(id, { message }),
    { invalidate: APPLICATIONS_KEY },
  );
  const decline = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) =>
      api.firmApplications.decline(id, { reason }),
    { invalidate: APPLICATIONS_KEY },
  );
  const saveNotes = useApiMutation(
    (value: string | null) => api.firmApplications.saveNotes(application.id, { notes: value }),
    { invalidate: APPLICATIONS_KEY },
  );
  const busy =
    approve.isPending || requestInfo.isPending || decline.isPending || saveNotes.isPending;
  const business = application.business;
  const address = business
    ? [
        business.address.line1,
        business.address.line2,
        business.address.city,
        business.address.state,
        business.address.postalCode,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const unreadable = 'The application form could not be read';
  const businessFields: Field[] = business
    ? [
        ['Business Name', application.legalName],
        ['DBA', application.dbaName],
        [
          'Business Type',
          `${PRACTICE_TYPES[business.practiceType]} · ${ENTITY_TYPES[business.entityType]}`,
        ],
        ['Services Offered', business.services.map((item) => FIRM_SERVICES[item]).join(', ')],
        ['EIN', business.einLast4 ? `••••${business.einLast4}` : 'Not provided'],
        ['Business Email', business.email],
        ['Business Phone', business.phone],
        ['Website', business.website],
        ['Business Address', address],
      ]
    : [
        ['Business Name', application.legalName],
        ['DBA', application.dbaName],
        ['Other details', unreadable],
      ];
  const adminFields: Field[] = application.primaryAdmin
    ? [
        ['Full Name', application.primaryAdmin.fullName],
        ['Email', application.primaryAdmin.email],
        ['Phone', application.primaryAdmin.phone],
        ['Title / Role', application.primaryAdmin.title],
        ['Preferred Contact', humanize(application.primaryAdmin.preferredContact)],
        ['Alternate Phone', application.primaryAdmin.alternatePhone],
      ]
    : [
        ['Full Name', application.contactName],
        ['Email', application.contactEmail],
        ['Phone', application.contactPhone],
        ['Other details', unreadable],
      ];
  const accountFields: Field[] = application.account
    ? [
        ['Requested Plan', FIRM_PLANS[application.account.requestedPlan]],
        ['Estimated Team Size', String(application.account.teamSize)],
        ['Estimated Client Volume', CLIENT_VOLUMES[application.account.clientVolume]],
        ['How They Heard About Us', application.account.heardFrom],
        ['Requested Start Date', application.account.requestedStartDate ?? 'As soon as possible'],
        ['Additional Information', application.account.additionalInfo],
      ]
    : [['Details', unreadable]];
  const canDecide = application.status === 'PENDING_REVIEW';

  const openAction = (next: Action) => {
    approve.reset();
    requestInfo.reset();
    decline.reset();
    setActionError('');
    setMessage('');
    setAction(next);
  };

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const detail = message.trim();
    if (action !== 'approve' && !detail) return;
    setActionError('');
    try {
      if (action === 'approve') await approve.mutateAsync(application.id);
      if (action === 'request-info')
        await requestInfo.mutateAsync({ id: application.id, message: detail });
      if (action === 'decline') await decline.mutateAsync({ id: application.id, reason: detail });
      setAction(null);
      setMessage('');
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function submitNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    saveNotes.mutate(notes.trim() || null, {
      onSuccess: (record) => setNotes(record.internalNotes ?? ''),
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Link href="/applications" className="w-fit text-sm font-medium text-brand-700">
        ← Back to Applications
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 data-testid="page-title" className="font-serif text-3xl font-semibold tracking-tight">
            {application.legalName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill status={application.status} />
            <span className="text-sm text-muted">
              Submitted {dateText(application.submittedAt)}
            </span>
          </div>
        </div>
        {canDecide && (
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => openAction('approve')}>
              Approve Application
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => openAction('request-info')}>
              Request Information
            </Button>
            <Button
              variant="ghost"
              className="text-danger"
              disabled={busy}
              onClick={() => openAction('decline')}
            >
              Decline Application
            </Button>
          </div>
        )}
      </header>

      {application.firm && (
        <Card data-testid="approved-firm-summary">
          <h2 className="font-semibold">Firm created</h2>
          <p className="mt-2 text-sm text-muted">
            {application.firm.name} · {humanize(application.firm.status)} · Portal slug:{' '}
            {application.firm.slug}
          </p>
          {application.ownerInvite && (
            <p className="mt-1 text-sm text-muted">
              Owner invite: {humanize(application.ownerInvite.status)}, expires{' '}
              {dateText(application.ownerInvite.expiresAt)}
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <FieldCard title="Business Information" fields={businessFields} />
        <FieldCard title="Primary Administrator" fields={adminFields} />
        <FieldCard title="Account Details" fields={accountFields} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold">Credentials</h2>
          {!application.formReadable ? (
            <p className="mt-4 text-sm text-muted">{unreadable}</p>
          ) : application.credentials.length ? (
            <ul className="mt-4 space-y-2 text-sm">
              {application.credentials.map((credential) => (
                <li key={`${credential.type}-${credential.number}-${credential.issuedBy ?? ''}`}>
                  {CREDENTIAL_TYPES[credential.type]} · ••••{credential.number.slice(-4)}
                  {credential.issuedBy ? ` · ${credential.issuedBy}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No credentials submitted.</p>
          )}
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Documents Submitted</h2>
          {application.documents.length ? (
            <ul className="mt-4 space-y-3 text-sm">
              {application.documents.map((document) => (
                <li key={document.id}>
                  <p className="font-medium">{document.name}</p>
                  <p className="text-muted">
                    {document.fileName} · {dateText(document.uploadedAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-control bg-canvas p-4 text-center text-sm text-muted">
              No documents uploaded.
            </p>
          )}
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Automated Checks</h2>
          {application.checks.length ? (
            <ul className="mt-4 space-y-3">
              {application.checks.map((check) => (
                <li key={check.key} className="flex items-start justify-between gap-3 text-sm">
                  <span>{check.note}</span>
                  <span className="shrink-0 rounded-control bg-canvas px-2 py-1 text-xs text-muted">
                    {humanize(check.result)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No automated checks returned.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold">Internal Notes</h2>
          <p className="my-3 text-xs text-muted">
            Notes are only visible to Firmivra administrators.
          </p>
          <form onSubmit={submitNotes}>
            <textarea
              aria-label="Internal notes"
              value={notes}
              onChange={(event) => {
                saveNotes.reset();
                setNotes(event.target.value);
              }}
              rows={5}
              maxLength={5000}
              className="w-full rounded-control border border-border bg-surface p-3 text-sm"
            />
            {saveNotes.error && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {errorMessage(saveNotes.error)}
              </p>
            )}
            {saveNotes.isSuccess && (
              <p role="status" className="mt-2 text-sm text-success">
                Notes saved.
              </p>
            )}
            <Button type="submit" className="mt-3" disabled={busy}>
              {saveNotes.isPending ? 'Saving…' : 'Save Note'}
            </Button>
          </form>
        </Card>
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-semibold">Application History</h2>
          {application.history.length ? (
            <ol className="mt-4 space-y-4 border-l border-border pl-5">
              {application.history.map((event) => (
                <li
                  key={`${event.at}-${event.type}-${event.by?.userId ?? 'applicant'}-${event.message ?? ''}`}
                >
                  <p className="font-medium">{humanize(event.type)}</p>
                  <p className="text-sm text-muted">
                    {event.message ||
                      (event.by ? `Recorded by ${event.by.name}.` : 'Received from applicant.')}
                  </p>
                  <time dateTime={event.at} className="text-xs text-muted">
                    {dateText(event.at)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted">No application history yet.</p>
          )}
        </Card>
      </div>

      {action && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-brand-900/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            className="w-full max-w-lg rounded-card bg-surface p-6"
          >
            <h2 id="decision-title" className="text-xl font-semibold">
              {action === 'approve'
                ? 'Approve application?'
                : action === 'decline'
                  ? 'Decline application?'
                  : 'Request information'}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {action === 'approve'
                ? 'This creates the firm and sends its owner an activation link.'
                : action === 'decline'
                  ? 'This reason will be sent to the applicant.'
                  : 'This message will be sent to the applicant; the application stays pending.'}
            </p>
            <form onSubmit={submitDecision} className="mt-5">
              {action !== 'approve' && (
                <label className="block text-sm font-medium text-text">
                  {action === 'decline'
                    ? 'Reason (sent to the applicant)'
                    : 'Message to the applicant'}
                  <textarea
                    autoFocus
                    required
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={4}
                    maxLength={action === 'decline' ? 1000 : 2000}
                    className="mt-1 w-full rounded-control border border-border bg-surface p-3 font-normal"
                  />
                </label>
              )}
              {actionError && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {actionError}
                </p>
              )}
              <div className="mt-4 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAction(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || (action !== 'approve' && !message.trim())}>
                  {busy
                    ? 'Submitting…'
                    : action === 'approve'
                      ? 'Confirm approval'
                      : action === 'decline'
                        ? 'Confirm decline'
                        : 'Send request'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function ApplicationDetailContent({ id }: { id: string }) {
  const { me } = useMe();
  const query = useApiQuery(applicationDetailKey(id), () => api.firmApplications.get(id));
  if (!me.platformAdmin) return <NoApplicationPermission />;
  return (
    <ApplicationPageState query={query}>
      {(application) => <ApplicationRecord key={application.id} application={application} />}
    </ApplicationPageState>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  if (!FirmApplicationId.safeParse(id).success) {
    return (
      <Card data-testid="page-not-found">
        <p className="font-medium text-text">We couldn&apos;t find this.</p>
        <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
      </Card>
    );
  }

  return <ApplicationDetailContent id={id} />;
}
