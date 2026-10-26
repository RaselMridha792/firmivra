'use client';

import type { ClientPortalAccess } from '@firmivra/types';
import { Badge, Button, Checkbox, Modal } from '@firmivra/ui';
import { EnvelopeSimple, PaperPlaneTilt, UserCircle, XCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine } from './ba-dialogs';
import { BA_KEY, SectionHead, card, quiet } from './ba-shared';
import { blockText, invitationLine, PORTAL_ACCESS } from './portal-invitation-parts';

const accessKey = (clientId: string | undefined) => [...BA_KEY, 'portal-access', clientId];

/**
 * The Client Portal tab's Portal Access card (Business Advisory B3): who can sign in for the
 * client, the last invitation and its state, and Send Portal Invitation, Resend and Revoke.
 */
export function PortalAccessCard({
  firmClientId,
  failed,
  onDone,
}: {
  firmClientId: string | undefined;
  failed: boolean;
  onDone: (text: string) => void;
}) {
  const access = useApiQuery(accessKey(firmClientId), () =>
    firmClientId ? api.portalInvitations.access(firmClientId) : Promise.resolve(null),
  );
  const [dialog, setDialog] = useState<'send' | 'revoke'>();
  const a = access.data;
  const line = a ? invitationLine(a) : null;
  const block = a?.blocked ? blockText(a.blocked, a.clientId) : null;
  const open = a?.invitation?.state === 'OPEN';

  return (
    <section className={card} aria-label="Portal access" data-testid="portal-access">
      <SectionHead
        icon={UserCircle}
        title="Portal Access"
        subtitle="Who can sign in to the client portal for this client."
      />
      {failed || access.isError ? (
        <p className={quiet}>Not available right now.</p>
      ) : !a ? (
        <p className={quiet}>Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {a.logins.length ? (
            <ul className="divide-y divide-divider">
              {a.logins.map((l) => (
                <li
                  key={l.clientAccountId}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="min-w-40 flex-1 text-heading">{l.email}</span>
                  <Badge tone="neutral">{l.portalRole.replace('_', ' ').toLowerCase()}</Badge>
                  <Badge
                    tone={
                      l.status === 'ACTIVE'
                        ? 'success'
                        : l.status === 'INVITED' || l.status === 'PENDING_APPROVAL'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {l.status.replace('_', ' ').toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>No portal login yet.</p>
          )}
          {line ? (
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="invitation-line">
              <Badge tone={line.tone}>
                {a.invitation!.state === 'NOT_SENT'
                  ? 'not sent'
                  : a.invitation!.state.toLowerCase()}
              </Badge>
              <span className="text-text">{line.text}</span>
            </p>
          ) : null}
          {block ? (
            <p className={quiet} data-testid="invitation-blocked">
              {block.text}{' '}
              {block.link ? (
                <Link href={block.link.href} className="font-medium text-link hover:underline">
                  {block.link.label}
                </Link>
              ) : null}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!a.blocked ? (
              <Button onClick={() => setDialog('send')}>
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                {a.invitation && a.invitation.state !== 'ACCEPTED'
                  ? 'Resend Invitation'
                  : 'Send Portal Invitation'}
              </Button>
            ) : null}
            {open ? (
              <Button variant="secondary" onClick={() => setDialog('revoke')}>
                <XCircle aria-hidden weight="fill" className="size-4" />
                Revoke Invitation
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {dialog === 'send' && a ? (
        <SendInvitationDialog
          access={a}
          onClose={() => setDialog(undefined)}
          onDone={(next) => {
            setDialog(undefined);
            onDone(
              next.invitation?.delivered
                ? `Invitation sent to ${next.recipient?.email ?? 'the client'}.`
                : 'The invitation could not be emailed. Try again.',
            );
          }}
        />
      ) : null}
      {dialog === 'revoke' && a ? (
        <RevokeInvitationDialog
          access={a}
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            onDone('Invitation revoked. Its link no longer works.');
          }}
        />
      ) : null}
    </section>
  );
}

function SendInvitationDialog({
  access,
  onClose,
  onDone,
}: {
  access: ClientPortalAccess;
  onClose: () => void;
  onDone: (next: ClientPortalAccess) => void;
}) {
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const resend = access.invitation !== null && access.invitation.state !== 'ACCEPTED';
  const send = async () => {
    setSending(true);
    setError(undefined);
    try {
      const next = await api.portalInvitations.send(access.clientId, { confirm: true });
      qc.setQueryData(accessKey(access.clientId), next);
      onDone(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      open
      title={resend ? 'Resend Portal Invitation' : 'Send Portal Invitation'}
      subtitle="Check who receives it and what they can open before you send."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!confirmed || sending} onClick={() => void send()}>
            <EnvelopeSimple aria-hidden weight="fill" className="size-4" />
            Send Invitation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="send-invitation">
        <ErrorLine text={error} />
        <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-control bg-canvas px-4 py-3 text-sm">
          <dt className="font-semibold text-heading">Recipient</dt>
          <dd className="break-all text-text">
            {access.recipient?.name} &lt;{access.recipient?.email}&gt;
          </dd>
          <dt className="font-semibold text-heading">Client</dt>
          <dd className="text-text">{access.clientName}</dd>
          <dt className="font-semibold text-heading">Access</dt>
          <dd className="text-text">{PORTAL_ACCESS}</dd>
          <dt className="font-semibold text-heading">Link</dt>
          <dd className="text-text">
            A private link that works for 7 days.
            {resend ? ' The earlier link stops working.' : ''}
          </dd>
        </dl>
        <ol className="list-decimal pl-5 text-sm text-text">
          <li>The client opens the link and creates an account with this email address.</li>
          <li>The sign-up waits in Sign-ups until someone at the firm approves it.</li>
          <li>After approval the client signs in to the portal.</li>
        </ol>
        <Checkbox
          label={`I confirm ${access.recipient?.email ?? 'this address'} is the client's email and the client should have portal access.`}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

function RevokeInvitationDialog({
  access,
  onClose,
  onDone,
}: {
  access: ClientPortalAccess;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(
        accessKey(access.clientId),
        await api.portalInvitations.revoke(access.clientId),
      );
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Revoke Invitation"
      subtitle={`The link sent to ${access.recipient?.email ?? 'the client'} stops working.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep It
          </Button>
          <Button disabled={busy} onClick={() => void revoke()}>
            Revoke Invitation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="revoke-invitation">
        <ErrorLine text={error} />
        <p className="text-sm text-text">
          {access.clientName} can no longer use this invitation. A sign-up made on the portal
          without it still waits for the firm&apos;s approval in Sign-ups.
        </p>
      </div>
    </Modal>
  );
}
