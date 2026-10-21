'use client';

import {
  FIRM_ROLE_LABELS,
  type FirmUser,
  type PermissionCapability,
  type PermissionModule,
  type PermissionOverrideMode,
} from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';

const OVERRIDE_ERRORS: Record<string, string> = {
  PERMISSION_NEEDS_VIEW: 'Give View first in each module where you allow anything else.',
  CANNOT_GRANT: 'You cannot change this person’s permissions.',
  FORBIDDEN: 'You cannot change this person’s permissions.',
  VALIDATION_FAILED: 'The Owner’s permissions cannot be changed.',
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
const MODES: { mode: PermissionOverrideMode; label: string }[] = [
  { mode: 'INHERIT', label: 'Inherit' },
  { mode: 'ALLOW', label: 'Allow' },
  { mode: 'DENY', label: 'Deny' },
];
const key = (m: string, c: string) => `${m}:${c}`;

/**
 * Individual Permissions (Octavia's review, section 3): each permission of one person is Inherit
 * (the role decides, in this firm), Allow or Deny; an override wins over the role, and Reset to
 * Inherit gives the cell back to the role. Only the cells changed here are sent
 * (`api.staff.setOverrides`); an Allow beyond the role asks first.
 */
export function PermissionsModal({
  user,
  onClose,
  onDone,
}: {
  user: FirmUser;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const own = useApiQuery(['staff', user.id, 'permissions'], () => api.staff.permissions(user.id));
  const role = useApiQuery(['roles', 'permissions', user.role], () =>
    api.roles.permissions(user.role),
  );
  const [picked, setPicked] = useState<PermissionModule>();
  const [draft, setDraft] = useState<Record<string, PermissionOverrideMode>>({});
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const saved = new Map<string, PermissionOverrideMode>();
  for (const c of own.data?.cells ?? [])
    saved.set(
      key(c.module, c.capability),
      c.source === 'MEMBER' ? (c.granted ? 'ALLOW' : 'DENY') : 'INHERIT',
    );
  const roleHas = new Set(
    (role.data?.cells ?? []).filter((c) => c.granted).map((c) => key(c.module, c.capability)),
  );
  const modeOf = (k: string) => draft[k] ?? saved.get(k) ?? 'INHERIT';
  const effective = (k: string) => {
    const m = modeOf(k);
    return m === 'INHERIT' ? roleHas.has(k) : m === 'ALLOW';
  };
  const list = modules.data?.modules ?? [];
  const current = list.find((m) => m.module === picked) ?? list[0];
  const changed = Object.entries(draft).filter(([k, m]) => (saved.get(k) ?? 'INHERIT') !== m);
  const overridesIn = (m: PermissionModule) =>
    list.find((x) => x.module === m)?.capabilities.filter((c) => modeOf(key(m, c)) !== 'INHERIT')
      .length ?? 0;
  const anyOverride = [...saved.values()].some((m) => m !== 'INHERIT');
  const loading = modules.isPending || own.isPending || role.isPending;
  const failed = modules.error ?? own.error ?? role.error;

  const save = async (acknowledgeEscalation: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      await api.staff.setOverrides(user.id, {
        overrides: changed.map(([k, mode]) => {
          const [module, capability] = k.split(':') as [PermissionModule, PermissionCapability];
          return { module, capability, mode };
        }),
        ...(acknowledgeEscalation ? { acknowledgeEscalation: true } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onDone(`${user.name}’s permissions are saved. They apply on their next request.`);
    } catch (e) {
      if (errorCode(e) === 'PERMISSION_ESCALATION') setAsking(true);
      else setError(errorMessage(e, OVERRIDE_ERRORS));
      setBusy(false);
    }
  };

  return (
    <Modal open title="Individual Permissions" onClose={onClose}>
      <div className="flex flex-col gap-4" data-testid="individual-permissions">
        <p className="text-sm text-text">
          {user.name} ({user.email}) is <strong>{FIRM_ROLE_LABELS[user.role]}</strong>. Inherit
          follows the role in this firm; Allow and Deny are theirs alone and win over the role.
        </p>
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(failed, OVERRIDE_ERRORS)}
          </p>
        ) : loading || !current ? (
          <p className="text-sm text-muted">Loading permissions…</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <ul
              aria-label="Modules"
              className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-divider text-sm"
            >
              {list.map((m) => {
                const n = overridesIn(m.module);
                const on = m.module === current.module;
                return (
                  <li key={m.module}>
                    <button
                      type="button"
                      aria-current={on || undefined}
                      onClick={() => setPicked(m.module)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${on ? 'bg-accent-soft font-medium text-heading' : 'hover:bg-canvas'}`}
                    >
                      <span>{m.label}</span>
                      {n ? (
                        <span className="rounded-pill bg-purple-soft px-1.5 text-xs text-purple">
                          {n}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <table className="w-full text-left text-sm" data-testid="override-cells">
              <caption className="mb-1 text-left font-semibold text-heading">
                {current.label}
              </caption>
              <thead className="bg-table-head">
                <tr>
                  <th scope="col" className="px-2 py-1 font-medium">
                    Permission
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-2 py-1 font-medium">
                    This person
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.capabilities.map((c) => {
                  const k = key(current.module, c);
                  return (
                    <tr key={k} className="border-b border-divider">
                      <th scope="row" className="px-2 py-1.5 font-normal">
                        {CAPABILITY_LABEL[c]}
                        <span className="block text-xs text-muted">
                          {effective(k) ? 'Has it' : 'Does not have it'}
                        </span>
                      </th>
                      <td className="px-2 py-1.5 text-muted">{roleHas.has(k) ? 'Yes' : 'No'}</td>
                      <td className="px-2 py-1.5">
                        <fieldset className="flex gap-1">
                          <legend className="sr-only">
                            {current.label} {CAPABILITY_LABEL[c]}
                          </legend>
                          {MODES.map(({ mode, label }) => (
                            <label
                              key={mode}
                              className={`cursor-pointer rounded-control border px-2 py-0.5 text-xs ${modeOf(k) === mode ? 'border-action bg-accent-soft text-action' : 'border-divider text-text'}`}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name={k}
                                checked={modeOf(k) === mode}
                                onChange={() => setDraft({ ...draft, [k]: mode })}
                              />
                              {label}
                            </label>
                          ))}
                        </fieldset>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {asking ? (
          <p role="alert" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-text">
            This gives {user.name} more than the {FIRM_ROLE_LABELS[user.role]} role has. Save
            anyway?
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            disabled={!anyOverride || busy}
            onClick={() => {
              const all: Record<string, PermissionOverrideMode> = {};
              for (const [k, m] of saved) if (m !== 'INHERIT') all[k] = 'INHERIT';
              setDraft(all);
              setAsking(false);
            }}
          >
            Reset all to Inherit
          </Button>
          <span className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!changed.length || busy} onClick={() => void save(asking)}>
              {busy ? 'Saving…' : asking ? 'Save Anyway' : 'Save Changes'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
