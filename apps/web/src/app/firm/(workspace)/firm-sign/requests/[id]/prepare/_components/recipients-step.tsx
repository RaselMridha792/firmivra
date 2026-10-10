'use client';

import {
  ESIGN_ERRORS,
  ESIGN_MAX_RECIPIENTS,
  type EsignRequestDetail,
  type EsignRouting,
} from '@firmivra/types';
import { Button, Card, Select } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { isOwnerOrAdmin } from '../../../../../../../../components/esign/esign-role';
import { useApiMutation, useApiQuery } from '../../../../../../../../lib/query';
import {
  blank,
  type DraftErrors,
  fromRecipients,
  type RecipientDraft,
  toBody,
} from './recipient-draft';
import { type Choice, RecipientRow } from './recipient-row';
import { NextStepLink } from './next-step-link';
import { requestKey } from './steps';

/** Step 2: who signs, who approves first and who gets a copy, and in what order. */
export function RecipientsStep({ r }: { r: EsignRequestDetail }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RecipientDraft[]>(() => fromRecipients(r.recipients));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<{ rows: DraftErrors[]; list?: string }>({ rows: [] });
  const sequential = r.routing === 'SEQUENTIAL';

  const clientId = r.client?.id;
  const client = useQuery({
    queryKey: ['clients', clientId],
    queryFn: () => api.clients.get(clientId ?? ''),
    enabled: !!clientId,
  });
  const logins: Choice[] = (client.data?.portalLogins ?? [])
    .filter((l) => l.status === 'ACTIVE')
    .map((l) => ({ value: `login:${l.clientAccountId}`, label: `${l.email} (portal login)` }));
  // Only Owners and Admins can list the members; anyone else adds people as "Someone else".
  const status = useApiQuery(['esign', 'status'], () => api.esign.status());
  const manager = isOwnerOrAdmin(status.data?.myEsignRole ?? null);
  const roles = useQuery({
    queryKey: ['esign', 'roles'],
    queryFn: () => api.esign.roles.list(),
    enabled: manager,
  });
  const all = roles.data?.items ?? [];
  const toChoice = (m: (typeof all)[number]) => ({
    value: `staff:${m.user.userId}`,
    label: `${m.user.name} (firm)`,
  });
  const members: Choice[] = all.filter((m) => m.esignRole !== 'VIEWER').map(toChoice);
  // An Owner, Admin or Firm Sign Manager approves, and never the request's own sender.
  const approvers: Choice[] = all
    .filter((m) => ['OWNER', 'ADMIN', 'MANAGER'].includes(m.esignRole))
    .filter((m) => m.user.userId !== r.sender.userId)
    .map(toChoice);

  // `invalidate` runs even when the user leaves the step before the answer (unlike mutate's own
  // onSuccess), so the request never keeps its old recipients.
  const save = useApiMutation(
    (body: Parameters<typeof api.esign.putRecipients>[1]) => api.esign.putRecipients(r.id, body),
    { invalidate: requestKey(r.id) },
  );
  const routing = useApiMutation(
    (value: EsignRouting) => api.esign.update(r.id, { routing: value }),
    { invalidate: requestKey(r.id) },
  );

  function edit(next: RecipientDraft[]) {
    setRows(next);
    setDirty(true);
    setErrors({ rows: [] });
  }
  const change = (i: number, patch: Partial<RecipientDraft>) =>
    edit(rows.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    const [d] = next.splice(i, 1);
    if (d) next.splice(i + by, 0, d);
    edit(next);
  };

  function submit() {
    const result = toBody(rows);
    if (!result.ok) {
      setErrors({ rows: result.rows, list: result.list });
      return;
    }
    save.mutate(result.body, {
      onSuccess: (detail) => {
        queryClient.setQueryData(requestKey(r.id), detail);
        setRows(fromRecipients(detail.recipients));
        setDirty(false);
      },
    });
  }

  const signers = rows.filter((d) => d.kind === 'SIGNER').length;
  const full = rows.length >= ESIGN_MAX_RECIPIENTS;
  const error = save.error ?? routing.error;
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4">
        <h2 className="font-display text-2xl text-heading">Recipients</h2>
        <div className="max-w-sm">
          <Select
            label="Signing order"
            value={r.routing}
            disabled={routing.isPending}
            onChange={(e) =>
              routing.mutate(e.target.value as EsignRouting, {
                onSuccess: (detail) => {
                  queryClient.setQueryData(requestKey(r.id), detail);
                  // All at once saved every order as 1: save again to keep the order shown.
                  if (detail.routing === 'SEQUENTIAL' && rows.length > 1) setDirty(true);
                },
              })
            }
            options={[
              { value: 'SEQUENTIAL', label: 'One after another, in this order' },
              { value: 'PARALLEL', label: 'All at once' },
            ]}
          />
        </div>
        {/* Edits wait for a save in flight: its answer replaces the list. */}
        <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted">No recipients yet.</p>
          ) : (
            <ol data-testid="recipients" className="flex flex-col divide-y divide-border">
              {rows.map((d, i) => (
                <RecipientRow
                  key={d.key}
                  d={d}
                  order={sequential ? i + 1 : null}
                  count={rows.length}
                  errors={errors.rows[i] ?? {}}
                  logins={logins}
                  members={d.kind === 'APPROVER' ? approvers : members}
                  onChange={(patch) => change(i, patch)}
                  onMove={(by) => move(i, by)}
                  onRemove={() => edit(rows.filter((_, k) => k !== i))}
                />
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              disabled={full}
              onClick={() => edit([...rows, blank('SIGNER')])}
            >
              Add a signer
            </Button>
            <Button
              variant="secondary"
              disabled={full}
              onClick={() => edit([...rows, blank('APPROVER')])}
            >
              Add an approver
            </Button>
            <Button
              variant="secondary"
              disabled={full}
              onClick={() => edit([...rows, blank('CC')])}
            >
              Add someone who gets a copy
            </Button>
          </div>
        </fieldset>
        {errors.list && (
          <p role="alert" className="text-sm text-danger">
            {errors.list}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error, ESIGN_ERRORS)}
          </p>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!dirty || save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save recipients'}
        </Button>
        {!dirty && signers > 0 ? (
          <NextStepLink id={r.id} step="fields" label="Next: Fields" />
        ) : (
          <p className="text-sm text-muted">
            {dirty ? 'Save your changes to continue.' : 'Add a signer to continue.'}
          </p>
        )}
      </div>
    </div>
  );
}
