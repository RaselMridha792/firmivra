'use client';

import type { ClientAccountType, ClientLinkRole } from '@firmivra/types';
import { Button, Modal, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { AddClientDialog } from '../../clients/_components/clients-dialogs';
import {
  clientLinksKey,
  LINK_ROLE_CHOICES,
  LinkedProfilesCard,
} from '../../clients/[id]/_components/client-links';
import { useClientRecord } from '../../clients/[id]/_components/use-client-record';

/** The type a new profile starts as, from how it is related (the form can still change it). */
const typeFor = (role: ClientLinkRole): ClientAccountType | undefined =>
  role === 'RELATED_BUSINESS' ? 'BUSINESS' : role === 'OTHER' ? undefined : 'INDIVIDUAL';

/**
 * Business Advisory A-X06 (B18): the advisory client's linked business and personal profiles
 * (the Clients module's links, G9), and Add Business or Personal Profile: a new client, created
 * with Add New Client and linked to this one in the role chosen first. Linking an existing client
 * is the card's own Add Link. Both are the Clients API's, audited there.
 */
export function AdvisoryLinkedProfiles({
  clientId,
  canEdit,
}: {
  clientId: string;
  canEdit: boolean;
}) {
  const record = useClientRecord(clientId);
  const qc = useQueryClient();
  const [step, setStep] = useState<'role' | 'create' | null>(null);
  const [role, setRole] = useState<ClientLinkRole | ''>('');
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();
  if (!record.data) return null;
  const client = record.data;
  const linked = async (created: { id: string; displayName: string }) => {
    setStep(null);
    if (!role) return;
    try {
      await api.clients.addLink(clientId, { linkedClientId: created.id, role });
      await qc.invalidateQueries({ queryKey: clientLinksKey(clientId) });
      setError(undefined);
      setDone(`${created.displayName} was added and linked to ${client.displayName}.`);
    } catch (e) {
      setDone(undefined);
      setError(
        `${created.displayName} was added, but linking them failed: ${errorMessage(e)} Link them with Add Link.`,
      );
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="advisory-linked-profiles">
      <LinkedProfilesCard client={client} />
      {canEdit && !client.archivedAt ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setRole('');
            setDone(undefined);
            setError(undefined);
            setStep('role');
          }}
        >
          Add Business or Personal Profile
        </Button>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {step === 'role' ? (
        <Modal
          open
          title="Add Business or Personal Profile"
          subtitle={client.displayName}
          onClose={() => setStep(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setStep(null)}>
                Cancel
              </Button>
              <Button disabled={!role} onClick={() => setStep('create')}>
                Continue
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">
              A new client profile, linked to {client.displayName}. Choose how they are related,
              then fill in the new client.
            </p>
            <Select
              label="How they are related *"
              value={role}
              onChange={(e) => setRole(e.target.value as ClientLinkRole | '')}
              options={[{ value: '', label: 'Choose…' }, ...LINK_ROLE_CHOICES]}
            />
          </div>
        </Modal>
      ) : null}
      {step === 'create' && role ? (
        <AddClientDialog
          manager={false}
          members={[]}
          {...(typeFor(role) ? { accountType: typeFor(role) } : {})}
          onClose={() => setStep(null)}
          onCreated={(created) => void linked(created)}
        />
      ) : null}
    </div>
  );
}
