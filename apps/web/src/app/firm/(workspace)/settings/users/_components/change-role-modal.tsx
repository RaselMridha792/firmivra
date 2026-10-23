'use client';

import {
  FIRM_ROLE_LABELS,
  type FirmUser,
  type MembershipRole,
  type PermissionCapability,
  type PermissionModule,
} from '@firmivra/types';
import { Button, Modal, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { CUSTOM_ROLE_ERRORS, customKey } from './custom-roles';

const CHANGE_ERRORS: Record<string, string> = {
  ...CUSTOM_ROLE_ERRORS,
  CANNOT_GRANT: 'You cannot give this role, or change this person’s role.',
  SAVE_CONFLICT: 'This person’s record changed meanwhile. Close this and try again.',
  FORBIDDEN: 'Only an Owner or an Admin can change roles.',
  LAST_ADMIN: 'The firm needs at least one other active Owner or Admin first.',
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

/**
 * Change Role (Octavia's review, section 11): one person's role, from their row. Shows who they
 * are and their current role, previews the new role's permissions in this firm and lists the
 * person's own overrides, which stay and keep winning over the role. The firm's custom roles the
 * signed-in person may give are offered too (`account.customRoleId`, which brings the role it is
 * based on). Saves through Edit Staff's route (audited with the old and new role); their access
 * follows on their next request.
 */
export function ChangeRoleModal({
  user,
  onClose,
  onDone,
}: {
  user: FirmUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const roles = (options.data?.roles ?? []).filter((r) => r.role !== 'OWNER');
  const customs = options.data?.customRoles ?? [];
  /** A built-in role, or `custom:<id>`. */
  const [role, setRole] = useState('');
  const custom = customs.find((c) => customKey(c.id) === role);
  const builtIn = custom ? undefined : (role as MembershipRole | '');
  const current = user.customRole ? customKey(user.customRole.id) : user.role;
  const currentLabel = user.customRole?.name ?? FIRM_ROLE_LABELS[user.role];
  const newLabel = custom?.name ?? (builtIn ? FIRM_ROLE_LABELS[builtIn] : '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const preview = useApiQuery(['roles', 'permissions', role || 'none'], async () => {
    if (custom) return { cells: (await api.roles.customRole(custom.id)).cells };
    return builtIn ? api.roles.permissions(builtIn) : null;
  });
  const own = useApiQuery(['staff', user.id, 'permissions'], () => api.staff.permissions(user.id));
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const moduleName = (m: PermissionModule) =>
    modules.data?.modules.find((x) => x.module === m)?.label ?? m;
  const overrides = (own.data?.cells ?? []).filter((c) => c.source === 'MEMBER');
  const granted = new Map<PermissionModule, string[]>();
  for (const c of preview.data?.cells ?? [])
    if (c.granted)
      granted.set(c.module, [...(granted.get(c.module) ?? []), CAPABILITY_LABEL[c.capability]]);

  const save = async () => {
    if (!role) return;
    setBusy(true);
    setError(undefined);
    try {
      const record = await api.staff.get(user.id);
      await api.staff.update(user.id, {
        version: record.version,
        // A built-in role takes a custom role away, even the one it was based on.
        account: custom
          ? { customRoleId: custom.id }
          : { role: builtIn || user.role, customRoleId: null },
      });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      onDone(`${user.name} is now ${newLabel} (was ${currentLabel}).`);
    } catch (e) {
      setError(errorMessage(e, CHANGE_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Modal open title="Change Role" onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="change-role">
        <dl className="grid grid-cols-[7rem_1fr] gap-1 rounded-lg border border-divider p-3 text-sm">
          <dt className="text-muted">Employee</dt>
          <dd className="text-heading">{user.name}</dd>
          <dt className="text-muted">Work email</dt>
          <dd className="break-all text-heading">{user.email}</dd>
          <dt className="text-muted">Company</dt>
          <dd className="text-heading">{user.company}</dd>
          <dt className="text-muted">Current role</dt>
          <dd className="text-heading">{currentLabel}</dd>
        </dl>
        <Select
          label="New role *"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          options={[
            { value: '', label: options.isPending ? 'Loading roles…' : 'Choose a role' },
            ...roles
              .filter((r) => r.role !== current)
              .map((r) => ({ value: r.role, label: r.label })),
            ...customs
              .filter((c) => customKey(c.id) !== current)
              .map((c) => ({ value: customKey(c.id), label: `${c.name} (custom)` })),
          ]}
        />
        {role ? (
          <section aria-label="New role's permissions" className="flex flex-col gap-1 text-sm">
            <h3 className="font-semibold text-heading">What {newLabel} can do in this firm</h3>
            {preview.isError ? (
              <p className="text-danger">{errorMessage(preview.error, CHANGE_ERRORS)}</p>
            ) : preview.isPending ? (
              <p className="text-muted">Loading…</p>
            ) : granted.size === 0 ? (
              <p className="text-muted">Nothing: this role has no permissions yet.</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto rounded-lg bg-canvas px-3 py-2">
                {[...granted.entries()].map(([m, caps]) => (
                  <li key={m}>
                    <span className="text-heading">{moduleName(m)}</span>
                    <span className="text-muted">: {caps.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
        <section aria-label="Individual overrides" className="text-sm">
          <h3 className="font-semibold text-heading">Individual overrides</h3>
          {own.isError ? (
            <p className="text-muted">Could not load this person’s overrides.</p>
          ) : overrides.length === 0 ? (
            <p className="text-muted">
              {own.isPending ? 'Loading…' : 'None: they get exactly what the role gives.'}
            </p>
          ) : (
            <>
              <p className="text-muted">These stay and keep winning over the new role:</p>
              <ul className="rounded-lg bg-canvas px-3 py-2">
                {overrides.map((c) => (
                  <li key={`${c.module}:${c.capability}`}>
                    {moduleName(c.module)} {CAPABILITY_LABEL[c.capability]}:{' '}
                    <span className={c.granted ? 'text-success' : 'text-danger'}>
                      {c.granted ? 'Allowed' : 'Denied'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <p className="text-xs text-muted">
          Only {user.name}’s role changes; the role’s permissions and everyone else stay as they
          are. Their access follows on their next request.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!role || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Change Role'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
