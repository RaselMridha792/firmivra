'use client';

import {
  type BulkClientsRequest,
  type ClientAccountType,
  CreateClientRequest,
  type MemberRef,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { ACCOUNT_TYPES, CLIENT_ERRORS, CLIENTS } from './client-parts';
import { bulkSummary } from './list-parts';

type Field = 'accountType' | 'displayName' | 'email' | 'phone' | 'assignedUserId';
const EMPTY_FORM: Record<Field, string> = {
  accountType: 'INDIVIDUAL',
  displayName: '',
  email: '',
  phone: '',
  assignedUserId: '',
};

/**
 * "Add New Client": a client with no portal login yet (POST /business/clients), then their record
 * opens. Owner and Admin may assign someone; a client Staff add is assigned to them.
 */
export function AddClientDialog({
  manager,
  members,
  onClose,
}: {
  manager: boolean;
  members: MemberRef[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const create = useApiMutation((body: CreateClientRequest) => api.clients.create(body), {
    invalidate: CLIENTS,
  });
  const business = values.accountType === 'BUSINESS';
  const field = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) =>
      setValues((was) => ({ ...was, [name]: event.target.value })),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: CreateClientRequest = {
      accountType: values.accountType as ClientAccountType,
      displayName: values.displayName,
      ...(values.email.trim() ? { email: values.email } : {}),
      ...(values.phone.trim() ? { phone: values.phone } : {}),
      ...(manager && values.assignedUserId ? { assignedUserId: values.assignedUserId } : {}),
    };
    const check = CreateClientRequest.safeParse(body);
    if (!check.success) {
      const found: Partial<Record<Field, string>> = {};
      for (const issue of check.error.issues) {
        const name = String(issue.path[0] ?? 'displayName') as Field;
        found[name] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    create.mutate(body, { onSuccess: (client) => router.push(`/clients/${client.id}`) });
  };

  return (
    <Modal
      open
      title="Add New Client"
      subtitle="Add a client your firm works for. You can invite them to the portal later."
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label="Client type"
          {...field('accountType')}
          options={Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }))}
        />
        <Input
          label={business ? 'Business name' : 'Full name'}
          autoComplete="off"
          required
          {...field('displayName')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Email (optional)" type="email" autoComplete="off" {...field('email')} />
          <Input label="Phone (optional)" type="tel" autoComplete="off" {...field('phone')} />
        </div>
        {manager ? (
          <Select
            label="Assigned to"
            {...field('assignedUserId')}
            options={[
              { value: '', label: 'Not assigned yet' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        ) : null}
        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, CLIENT_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add Client'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export type BulkKind = BulkClientsRequest['action'];

const TITLES: Record<BulkKind, { title: string; button: string; verb: string }> = {
  ASSIGN: { title: 'Assign Staff Member', button: 'Assign', verb: 'updated' },
  ARCHIVE: { title: 'Archive Clients', button: 'Archive', verb: 'archived' },
  RESTORE: { title: 'Restore Clients', button: 'Restore', verb: 'restored' },
};

/** The value of the "nobody" choice, which sends `assignedUserId: null`. */
const NOBODY = 'none';

/**
 * Bulk Actions and the row menu (Owner and Admin): assign, archive or restore the chosen clients
 * (POST /business/clients/bulk). Shows what changed and what was skipped, then the list and the
 * cards refetch.
 */
export function BulkDialog({
  kind,
  clients,
  members,
  onClose,
  onDone,
}: {
  kind: BulkKind;
  clients: { id: string; displayName: string }[];
  members: MemberRef[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState('');
  const bulk = useApiMutation((body: BulkClientsRequest) => api.clients.bulk(body), {
    invalidate: CLIENTS,
  });
  const { title, button, verb } = TITLES[kind];
  const clientIds = clients.map((c) => c.id);
  const names = new Map(clients.map((c) => [c.id, c.displayName]));
  const count = `${clients.length} selected ${clients.length === 1 ? 'client' : 'clients'}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: BulkClientsRequest =
      kind === 'ASSIGN'
        ? { action: kind, clientIds, assignedUserId: assignee === NOBODY ? null : assignee }
        : { action: kind, clientIds };
    bulk.mutate(body, { onSuccess: (result) => onDone(bulkSummary(result, verb, names)) });
  };

  return (
    <Modal open title={title} subtitle={count} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {kind === 'ASSIGN' ? (
          <Select
            label="Assign to"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            options={[
              { value: '', label: 'Choose a staff member' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
              { value: NOBODY, label: 'Nobody (unassign)' },
            ]}
          />
        ) : (
          <p className="text-sm text-text">
            {kind === 'ARCHIVE'
              ? 'Archived clients leave the list and keep their history. You can restore them later.'
              : 'Restored clients come back to the list as they were.'}
          </p>
        )}
        <ul className="max-h-40 overflow-y-auto text-sm text-muted">
          {clients.map((c) => (
            <li key={c.id} className="truncate">
              {c.displayName}
            </li>
          ))}
        </ul>
        {bulk.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(bulk.error, CLIENT_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={bulk.isPending || (kind === 'ASSIGN' && !assignee)}
            className={kind === 'ARCHIVE' ? '!bg-danger hover:!bg-danger' : ''}
          >
            {bulk.isPending ? 'Saving…' : button}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
