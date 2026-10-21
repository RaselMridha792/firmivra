'use client';

import { FIRM_ROLE_LABELS, type FirmUser, type PermissionCapability } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';

const ACCESS_ERRORS: Record<string, string> = {
  NOT_LOCKED: 'This account is not locked any more.',
  NOT_DEACTIVATED: 'Only an inactive account can be reactivated.',
  CANNOT_GRANT: 'You cannot change this person’s access.',
  FORBIDDEN: 'Only an Owner or an Admin can do this.',
};

const CAPABILITY_LABEL: Record<PermissionCapability, string> = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  DELETE: 'Delete',
  APPROVE: 'Approve',
  EXPORT: 'Export',
  MANAGE: 'Admin',
};

const LOOKS = {
  unlock: {
    title: 'Unlock Account',
    confirm: 'Unlock Account',
    what: 'The lock and its reason are cleared. Their password, role, overrides and two-factor sign-in stay as they are; they sign in as usual. Unlocking does not reset a password.',
  },
  reactivate: {
    title: 'Reactivate User',
    confirm: 'Reactivate',
    what: 'Access comes back with the saved role and overrides below, and their history stays. Old sessions stay ended: they sign in again with two-factor sign-in. Someone who never joined gets a new invitation instead.',
  },
} as const;

/**
 * Unlock Account and Reactivate User (Octavia's review, section 11): review who it is, their
 * company, saved role and own overrides, then confirm. The Staff routes do the work and the audit
 * (an inactive account is never unlocked into access; a lock is not lifted by reactivating).
 */
export function AccessModal({
  action,
  user,
  onClose,
  onDone,
}: {
  action: 'unlock' | 'reactivate';
  user: FirmUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const look = LOOKS[action];
  const own = useApiQuery(['staff', user.id, 'permissions'], () => api.staff.permissions(user.id));
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const overrides = (own.data?.cells ?? []).filter((c) => c.source === 'MEMBER');
  const label = (m: string) => modules.data?.modules.find((x) => x.module === m)?.label ?? m;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r =
        action === 'unlock' ? await api.staff.unlock(user.id) : await api.staff.reactivate(user.id);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      onDone(
        action === 'unlock'
          ? `${user.name}’s account is unlocked.`
          : r.status === 'INVITED'
            ? `${user.name} never joined, so a new invitation was sent.`
            : `${user.name} is active again.`,
      );
    } catch (e) {
      setError(errorMessage(e, ACCESS_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Modal open title={look.title} onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid={`${action}-user`}>
        <dl className="grid grid-cols-[7rem_1fr] gap-1 rounded-lg border border-divider p-3 text-sm">
          <dt className="text-muted">Employee</dt>
          <dd className="text-heading">{user.name}</dd>
          <dt className="text-muted">Work email</dt>
          <dd className="break-all text-heading">{user.email}</dd>
          <dt className="text-muted">Company</dt>
          <dd className="text-heading">{user.company}</dd>
          <dt className="text-muted">Saved role</dt>
          <dd className="text-heading">{user.customRole?.name ?? FIRM_ROLE_LABELS[user.role]}</dd>
        </dl>
        <section aria-label="Individual overrides" className="text-sm">
          <h3 className="font-semibold text-heading">Individual overrides</h3>
          {own.isError ? (
            <p className="text-muted">Could not load this person’s overrides.</p>
          ) : overrides.length === 0 ? (
            <p className="text-muted">
              {own.isPending ? 'Loading…' : 'None: they get exactly what the role gives.'}
            </p>
          ) : (
            <ul className="rounded-lg bg-canvas px-3 py-2">
              {overrides.map((c) => (
                <li key={`${c.module}:${c.capability}`}>
                  {label(c.module)} {CAPABILITY_LABEL[c.capability]}:{' '}
                  <span className={c.granted ? 'text-success' : 'text-danger'}>
                    {c.granted ? 'Allowed' : 'Denied'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="text-sm text-text">{look.what}</p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? 'Saving…' : look.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
