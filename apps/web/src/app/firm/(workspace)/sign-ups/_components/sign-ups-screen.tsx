'use client';

import type { ClientSignUp, SignUpListStatus } from '@firmivra/types';
import { Badge, Button, EmptyState } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ACCOUNT_TYPES, CLIENTS, formatPhone } from '../../clients/_components/client-parts';
import { DeclineDialog } from './decline-dialog';
import { SIGN_UP_ERRORS, SIGN_UPS, signedUpText } from './sign-up-parts';

const VIEWS: { status: SignUpListStatus; label: string }[] = [
  { status: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { status: 'DECLINED', label: 'Declined' },
];

type Feedback = { ok: boolean; text: string; clientId?: string };

/**
 * Client sign-ups from the portal, oldest first: verified people waiting for the firm. Owner and
 * Admin approve (creating the client record, or linking the one with the same email) or decline.
 * Staff get 403 from the API and see the no-permission state.
 */
export function SignUpsScreen() {
  const [status, setStatus] = useState<SignUpListStatus>('PENDING_APPROVAL');
  const [cursors, setCursors] = useState<string[]>([]);
  const [declining, setDeclining] = useState<ClientSignUp | null>(null);
  // Only the latest action's result shows.
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const cursor = cursors.at(-1);
  const query = { status, ...(cursor ? { cursor } : {}) };
  const signUps = useApiQuery([...SIGN_UPS, query], () => api.clientSignUps.list(query));
  const approve = useApiMutation(
    (signUp: ClientSignUp) =>
      api.clientSignUps.approve(
        signUp.clientAccountId,
        signUp.existingClient ? { clientId: signUp.existingClient.clientId } : {},
      ),
    { invalidate: SIGN_UPS },
  );
  const queryClient = useQueryClient();

  const show = (next: SignUpListStatus) => {
    setStatus(next);
    setCursors([]);
    setFeedback(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Sign-ups
        </h1>
        <p className="text-sm text-muted">
          People who signed up on your client portal and verified their email and phone. Approve
          them to open their portal access.
        </p>
      </div>
      <nav aria-label="Sign-ups" className="flex gap-1 overflow-x-auto border-b border-border">
        {VIEWS.map((view) => (
          <button
            key={view.status}
            type="button"
            aria-pressed={status === view.status}
            onClick={() => show(view.status)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${status === view.status ? 'border-brand-600 text-brand-600' : 'border-transparent text-muted hover:text-text'}`}
          >
            {view.label}
          </button>
        ))}
      </nav>
      {feedback ? (
        <p
          data-testid="sign-ups-feedback"
          role={feedback.ok ? 'status' : 'alert'}
          className={`text-sm ${feedback.ok ? 'text-success' : 'text-danger'}`}
        >
          {feedback.text}
          {feedback.clientId ? (
            <>
              {' '}
              <Link href={`/clients/${feedback.clientId}`} className="text-link hover:underline">
                Open client record
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <PageState query={signUps}>
        {(page) =>
          page.items.length ? (
            <div className="flex flex-col gap-4">
              <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                {page.items.map((signUp) => (
                  <li
                    key={signUp.clientAccountId}
                    data-testid="sign-up-row"
                    className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">{signUp.name}</span>
                        <Badge tone="info">{ACCOUNT_TYPES[signUp.accountType]}</Badge>
                      </span>
                      <span className="mt-1 block text-sm wrap-anywhere text-muted">
                        {signUp.email}
                        <span aria-hidden> · </span>
                        <span className="whitespace-nowrap">{formatPhone(signUp.phone)}</span>
                      </span>
                      <span className="mt-1 block text-xs text-muted">
                        {signUp.status === 'DECLINED' && signUp.declinedAt
                          ? `Declined ${signedUpText(signUp.declinedAt)}${signUp.declineReason ? `: ${signUp.declineReason}` : ''}`
                          : `Signed up ${signedUpText(signUp.signedUpAt)}`}
                      </span>
                      {signUp.existingClient && signUp.status === 'PENDING_APPROVAL' ? (
                        <span className="mt-2 block text-sm text-info">
                          Matches your client {signUp.existingClient.displayName}. Approving links
                          this login to that record.
                        </span>
                      ) : null}
                    </span>
                    {signUp.status === 'PENDING_APPROVAL' ? (
                      <span className="flex shrink-0 gap-2">
                        <Button
                          disabled={approve.isPending}
                          onClick={() =>
                            approve.mutate(signUp, {
                              onSuccess: (done) => {
                                void queryClient.invalidateQueries({ queryKey: CLIENTS });
                                setFeedback({
                                  ok: true,
                                  text: `${signUp.name} is approved and can now use your portal.`,
                                  clientId: done.clientId,
                                });
                              },
                              onError: (error) =>
                                setFeedback({
                                  ok: false,
                                  text: errorMessage(error, SIGN_UP_ERRORS),
                                }),
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button variant="secondary" onClick={() => setDeclining(signUp)}>
                          Decline
                        </Button>
                      </span>
                    ) : (
                      <Badge tone="danger">Declined</Badge>
                    )}
                  </li>
                ))}
              </ul>
              {cursors.length || page.nextCursor ? (
                <div className="flex items-center gap-3 text-sm text-muted">
                  <p aria-live="polite">Page {cursors.length + 1}</p>
                  <Button
                    variant="secondary"
                    disabled={!cursors.length}
                    onClick={() => setCursors(cursors.slice(0, -1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!page.nextCursor}
                    onClick={() => page.nextCursor && setCursors([...cursors, page.nextCursor])}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState
              title={status === 'DECLINED' ? 'No declined sign-ups' : 'No one is waiting'}
              description={
                status === 'DECLINED'
                  ? 'Sign-ups you decline are listed here.'
                  : 'When someone signs up on your client portal and verifies their email and phone, they appear here for you to approve.'
              }
            />
          )
        }
      </PageState>
      <DeclineDialog
        signUp={declining}
        onClose={() => setDeclining(null)}
        onDone={(signUp) => {
          setDeclining(null);
          setFeedback({ ok: true, text: `${signUp.name}'s sign-up was declined.` });
        }}
      />
    </div>
  );
}
