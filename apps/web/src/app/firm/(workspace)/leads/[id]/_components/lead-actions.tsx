'use client';

import type { ClientAccountType, ConvertLeadResponse, LeadDetail } from '@firmivra/types';
import { Button, Checkbox, Modal, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { RequireRole } from '../../../../../../components/require-role';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { TextArea } from '../../../../setup/_components/fields';
import { LEAD_ERRORS } from './lead-shared';

/** Refreshes this lead and the inbox. */
const LEADS = ['leads'];

/**
 * What the Owner and Admins do with a new or in-review lead: mark it in review, convert it to a
 * client (with an engagement for its service and, for a new client, a portal invitation), or
 * decline it with a reason. Both ask first. Staff read the lead only.
 */
export function LeadActions({ lead }: { lead: LeadDetail }) {
  const [dialog, setDialog] = useState<'convert' | 'decline' | null>(null);
  const [done, setDone] = useState<ConvertLeadResponse | null>(null);
  const review = useApiMutation(() => api.leads.startReview(lead.id), { invalidate: LEADS });
  const open = lead.status === 'SUBMITTED' || lead.status === 'IN_REVIEW';

  return (
    <RequireRole roles={['OWNER', 'ADMIN']}>
      {done ? (
        <p role="status" className="text-sm font-medium text-success">
          Converted to a client:{' '}
          <Link href={`/clients/${done.clientId}`} className="text-link">
            {lead.firstName} {lead.lastName}
          </Link>
          .{' '}
          {done.inviteSent
            ? 'The portal invitation was sent.'
            : 'The portal invitation email could not be sent.'}
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setDialog('convert')}>Convert to client</Button>
          <Button variant="secondary" onClick={() => setDialog('decline')}>
            Decline
          </Button>
          {lead.status === 'SUBMITTED' ? (
            <Button variant="ghost" disabled={review.isPending} onClick={() => review.mutate()}>
              Mark as in review
            </Button>
          ) : null}
          {review.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(review.error, LEAD_ERRORS)}
            </p>
          ) : null}
        </div>
      ) : null}
      <Modal open={dialog === 'convert'} title="Convert to client" onClose={() => setDialog(null)}>
        {dialog === 'convert' ? (
          <ConvertForm
            lead={lead}
            onDone={(result) => {
              setDone(result);
              setDialog(null);
            }}
          />
        ) : null}
      </Modal>
      <Modal open={dialog === 'decline'} title="Decline this lead" onClose={() => setDialog(null)}>
        {dialog === 'decline' ? <DeclineForm lead={lead} onDone={() => setDialog(null)} /> : null}
      </Modal>
    </RequireRole>
  );
}

function ConvertForm({
  lead,
  onDone,
}: {
  lead: LeadDetail;
  onDone: (result: ConvertLeadResponse) => void;
}) {
  const [accountType, setAccountType] = useState<ClientAccountType>('INDIVIDUAL');
  const [invite, setInvite] = useState(true);
  const convert = useApiMutation(
    () => api.leads.convert(lead.id, { accountType, sendPortalInvite: invite }),
    { invalidate: LEADS },
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text">
        This creates a client from {lead.firstName} {lead.lastName}&apos;s details and an engagement
        for {lead.service.name}, and moves the answers and files over.
      </p>
      <Select
        label="Client type"
        value={accountType}
        onChange={(event) =>
          setAccountType(event.target.value === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL')
        }
        options={[
          { value: 'INDIVIDUAL', label: 'Individual' },
          { value: 'BUSINESS', label: 'Business' },
        ]}
      />
      <Checkbox
        label={`Email ${lead.email} an invitation to the client portal`}
        checked={invite}
        onChange={(event) => setInvite(event.target.checked)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={convert.isPending}
          onClick={() => convert.mutate(undefined, { onSuccess: onDone })}
        >
          {convert.isPending ? 'Converting…' : 'Convert to client'}
        </Button>
      </div>
      {convert.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(convert.error, LEAD_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}

function DeclineForm({ lead, onDone }: { lead: LeadDetail; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const decline = useApiMutation(() => api.leads.decline(lead.id, { reason: reason.trim() }), {
    invalidate: LEADS,
  });
  return (
    <div className="flex flex-col gap-4">
      <TextArea
        label="Reason (kept in the firm, never sent to the visitor)"
        rows={4}
        maxLength={1000}
        value={reason}
        error={missing ? 'Enter a reason' : undefined}
        onChange={(event) => {
          setReason(event.target.value);
          setMissing(false);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={decline.isPending}
          onClick={() =>
            reason.trim() ? decline.mutate(undefined, { onSuccess: onDone }) : setMissing(true)
          }
        >
          {decline.isPending ? 'Declining…' : 'Decline lead'}
        </Button>
      </div>
      {decline.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(decline.error, LEAD_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
