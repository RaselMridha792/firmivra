'use client';

import {
  ESIGN_ERRORS,
  type EsignAccessRole,
  type EsignDownloadFile,
  type EsignRequestDetail,
} from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { canCreate, isOwnerOrAdmin } from '../../../../../../../components/esign/esign-role';
import { shortDate } from '../../../../../../../components/esign/format';
import { StatusBadge } from '../../../../../../../components/esign/status-badge';
import { PageState } from '../../../../../../../components/page-state';
import { useMe } from '../../../../../../../components/signed-in';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { RecipientActions } from './recipient-actions';
import { RequestActions } from './request-actions';
import { Recipients } from './recipients';
import { SaveAsTemplate } from './save-as-template';
import { Timeline, useEvents } from './timeline';

/** One signature request (/firm-sign/requests/{id}): where it is, who signed, and what happened. */
export function RequestDetail({ id }: { id: string }) {
  return <EsignGate>{(role) => <Detail id={id} role={role} />}</EsignGate>;
}

function Detail({ id, role }: { id: string; role: EsignAccessRole | null }) {
  const request = useApiQuery(['esign', 'requests', id], () => api.esign.get(id));
  // The timeline's data, loading alongside the request rather than after it.
  useEvents(id);
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/firm-sign/requests"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Signature requests
      </Link>
      {/* The page keeps a heading while it loads or fails. */}
      {!request.data && <h1 className="sr-only">Signature request</h1>}
      <PageState query={request} isEmpty={() => false}>
        {(r) => (
          <>
            <Header r={r} canSave={canCreate(role)} />
            <Notices r={r} />
            {/* Stacked: recipients, details, timeline. From xl the details sit beside both. */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
              <Recipients
                recipients={r.recipients}
                ordered={r.routing === 'SEQUENTIAL'}
                needsApproval={r.status === 'NEEDS_APPROVAL'}
                actions={(x) => <RecipientActions r={r} x={x} />}
              />
              <div className="flex flex-col gap-6 xl:col-start-2 xl:row-span-2 xl:row-start-1">
                <Facts r={r} role={role} />
                {r.allowedActions.includes('DOWNLOAD') && <Downloads r={r} />}
                {r.internalNote && (
                  <Card>
                    <h2 className="mb-2 font-display text-2xl text-heading">Internal note</h2>
                    <p className="text-sm whitespace-pre-line text-text">{r.internalNote}</p>
                    <p className="mt-2 text-xs text-muted">Only your firm sees this.</p>
                  </Card>
                )}
              </div>
              <Timeline id={id} />
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
      if (r.allowedActions.includes('APPROVE')) return 'Waiting for your approval.';
      return names ? `Waiting for approval from ${names}.` : 'Waiting for approval.';
    case 'AWAIT_SIGNATURE':
      return names ? `Waiting for ${names} to sign.` : 'Waiting for signatures.';
    default:
      return null;
  }
}

function Header({ r, canSave }: { r: EsignRequestDetail; canSave: boolean }) {
  const next = nextStep(r);
  const edit = r.allowedActions.includes('EDIT');
  const inPerson = r.allowedActions.includes('START_IN_PERSON');
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1
          data-testid="page-title"
          className="min-w-0 font-display text-3xl wrap-anywhere text-heading"
        >
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
      {/* Any request with pages can become a template; a Viewer can't make one. */}
      {canSave && r.pagePlan.length > 0 && (
        <div>
          <SaveAsTemplate r={r} />
        </div>
      )}
    </Card>
  );
}

/** The look of the primary Button, for a link (packages/ui has no link button yet). */
const LINK_BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** When it ended (by its status), or when it expires while it is not closed. */
function ended(r: EsignRequestDetail): [string, string] {
  switch (r.status) {
    case 'COMPLETED':
      return ['Completed', shortDate(r.completedAt)];
    case 'VOIDED':
      return ['Voided', shortDate(r.voidedAt)];
    case 'DECLINED':
      return ['Declined', shortDate(r.declinedAt)];
    case 'EXPIRED':
      return ['Expired', shortDate(r.expiredAt)];
    default:
      return ['Expires', shortDate(r.expiresAt)];
  }
}

/** Only actions an approver gets on a request they reach as its approver alone. */
const APPROVER_ONLY = ['APPROVE', 'DOWNLOAD'];

function Facts({ r, role }: { r: EsignRequestDetail; role: EsignAccessRole | null }) {
  const { me } = useMe();
  const signers = r.recipients.filter((x) => x.kind === 'SIGNER').length;
  // A caller who reaches the request only as its approver may not open the client's record.
  const clientLink =
    isOwnerOrAdmin(role) ||
    r.sender.userId === me.user.id ||
    r.allowedActions.some((a) => !APPROVER_ONLY.includes(a));
  const rows: [string, string][] = [
    ['Engagement', r.engagement?.title ?? '–'],
    [r.status === 'DRAFT' ? 'Prepared by' : 'Sent by', r.sender.name],
    ['Created', shortDate(r.createdAt)],
    ['Sent', shortDate(r.sentAt)],
    ended(r),
    ...(signers > 1
      ? [
          ['Signing order', r.routing === 'SEQUENTIAL' ? 'One after another' : 'All at once'] as [
            string,
            string,
          ],
        ]
      : []),
    ['Pages', String(r.pagePlan.length)],
  ];
  return (
    <Card>
      <h2 className="mb-4 font-display text-2xl text-heading">Details</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <div className="contents">
          <dt className="text-muted">Client</dt>
          <dd data-testid="request-client" className="break-words text-text">
            {r.client && clientLink ? (
              <Link href={`/clients/${r.client.id}`} className="text-link hover:underline">
                {r.client.displayName}
              </Link>
            ) : (
              (r.client?.displayName ?? '–')
            )}
          </dd>
        </div>
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
  // The storage link is sent as an attachment, so the browser saves it and stays on this page.
  a.download = '';
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
      <h2 className="mb-4 font-display text-2xl text-heading">Download</h2>
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
