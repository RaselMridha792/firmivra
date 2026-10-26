'use client';

import { ApiRequestError, type ClientSignUpDetail } from '@firmivra/types';
import { Avatar, Badge, Button, Checkbox, Skeleton } from '@firmivra/ui';
import { ArrowSquareOut, CheckCircle, Prohibit, Warning, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { ACCOUNT_TYPES, formatPhone } from '../../clients/_components/client-parts';
import { ApproveDialog } from './approve-dialog';
import { DeclineDialog } from './decline-dialog';
import { dayText, EVENT_TEXT, momentText, SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

export type Notice = { ok: boolean; text: string; clientId?: string };

/** One request, shared by the panel and the activity list (one fetch, one audit entry). */
export function useSignUp(id: string) {
  return useApiQuery([...SIGN_UPS, 'detail', id], () =>
    id ? api.clientSignUps.get(id) : Promise.resolve(null),
  );
}

const STATUS_BADGE = {
  PENDING_APPROVAL: { tone: 'warning', text: 'Pending' },
  APPROVED: { tone: 'success', text: 'Approved' },
  DECLINED: { tone: 'danger', text: 'Declined' },
} as const;

/** The three checks a potential match needs before access is restored or a record linked. */
const CHECKS = [
  'Call the contact already on file',
  "Verify the client's identity",
  "Record the client's permission",
];

const card = 'min-w-0 rounded-xl border border-divider bg-surface p-5';

/**
 * The open request (the design's right-hand panel, staff only): who applied and when, the match
 * check, and the decision. A potential match keeps Approve off and shows the existing record
 * and the checks Restore Access and Link Existing Record need. A decided request shows its
 * decision instead of action buttons.
 */
export function RequestPanel({
  id,
  onClose,
  onNotice,
}: {
  id: string;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const detail = useSignUp(id);
  const [deciding, setDeciding] = useState<'approve' | 'decline' | null>(null);

  if (!id) {
    return (
      <aside aria-labelledby="su-panel" className={card} data-testid="sign-up-panel">
        <PanelTitle title="Review a request" />
        <p className="mt-3 text-sm text-muted">
          Select a request to see the applicant, the match check and the decision.
        </p>
      </aside>
    );
  }
  if (detail.isPending) {
    return (
      <aside aria-busy="true" aria-label="Loading the request" className={card}>
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-4 h-14 w-full" />
        <Skeleton className="mt-4 h-24 w-full" />
      </aside>
    );
  }
  if (detail.isError || !detail.data) {
    const gone = detail.error instanceof ApiRequestError && detail.error.code === 'NOT_FOUND';
    return (
      <aside aria-labelledby="su-panel" className={card} data-testid="sign-up-panel">
        <PanelTitle title="Review a request" onClose={onClose} />
        <p role="alert" className="mt-3 text-sm text-danger">
          {gone ? SIGN_UP_ERRORS['NOT_FOUND'] : errorMessage(detail.error, SIGN_UP_ERRORS)}
        </p>
        {gone ? null : (
          <Button variant="secondary" className="mt-3" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        )}
      </aside>
    );
  }

  const r = detail.data;
  const waiting = r.status === 'PENDING_APPROVAL';
  const matched = waiting && r.match === 'POTENTIAL_MATCH';
  const badge = STATUS_BADGE[r.status];
  return (
    <aside aria-labelledby="su-panel" className={card} data-testid="sign-up-panel">
      <PanelTitle
        title={matched ? 'Resolve Existing Account' : 'Sign-up Request'}
        onClose={onClose}
      />
      <div className="mt-4 flex min-w-0 items-center gap-3">
        <Avatar name={r.name} size="lg" />
        <div className="min-w-0">
          <p className="font-semibold text-heading">{r.name}</p>
          <p className="text-sm text-muted wrap-anywhere">{r.email}</p>
        </div>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Phone</dt>
        <dd className="text-text">{r.phone ? formatPhone(r.phone) : 'Not given'}</dd>
        <dt className="text-muted">Account type</dt>
        <dd className="text-text">{ACCOUNT_TYPES[r.accountType]}</dd>
        <dt className="text-muted">Submitted</dt>
        <dd className="text-text">{momentText(r.signedUpAt)}</dd>
        <dt className="text-muted">Request ID</dt>
        <dd className="font-mono text-xs text-text wrap-anywhere">{r.clientAccountId}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted">
        Contact details in a sign-up are what the applicant typed. They prove nothing on their own.
      </p>

      {matched ? <MatchReview request={r} onNotice={onNotice} onClose={onClose} /> : null}
      {waiting && !matched ? (
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-divider bg-success-soft p-4">
          <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="text-sm">
            <p className="font-semibold text-success">No match found</p>
            <p className="text-text">No client of your firm has this email or phone number.</p>
          </div>
        </div>
      ) : null}

      {waiting ? (
        <div className="mt-5 border-t border-divider pt-4">
          <p className="text-sm text-text">
            New applicants: Approve / Decline after authorized review.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              disabled={matched}
              aria-describedby="su-approve-note"
              onClick={() => setDeciding('approve')}
            >
              Approve
            </Button>
            <Button variant="outline" onClick={() => setDeciding('decline')}>
              Decline
            </Button>
          </div>
          <p id="su-approve-note" className="mt-2 text-xs text-muted">
            {matched
              ? 'Approve stays off while this request may belong to a client your firm already has.'
              : 'Approval decisions require an authorized role.'}
          </p>
        </div>
      ) : (
        <Decision request={r} />
      )}

      <ApproveDialog
        signUp={deciding === 'approve' ? r : null}
        onClose={() => setDeciding(null)}
        onDone={(done) => {
          setDeciding(null);
          onNotice({
            ok: true,
            text: `${r.name} is approved and can now use your client portal.`,
            clientId: done.clientId,
          });
        }}
      />
      <DeclineDialog
        signUp={deciding === 'decline' ? r : null}
        onClose={() => setDeciding(null)}
        onDone={() => {
          setDeciding(null);
          onNotice({ ok: true, text: `${r.name}'s sign-up was declined.` });
        }}
      />
    </aside>
  );
}

function PanelTitle({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2
        id="su-panel"
        className="flex flex-wrap items-center gap-3 font-display text-xl font-bold text-heading"
      >
        {title}
        <Badge tone="neutral">STAFF ONLY</Badge>
      </h2>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the request"
          className="flex size-10 shrink-0 items-center justify-center rounded-control text-muted hover:bg-canvas"
        >
          <X aria-hidden weight="bold" className="size-5" />
        </button>
      ) : null}
    </div>
  );
}

/** A potential match: the existing record(s), the required checks, and what stays off. */
function MatchReview({
  request,
  onNotice,
  onClose,
}: {
  request: ClientSignUpDetail;
  onNotice: (notice: Notice) => void;
  onClose: () => void;
}) {
  const on = (fields: string[]) =>
    fields.map((f) => (f === 'email' ? 'email' : 'phone number')).join(' and ');
  return (
    <>
      <div
        className="mt-4 rounded-lg border border-warning bg-warning-soft p-4"
        data-testid="match-alert"
      >
        <div className="flex items-start gap-3">
          <Warning aria-hidden weight="fill" className="mt-0.5 size-6 shrink-0 text-warning" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-warning">
              Potential Match — Automatic Approval Paused
            </p>
            <p className="mt-1 text-text">
              Keep this request pending. Review the existing client record before granting access.
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {request.candidates.map((c) => (
                <li key={c.clientId} className="flex flex-col gap-1">
                  <Link
                    href={`/clients/${c.clientId}`}
                    className="inline-flex min-h-10 w-fit items-center gap-2 rounded-control border border-action bg-surface px-3 font-medium text-action hover:bg-accent-soft"
                  >
                    <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                    View existing client record
                    <span className="sr-only">
                      {' '}
                      {c.clientNumber}, {c.displayName}
                    </span>
                  </Link>
                  <span className="text-xs text-muted">
                    {c.clientNumber} · {c.displayName} · same {on(c.matchedOn)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <fieldset className="mt-5" aria-describedby="su-checks-note">
        <legend className="font-semibold text-heading">Required before restoring or linking</legend>
        {CHECKS.map((label) => (
          <Checkbox key={label} label={label} disabled checked={false} readOnly />
        ))}
        <p id="su-checks-note" className="text-sm text-muted">
          Do not rely on new contact details from this request.
        </p>
      </fieldset>
      <div className="mt-4 border-t border-divider pt-4">
        <p className="text-sm text-text">
          Preserve the existing Client ID. No duplicate profile is created.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button disabled aria-describedby="su-resolve-note">
            Restore Access
          </Button>
          <Button disabled aria-describedby="su-resolve-note">
            Link Existing Record
          </Button>
          <Button
            onClick={() => {
              onNotice({
                ok: true,
                text: `${request.name}'s request stays waiting for approval. Nothing was changed.`,
              });
              onClose();
            }}
          >
            Keep Pending
          </Button>
        </div>
        <p id="su-resolve-note" className="mt-2 text-xs text-muted">
          Available only after all required checks are recorded.
        </p>
      </div>
    </>
  );
}

/** A decided request: its outcome instead of action buttons. */
function Decision({ request: r }: { request: ClientSignUpDetail }) {
  const last = [...r.history].reverse().find((h) => h.kind === 'APPROVED' || h.kind === 'DECLINED');
  const by = last?.actorName ? ` by ${last.actorName}` : '';
  if (r.status === 'APPROVED') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-divider bg-success-soft p-4">
        <CheckCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-success">
            Approved{r.approvedAt ? ` ${dayText(r.approvedAt)}` : ''}
            {by}
          </p>
          {r.client ? (
            <p className="mt-1 text-text">
              Client ID {r.client.clientNumber} ·{' '}
              <Link href={`/clients/${r.client.clientId}`} className="text-link hover:underline">
                Open client record
              </Link>
            </p>
          ) : (
            <p className="mt-1 text-text">This login is not linked to a client record.</p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-3 rounded-lg border border-divider bg-danger-soft p-4">
      <Prohibit aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-danger">
          Declined{r.declinedAt ? ` ${dayText(r.declinedAt)}` : ''}
          {by}
        </p>
        <p className="mt-1 text-text">
          {r.declineReason
            ? `Reason (your firm only): ${r.declineReason}`
            : 'No reason was recorded.'}
        </p>
      </div>
    </div>
  );
}

/** The open request's history under the list (the design's Activity), oldest first. */
export function RequestActivity({ id }: { id: string }) {
  const detail = useSignUp(id);
  return (
    <section aria-labelledby="su-activity">
      <h2 id="su-activity" className="font-display text-lg font-bold text-heading">
        Activity
      </h2>
      {!id ? (
        <p className="mt-2 text-sm text-muted">Select a request to see its activity.</p>
      ) : detail.isPending ? (
        <Skeleton className="mt-3 h-12 w-full" />
      ) : !detail.data ? (
        <p className="mt-2 text-sm text-muted">The activity can&apos;t be shown right now.</p>
      ) : (
        <ol className="mt-3 flex flex-col" data-testid="sign-up-activity">
          {detail.data.history.map((event, i, all) => (
            <li key={`${event.kind}-${event.at}`} className="relative flex gap-4 pb-4 last:pb-0">
              {i < all.length - 1 ? (
                <span aria-hidden className="absolute left-[7px] top-4 h-full w-0.5 bg-divider" />
              ) : null}
              <span aria-hidden className="relative mt-1 size-4 shrink-0 rounded-full bg-action" />
              <span className="text-sm">
                <span className="block font-medium text-heading">
                  {EVENT_TEXT[event.kind]}
                  {event.actorName ? ` by ${event.actorName}` : ''}
                </span>
                <time dateTime={event.at} className="text-muted">
                  {momentText(event.at)}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
