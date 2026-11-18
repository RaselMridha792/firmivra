'use client';

import { ApiRequestError, type AssignedFormRow, type IntakeStatus } from '@firmivra/types';
import { type ActionMenuItem, Button, Modal, Select } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  type Expiry,
  ExpiryField,
  expiryBody,
  expiryError,
  expiryFrom,
  useFirmTimeZone,
} from './expiry';

/**
 * Intake Forms Review Two, INTAKE-USABILITY-03: Assign Staff, Extend Expiration, Duplicate and
 * Archive straight from an assigned form (its detail and its row), each only where it is
 * permitted. Duplicate copies the exact version the form was sent with into a new draft to edit;
 * the form and its answers stay as they are. History is unchanged.
 */
export type ManageAction = 'assign' | 'extend' | 'duplicate' | 'archive';

const EXTENDABLE: readonly IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION', 'EXPIRED'];

/** The menu items this member may use on this form. */
export function manageItems(
  row: Pick<AssignedFormRow, 'status'>,
  manager: boolean,
  open: (action: ManageAction) => void,
): ActionMenuItem[] {
  if (row.status === 'ARCHIVED') return [];
  return [
    ...(manager ? [{ label: 'Assign Staff', onSelect: () => open('assign') }] : []),
    ...(EXTENDABLE.includes(row.status)
      ? [{ label: 'Extend Expiration', onSelect: () => open('extend') }]
      : []),
    ...(manager ? [{ label: 'Duplicate', onSelect: () => open('duplicate') }] : []),
    { label: 'Archive', onSelect: () => open('archive'), danger: true },
  ];
}

/** Owner and Admin manage the firm's forms (assign, duplicate). */
export function useManager(): boolean {
  const { role } = useFirm();
  return role === 'OWNER' || role === 'ADMIN';
}

/** Every Intake Forms query (the list, the detail) starts with this. */
const KEYS = ['intake-forms'];

/** The dialog of one action on one form. */
export function ManageDialog({
  action,
  row,
  onClose,
  notify,
}: {
  action: ManageAction;
  row: AssignedFormRow;
  onClose: () => void;
  notify: (text: string, tone?: 'success' | 'error') => void;
}) {
  if (action === 'assign') return <AssignDialog row={row} onClose={onClose} notify={notify} />;
  if (action === 'extend') return <ExtendDialog row={row} onClose={onClose} notify={notify} />;
  if (action === 'duplicate')
    return <DuplicateDialog row={row} onClose={onClose} notify={notify} />;
  return <ArchiveDialog row={row} onClose={onClose} notify={notify} />;
}

type DialogProps = {
  row: AssignedFormRow;
  onClose: () => void;
  notify: (text: string, tone?: 'success' | 'error') => void;
};

function AssignDialog({ row, onClose, notify }: DialogProps) {
  const team = useApiQuery(['team'], () => api.team.list());
  const [who, setWho] = useState(row.assignedTo?.userId ?? '');
  // USABILITY-03: only those who can take the form: the Owner and Admins, the client's or lead's
  // own staff member, and whoever has it now.
  const eligible = (team.data ?? []).filter(
    (m) =>
      m.status === 'ACTIVE' &&
      (m.role !== 'STAFF' ||
        m.user.id === row.recipient.assignedUserId ||
        m.user.id === row.assignedTo?.userId),
  );
  const save = useApiMutation(
    () => api.intakeForms.update(row.id, { assignedUserId: who || null }),
    { invalidate: KEYS },
  );
  return (
    <Modal
      open
      title="Assign Staff"
      subtitle={`Who looks after ${row.form.name} for ${row.recipient.name}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  notify(who ? 'Staff assigned.' : 'Nobody is assigned now.');
                  onClose();
                },
                onError: (e) => notify(errorMessage(e), 'error'),
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div data-testid="assign-dialog">
        <Select
          label="Assigned to"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          options={[
            { value: '', label: 'Not assigned' },
            ...eligible.map((m) => ({ value: m.user.id, label: m.user.name })),
          ]}
        />
        <p className="mt-2 text-sm text-muted" data-testid="assign-hint">
          Only staff who work with this client can be assigned.
        </p>
      </div>
    </Modal>
  );
}

function ExtendDialog({ row, onClose, notify }: DialogProps) {
  const timeZone = useFirmTimeZone();
  const [value, setValue] = useState<Expiry | null>(null);
  const [error, setError] = useState<string>();
  const current = value ?? (timeZone ? expiryFrom(row.expiresAt, timeZone) : null);
  const save = useApiMutation(
    (e: Expiry) => api.intakeForms.update(row.id, expiryBody(e, timeZone ?? 'UTC')),
    { invalidate: KEYS },
  );
  return (
    <Modal
      open
      title="Extend Expiration"
      subtitle="Choose when this form stops taking answers. An expired form opens again."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!current || save.isPending}
            onClick={() => {
              if (!current) return;
              const wrong = expiryError(current, timeZone, row.dueOn ?? '');
              if (wrong) return setError(wrong);
              setError(undefined);
              save.mutate(current, {
                onSuccess: () => {
                  notify('Expiration saved.');
                  onClose();
                },
                onError: (e) => {
                  const field =
                    e instanceof ApiRequestError
                      ? e.details?.find((d) => /^expires|^dueOn/.test(d.path))?.message
                      : undefined;
                  if (field) setError(field);
                  else notify(errorMessage(e), 'error');
                },
              });
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div data-testid="extend-dialog">
        {current ? (
          <ExpiryField
            value={current}
            onChange={setValue}
            error={error}
            allowDefault={false}
            label="Expiration"
          />
        ) : null}
      </div>
    </Modal>
  );
}

function DuplicateDialog({ row, onClose, notify }: DialogProps) {
  const router = useRouter();
  const record = useApiQuery(['intake-forms', 'manage', 'record', row.id], () =>
    api.intakeForms.record(row.id),
  );
  const copy = useApiMutation(
    () =>
      api.intakeForms.duplicateForm(row.form.id, false, record.data?.formVersionId ?? undefined),
    { invalidate: KEYS },
  );
  return (
    <Modal
      open
      title="Duplicate this form?"
      subtitle="A new draft with the same questions and settings as the version sent, to edit and send again. This form, its answers and its history stay as they are."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={record.isPending || copy.isPending}
            onClick={() =>
              copy.mutate(undefined, {
                onSuccess: (made) => {
                  notify('A draft copy was made.');
                  router.push(`/intake-forms/builder/${made.id}`);
                },
                onError: (e) => notify(errorMessage(e), 'error'),
              })
            }
          >
            Duplicate
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="duplicate-dialog">
        {row.form.name}
      </p>
    </Modal>
  );
}

function ArchiveDialog({ row, onClose, notify }: DialogProps) {
  const archive = useApiMutation(() => api.intakeForms.archive(row.id), { invalidate: KEYS });
  return (
    <Modal
      open
      title="Archive this form?"
      subtitle={`${row.form.name} for ${row.recipient.name} leaves the open lists. It is kept, with its answers and history.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            disabled={archive.isPending}
            onClick={() =>
              archive.mutate(undefined, {
                onSuccess: () => {
                  notify('Form archived.');
                  onClose();
                },
                onError: (e) => notify(errorMessage(e), 'error'),
              })
            }
          >
            Archive
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="archive-dialog">
        Clients can no longer open an archived form.
      </p>
    </Modal>
  );
}
