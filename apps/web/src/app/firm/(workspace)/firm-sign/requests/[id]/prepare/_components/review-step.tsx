'use client';

import {
  ESIGN_ERRORS,
  ESIGN_READINESS_TEXT,
  type EsignReadinessCode,
  type EsignRequestDetail,
  type UpdateEsignRequestBody,
} from '@firmivra/types';
import { Button, Card, Checkbox, Select } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../../lib/query';
import { ClientPicker } from '../../../../new/_components/client-picker';
import { requestKey, type StepId, stepHref } from './steps';

/** Where each problem is fixed; the client and service are fixed on this step. */
const FIX: Partial<Record<EsignReadinessCode, StepId | 'settings-page'>> = {
  NO_DOCUMENTS: 'documents',
  SCAN_PENDING: 'documents',
  SCAN_BLOCKED: 'documents',
  NO_SIGNERS: 'recipients',
  RECIPIENT_NO_CONTACT: 'recipients',
  ACCESS_CODE_MISSING: 'recipients',
  APPROVER_MISSING: 'recipients',
  SIGNATURE_UNASSIGNED: 'fields',
  SIGNER_NO_FIELDS: 'fields',
  MERGE_MISSING: 'fields',
  REMINDER_AFTER_EXPIRY: 'settings',
  NO_CONSENT: 'settings-page',
};

const KIND = { SIGNER: 'Signs', APPROVER: 'Approves first', CC: 'Gets a copy' } as const;
const DELIVERY = { EMAIL: 'by email', PORTAL: 'in the client portal', IN_PERSON: 'in person' };

/** Step 5: what is missing, a summary, an explicit confirmation, then send. */
export function ReviewStep({ r }: { r: EsignRequestDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const readinessKey = [...requestKey(r.id), 'readiness'];
  const readiness = useQuery({
    // A finished virus check changes the answer; so does any step's save (asked again on return).
    queryKey: [...readinessKey, r.documents.map((d) => d.scanStatus).join()],
    queryFn: () => api.esign.readiness(r.id),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const [confirmed, setConfirmed] = useState(false);
  const update = useApiMutation((body: UpdateEsignRequestBody) => api.esign.update(r.id, body), {
    invalidate: requestKey(r.id),
  });
  // Sent, or (when an approver must approve first) sent for approval.
  const send = useApiMutation((approval: boolean) =>
    approval
      ? api.esign.submitForApproval(r.id, { confirm: true })
      : api.esign.send(r.id, { confirm: true }),
  );
  const change = (body: UpdateEsignRequestBody) => {
    // What was confirmed is no longer what would be sent.
    setConfirmed(false);
    send.reset();
    update.mutate(body, {
      onSuccess: (d) => queryClient.setQueryData(requestKey(r.id), d),
    });
  };

  const services = useQuery({
    queryKey: ['engagements', r.client?.id],
    queryFn: () => api.engagements.listForClient(r.client?.id ?? ''),
    enabled: !!r.client,
  });
  const open = (services.data ?? []).filter((e) => ['PENDING', 'ACTIVE'].includes(e.status));
  const problems = readiness.data?.problems ?? [];
  // Only approvals are missing: it goes to the approvers first, and is sent when they approve.
  const approval = problems.length > 0 && problems.every((p) => p.code === 'APPROVAL_PENDING');
  const blocking = approval ? [] : problems;
  const busy = send.isPending || update.isPending || readiness.isFetching;
  const name = (id: string | null) => r.recipients.find((x) => x.id === id)?.name;
  const signers = r.recipients.filter((x) => x.kind === 'SIGNER');

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-heading">Review and send</h2>
        <h3 className="font-semibold text-heading">Client and service</h3>
        <fieldset disabled={update.isPending} className="grid min-w-0 gap-3 md:grid-cols-2">
          <ClientPicker
            value={r.client?.id ?? ''}
            fromClient={r.client?.id}
            // A request is always for a client: "No client" is not taken here.
            onChange={(id: string) => id && change({ clientId: id, engagementId: null })}
          />
          {r.client && (
            <Select
              label="Service"
              value={r.engagement?.id ?? ''}
              onChange={(e) => change({ engagementId: e.target.value || null })}
              options={[
                { value: '', label: 'Choose the service' },
                // The saved one, while the list loads or once it is no longer open.
                ...(r.engagement && !open.some((e) => e.id === r.engagement?.id)
                  ? [{ value: r.engagement.id, label: r.engagement.title }]
                  : []),
                ...open.map((e) => ({ value: e.id, label: e.title })),
              ]}
            />
          )}
        </fieldset>
        <p className="text-sm text-muted">The signed copy is filed under this service.</p>
        {update.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(update.error, ESIGN_ERRORS)}
          </p>
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h3 className="font-semibold text-heading">Summary</h3>
        <dl
          data-testid="review-summary"
          className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-[auto_1fr]"
        >
          <dt className="text-muted">Documents</dt>
          <dd className="text-text">
            {r.documents.map((d) => d.fileName).join(', ') || 'None'} ({r.pagePlan.length}{' '}
            {r.pagePlan.length === 1 ? 'page' : 'pages'})
          </dd>
          <dt className="text-muted">Recipients</dt>
          <dd className="text-text">
            <ol className="flex flex-col gap-1">
              {r.recipients.map((x) => (
                <li key={x.id}>
                  {r.routing === 'SEQUENTIAL' && `${x.routingOrder}. `}
                  {x.name}: {KIND[x.kind]}
                  {x.kind === 'SIGNER' && ` ${DELIVERY[x.delivery]}`}
                </li>
              ))}
            </ol>
          </dd>
          <dt className="text-muted">Fields</dt>
          <dd className="text-text">
            {r.fields.length === 0
              ? 'None placed: a signature page is added at the end for each signer.'
              : `${r.fields.length} placed`}
          </dd>
          <dt className="text-muted">Expires</dt>
          <dd className="text-text">{r.expiryDays} days after it is sent</dd>
          <dt className="text-muted">Reminders</dt>
          <dd className="text-text">
            {r.reminders.max === 0
              ? 'Off'
              : `After ${r.reminders.firstAfterDays} days, then every ${r.reminders.everyDays}, at most ${r.reminders.max}`}
          </dd>
        </dl>
      </Card>
      <Card className="flex flex-col gap-4">
        {readiness.isPending ? (
          <p className="text-sm text-muted">Checking the request…</p>
        ) : readiness.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(readiness.error, ESIGN_ERRORS)}
          </p>
        ) : blocking.length > 0 ? (
          <>
            <h3 className="font-semibold text-heading">Before you send</h3>
            <ul data-testid="readiness" className="flex flex-col gap-2">
              {blocking.map((p) => {
                const fix = FIX[p.code];
                const who = name(p.recipientId);
                const href =
                  fix === 'settings-page' ? '/firm-sign/settings' : fix && stepHref(r.id, fix);
                return (
                  <li
                    key={`${p.code}-${p.recipientId ?? p.fieldId ?? p.documentId ?? p.mergeKey ?? ''}`}
                    className="flex flex-wrap gap-x-2 text-sm text-text"
                  >
                    <span>
                      {ESIGN_READINESS_TEXT[p.code]}
                      {who && ` (${who})`}
                    </span>
                    {href && (
                      <Link href={href} className="text-link underline">
                        Fix it
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>
            {approval && (
              <p className="text-sm text-text">
                Your firm asks for an approval first. It goes to the approvers, and is sent to the
                signers once they approve.
              </p>
            )}
            <Checkbox
              label={`I checked the documents, the fields and the ${signers.length === 1 ? 'signer' : 'signers'}. ${approval ? 'Send it for approval' : 'Send it'} now.`}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <div>
              <Button
                disabled={!confirmed || busy}
                onClick={() =>
                  send.mutate(approval, {
                    onSuccess: (d) => {
                      router.push(`/firm-sign/requests/${r.id}`);
                      // The request page reads it from here (the wizard may show it as locked
                      // for a moment before the page changes).
                      queryClient.setQueryData(requestKey(r.id), d);
                      void queryClient.invalidateQueries({
                        queryKey: ['esign', 'requests', 'list'],
                      });
                      void queryClient.invalidateQueries({ queryKey: ['esign', 'summary'] });
                    },
                    // Refused as not ready: show what is missing now.
                    onError: () => void queryClient.invalidateQueries({ queryKey: readinessKey }),
                  })
                }
              >
                {send.isPending
                  ? 'Sending…'
                  : approval
                    ? 'Send for approval'
                    : 'Send for signature'}
              </Button>
            </div>
          </>
        )}
        {send.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, ESIGN_ERRORS)}
          </p>
        )}
      </Card>
    </div>
  );
}
