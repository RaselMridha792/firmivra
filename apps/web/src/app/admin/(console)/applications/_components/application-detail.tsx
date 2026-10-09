'use client';

import {
  CLIENT_VOLUMES,
  CREDENTIAL_TYPES,
  ENTITY_TYPES,
  FIRM_PLANS,
  FIRM_SERVICES,
  FirmApplicationId,
  type BusinessStatus,
  type FirmApplicationRecord,
} from '@firmivra/types';
import { Button, Card, Modal } from '@firmivra/ui';
import {
  ArrowLeft,
  Building2,
  Check,
  Database,
  ExternalLink,
  FileText,
  Folder,
  History,
  IdCard,
  MessageSquare,
  NotepadText,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { APPLICATIONS_KEY, applicationDetailKey } from './application-data';
import {
  ActiveFeatures,
  CardHeading,
  DocumentsTable,
  type Field,
  FieldCard,
  formatPhone,
  Timeline,
} from './application-cards';
import {
  ApplicationPageState,
  dateParts,
  dateText,
  NoApplicationPermission,
  StatusPill,
} from './application-ui';

type Action = 'approve' | 'request-info' | 'decline';

/** This module's codes (firm-applications schemas), and the reason rule behind a 400. */
const DECISION_ERRORS: Record<string, string> = {
  APPLICATION_DECIDED: 'Another administrator has already decided this application.',
  SLUG_TAKEN: 'Another firm already uses this portal address.',
  VALIDATION_FAILED: 'Check the text: it may be too long, or the same as your last message.',
};
function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** 'September 28, 2026', in the console's time zone (as dateText). */
const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));

const FIRM_STATUS: Partial<Record<BusinessStatus, { label: string; tone: string }>> = {
  ACTIVE: { label: 'Active', tone: 'bg-success-soft text-success' },
  PENDING_SETUP: { label: 'Pending Setup', tone: 'bg-warning-soft text-warning' },
};
const firmStatus = (status: BusinessStatus) =>
  FIRM_STATUS[status] ?? { label: humanize(status), tone: 'bg-disabled text-muted' };

function ApplicationRecord({
  application,
  appBaseUrl,
  onStale,
}: {
  application: FirmApplicationRecord;
  /** The firm workspace site, for "Open Firm Workspace". */
  appBaseUrl: string;
  /** Reloads the application after someone else changed it. */
  onStale: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState('');
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
  const address = business ? (
    <>
      {[business.address.line1, business.address.line2].filter(Boolean).join(', ')}
      <span className="block">
        {business.address.city}, {business.address.state} {business.address.postalCode}
      </span>
    </>
  ) : null;
  const mail = (email: string) => (
    <a href={`mailto:${email}`} className="break-all text-link hover:underline">
      {email}
    </a>
  );
  const unreadable = 'The application form could not be read';
  // The mockup's five rows; the other form fields only when the applicant filled them.
  const businessFields: Field[] = business
    ? [
        ['Business Name', application.legalName],
        ...(application.dbaName ? [['DBA', application.dbaName] as const] : []),
        ['Business Type', ENTITY_TYPES[business.entityType]],
        ['Services Offered', business.services.map((item) => FIRM_SERVICES[item]).join(', ')],
        ['EIN (if applicable)', business.einLast4 ? `••••${business.einLast4}` : 'Not provided'],
        ...(business.email ? [['Business Email', mail(business.email)] as const] : []),
        ...(business.phone ? [['Business Phone', formatPhone(business.phone)] as const] : []),
        ...(business.website ? [['Website', business.website] as const] : []),
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
        ['Email', mail(application.primaryAdmin.email)],
        ['Phone', formatPhone(application.primaryAdmin.phone)],
        ['Title / Role', application.primaryAdmin.title],
        ['Preferred Contact Method', humanize(application.primaryAdmin.preferredContact)],
        ['Alternate Phone', formatPhone(application.primaryAdmin.alternatePhone)],
      ]
    : [
        ['Full Name', application.contactName],
        ['Email', mail(application.contactEmail)],
        ['Phone', formatPhone(application.contactPhone)],
        ['Other details', unreadable],
      ];
  const firm = application.firm;
  const account = application.account;
  // The firm's own rows come from the firm, decision and invite, so they show even when the form
  // can't be read (LVP's seeded application).
  const firmFields: Field[] = firm
    ? [
        ['Start Date', application.decision ? dateParts(application.decision.at)[0] : null],
        [
          'Status',
          <span
            key="status"
            className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${firmStatus(firm.status).tone}`}
          >
            {firmStatus(firm.status).label}
          </span>,
        ],
        ['Portal Address', `/${firm.slug}`],
        // Only while the owner has not accepted: the timeline already records the invite.
        ...(application.ownerInvite && application.ownerInvite.status !== 'ACCEPTED'
          ? [
              [
                'Owner Invite',
                application.ownerInvite.status === 'EXPIRED'
                  ? `Expired ${dateParts(application.ownerInvite.expiresAt)[0]}`
                  : `${humanize(application.ownerInvite.status)}, expires ${dateParts(application.ownerInvite.expiresAt)[0]}`,
              ] as const,
            ]
          : []),
      ]
    : [];
  const accountFields: Field[] = !account
    ? [['Details', unreadable], ...firmFields]
    : firm
      ? [
          ['Plan', FIRM_PLANS[account.requestedPlan]],
          ['Team Size (Estimated)', String(account.teamSize)],
          ['Estimated Client Volume', `${CLIENT_VOLUMES[account.clientVolume]} (per year)`],
          ['How They Heard About Us', account.heardFrom],
          ...firmFields,
          ['Additional Information', account.additionalInfo],
        ]
      : [
          ['Requested Plan', FIRM_PLANS[account.requestedPlan]],
          ['Estimated Team Size', String(account.teamSize)],
          ['Estimated Client Volume (per year)', CLIENT_VOLUMES[account.clientVolume]],
          ['How They Heard About Us', account.heardFrom],
          ['Requested Start Date', account.requestedStartDate ?? 'As soon as possible'],
          ['Additional Information', account.additionalInfo],
        ];
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
      if (errorCode(error) === 'APPLICATION_DECIDED') {
        setAction(null);
        setNotice(errorMessage(error, DECISION_ERRORS));
        onStale();
        return;
      }
      setActionError(errorMessage(error, DECISION_ERRORS));
    }
  }

  function submitNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    saveNotes.mutate(notes.trim() || null, {
      onSuccess: (record) => setNotes(record.internalNotes ?? ''),
    });
  }

  const notesCard = (
    <Card className="!p-4">
      <CardHeading icon={NotepadText}>{firm ? 'Notes' : 'Internal Notes'}</CardHeading>
      <form onSubmit={submitNotes} className="mt-4">
        <textarea
          aria-label="Internal notes"
          value={notes}
          onChange={(event) => {
            saveNotes.reset();
            setNotes(event.target.value);
          }}
          rows={2}
          maxLength={5000}
          placeholder={`Add internal notes about this ${firm ? 'firm' : 'application'}...`}
          className="w-full resize-none rounded-control border border-border bg-surface p-3 text-sm"
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 grow basis-40 text-xs text-muted">
            Notes are only visible to Firmivra administrators.
          </p>
          <Button
            type="submit"
            className="shrink-0"
            disabled={busy || notes.trim() === (application.internalNotes ?? '').trim()}
          >
            {saveNotes.isPending ? 'Saving…' : 'Save Note'}
          </Button>
        </div>
      </form>
    </Card>
  );
  const historyCard = (
    <Card className="!p-4">
      <CardHeading icon={History}>{firm ? 'Recent Activity' : 'Application History'}</CardHeading>
      <Timeline application={application} />
    </Card>
  );
  const documentsCard = (
    <Card className="!p-4">
      <CardHeading icon={Folder}>Documents Submitted</CardHeading>
      <DocumentsTable documents={application.documents} />
    </Card>
  );
  const status = firm ? firmStatus(firm.status) : null;

  return (
    <section className="flex w-full flex-col gap-5 rounded-card bg-surface p-4 shadow-md md:p-5">
      <Link
        href="/applications"
        className="inline-flex w-fit items-center gap-3 text-base font-medium text-link"
      >
        <ArrowLeft aria-hidden className="size-5" />
        Back to Applications
      </Link>
      {notice ? (
        <p role="status" className="rounded-card bg-warning-soft p-3 text-sm text-warning">
          {notice}
        </p>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-4">
        {/* Below 2xl the buttons drop under a one-line title. */}
        <div className="min-w-0 grow basis-full 2xl:basis-96">
          <div className="flex flex-wrap items-center gap-4">
            <h1
              data-testid="page-title"
              className="font-display text-4xl font-bold tracking-tight text-heading"
            >
              {application.legalName}
            </h1>
            {status ? (
              <span
                data-testid="application-status"
                className={`rounded-pill px-3 py-1 text-base font-semibold ${status.tone}`}
              >
                {status.label}
              </span>
            ) : (
              <StatusPill status={application.status} />
            )}
          </div>
          {firm && application.decision ? (
            <p data-testid="approved-firm-summary" className="mt-1 text-base text-muted">
              Approved on {longDate(application.decision.at)}
              {account ? ` | ${FIRM_PLANS[account.requestedPlan]}` : ''}
            </p>
          ) : (
            <p className="mt-1 text-base text-muted">
              Submitted on {dateText(application.submittedAt)}
            </p>
          )}
        </div>
        {canDecide && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              className="enabled:!bg-success enabled:hover:!bg-success/90"
              onClick={() => openAction('approve')}
            >
              <Check aria-hidden className="size-4" />
              Approve Application
            </Button>
            <Button
              variant="outline"
              className="enabled:!bg-info-soft enabled:hover:!bg-folder-hover"
              disabled={busy}
              onClick={() => openAction('request-info')}
            >
              <MessageSquare aria-hidden className="size-4" />
              Request Information
            </Button>
            <Button
              variant="outline"
              className="enabled:!border-danger enabled:!bg-danger-soft enabled:!text-danger enabled:hover:!bg-danger/10"
              disabled={busy}
              onClick={() => openAction('decline')}
            >
              <X aria-hidden className="size-4" />
              Decline Application
            </Button>
          </div>
        )}
        {/* Edit Firm Details and Deactivate Firm wait for their API; only working buttons show. */}
        {firm && (
          <a
            href={appBaseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover"
          >
            <ExternalLink aria-hidden className="size-4" />
            Open Firm Workspace
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FieldCard icon={Building2} title="Business Information" fields={businessFields} />
        <FieldCard icon={UserRound} title="Primary Administrator" fields={adminFields} />
        <FieldCard icon={FileText} title="Account Details" fields={accountFields} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {firm ? (
          <>
            <Card className="!p-4">
              <CardHeading icon={Database}>Active Features (Beta)</CardHeading>
              <ActiveFeatures active={firm.status === 'ACTIVE'} />
            </Card>
            {historyCard}
            {notesCard}
          </>
        ) : (
          <>
            {documentsCard}
            {notesCard}
            {historyCard}
          </>
        )}
      </div>

      {/* Not in the mockups, but the review needs them (PROJECT-DRAFT-v2: automated checks). */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {firm ? documentsCard : null}
        <Card className="!p-4">
          <CardHeading icon={IdCard}>Credentials</CardHeading>
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
        <Card className="!p-4">
          <CardHeading icon={ShieldCheck}>Automated Checks</CardHeading>
          {application.checks.length ? (
            <ul className="mt-4 space-y-3">
              {application.checks.map((check) => (
                <li key={check.key} className="flex items-start justify-between gap-3 text-sm">
                  <span>{check.note}</span>
                  <span className="shrink-0 rounded-pill bg-canvas px-2 py-1 text-xs text-muted">
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

      <Modal
        open={action !== null}
        title={
          action === 'approve'
            ? 'Approve application?'
            : action === 'decline'
              ? 'Decline application?'
              : 'Request information'
        }
        onClose={() => setAction(null)}
      >
        {action ? (
          <div className="max-w-lg">
            <p className="text-sm text-muted">
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
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

function ApplicationDetailContent({ id, appBaseUrl }: { id: string; appBaseUrl: string }) {
  const { me } = useMe();
  const query = useApiQuery(applicationDetailKey(id), () => api.firmApplications.get(id));
  if (!me.platformAdmin) return <NoApplicationPermission />;
  return (
    <ApplicationPageState query={query}>
      {(application) => (
        <ApplicationRecord
          key={application.id}
          application={application}
          appBaseUrl={appBaseUrl}
          onStale={() => void query.refetch()}
        />
      )}
    </ApplicationPageState>
  );
}

export function ApplicationDetail({ id, appBaseUrl }: { id: string; appBaseUrl: string }) {
  if (!FirmApplicationId.safeParse(id).success) {
    return (
      <Card data-testid="page-not-found">
        <p className="font-medium text-text">We couldn&apos;t find this.</p>
        <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
      </Card>
    );
  }

  return <ApplicationDetailContent id={id} appBaseUrl={appBaseUrl} />;
}
