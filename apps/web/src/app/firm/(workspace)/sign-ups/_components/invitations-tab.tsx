'use client';

import type {
  PortalInvitationBlock,
  PortalInvitationListState,
  PortalInvitationRow,
  PortalInvitationsQuery,
} from '@firmivra/types';
import { Badge, Button, Modal, Pagination, SearchField, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { dayText } from './sign-up-parts';

// Clients Review Two, N8-09: Sign-ups > Invitations. Every client with no portal login, and every
// client invited in the last eight days, with the invitation's state; Invite, Resend and Revoke
// go through the client's own invitation routes, Invite and Resend after the same confirmation
// of the recipient as on the client's record. Staff see their own clients (the API filters).

const INVITATIONS = ['portal-invitations'] as const;
const PAGE = 10;

const STATES: Record<
  PortalInvitationListState,
  { label: string; tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple' }
> = {
  NOT_INVITED: { label: 'Not invited', tone: 'neutral' },
  OPEN: { label: 'Sent', tone: 'info' },
  OPENED: { label: 'Opened', tone: 'purple' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  REVOKED: { label: 'Revoked', tone: 'neutral' },
  NOT_SENT: { label: 'Not delivered', tone: 'danger' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  BLOCKED: { label: 'Can’t invite', tone: 'warning' },
};

const BLOCKS: Record<PortalInvitationBlock, string> = {
  NO_EMAIL: 'No email on file: add one on the client’s record.',
  HAS_LOGIN: 'Has a portal login.',
  SIGN_UP_WAITING: 'A sign-up with this email waits in Waiting for Approval.',
  ARCHIVED: 'Archived client: restore them first.',
  DAILY_LIMIT: 'Three invitations today: send again tomorrow.',
};

/** What a row's state allows. */
const actionsOf = (r: PortalInvitationRow) => ({
  invite: r.state === 'NOT_INVITED' && !r.blocked,
  resend: ['OPEN', 'OPENED', 'EXPIRED', 'REVOKED', 'NOT_SENT'].includes(r.state) && !r.blocked,
  revoke: r.state === 'OPEN' || r.state === 'OPENED',
});

/** The row's state line: when it was sent and by whom, opened, revoked or expired. */
function detailOf(r: PortalInvitationRow): string {
  const i = r.invitation;
  const parts: string[] = [];
  if (i) parts.push(`Sent ${dayText(i.sentAt)}${i.sentBy ? ` by ${i.sentBy}` : ''}`);
  if (i?.openedAt) parts.push(`opened ${dayText(i.openedAt)}`);
  if (i?.revokedAt) parts.push(`revoked ${dayText(i.revokedAt)}`);
  if (i && r.state === 'EXPIRED') parts.push(`expired ${dayText(i.expiresAt)}`);
  if (i && (r.state === 'OPEN' || r.state === 'OPENED'))
    parts.push(`works until ${dayText(i.expiresAt)}`);
  return parts.join(' · ');
}

type Ask = { kind: 'send' | 'revoke'; row: PortalInvitationRow } | null;

export function InvitationsTab() {
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<PortalInvitationListState | ''>('');
  const [page, setPage] = useState(1);
  const [ask, setAsk] = useState<Ask>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // The search settles before it is sent (control characters are refused by the API).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchText.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchText]);
  const query: PortalInvitationsQuery = {
    page,
    limit: PAGE,
    ...(search ? { search } : {}),
    ...(state ? { state } : {}),
  };
  const list = useApiQuery([...INVITATIONS, query], () => api.portalInvitations.list(query));
  const act = useApiMutation(
    async (a: NonNullable<Ask>) =>
      a.kind === 'send'
        ? api.portalInvitations.send(a.row.clientId, { confirm: true })
        : api.portalInvitations.revoke(a.row.clientId),
    { invalidate: INVITATIONS },
  );
  const run = (a: NonNullable<Ask>) =>
    act.mutate(a, {
      onSuccess: (access) => {
        setAsk(null);
        setNotice(
          a.kind === 'revoke'
            ? { ok: true, text: `The invitation to ${a.row.clientName} is revoked.` }
            : access.invitation?.delivered === false
              ? {
                  ok: false,
                  text: `The email to ${a.row.email ?? 'the client'} could not be sent.`,
                }
              : { ok: true, text: `Invitation sent to ${a.row.email ?? a.row.clientName}.` },
        );
      },
    });
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="sign-ups-invitations">
      <p className="text-sm text-muted">
        Invite a client to the portal, send it again or revoke a link. The link works for 7 days and
        opens the portal&apos;s sign-up; you approve the sign-up in Waiting for Approval.
      </p>
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <SearchField
          label="Search clients"
          placeholder="Search name, email or client ID"
          value={searchText}
          maxLength={100}
          minWidth="10rem"
          onChange={(event) => setSearchText(event.target.value)}
          className="bg-surface!"
        />
        <div className="w-48">
          <Select
            label="Invitation status"
            hideLabel
            value={state}
            options={[
              { value: '', label: 'All statuses' },
              ...(Object.keys(STATES) as PortalInvitationListState[]).map((s) => ({
                value: s,
                label: STATES[s].label,
              })),
            ]}
            onChange={(e) => {
              setState(e.target.value as PortalInvitationListState | '');
              setPage(1);
            }}
          />
        </div>
      </div>
      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          data-testid="invitations-notice"
          className={`text-sm ${notice.ok ? 'text-success' : 'text-danger'}`}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface">
        <PageState
          query={list}
          empty={search || state ? 'No clients match.' : 'Every client already has a portal login.'}
          isEmpty={(d) => d.items.length === 0}
        >
          {(d) => (
            <>
              <ul className="flex flex-col divide-y divide-divider">
                {d.items.map((r) => {
                  const look = STATES[r.state];
                  const can = actionsOf(r);
                  const detail = detailOf(r);
                  return (
                    <li
                      key={r.clientId}
                      data-testid="invitation-row"
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/clients/${r.clientId}`}
                            className="font-semibold text-link hover:underline"
                          >
                            {r.clientName}
                          </Link>
                          <span className="text-sm text-muted">{r.clientNumber}</span>
                          <Badge tone={look.tone}>{look.label}</Badge>
                        </span>
                        <span className="text-sm break-all text-text">
                          {r.email ?? 'No email on file'}
                        </span>
                        {detail ? <span className="text-sm text-muted">{detail}</span> : null}
                        {r.blocked && r.blocked !== 'HAS_LOGIN' ? (
                          <span className="text-sm text-warning" data-testid="invitation-blocked">
                            {BLOCKS[r.blocked]}
                          </span>
                        ) : null}
                      </div>
                      <span className="flex flex-wrap gap-2">
                        {can.invite || can.resend ? (
                          <Button
                            variant={can.invite ? 'primary' : 'outline'}
                            aria-label={`${can.invite ? 'Invite' : 'Resend'} ${r.clientName}`}
                            onClick={() => setAsk({ kind: 'send', row: r })}
                          >
                            {can.invite ? 'Invite' : 'Resend'}
                          </Button>
                        ) : null}
                        {can.revoke ? (
                          <Button
                            variant="secondary"
                            aria-label={`Revoke ${r.clientName}`}
                            onClick={() => setAsk({ kind: 'revoke', row: r })}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {d.total > PAGE ? (
                <div className="border-t border-divider px-4 py-3">
                  <Pagination page={page} pageCount={Math.ceil(d.total / PAGE)} onPage={setPage} />
                </div>
              ) : null}
            </>
          )}
        </PageState>
      </div>
      {ask ? (
        <Modal
          open
          title={
            ask.kind === 'revoke'
              ? `Revoke the invitation to ${ask.row.clientName}?`
              : `${ask.row.state === 'NOT_INVITED' ? 'Invite' : 'Resend the invitation to'} ${ask.row.clientName}?`
          }
          onClose={() => {
            setAsk(null);
            act.reset();
          }}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setAsk(null);
                  act.reset();
                }}
              >
                Cancel
              </Button>
              <Button disabled={act.isPending} onClick={() => run(ask)}>
                {act.isPending
                  ? 'Working…'
                  : ask.kind === 'revoke'
                    ? 'Revoke Invitation'
                    : 'Send Invitation'}
              </Button>
            </>
          }
        >
          <div className="flex max-w-md flex-col gap-2 text-sm text-text">
            {ask.kind === 'revoke' ? (
              <p>The link stops working at once. You can send a new invitation later.</p>
            ) : (
              <>
                <p>
                  {ask.row.clientName} gets a link at <strong>{ask.row.email}</strong> to sign up
                  for your portal. It works for 7 days, and you approve the sign-up in Waiting for
                  Approval.
                </p>
                {ask.row.invitation ? <p>The earlier link stops working.</p> : null}
              </>
            )}
            {act.error ? (
              <p role="alert" className="text-danger">
                {errorMessage(act.error)}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
