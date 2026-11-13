'use client';

import {
  FIRM_APPLICATION_ACTIVITY_LABELS,
  FIRM_APPLICATION_STATUS_LABELS,
  type FirmApplicationInfoRequestView,
  type FirmApplicationRecord,
} from '@firmivra/types';
import { Button, Card, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Download, MailQuestion } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CardHeading } from './application-cards';
import { APPLICATIONS_KEY, applicationDetailKey } from './application-data';
import { dateParts } from './application-ui';

// SA-APP-F02 to F09 on the review page: In Review on open, the assigned reviewer, last activity,
// the request status, every request with its responses and files. Times are the platform's,
// America/New_York, labelled ET.

/** "Nov 10, 2026, 9:15 AM ET". */
export const etText = (iso: string) => {
  const [day, time] = dateParts(iso);
  return `${day}, ${time} ET`;
};

/**
 * SA-APP-F02: once the review page has a Pending application, it says so (POST .../open): the
 * application becomes In Review, recorded as the reviewer who opened it. Once per page; never from
 * the list, and never inside a GET.
 */
export function useOpenForReview(application: FirmApplicationRecord | undefined) {
  const client = useQueryClient();
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!application || application.status !== 'PENDING_REVIEW') return;
    if (sentRef.current === application.id) return;
    sentRef.current = application.id;
    void api.firmApplications
      .open(application.id)
      .then((record) => {
        client.setQueryData(applicationDetailKey(application.id), record);
        void client.invalidateQueries({ queryKey: APPLICATIONS_KEY });
      })
      .catch(() => {
        // The page still works; the next open tries again.
        sentRef.current = null;
      });
  }, [application, client]);
}

/** SA-APP-F08 in words. */
export function requestStateText(state: FirmApplicationRecord['requestState']): string {
  if (state.state === 'WAITING' && state.at) return `Requested, waiting since ${etText(state.at)}`;
  if (state.state === 'RESPONDED' && state.at) return `Response received ${etText(state.at)}`;
  return 'No request';
}

const REQUEST_LOOKS: Record<FirmApplicationInfoRequestView['status'], [string, string]> = {
  OPEN: ['Waiting for the applicant', 'bg-warning-soft text-warning'],
  RESPONDED: ['Answered', 'bg-success-soft text-success'],
  SUPERSEDED: ['Closed', 'bg-canvas text-muted'],
  EXPIRED: ['Link expired', 'bg-danger-soft text-danger'],
};

/**
 * The Review card: the application's and the firm account's status as two labelled badges
 * (SA-APP-Y01), the assigned reviewer with Assign / Reassign for a Super Admin (F06), the last
 * activity (F07) and the request status (F08).
 */
export function ReviewCard({ application }: { application: FirmApplicationRecord }) {
  const reviewers = useApiQuery(['firm-applications', 'reviewers'], () =>
    api.firmApplications.reviewers(),
  );
  const [choice, setChoice] = useState(application.assignedReviewer?.userId ?? '');
  const assign = useApiMutation(
    (userId: string | null) => api.firmApplications.assignReviewer(application.id, { userId }),
    { invalidate: APPLICATIONS_KEY },
  );
  const current = application.assignedReviewer?.userId ?? '';
  const activity = application.lastActivity;
  return (
    <Card className="!p-4" data-testid="review-card">
      <CardHeading icon={ClipboardList}>Review</CardHeading>
      <dl className="mt-4 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
        <dt className="font-semibold text-heading">Application</dt>
        <dd data-testid="review-application-status">
          {FIRM_APPLICATION_STATUS_LABELS[application.status]}
        </dd>
        <dt className="font-semibold text-heading">Firm account</dt>
        <dd data-testid="review-account-status">
          {application.firm ? accountLabel(application.firm.status) : 'Not created yet'}
        </dd>
        <dt className="font-semibold text-heading">Last activity</dt>
        <dd data-testid="review-last-activity">
          {FIRM_APPLICATION_ACTIVITY_LABELS[activity.event]}
          <span className="block text-muted">{etText(activity.at)}</span>
        </dd>
        <dt className="font-semibold text-heading">Information request</dt>
        <dd data-testid="review-request-state">{requestStateText(application.requestState)}</dd>
        <dt className="font-semibold text-heading">Reviewer</dt>
        <dd data-testid="review-reviewer">{application.assignedReviewer?.name ?? 'Unassigned'}</dd>
      </dl>
      {application.can.assign ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            assign.mutate(choice || null);
          }}
        >
          <div className="min-w-0 grow basis-48">
            <Select
              label={current ? 'Reassign reviewer' : 'Assign reviewer'}
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              options={[
                { value: '', label: 'Unassigned' },
                ...(reviewers.data?.items ?? []).map((r) => ({ value: r.userId, label: r.name })),
              ]}
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={assign.isPending || choice === current}
          >
            {assign.isPending ? 'Saving…' : current ? 'Reassign' : 'Assign'}
          </Button>
        </form>
      ) : null}
      {assign.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(assign.error)}
        </p>
      ) : null}
    </Card>
  );
}

const accountLabel = (status: NonNullable<FirmApplicationRecord['firm']>['status']) =>
  ({ PENDING_SETUP: 'Pending Setup', ACTIVE: 'Active', SUSPENDED: 'Suspended', CLOSED: 'Closed' })[
    status
  ];

const size = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/**
 * Information Requests (SA-APP-F03, F04, F08): each request on its own row, newest first, with
 * what was asked, by whom and when, its state, and the applicant's responses: text, and files to
 * view or download once scanned clean.
 */
export function RequestsCard({ application }: { application: FirmApplicationRecord }) {
  const [opening, setOpening] = useState('');
  const [failed, setFailed] = useState('');
  const open = async (fileId: string) => {
    setFailed('');
    setOpening(fileId);
    try {
      const link = await api.firmApplications.fileLink(application.id, fileId);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setFailed(errorMessage(error, { FILE_NOT_READY: 'This file is still being checked.' }));
    } finally {
      setOpening('');
    }
  };
  return (
    <Card className="!p-4" data-testid="requests-card">
      <CardHeading icon={MailQuestion}>Information Requests</CardHeading>
      {application.requests.length ? (
        <ol className="mt-4 flex flex-col gap-4">
          {application.requests.map((r) => {
            const [label, tone] = REQUEST_LOOKS[r.status];
            return (
              <li key={r.id} className="rounded-control border border-divider p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted">
                    {etText(r.requestedAt)}
                    {r.requestedBy ? `, by ${r.requestedBy.name}` : ''}
                  </span>
                  <span className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${tone}`}>
                    {label}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-text">{r.reason}</p>
                {r.status === 'OPEN' ? (
                  <p className="mt-1 text-xs text-muted">
                    The link works until {etText(r.expiresAt)}.
                  </p>
                ) : null}
                {r.responses.map((x) => (
                  <div key={x.id} className="mt-3 rounded-control bg-canvas p-3">
                    <p className="text-xs font-semibold text-heading">
                      Response, {etText(x.submittedAt)}
                    </p>
                    {x.text ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-text">{x.text}</p>
                    ) : null}
                    {x.files.length ? (
                      <ul className="mt-2 flex flex-col gap-1">
                        {x.files.map((f) => (
                          <li key={f.id} className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 grow break-all">
                              {f.fileName} <span className="text-muted">({size(f.sizeBytes)})</span>
                            </span>
                            {f.scanStatus === 'CLEAN' ? (
                              <Button
                                variant="secondary"
                                disabled={opening === f.id}
                                onClick={() => void open(f.id)}
                              >
                                <Download aria-hidden className="size-4" />
                                View or download<span className="sr-only"> {f.fileName}</span>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted">
                                {f.scanStatus === 'PENDING'
                                  ? 'Being checked'
                                  : 'Blocked: did not pass the check'}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted">No information requests yet.</p>
      )}
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {failed}
        </p>
      ) : null}
    </Card>
  );
}
