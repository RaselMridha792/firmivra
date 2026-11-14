'use client';

import {
  type BulkClientsRequest,
  type ClientAccountType,
  type ClientStatus,
  type CreateClientRequest,
  type ExportClientsRequest,
  type MemberRef,
  NewClientForm,
  US_STATES,
} from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ACCOUNT_TYPES, CLIENT_ERRORS, CLIENTS, clientKey } from './client-parts';
import { bulkSummary, STAGE_ORDER, STAGES } from './list-parts';

type Field =
  | 'accountType'
  | 'displayName'
  | 'email'
  | 'phone'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'rpName'
  | 'rpEmail'
  | 'rpPhone'
  | 'assignedUserId';
const EMPTY_FORM: Record<Field, string> = {
  accountType: 'INDIVIDUAL',
  displayName: '',
  email: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  rpName: '',
  rpEmail: '',
  rpPhone: '',
  assignedUserId: '',
};
const STATE_OPTIONS = [
  { value: '', label: 'Choose a state' },
  ...Object.entries(US_STATES).map(([value, label]) => ({ value, label })),
];

/**
 * "Add New Client", the shared new-client form (the Clients list and the dashboard's + New and
 * quick action): a client with no portal login yet (POST /business/clients), then their record
 * opens. Name, email, phone and the address are required for both types, and a Business gives
 * its Business Name and its responsible party (Octavia's D1 and E5, checked with the contract's
 * NewClientForm). Owner and Admin may assign someone; a client Staff add is assigned to them.
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
  // Clients Review 2 (C2-029): closing a filled form asks first, as Edit does (E6): Cancel,
  // Escape and the X all come here; Keep Editing keeps every value.
  const [leaving, setLeaving] = useState(false);
  const dirty = (Object.keys(EMPTY_FORM) as Field[]).some((k) => values[k] !== EMPTY_FORM[k]);
  const close = () => (dirty ? setLeaving(true) : onClose());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: NewClientForm = {
      accountType: values.accountType as ClientAccountType,
      displayName: values.displayName,
      email: values.email,
      phone: values.phone,
      ...(manager && values.assignedUserId ? { assignedUserId: values.assignedUserId } : {}),
      profile: {
        ...(business
          ? {
              businessName: values.displayName,
              // Sent once all three are typed; until then the form names what is missing.
              ...(values.rpName.trim() && values.rpEmail.trim() && values.rpPhone.trim()
                ? {
                    responsibleParty: {
                      name: values.rpName,
                      email: values.rpEmail,
                      phone: values.rpPhone,
                    },
                  }
                : {}),
            }
          : {}),
        address: {
          line1: values.line1,
          line2: values.line2,
          city: values.city,
          state: values.state,
          postalCode: values.postalCode,
        },
      },
    };
    const check = NewClientForm.safeParse(body);
    if (!check.success) {
      const found: Partial<Record<Field, string>> = {};
      for (const issue of check.error.issues) {
        const last = String(issue.path.at(-1) ?? 'displayName');
        // The Business Name is the name typed in the name field; the responsible party's own.
        const name = (
          issue.path.includes('responsibleParty')
            ? `rp${last.charAt(0).toUpperCase()}${last.slice(1)}`
            : last === 'businessName'
              ? 'displayName'
              : last
        ) as Field;
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
      onClose={close}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label="Client type *"
          {...field('accountType')}
          options={Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }))}
        />
        <Input
          label={business ? 'Business name *' : 'Full name *'}
          autoComplete="off"
          required
          {...field('displayName')}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={business ? 'Business email *' : 'Email *'}
            type="email"
            autoComplete="off"
            required
            {...field('email')}
          />
          <Input
            label={business ? 'Business phone *' : 'Phone *'}
            type="tel"
            autoComplete="off"
            required
            {...field('phone')}
          />
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-heading">
            {business ? 'Business address' : 'Home address'}
          </legend>
          <Input label="Street address *" autoComplete="off" required {...field('line1')} />
          <Input label="Apt, suite or unit" autoComplete="off" {...field('line2')} />
          <Input label="City *" autoComplete="off" required {...field('city')} />
          <Select label="State *" required options={STATE_OPTIONS} {...field('state')} />
          <Input
            label="ZIP code *"
            inputMode="numeric"
            autoComplete="off"
            required
            {...field('postalCode')}
          />
        </fieldset>
        {business ? (
          <fieldset className="grid gap-4 sm:grid-cols-2" data-testid="responsible-party">
            <legend className="mb-1 text-sm font-semibold text-heading">Responsible party</legend>
            <p className="text-sm text-muted sm:col-span-2">
              The person who answers for the business. They are linked to it; the business stays the
              client.
            </p>
            <div className="sm:col-span-2">
              <Input label="Full name *" autoComplete="off" required {...field('rpName')} />
            </div>
            <Input
              label="Their email *"
              type="email"
              autoComplete="off"
              required
              {...field('rpEmail')}
            />
            <Input
              label="Their phone *"
              type="tel"
              autoComplete="off"
              required
              {...field('rpPhone')}
            />
          </fieldset>
        ) : null}
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
        {leaving ? (
          <div
            role="alertdialog"
            aria-labelledby="add-client-leaving"
            data-testid="unsaved-changes"
            className="flex flex-col gap-3 rounded-control border border-warning bg-warning-soft p-4"
          >
            <p id="add-client-leaving" className="text-sm font-semibold text-heading">
              You have entered details for this client. Close without adding them?
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" autoFocus onClick={() => setLeaving(false)}>
                Keep Editing
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add Client'}
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}

export type BulkKind = BulkClientsRequest['action'];

const TITLES: Record<BulkKind, { title: string; button: string; verb: string }> = {
  ASSIGN: { title: 'Assign Staff Member', button: 'Assign', verb: 'updated' },
  ARCHIVE: { title: 'Archive Clients', button: 'Archive', verb: 'archived' },
  RESTORE: { title: 'Restore Clients', button: 'Restore', verb: 'restored' },
  // Octavia's E2 additions.
  TAG: { title: 'Add Tag', button: 'Add Tag', verb: 'tagged' },
  STAGE: { title: 'Change Status', button: 'Change Status', verb: 'updated' },
};

/** The value of the "nobody" choice, which sends `assignedUserId: null`. */
const NOBODY = 'none';

/**
 * Bulk Actions and the row menu (Owner and Admin): assign, archive or restore the chosen clients,
 * and (Octavia's E2 additions) add a tag or change their status, Inactive included
 * (POST /business/clients/bulk). Each names the clients it changes first; then it shows what
 * changed and what was skipped, and the list and the cards refetch. Every change is audited per
 * client on the API.
 */
export function BulkDialog({
  kind,
  clients,
  members,
  initialStatus = '',
  onClose,
  onDone,
}: {
  kind: BulkKind;
  clients: { id: string; displayName: string }[];
  members: MemberRef[];
  /** Mark Inactive: Change Status with Inactive chosen. */
  initialStatus?: ClientStatus | '';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [assignee, setAssignee] = useState('');
  const [tagId, setTagId] = useState('');
  const [status, setStatus] = useState<ClientStatus | ''>(initialStatus);
  const tags = useApiQuery(['tags'], () => api.tags.list());
  const bulk = useApiMutation((body: BulkClientsRequest) => api.clients.bulk(body), {
    invalidate: CLIENTS,
  });
  const queryClient = useQueryClient();
  const { title, button, verb } = TITLES[kind];
  const clientIds = clients.map((c) => c.id);
  const names = new Map(clients.map((c) => [c.id, c.displayName]));
  const count = `${clients.length} selected ${clients.length === 1 ? 'client' : 'clients'}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body: BulkClientsRequest =
      kind === 'ASSIGN'
        ? { action: kind, clientIds, assignedUserId: assignee === NOBODY ? null : assignee }
        : kind === 'TAG'
          ? { action: kind, clientIds, tagId }
          : kind === 'STAGE'
            ? { action: kind, clientIds, status: status as ClientStatus }
            : { action: kind, clientIds };
    bulk.mutate(body, {
      onSuccess: async (result) => {
        // Clients Review 2 (C2-034): every chosen client's record is fetched again now, even a
        // profile that is not on screen, so opening it right after shows the change.
        await Promise.all(
          clientIds.map((id) =>
            queryClient.invalidateQueries({ queryKey: clientKey(id), refetchType: 'all' }),
          ),
        );
        onDone(bulkSummary(result, verb, names));
      },
    });
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
        ) : kind === 'TAG' ? (
          <>
            <Select
              label="Tag"
              value={tagId}
              onChange={(event) => setTagId(event.target.value)}
              options={[
                { value: '', label: 'Choose a tag' },
                ...(tags.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <p className="text-sm text-text">
              The tag joins each client&apos;s tags; their other tags stay. Archived clients are
              skipped.
            </p>
          </>
        ) : kind === 'STAGE' ? (
          <>
            <Select
              label="New status"
              value={status}
              onChange={(event) => setStatus(event.target.value as ClientStatus | '')}
              options={[
                { value: '', label: 'Choose a status' },
                ...STAGE_ORDER.map((value) => ({ value, label: STAGES[value].label })),
              ]}
            />
            <p className="text-sm text-text">
              Each client moves to this status; automations on a status change run for each.
              Archived clients are skipped.
            </p>
          </>
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
            disabled={
              bulk.isPending ||
              (kind === 'ASSIGN' && !assignee) ||
              (kind === 'TAG' && !tagId) ||
              (kind === 'STAGE' && !status)
            }
            className={kind === 'ARCHIVE' ? '!bg-danger hover:!bg-danger' : ''}
          >
            {bulk.isPending ? 'Saving…' : button}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The columns the export holds (the API's, in order): no SSN, EIN or date of birth. */
const EXPORT_COLUMNS =
  'Client, Type, Email, Phone, Stage, Services, Assigned to, Missing documents, Balance due, Last activity, Next appointment, Added, Archived';

/**
 * Export (Octavia's E2 additions): what will be exported before it is: the clients the list shows
 * now (its filters and search), how many, and the columns, then the CSV link. For the Owner and
 * anyone granted Clients EXPORT; the API checks again and records the export.
 */
export function ExportDialog({
  query,
  total,
  selected = false,
  onClose,
  onDone,
}: {
  query: ExportClientsRequest;
  total: number;
  /** Bulk Actions' Export Selected: the scope is the clients chosen. */
  selected?: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const exporting = useApiMutation((body: ExportClientsRequest) => api.clients.exportList(body));
  const count = Math.min(total, 5000);
  const noun = count === 1 ? 'client' : 'clients';
  return (
    <Modal
      open
      title="Export Clients"
      subtitle="A CSV file of the clients this list shows now."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={count === 0 || exporting.isPending}
            onClick={() =>
              exporting.mutate(query, {
                onSuccess: (link) => {
                  window.open(link.url, '_blank', 'noopener');
                  onDone(
                    `Exported ${link.rowCount} ${link.rowCount === 1 ? 'client' : 'clients'}.`,
                  );
                },
              })
            }
          >
            {exporting.isPending ? 'Exporting…' : `Export ${count} ${noun}`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text" data-testid="export-dialog">
        <p>
          <span className="font-semibold">Scope:</span>{' '}
          {selected
            ? `the ${count} ${noun} you selected.`
            : `the ${count} ${noun} the list shows with its filters and search${total > 5000 ? ` (the first 5,000 of ${total})` : ''}.`}
        </p>
        <p>
          <span className="font-semibold">Columns:</span> {EXPORT_COLUMNS}. Never an SSN, EIN or
          date of birth.
        </p>
        <p className="text-muted">The export is recorded in your firm&apos;s audit log.</p>
        {exporting.error ? (
          <p role="alert" className="text-danger">
            {errorMessage(exporting.error, CLIENT_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
