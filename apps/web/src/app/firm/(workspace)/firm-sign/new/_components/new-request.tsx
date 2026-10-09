'use client';

import { ClientId, CreateEsignRequestBody, ESIGN_ERRORS } from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { canCreate } from '../../../../../../components/esign/esign-role';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { requestKey } from '../../requests/[id]/prepare/_components/steps';
import { ClientPicker } from './client-picker';

/** Step 0 of a request (/firm-sign/new): its name, client and service; then the wizard. */
export function NewRequest({ clientId }: { clientId?: string }) {
  return (
    <EsignGate>
      {(role) =>
        canCreate(role) ? (
          <StartForm fromClient={ClientId.safeParse(clientId).success ? clientId : undefined} />
        ) : (
          <Card>
            <p className="text-text">You can view signature requests, but not send them.</p>
          </Card>
        )
      }
    </EsignGate>
  );
}

function StartForm({ fromClient }: { fromClient?: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState(fromClient ?? '');
  const [engagementId, setEngagementId] = useState('');
  const [titleError, setTitleError] = useState<string>();
  const services = useQuery({
    queryKey: ['engagements', clientId],
    queryFn: () => api.engagements.listForClient(clientId),
    enabled: !!clientId,
  });
  const open = (services.data ?? []).filter((e) => ['PENDING', 'ACTIVE'].includes(e.status));
  const queryClient = useQueryClient();
  const create = useApiMutation((body: CreateEsignRequestBody) => api.esign.create(body));

  function submit() {
    const parsed = CreateEsignRequestBody.safeParse({
      title,
      source: fromClient && clientId === fromClient ? 'CLIENT_RECORD' : 'TAB',
      ...(clientId && { clientId }),
      ...(engagementId && { engagementId }),
    });
    if (!parsed.success) {
      setTitleError(parsed.error.issues[0]?.message);
      return;
    }
    setTitleError(undefined);
    create.mutate(parsed.data, {
      onSuccess: (r) => {
        // The wizard opens on the draft just made; the lists and counters catch up behind it.
        queryClient.setQueryData(requestKey(r.id), r);
        void queryClient.invalidateQueries({ queryKey: ['esign', 'requests', 'list'] });
        void queryClient.invalidateQueries({ queryKey: ['esign', 'summary'] });
        router.push(`/firm-sign/requests/${r.id}/prepare`);
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="font-display text-3xl text-heading">
        New signature request
      </h1>
      <Card>
        <form
          noValidate
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            label="Document name"
            maxLength={200}
            value={title}
            error={titleError}
            onChange={(e) => setTitle(e.target.value)}
          />
          <ClientPicker
            value={clientId}
            fromClient={fromClient}
            onChange={(id) => {
              setClientId(id);
              setEngagementId('');
            }}
          />
          {clientId && (
            <Select
              label="Service (optional)"
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value)}
              options={[
                { value: '', label: 'Not for a particular service' },
                ...open.map((e) => ({ value: e.id, label: e.title })),
              ]}
            />
          )}
          <p className="text-sm text-muted">
            The signed copy is filed in the client&apos;s documents. Next you add the documents and
            the people who sign.
          </p>
          {create.error && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(create.error, ESIGN_ERRORS)}
            </p>
          )}
          <div>
            <Button type="submit" disabled={create.isPending}>
              Continue
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
