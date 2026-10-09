'use client';

import { ESIGN_ERRORS, type EsignDownloadFile, type EsignRequestDetail } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { shortDate } from '../../../../../../../components/esign/format';
import { StatusBadge } from '../../../../../../../components/esign/status-badge';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { RecipientActions } from './recipient-actions';
import { RequestActions } from './request-actions';
import { Recipients } from './recipients';
import { Timeline } from './timeline';

/** One signature request (/firm-sign/requests/{id}): where it is, who signed, and what happened. */
export function RequestDetail({ id }: { id: string }) {
  return <EsignGate>{() => <Detail id={id} />}</EsignGate>;
}

function Detail({ id }: { id: string }) {
  const request = useApiQuery(['esign', 'requests', id], () => api.esign.get(id));
  // The timeline's data, loading alongside the request rather than after it.
  useApiQuery(['esign', 'requests', id, 'events'], () => api.esign.events(id));
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/firm-sign/requests"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All requests
      </Link>
      <PageState query={request} isEmpty={() => false}>
        {(r) => (
          <>
            <Header r={r} />
            <Notices r={r} />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex flex-col gap-6">
                <Recipients
                  recipients={r.recipients}
                  ordered={r.routing === 'SEQUENTIAL'}
                  actions={(x) => <RecipientActions r={r} x={x} />}
                />
                <Timeline id={id} />
              </div>
              <div className="flex flex-col gap-6">
                <Facts r={r} />
                {r.allowedActions.includes('DOWNLOAD') && <Downloads r={r} />}
                {r.internalNote && (
                  <Card>
                    <h2 className="mb-2 font-semibold text-heading">Internal note</h2>
                    <p className="text-sm whitespace-pre-line text-text">{r.internalNote}</p>
                    <p className="mt-2 text-xs text-muted">Only your firm sees this.</p>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </PageState>
    </div>
  );
}

/** What the request waits on, in a sentence. */
function nextStep(r: EsignRequestDetail): string | null {
  const edit = r.allowedActions.includes('EDIT');
  const names = r.nextAction.waitingOn.join(', ');
  switch (r.nextAction.kind) {
    case 'FINISH_DRAFT':
      return edit ? 'Not sent yet: finish preparing it.' : 'Not sent yet.';
    case 'AWAIT_APPROVAL':
      return names ? `Waiting for approval from ${names}.` : 'Waiting for approval.';
    case 'AWAIT_SIGNATURE':
      return names ? `Waiting for ${names} to sign.` : 'Waiting for signatures.';
    default:
      return null;
  }
}

function Header({ r }: { r: EsignRequestDetail }) {
  const next = nextStep(r);
  const edit = r.allowedActions.includes('EDIT');
  const inPerson = r.allowedActions.includes('START_IN_PERSON');
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 data-testid="page-title" className="font-display text-3xl break-words text-heading">
          {r.title}
        </h1>
        <span data-testid="request-status">
          <StatusBadge status={r.status} />
        </span>
      </div>
      {next && <p className="text-text">{next}</p>}
      {(edit || inPerson) && (
        <div className="flex flex-wrap gap-3">
          {edit && (
            <Link href={`/firm-sign/requests/${r.id}/prepare`} className={LINK_BUTTON}>
              Continue preparing
            </Link>
          )}
          {inPerson && (
            <Link href={`/firm-sign/in-person/${r.id}`} className={LINK_BUTTON}>
              Sign in person
            </Link>
          )}
        </div>
      )}
      <RequestActions r={r} />
    </Card>
  );
}

/** The look of the primary Button, for a link (packages/ui has no link button yet). */
const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** When it ended, or when it will expire while open. */
function ended(r: EsignRequestDetail): [string, string] {
  if (r.completedAt) return ['Completed', shortDate(r.completedAt)];
  if (r.voidedAt) return ['Voided', shortDate(r.voidedAt)];
  if (r.declinedAt) return ['Declined', shortDate(r.declinedAt)];
  if (r.expiredAt) return ['Expired', shortDate(r.expiredAt)];
  return ['Expires', shortDate(r.expiresAt)];
}

function Facts({ r }: { r: EsignRequestDetail }) {
  const rows: [string, string][] = [
    ['Engagement', r.engagement?.title ?? '–'],
    ['Sent by', r.sender.name],
    ['Created', shortDate(r.createdAt)],
    ['Sent', shortDate(r.sentAt)],
    ended(r),
    ['Signing order', r.routing === 'SEQUENTIAL' ? 'One after another' : 'All at once'],
    ['Pages', String(r.pagePlan.length)],
  ];
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-heading">Details</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Client</dt>
        <dd className="break-words text-text">
          {r.client ? (
            <Link href={`/clients/${r.client.id}`} className="text-link hover:underline">
              {r.client.displayName}
            </Link>
          ) : (
            '–'
          )}
        </dd>
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Why it ended, and the request it replaced or was replaced by. */
function Notices({ r }: { r: EsignRequestDetail }) {
  const approvals = r.approvalNotes.filter((a) => a.note);
  const any =
    r.voidedAt || r.replacedByRequestId || r.replacesRequestId || r.expiredAt || approvals.length;
  if (!any) return null;
  const nameOf = (id: string) => r.recipients.find((x) => x.id === id)?.name ?? 'An approver';
  return (
    <Card data-testid="notices" className="flex flex-col gap-2 text-sm text-text">
      {r.voidedAt && (
        <p>
          Voided {shortDate(r.voidedAt)}
          {r.voidedBy && ` by ${r.voidedBy.name}`}
          {r.voidReason && `. Reason: ${r.voidReason}`}
        </p>
      )}
      {r.replacedByRequestId && (
        <p>
          It was replaced by{' '}
          <Link
            href={`/firm-sign/requests/${r.replacedByRequestId}`}
            className="text-link underline"
          >
            a new request
          </Link>
          .
        </p>
      )}
      {r.replacesRequestId && (
        <p>
          This replaces{' '}
          <Link href={`/firm-sign/requests/${r.replacesRequestId}`} className="text-link underline">
            an earlier request
          </Link>
          .
        </p>
      )}
      {r.expiredAt && <p>Expired {shortDate(r.expiredAt)} before everyone signed.</p>}
      {approvals.map((a) => (
        <p key={`${a.recipientId}-${a.decision}-${a.note}`}>
          {nameOf(a.recipientId)} {a.decision === 'APPROVE' ? 'approved' : 'asked for changes'}:{' '}
          {a.note}
        </p>
      ))}
    </Card>
  );
}

/** A 5-minute link: saved straight away, without leaving the page. */
function save(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  a.click();
}

/** The signed PDF and certificate once completed; the packet as sent before that. */
function Downloads({ r }: { r: EsignRequestDetail }) {
  const files: [EsignDownloadFile, string][] =
    r.status === 'COMPLETED'
      ? [
          ['final', 'Signed document'],
          ['certificate', 'Completion certificate'],
          ['original', 'Document as sent'],
        ]
      : [['original', 'Document as sent']];
  const download = useApiMutation((file: EsignDownloadFile) => api.esign.download(r.id, file), {
    invalidate: ['esign', 'requests', r.id, 'events'],
  });
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-heading">Download</h2>
      <div className="flex flex-col gap-2">
        {files.map(([file, label]) => (
          <Button
            key={file}
            variant="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate(file, { onSuccess: ({ url }) => save(url) })}
          >
            {label}
          </Button>
        ))}
      </div>
      {download.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(download.error, ESIGN_ERRORS)}
        </p>
      )}
    </Card>
  );
}
